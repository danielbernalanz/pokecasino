'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-npc-'));

const db = require('../server/db');
const hub = require('../server/hub');
const auth = require('../server/auth');
const config = require('../server/config');
const market = require('../server/market');
const gacha = require('../server/gacha');
const items = require('../server/items');
const { DEX, RARITY } = require('../server/pokedex');
const npc = require('../server/npc');

const DAY = 24 * 3600 * 1000;
// Jugador veterano (nivel 5, cuenta de varios días). Sin `progress`: así no cobra recompensas de misiones.
function user(name, extra = {}) {
  const u = { id: 'id-' + name, username: name, coins: 1_000_000, dust: 0, buddy: null, items: {}, buffs: {}, games: {}, collection: {}, stats: {}, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 5, createdAt: Date.now() - 5 * DAY, ...extra };
  db.addUser(u);
  delete u.progress;
  return u;
}
const N = (id) => db.userById('npc-' + id);
const npcs = () => Object.values(db.data.users).filter((u) => u.npc);
const poke = (id, shiny = false) => ({ kind: 'poke', pokeId: id, shiny });
const item = (itemId) => ({ kind: 'item', itemId });
const byRarity = (r) => DEX.find((p) => p.rarity === r).id;
// Deja el mercado sin órdenes de NPC (devuelve los depósitos).
function clearNpcOrders() {
  for (const o of [...db.data.market.orders]) if (o.npc) market.cancel(N(o.userId.slice(4)), { id: o.id });
}

npc.ensure();

test('NPC: cuentas creadas una sola vez, con fondo inicial apuntado y sin poder entrar', () => {
  const us = npcs();
  assert.strictEqual(us.length, 4);
  for (const u of us) {
    assert.match(u.username, /^[A-Za-z0-9_-]{3,16}$/);
    assert.ok(npc.isNpc(u) && u.npc === true);
    assert.strictEqual(u.coins, 60000);
    assert.strictEqual(u.hist.log.filter((l) => l.r === 'npc_fund').length, 1);
    assert.ok(!u.salt && !u.hash);
    assert.throws(() => auth.login({ username: u.username, password: 'cualquiera' }, '1.1.1.1'), /incorrectos/);
    assert.throws(() => auth.register({ username: u.username.toUpperCase(), password: 'secreto1', invite: config.ACCESS_KEY }, '1.1.1.1'), /en uso/);
    assert.strictEqual(auth.userFromToken(auth.hashPassword('x').hash), null);
  }
  assert.strictEqual(hub.econDay().src.npc_fund, 240000, 'el panel de economía ve el fondo');
  npc.ensure();
  assert.strictEqual(npcs().length, 4);
  assert.ok(npcs().every((u) => u.coins === 60000 && u.hist.log.filter((l) => l.r === 'npc_fund').length === 1), 'no se vuelve a financiar');
  assert.ok(!npc.isNpc(db.userById('nadie')) && !npc.isNpc({ username: 'x' }));
  // Con NPC ya creados, el primer jugador real sigue siendo el anfitrión.
  const first = auth.register({ username: 'primero', password: 'secreto1', invite: config.ACCESS_KEY }, '1.1.1.1');
  assert.strictEqual(first.user.isAdmin, true);
  assert.strictEqual(hub.publicUser(N('kecleon')).npc, true);
});

test('NPC: cada uno tiene un tope de compra por debajo del suelo de venta, para todos los artículos', () => {
  const all = [];
  for (const p of DEX) all.push(poke(p.id), poke(p.id, true));
  for (const id of Object.keys(items.ITEMS)) all.push(item(id));
  all.push({ kind: 'dust' });
  for (const a of all) {
    const b = npc.bounds(market.parseRef(a));
    assert.ok(b, JSON.stringify(a));
    assert.ok(b.cap >= 1 && b.floor >= 2 * b.cap, 'ask ≥ 2 × tope de compra: ' + JSON.stringify(a));
    assert.ok(Math.ceil(npc.FLASH.min * b.floor) > b.cap, 'incluso rebajado (80 % del suelo) supera el tope: ' + JSON.stringify(a));
    if (a.kind === 'poke') {
      const r = DEX.find((p) => p.id === a.pokeId).rarity;
      const release = RARITY[r].dust * gacha.DUST_RATE;
      const normal = npc.bounds(market.parseRef(poke(a.pokeId)));
      assert.ok(normal.cap <= release, 'vender a un NPC nunca supera a liberar el duplicado');
      assert.ok(normal.floor >= Math.max(2 * normal.cap, npc.POKE_FLOOR[r]));
      if (a.shiny) {
        assert.ok(b.cap <= 3 * normal.cap);
        assert.ok(b.floor >= 3 * normal.floor && b.floor >= 2.5 * b.cap);
      }
    }
    if (a.kind === 'item' && items.ITEMS[a.itemId].price) {
      const p = items.ITEMS[a.itemId].price;
      assert.ok(b.cap < p && b.floor >= p && b.cap <= 0.6 * p, 'objetos de tienda: nunca por debajo de la tienda');
    }
    if (a.kind === 'dust') assert.ok(b.cap <= gacha.DUST_RATE - 1 && b.floor >= 2 * gacha.DUST_RATE, 'polvo: nunca el tipo de cambio exacto');
  }
  assert.deepStrictEqual(npc.bounds(market.parseRef(item('master-ball'))), { cap: 2300, floor: 9000 });
  // Suelos nuevos de Pokémon normales y cosméticos.
  assert.deepStrictEqual(['C', 'U', 'R', 'E', 'L', 'M'].map((r) => npc.bounds(market.parseRef(poke(byRarity(r)))).floor), [90, 200, 500, 1500, 9000, 18000]);
  assert.deepStrictEqual(['C', 'U', 'R', 'E', 'L'].map((r) => npc.bounds(market.parseRef(item(Object.keys(items.ITEMS).find((i) => items.ITEMS[i].cosmetic && !items.ITEMS[i].event && items.ITEMS[i].rarity === r)))).floor), [150, 350, 900, 2700, 9000]);
});

