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
    assert.ok(b.cap >= 1 && b.cap < b.floor, JSON.stringify(a));
    if (a.kind === 'poke') {
      const r = DEX.find((p) => p.id === a.pokeId).rarity;
      const release = RARITY[r].dust * gacha.DUST_RATE;
      const normal = npc.bounds(market.parseRef(poke(a.pokeId)));
      assert.ok(normal.cap <= 0.9 * release, 'vender a un NPC nunca supera a liberar el duplicado');
      assert.ok(normal.floor >= Math.max(3 * normal.cap, npc.POKE_FLOOR[r]));
      if (a.shiny) {
        assert.ok(b.cap <= 3 * normal.cap);
        assert.ok(b.floor >= 4 * normal.floor);
      }
    }
    if (a.kind === 'item' && items.ITEMS[a.itemId].price) {
      const p = items.ITEMS[a.itemId].price;
      assert.ok(b.cap <= 0.5 * p && b.floor >= p, 'objetos de tienda: nunca por debajo de la tienda');
    }
    if (a.kind === 'dust') assert.ok(b.cap < gacha.DUST_RATE && b.floor >= 2 * gacha.DUST_RATE);
  }
  assert.strictEqual(npc.bounds(market.parseRef(item('master-ball'))).cap, 2000);
  assert.strictEqual(npc.bounds(market.parseRef(item('master-ball'))).floor, 12000);
});

test('NPC: vender al tope de compra de un NPC rinde menos que una tirada de gacha cuesta', () => {
  const ev = Object.entries(gacha.RATES).reduce((s, [r, rate]) => s + rate * npc.maxBid(r), 0);
  assert.ok(ev < 0.6 * gacha.COST[10] / 10, `EV ${ev}`);
  // Incluso contando el variocolor (1/64 de las tiradas, al triple).
  assert.ok(ev * (1 + 3 * gacha.SHINY_RATE) < 0.6 * gacha.COST[10] / 10);
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
    const p = user('arb' + i++, { level: 50 }); // límite diario 6.500: cabe un variocolor mítico
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
      for (const p of npc.NPCS) for (let i = 0; i < 30; i++) { hi = Math.max(hi, npc.bidPrice(a, p, med)); lo = Math.min(lo, npc.askPrice(a, p, med)); }
    }
    assert.ok(hi < lo, `${a.ref}: ${hi} vs ${lo}`);
  }
});

test('NPC: límites diarios por jugador (monedas y unidades) al venderles', () => {
  clearNpcOrders();
  const g = N('ginger');
  const p = user('vendedor-npc', { items: { 'rare-candy': 14, 'master-ball': 3 }, level: 3 });
  const limit = npc.sellLimit(p); // 5000 + 500 × 3
  assert.strictEqual(limit, 6500);
  const candy = npc.bounds(market.parseRef(item('rare-candy'))).cap; // 450
  const egg = npc.bounds(market.parseRef(item('master-ball'))).cap; // 2000
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

test('NPC: el reabastecimiento diario solo crea comunes, poco comunes y huevos', () => {
  for (const u of npcs()) { u.collection = {}; u.items = {}; }
  delete npc.state().restockDay;
  const r = npc.restock();
  assert.ok(r.poke <= 10 && r.eggs <= 2);
  assert.strictEqual(npc.restock().poke, 0, 'solo una vez al día');
  for (const u of npcs()) {
    for (const id of Object.keys(u.collection)) assert.ok(['C', 'U'].includes(DEX.find((p) => p.id === Number(id)).rarity));
    assert.ok(Object.values(u.collection).every((c) => c.s === 0));
    assert.deepStrictEqual(Object.keys(u.items).filter((i) => i !== 'mystery-egg'), []);
  }
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
    if (r) { assert.ok(r.got <= npc.sellLimit(u)); for (const n of Object.values(r.sold)) assert.ok(n <= 100); }
  }
  clearNpcOrders();
});