test('NPC: vender al tope de compra de un NPC rinde menos que una tirada de gacha cuesta', () => {
  const ev = Object.entries(gacha.RATES).reduce((s, [r, rate]) => s + rate * npc.maxBid(r), 0);
  // Margen: ≈ 80-84 monedas por tirada frente a 101 (el 75 % de 135 de una tirada del ×10).
  assert.ok(ev < 0.75 * gacha.COST[10] / 10, `EV ${ev}`);
  // Incluso contando el variocolor (1/64 de las tiradas, al triple).
  assert.ok(ev * (1 + 3 * gacha.SHINY_RATE) < 0.75 * gacha.COST[10] / 10);
  // Y el suelo de las legendarias no baja del coste esperado de una legendaria al azar con tiradas sueltas.
  assert.ok(npc.POKE_FLOOR.L >= gacha.COST[1] / gacha.RATES.L, `L ${npc.POKE_FLOOR.L} vs ${gacha.COST[1] / gacha.RATES.L}`);
});

test('NPC: comprar a un NPC y venderle de vuelta siempre pierde monedas', () => {
  const sample = [
    poke(byRarity('C')), poke(byRarity('U')), poke(byRarity('R')), poke(byRarity('E')), poke(byRarity('L')), poke(byRarity('M')),
    poke(byRarity('C'), true), poke(byRarity('M'), true),
    item('ticket'), item('rare-candy'), item('amulet-coin'), item('master-ball'), item('shiny-charm'), item('mystery-egg'),
    item('frame-poke'), item('back-mew'), item('title-legend'), { kind: 'dust' },
  ];
  const seller = N('kecleon');
  const bidder = N('bill');
  let i = 0;
  for (const raw of sample) {
    const a = market.parseRef(raw);
    const b = npc.bounds(a);
    const p = user('arb' + i++, { level: 50 }); // límite diario 30.000: cabe un variocolor mítico
    // El NPC vende su stock al precio más bajo que se permite.
    if (a.kind === 'poke') seller.collection[a.pokeId] = { n: 1, s: a.shiny ? 1 : 0 };
    else if (a.kind === 'item') seller.items[a.itemId] = 1;
    else seller.dust = 10;
    seller.coins = 60000;
    bidder.coins = 60000;
    delete npc.state().spent[bidder.id]; // cupo de gasto diario nuevo para cada caso
    market.sell(seller, { ...raw, qty: 1, price: b.floor });
    // Y otro NPC pide al precio más alto que se permite.
    market.buy(bidder, { ...raw, qty: 1, price: b.cap });
    const before = p.coins;
    market.buy(p, { ...raw, qty: 1, price: b.floor, instant: true });
    market.sell(p, { ...raw, qty: 1, price: b.cap, instant: true });
    assert.ok(p.coins < before, `${JSON.stringify(raw)}: ${before} → ${p.coins}`);
    clearNpcOrders();
  }
  assert.strictEqual(db.data.market.trades.filter((t) => t.sellerNpc && t.buyerNpc).length, 0);
});

test('NPC: dos órdenes de NPC jamás se cruzan entre sí', () => {
  const k = N('kecleon');
  const b = N('bill');
  k.items.ticket = 5;
  // Saltándose los precios normales: el pedido de Bill está muy por encima de la oferta de Kecleon.
  market.sell(k, { ...item('ticket'), qty: 2, price: 100 });
  market.buy(b, { ...item('ticket'), qty: 2, price: 5000 });
  const o = db.data.market.orders.filter((x) => x.npc && x.ref === 'item:ticket');
  assert.strictEqual(o.length, 2, 'las dos siguen publicadas');
  assert.ok(o.every((x) => x.qty === 2));
  assert.throws(() => market.buy(b, { ...item('ticket'), qty: 1, price: 5000, instant: true }), /No hay ofertas/);
  assert.throws(() => market.sell(k, { ...item('ticket'), qty: 1, price: 50, instant: true }), /No hay pedidos/);
  clearNpcOrders();
});

test('NPC: operaciones entre jugadores a precios absurdos no mueven al NPC fuera de sus límites', () => {
  const players = ['m1', 'm2', 'm3', 'm4'].map((n) => user(n, { collection: { 19: { n: 5, s: 0 }, 150: { n: 5, s: 0 } }, coins: 100_000_000 }));
  const dear = market.parseRef(poke(19));
  const cheap = market.parseRef(poke(150));
  for (let i = 0; i < 6; i++) {
    const [s, b] = [players[i % 4], players[(i + 1) % 4]];
    market.sell(s, { ...poke(19), qty: 1, price: 9_000_000 });
    market.buy(b, { ...poke(19), qty: 1, price: 9_000_000, instant: true });
    market.sell(b, { ...poke(150), qty: 1, price: 1 });
    market.buy(s, { ...poke(150), qty: 1, price: 1, instant: true });
  }
  assert.strictEqual(npc.reference(dear.ref), 9_000_000);
  assert.strictEqual(npc.reference(cheap.ref), 1);
  for (const p of npc.NPCS) {
    for (let i = 0; i < 50; i++) {
      for (const a of [dear, cheap]) {
        const bd = npc.bounds(a);
        const bid = npc.bidPrice(a, p);
        const ask = npc.askPrice(a, p);
        assert.ok(bid >= 1 && bid <= bd.cap, `bid ${bid} > cap ${bd.cap}`);
        assert.ok(ask >= bd.floor && ask <= bd.floor * 8, `ask ${ask} < floor ${bd.floor}`);
        assert.ok(bid < ask);
      }
    }
  }
  // Una sola persona operando consigo misma (un único vendedor) no cuenta como mercado.
  const solo = market.parseRef(poke(25));
  const [a1, a2] = [user('wash1', { collection: { 25: { n: 5, s: 0 } } }), user('wash2')];
  for (let i = 0; i < 4; i++) { market.sell(a1, { ...poke(25), qty: 1, price: 777 }); market.buy(a2, { ...poke(25), qty: 1, price: 777, instant: true }); }
  assert.strictEqual(npc.reference(solo.ref), null);
});

test('NPC: invariante global, la puja más alta de cualquier NPC es menor que la oferta más baja de cualquiera', () => {
  const articles = [poke(1), poke(byRarity('M')), poke(1, true), item('ticket'), item('master-ball'), item('frame-poke'), { kind: 'dust' }].map(market.parseRef);
  for (const a of articles) {
    let hi = 0;
    let lo = Infinity;
    for (const med of [null, 1, 50, 10_000_000]) {
      for (const p of npc.NPCS) {
        for (let i = 0; i < 30; i++) for (const have of [0, 1, 2, 5, 30]) for (const demand of [false, true]) {
          hi = Math.max(hi, npc.bidPrice(a, p, med, { have, demand })); lo = Math.min(lo, npc.askPrice(a, p, med, { have }));
        }
      }
    }
    assert.ok(hi < lo, `${a.ref}: ${hi} vs ${lo}`);
  }
  // Y con precios flash (80 % del suelo) y con la prima de encargo (1,5 × tope) para TODO artículo.
  for (const id of Object.keys(items.ITEMS)) for (const a of [item(id)]) {
    const b = npc.bounds(market.parseRef(a));
    if (b) assert.ok(1.5 * b.cap < npc.FLASH.min * b.floor || !npc.flashEligible(a), id);
  }
  for (const p of DEX) for (const sh of [false, true]) {
    const a = market.parseRef(poke(p.id, sh));
    const b = npc.bounds(a);
    assert.ok(b.cap < npc.flashFloor(a) || !npc.flashEligible(a), a.ref);
    assert.ok(1.5 * b.cap < b.floor, 'incluso con la prima de encargo (1,5 × tope) se paga menos que el suelo: ' + a.ref);
  }
});

test('NPC: límites diarios por jugador (monedas y unidades) al venderles', () => {
  clearNpcOrders();
  const g = N('ginger');
  const p = user('vendedor-npc', { items: { 'rare-candy': 14, 'master-ball': 3 }, level: 10 });
  const limit = npc.sellLimit(p); // 5000 + 500 × 10
  assert.strictEqual(limit, 10000);
  const candy = npc.bounds(market.parseRef(item('rare-candy'))).cap; // 517
  const egg = npc.bounds(market.parseRef(item('master-ball'))).cap; // 2300
  market.buy(g, { ...item('rare-candy'), qty: 12, price: candy });
  market.buy(g, { ...item('master-ball'), qty: 3, price: egg });
  const r1 = market.sell(p, { ...item('rare-candy'), qty: 12, price: candy, instant: true });
  assert.strictEqual(r1.filled, 10, 'como mucho 10 unidades por artículo');
  const r2 = market.sell(p, { ...item('master-ball'), qty: 3, price: egg, instant: true });
  assert.strictEqual(r2.filled, Math.min(10, Math.floor((limit - 10 * candy) / egg)), 'caben los que entran en el límite diario de monedas (y 10 unidades)');
  const rec = npc.state().daily[p.id];
  assert.strictEqual(rec.got, 10 * candy + r2.filled * egg);
  assert.ok(rec.got <= limit);
  assert.throws(() => market.sell(p, { ...item('rare-candy'), qty: 1, price: candy, instant: true }), /Hoy ya no puedes vender/);
  // Sin instantáneo, el resto queda publicado y los pedidos de NPC no se tocan.
  const before = db.data.market.orders.filter((o) => o.npc).reduce((s, o) => s + o.qty, 0);
  const r3 = market.sell(p, { ...item('rare-candy'), qty: 2, price: candy });
  assert.strictEqual(r3.filled, 0);
  assert.ok(r3.order);
  assert.strictEqual(db.data.market.orders.filter((o) => o.npc).reduce((s, o) => s + o.qty, 0), before);
  // Un día después los contadores vuelven a cero.
  rec.day = '2000-01-01';
  assert.strictEqual(market.sell(p, { ...item('rare-candy'), qty: 2, price: candy, instant: true }).filled, 2);
  clearNpcOrders();
});

test('NPC: las cuentas nuevas o de nivel bajo no pueden venderles, pero sí comprarles', () => {
  const g = N('ginger');
  const low = user('novato-lvl', { level: 2, items: { 'master-ball': 2 } });
  // Cuenta creada después de que llegaran los NPC: tiene que esperar 24 h.
  const young = user('novato-edad', { level: 9, createdAt: Date.now() + 1000, items: { 'master-ball': 2 } });
  // Cuenta que ya existía antes de los NPC: no espera.
  const veteran = user('veterana', { level: 3, createdAt: (db.data.npc.launchedAt || Date.now()) - 1000, items: {} });
  const legacy = user('sin-fecha', { level: 3, createdAt: undefined, items: { 'master-ball': 2 } });
  market.buy(g, { ...item('master-ball'), qty: 3, price: 1800 });
  const bids = () => db.data.market.orders.filter((o) => o.npc && o.side === 'buy').reduce((s, o) => s + o.qty, 0);
  for (const u of [low, young]) {
    assert.ok(!npc.eligible(u));
    assert.throws(() => market.sell(u, { ...item('master-ball'), qty: 1, price: 1800, instant: true }), u === low ? /nivel 3 o más \(tienes nivel 2\)/ : /más de 24 h: podrás venderles dentro de \d+ h/);
    assert.strictEqual(market.sell(u, { ...item('master-ball'), qty: 1, price: 1800 }).filled, 0, 'orden normal: sin llenado contra NPC');
  }
  assert.strictEqual(bids(), 3);
  assert.ok(npc.eligible(legacy), 'sin createdAt solo cuenta el nivel');
  assert.ok(npc.eligible(veteran), 'las cuentas anteriores a los NPC no esperan 24 h');
  assert.strictEqual(market.sell(legacy, { ...item('master-ball'), qty: 1, price: 1800, instant: true }).filled, 1, 'nivel 3: límite 1.800');
  clearNpcOrders();
  // Comprar sí pueden, con un máximo de 20 unidades por artículo y día.
  const k = N('kecleon');
  k.items.ticket = 30;
  market.sell(k, { ...item('ticket'), qty: 30, price: 200 });
  low.coins = 100000;
  const r = market.buy(low, { ...item('ticket'), qty: 25, price: 200, instant: true });
  assert.strictEqual(r.filled, 20);
  assert.throws(() => market.buy(low, { ...item('ticket'), qty: 1, price: 200, instant: true }), /Hoy ya no puedes comprar/);
  clearNpcOrders();
});

test('NPC: tesorería finita y gasto diario', () => {
  clearNpcOrders();
  const k = N('kecleon');
  const g = N('ginger');
  // Gasto diario: 15 % de la tesorería (9.000 de 60.000).
  const p = user('proveedor', { items: { 'master-ball': 9 }, level: 50 });
  g.coins = 60000;
  delete npc.state().spent[g.id];
  market.buy(g, { ...item('master-ball'), qty: 3, price: 2000 });
  market.sell(p, { ...item('master-ball'), qty: 3, price: 2000, instant: true });
  assert.strictEqual(npc.state().spent[g.id].amt, 6000);
  npc.state().spent[g.id].amt = npc.state().spent[g.id].base; // ya gastó todo el cupo
  assert.strictEqual(npc.cap(p, g, market.parseRef(item('master-ball')), 2000), 0);
  clearNpcOrders();
  // Con menos del 20 % de la tesorería inicial no pujan: solo venden.
  k.coins = 0.19 * k.npcStart;
  k.items.ticket = 3;
  const r = npc.act(k);
  assert.strictEqual(r.bids, 0);
  assert.ok(!db.data.market.orders.some((o) => o.npc && o.userId === k.id && o.side === 'buy'));
  clearNpcOrders();
  k.coins = 60000;
});

test('NPC: el reabastecimiento diario crea C/U/R/E, a veces una legendaria no destacada y huevos; nunca míticos ni variocolores', () => {
  const featured = new Set(gacha.BANNERS.flatMap((b) => b.featuredL || []));
  let legends = 0;
  for (let day = 0; day < 40; day++) {
    for (const u of npcs()) { u.collection = {}; u.items = {}; }
    delete npc.state().restockDay;
    const r = npc.restock();
    assert.ok(r.poke <= 10 && r.eggs <= 2 && r.rare >= 0 && r.rare <= 4 && r.epic <= 2 && r.legend <= 1);
    assert.strictEqual(npc.restock().poke, 0, 'solo una vez al día');
    for (const u of npcs()) {
      for (const id of Object.keys(u.collection)) {
        const rar = DEX.find((p) => p.id === Number(id)).rarity;
        assert.ok(['C', 'U', 'R', 'E', 'L'].includes(rar), 'nunca míticos');
        if (rar === 'L') { legends++; assert.ok(!featured.has(Number(id)), 'la legendaria no es destacada de ningún banner'); assert.strictEqual(u.id, 'npc-dorado'); }
      }
      assert.ok(Object.values(u.collection).every((c) => c.s === 0), 'nunca variocolores');
      assert.deepStrictEqual(Object.keys(u.items).filter((i) => i !== 'mystery-egg'), [], 'ni Master Ball ni megapiedras');
    }
  }
  assert.ok(legends >= 8 && legends <= 32, `≈ 1 legendaria cada 2 días: ${legends}/40`);
  // La legendaria que sale al mercado nunca baja del coste esperado de una legendaria al azar en el gacha.
  const l = market.parseRef(poke(byRarity('L')));
  for (const p of npc.NPCS) for (let i = 0; i < 20; i++) assert.ok(npc.askPrice(l, p, null, { have: 1 + (i % 6) }) >= gacha.COST[1] / gacha.RATES.L);
  for (const u of npcs()) { u.collection = {}; u.items = {}; }
});

test('NPC: la visita respeta límites, no repite pedido y oferta, y marca sus órdenes', () => {
  clearNpcOrders();
  const seller = user('ofrece', { collection: { 19: { n: 5, s: 0 }, 149: { n: 3, s: 0 } }, items: { 'rare-candy': 5 } });
  market.sell(seller, { ...poke(19), qty: 2, price: 500 });
  market.sell(seller, { ...poke(149), qty: 1, price: 6000 });
  market.sell(seller, { ...item('rare-candy'), qty: 2, price: 1200 });
  for (const u of npcs()) {
    u.collection = { 16: { n: 2, s: 0 }, 144: { n: 1, s: 1 } };
    u.items = { ticket: 3, 'master-ball': 1, 'mystery-egg': 2, 'back-mew': 1 };
    u.dust = 200;
    for (let i = 0; i < 6; i++) npc.act(u);
    const mine = db.data.market.orders.filter((o) => o.userId === u.id && o.qty > 0);
    assert.ok(mine.length <= 25);
    for (const o of mine) {
      const b = npc.bounds(market.parseRef(o));
      assert.ok(o.npc === true);
      assert.ok(o.side === 'buy' ? o.price <= b.cap : o.price >= b.floor, `${o.side} ${o.ref} ${o.price}`);
      assert.ok(!mine.some((x) => x !== o && x.ref === o.ref && x.side !== o.side));
    }
  }
  const st = market.state();
  assert.ok(st.orders.some((o) => o.npc === true));
  assert.ok(st.orders.filter((o) => !o.npc).every((o) => o.npc === undefined));
  clearNpcOrders();
});

test('NPC: operaciones con NPC se marcan y no ensucian la media de precios de los jugadores', () => {
  const g = N('ginger');
  delete npc.state().spent[g.id];
  g.coins = 60000;
  const p = user('cliente', { items: { 'master-ball': 1 } });
  market.buy(g, { ...item('master-ball'), qty: 1, price: 1800 });
  const hist = JSON.stringify(db.data.market.history['item:master-ball'] || {});
  market.sell(p, { ...item('master-ball'), qty: 1, price: 1800, instant: true });
  const t = market.state().trades[0];
  assert.deepStrictEqual([t.npc, t.buyerNpc, t.sellerNpc], [true, true, false]);
  assert.strictEqual(JSON.stringify(db.data.market.history['item:master-ball'] || {}), hist, 'la historia de precios no cambia');
  clearNpcOrders();
});

test('NPC: conservación de monedas con jugadores y NPC operando (solo bajan comisiones e impuestos)', () => {
  clearNpcOrders();
  const players = Array.from({ length: 4 }, (_, i) => user('cons' + i, {
    coins: 50000, dust: 3000, level: 8,
    collection: { 16: { n: 5, s: 0 }, 19: { n: 5, s: 1 }, 149: { n: 4, s: 0 }, 144: { n: 3, s: 1 } },
    items: { ticket: 30, 'rare-candy': 30, 'master-ball': 10, 'mystery-egg': 10, 'frame-poke': 3, 'back-mew': 3 },
  }));
  const holders = Object.values(db.data.users); // también quien dejó órdenes de otros tests
  const total = () => holders.reduce((s, u) => s + u.coins + market.lockedIn(u), 0);
  const sinks = () => { const d = hub.econDay(); return (d.sink.market_fee || 0) + (d.sink.market_tax || 0); };
  const created = () => Object.values(hub.econDay().src).reduce((s, v) => s + v, 0);
  const t0 = total();
  const s0 = sinks();
  const c0 = created();
  const articles = [poke(16), poke(19), poke(149), poke(144, true), item('ticket'), item('rare-candy'), item('master-ball'), item('mystery-egg'), item('frame-poke'), item('back-mew'), { kind: 'dust' }];
  for (let i = 0; i < 300; i++) {
    if (i % 3 === 0) npc.run();
    if (i % 60 === 30) { npc.newEncargo(); npc.newFlash(); } // encargos y ofertas flash también conservan las monedas
    const a = articles[Math.floor(Math.random() * articles.length)];
    const p = players[Math.floor(Math.random() * players.length)];
    const b = npc.bounds(market.parseRef(a));
    const qty = a.kind === 'dust' ? 20 + Math.floor(Math.random() * 80) : 1 + Math.floor(Math.random() * 3);
    // Precios alrededor de los límites de los NPC, para que haya cruces con ellos y con jugadores.
    const price = Math.max(1, Math.round((Math.random() < 0.5 ? b.cap : b.floor) * (0.8 + Math.random() * 0.5)));
    const instant = Math.random() < 0.4;
    try {
      if (Math.random() < 0.5) market.sell(p, { ...a, qty, price, instant });
      else market.buy(p, { ...a, qty, price, instant });
    } catch { /* sin contrapartida, sin límite, sin saldo… */ }
    if (Math.random() < 0.05) {
      const mine = db.data.market.orders.filter((o) => o.userId === p.id);
      if (mine.length) market.cancel(p, { id: mine[0].id });
    }
  }
  assert.strictEqual(created(), c0, 'nadie crea monedas');
  assert.strictEqual(total(), t0 - (sinks() - s0), 'solo salen comisiones e impuestos');
  assert.strictEqual(db.data.market.trades.filter((t) => t.sellerNpc && t.buyerNpc).length, 0);
  assert.ok(db.data.market.trades.some((t) => t.npc), 'hubo operaciones con NPC');
  for (const u of players) {
    const r = npc.state().daily[u.id];
    if (r) { assert.ok(r.got <= npc.sellLimit(u)); for (const [ref, n] of Object.entries(r.sold)) assert.ok(n <= npc.SELL_UNITS[ref === 'dust' ? 'dust' : ref.startsWith('item:') ? 'item' : 'poke']); }
  }
  clearNpcOrders();
});

test('NPC: pujan al 90-100 % del tope con demanda o poco stock, 70-85 % si no, y piden menos cuanto más stock tienen', () => {
  const a = market.parseRef(poke(byRarity('R')));
  const { cap, floor } = npc.bounds(a);
  for (const p of npc.NPCS) {
    for (let r = 0; r <= 1; r += 0.25) {
      const hot = npc.bidPrice(a, p, null, { have: 0, r });
      const hotDemand = npc.bidPrice(a, p, null, { have: 4, demand: true, r });
      const cold = npc.bidPrice(a, p, null, { have: 3, demand: false, r });
      assert.ok(hot <= cap && hotDemand <= cap && cold <= cap, 'nunca por encima del tope');
      assert.ok(hot >= 0.85 * cap && hotDemand >= 0.85 * cap, `con demanda/poco stock se acerca al tope: ${hot}/${cap}`);
      assert.ok(cold <= 0.9 * cap && cold >= 0.6 * cap, `sin demanda: ${cold}/${cap}`);
      assert.ok(hot >= cold);
    }
    // Más stock → más barato (hasta el suelo) y menos pujan.
    const asks = [0, 1, 2, 3, 4, 8].map((have) => npc.askPrice(a, p, null, { have, r: 0.5 }));
    for (let i = 1; i < asks.length; i++) assert.ok(asks[i] <= asks[i - 1] && asks[i] >= floor, asks.join());
    assert.ok(asks[0] > asks[5] || asks[0] === floor);
    const bids = [2, 4, 8].map((have) => npc.bidPrice(a, p, null, { have, demand: false, r: 0.5 }));
    assert.ok(bids[0] >= bids[1] && bids[1] >= bids[2]);
    // Con precio de referencia de jugadores también.
    assert.ok(npc.bidPrice(a, p, 300, { have: 0, r: 0.5 }) >= npc.bidPrice(a, p, 300, { have: 6, r: 0.5 }));
  }
});

test('NPC: el premio de cada encargo nunca supera el hueco suelo − (1,5 × tope): comprar y vender de vuelta pierde siempre', () => {
  for (const p of npc.NPCS) {
    for (const a of npc.encArticles(p)) {
      const b = npc.bounds(a);
      const r = a.kind === 'poke' ? DEX.find((x) => x.id === a.pokeId).rarity : items.ITEMS[a.itemId].rarity;
      assert.ok(['R', 'E', 'L'].includes(r), 'solo raras, épicas y legendarias');
      assert.ok(!a.shiny && !(a.kind === 'item' && items.ITEMS[a.itemId].event));
      for (const [type, n] of npc.BONUS[r]) {
        assert.ok(['ticket', 'egg', 'frag'].includes(type), 'el premio nunca son monedas');
        const v = npc.bonusValue({ type, n });
        const paid = Math.ceil(1.5 * b.cap); // tope + prima
        assert.ok(b.floor - paid > v, `${a.ref}: suelo ${b.floor} − ${paid} ≤ premio ${v}`);
        if (npc.flashEligible(a)) assert.ok(npc.flashFloor(a) - paid > v, `${a.ref} en oferta flash`);
      }
    }
  }
});

function resetSpecial() {
  clearNpcOrders();
  db.data.market.orders = db.data.market.orders.filter((o) => o.npc); // sin órdenes de jugadores de otros tests (no cruzan con las de los NPC)
  const n = npc.state();
  n.enc = []; n.flash = []; n.feed = { day: null, n: 0 };
  for (const u of npcs()) { u.coins = 60000; u.collection = {}; u.items = {}; }
  n.spent = {};
}
const fromRef = (ref) => { const [k, x, y] = ref.split(':'); return market.parseRef(k === 'poke' ? poke(Number(x), y === '1') : item(x)); };
const snap = (u) => ({ coins: u.coins, ticket: u.items.ticket || 0, egg: u.items['mystery-egg'] || 0, frag: (u.mega && u.mega.frags) || 0 });

test('NPC: encargos: premio extra que no son monedas, una vez por encargo y jugador y 2 al día', () => {
  resetSpecial();
  const made = [];
  for (let i = 0; i < 80 && made.length < 3; i++) {
    const e = npc.newEncargo();
    if (!e) continue;
    const o = db.data.market.orders.find((x) => x.id === e.orderId);
    if (o.qty >= 2) made.push(e); // (los cosméticos L muy caros salen con 1 unidad: se descartan para este test)
    else { npc.state().enc = npc.state().enc.filter((x) => x !== e); market.cancel(db.userById(e.npc), { id: o.id }); }
  }
  assert.strictEqual(made.length, 3);
  for (const e of made) {
    assert.ok(e.expiresAt - e.createdAt >= 2 * 3600e3 && e.expiresAt - e.createdAt <= 6 * 3600e3, 'dura 2-6 h');
    assert.ok(['ticket', 'egg', 'frag'].includes(e.bonus.type));
    const b = npc.bounds(fromRef(e.ref));
    assert.ok(e.price <= b.cap, 'el pedido se publica al precio normal (≤ tope)');
  }
  const pub = npc.publicState().encargos;
  assert.strictEqual(pub.length, 3);
  assert.ok(pub.every((e) => e.orderId && e.qty >= 1 && e.expiresAt > Date.now()));
  const owns = (ids) => Object.fromEntries(ids.map((id) => [id, { n: 5, s: 0 }]));
  const mk = (name, extra = {}) => user(name, { level: 60, collection: owns(made.filter((e) => e.ref.startsWith('poke:')).map((e) => Number(e.ref.split(':')[1]))), items: Object.fromEntries(made.filter((e) => e.ref.startsWith('item:')).map((e) => [e.ref.slice(5), 5])), ...extra });
  const sellTo = (p, e) => { const a = fromRef(e.ref); const before = snap(p); market.sell(p, { ...a, qty: 1, price: e.price, instant: true }); return { a, before, after: snap(p) }; };
  const taxOf = (price) => Math.floor(price * market.state().salesTax);
  const p1 = mk('enc-uno');
  const extras = [];
  for (const e of made) {
    const { a, before, after } = sellTo(p1, e);
    const b = npc.bounds(a);
    const got = after.coins - before.coins - (e.price - taxOf(e.price));
    const gotBonus = e.bonus.type === 'frag' ? after.frag - before.frag : e.bonus.type === 'egg' ? after.egg - before.egg : after.ticket - before.ticket;
    if (extras.length < 2) {
      assert.strictEqual(got, Math.floor(e.price * 0.5), 'prima del 50 % del precio cobrado');
      assert.ok(got <= 0.5 * b.cap && e.price + got <= 1.5 * b.cap, 'como mucho 1,5 × tope');
      assert.ok(gotBonus >= 1 || e.bonus.type === 'frag', 'premio entregado');
      extras.push(got);
    } else {
      assert.strictEqual(got, 0, 'el tercer encargo del día ya no paga prima');
      assert.strictEqual(gotBonus, 0, 'ni premio');
    }
  }
  assert.strictEqual(npc.state().daily[p1.id].enc, 2, 'como mucho 2 premios por jugador y día');
  // Cota diaria de la prima de monedas: 2 × 0,5 × tope máximo de un artículo de encargo.
  const maxCap = Math.max(...npc.NPCS.flatMap((p) => npc.encArticles(p).map((a) => npc.bounds(a).cap)));
  assert.ok(extras.reduce((t, x) => t + x, 0) <= 2 * 0.5 * maxCap);
  // Una vez por encargo: vender otra unidad al mismo encargo no vuelve a pagar premio.
  const again = sellTo(p1, made[0]);
  assert.strictEqual(again.after.ticket + again.after.egg + again.after.frag, again.before.ticket + again.before.egg + again.before.frag);
  assert.strictEqual(again.after.coins - again.before.coins, made[0].price - taxOf(made[0].price));
  // Otro jugador sí cobra el mismo encargo.
  const p2 = mk('enc-dos');
  const o = sellTo(p2, made[1]);
  assert.strictEqual(o.after.coins - o.before.coins, made[1].price - taxOf(made[1].price) + Math.floor(made[1].price * 0.5));
  // Solo jugadores elegibles: nivel bajo o cuenta nueva no pueden venderles, así que no hay premio.
  const low = mk('enc-bajo', { level: 2 });
  const young = mk('enc-joven', { level: 20, createdAt: Date.now() + 1000 });
  for (const u of [low, young]) {
    const before = snap(u);
    assert.throws(() => sellTo(u, made[2]), /NPC solo compran/);
    assert.deepStrictEqual(snap(u), before);
  }
  // Pasado el plazo, el encargo desaparece y se devuelve el depósito.
  npc.sweepSpecial(Date.now() + 7 * 3600e3);
  assert.strictEqual(npc.state().enc.length, 0);
  assert.strictEqual(npc.publicState().encargos.length, 0);
  assert.ok(!db.data.market.orders.some((x) => x.npc && x.enc));
  resetSpecial();
});

test('NPC: una oferta flash rebaja un 15-25 %, nunca por debajo del 80 % del suelo ni de ninguna puja de NPC', () => {
  resetSpecial();
  const g = N('ginger');
  g.items['mystery-egg'] = 3;
  N('bill').collection = { 19: { n: 2, s: 0 }, 149: { n: 1, s: 0 } };
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const f = npc.newFlash();
    if (!f) { npc.sweepSpecial(Date.now() + 3 * 3600e3); continue; }
    seen.add(f.ref);
    const a = fromRef(f.ref);
    const b = npc.bounds(a);
    assert.ok(npc.flashEligible(a));
    assert.ok(f.price >= npc.flashFloor(a) && f.price >= 0.8 * b.floor);
    assert.ok(f.price < f.normal && f.price <= f.normal * 0.85 + 1, `rebaja: ${f.price} de ${f.normal}`);
    for (const p of npc.NPCS) for (const have of [0, 1, 5]) for (const demand of [false, true]) assert.ok(npc.bidPrice(a, p, null, { have, demand, r: 1 }) < f.price, 'puja más alta < oferta flash');
    assert.ok(npc.bounds(a).cap < f.price);
    const o = db.data.market.orders.find((x) => x.id === f.orderId);
    assert.ok(o && o.flash === f.until && f.until - Date.now() <= 2 * 3600e3 + 1000 && f.until - Date.now() >= 3500e3);
    // El estado público lleva la marca para la insignia «Oferta».
    assert.ok(market.state().orders.find((x) => x.id === f.orderId).flash === f.until);
    assert.ok(npc.publicState().flash.some((x) => x.ref === f.ref));
    // Comprar a precio flash y vender de vuelta pierde.
    db.data.market.orders = db.data.market.orders.filter((x) => x.npc || x.ref !== f.ref); // sin órdenes de jugadores de otros tests
    const p = user('flash' + i, { level: 50 });
    const before = p.coins;
    market.buy(p, { ...a, qty: 1, price: f.price, instant: true });
    const bidder = db.userById(f.npc === 'npc-ginger' ? 'npc-bill' : 'npc-ginger');
    bidder.coins = 60000;
    delete npc.state().spent[bidder.id];
    market.buy(bidder, { ...a, qty: 1, price: b.cap });
    market.sell(p, { ...a, qty: 1, price: b.cap, instant: true });
    assert.ok(p.coins < before);
    npc.sweepSpecial(Date.now() + 3 * 3600e3); // caduca y se retira
    assert.ok(!db.data.market.orders.some((x) => x.flash));
    clearNpcOrders();
  }
  assert.ok(seen.size >= 1);
  // La visita normal respeta el suelo del 80 % para las flash y no las retira antes de tiempo.
  resetSpecial();
  g.items['mystery-egg'] = 3;
  const f = npc.newFlash();
  assert.ok(f);
  npc.act(db.userById(f.npc));
  assert.ok(db.data.market.orders.some((x) => x.id === f.orderId), 'la visita no cancela la oferta flash');
  resetSpecial();
});

test('NPC: el feed «En vivo» recibe como mucho 4 líneas de NPC al día y el chat ninguna', () => {
  resetSpecial();
  const feed0 = db.data.feed.length;
  const chat0 = (db.data.chat || []).length;
  for (const u of npcs()) u.items['mystery-egg'] = 4;
  N('bill').collection = { 19: { n: 3, s: 0 }, 149: { n: 3, s: 0 } };
  for (let i = 0; i < 30; i++) { npc.newEncargo(); npc.newFlash(); npc.sweepSpecial(Date.now() + 10 * 3600e3); }
  const lines = db.data.feed.slice(Math.max(0, feed0 - 0)).filter((f) => /^(📜|🔥)/.test(f.text));
  assert.ok(lines.length >= 1 && lines.length <= npc.FEED_DAILY, `${lines.length} líneas`);
  assert.strictEqual((db.data.chat || []).length, chat0, 'los NPC no escriben en el chat');
  // Otro día, otro presupuesto.
  npc.state().feed.day = '2000-01-01';
  assert.ok(npc.npcFeed(npc.FEED_DAILY, '🔥 prueba', {}));
  resetSpecial();
});

test('NPC: el plan diario tiene 3-6 encargos y 1-2 ofertas flash', () => {
  const n = npc.state();
  n.plan = null;
  const plan = npc.dayPlan(Date.parse(hub.dayKey() + 'T00:00:00Z') + 1000);
  assert.ok(plan.enc.length >= 3 && plan.enc.length <= 6 && plan.flash.length >= 1 && plan.flash.length <= 2, JSON.stringify([plan.enc.length, plan.flash.length]));
  n.plan = null;
});
