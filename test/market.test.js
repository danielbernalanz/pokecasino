'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-market-'));
// crash.js no arranca rondas al importarse; solo se usa crashPoint.

const db = require('../server/db');
const market = require('../server/market');
const plinko = require('../server/games/plinko');
const mines = require('../server/games/mines');
const crash = require('../server/games/crash');
const videopoker = require('../server/games/videopoker');
const blackjack = require('../server/games/blackjack');

function user(name, extra = {}) {
  const u = { id: 'id-' + name, username: name, coins: 10000, dust: 0, buddy: null, items: {}, buffs: {}, games: {}, collection: {}, stats: {}, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, ...extra };
  db.addUser(u);
  return u;
}

test('mercado: una orden de venta queda en depósito y se compra al momento', () => {
  const s = user('vendedor', { items: { 'master-ball': 3 } });
  const b = user('comprador');
  const r = market.sell(s, { kind: 'item', itemId: 'master-ball', qty: 2, price: 5000 });
  assert.strictEqual(r.order.qty, 2);
  assert.strictEqual(s.items['master-ball'], 1, 'los objetos quedan en depósito');
  assert.strictEqual(s.coins, 10000 - Math.ceil(10000 * market.SETUP_FEE), 'comisión de publicación');
  const coinsAfterFee = s.coins;
  market.buy(b, { kind: 'item', itemId: 'master-ball', qty: 1, price: 5000, instant: true });
  assert.strictEqual(b.items['master-ball'], 1);
  assert.strictEqual(b.coins, 5000);
  assert.strictEqual(s.coins, coinsAfterFee + 5000 - Math.floor(5000 * market.SALES_TAX), 'impuesto de venta');
  assert.strictEqual(market.state().orders.find((o) => o.id === r.order.id).qty, 1, 'llenado parcial');
});

test('mercado: el pedido de compra se llena con la oferta más barata y devuelve la diferencia', () => {
  const s1 = user('caro', { items: { 'lucky-egg': 5 } });
  const s2 = user('barato', { items: { 'lucky-egg': 5 } });
  const b = user('cazachollos', { coins: 100000 });
  market.sell(s1, { kind: 'item', itemId: 'lucky-egg', qty: 5, price: 900 });
  market.sell(s2, { kind: 'item', itemId: 'lucky-egg', qty: 2, price: 700 });
  const r = market.buy(b, { kind: 'item', itemId: 'lucky-egg', qty: 4, price: 1000 });
  assert.strictEqual(r.filled, 4);
  assert.strictEqual(r.spent, 2 * 700 + 2 * 900, 'paga el precio de cada oferta, no su máximo');
  assert.strictEqual(b.coins, 100000 - 3200);
  assert.strictEqual(b.items['lucky-egg'], 4);
  assert.strictEqual(r.order, null, 'no queda pedido porque se llenó entero');
});

test('mercado: vender a un pedido de compra existente y cancelar devuelve el depósito', () => {
  const b = user('demandante', { coins: 50000 });
  const s = user('ofertante', { collection: { 25: { n: 3, s: 0 } } });
  const before = b.coins;
  const r = market.buy(b, { kind: 'poke', pokeId: 25, qty: 2, price: 4000 });
  const feeB = Math.ceil(8000 * market.SETUP_FEE);
  assert.strictEqual(b.coins, before - 8000 - feeB, 'las monedas del pedido quedan en depósito');
  market.sell(s, { kind: 'poke', pokeId: 25, qty: 1, price: 3000, instant: true });
  assert.strictEqual(s.collection[25].n, 2);
  assert.strictEqual(b.collection[25].n, 1);
  assert.strictEqual(s.coins, 10000 + 4000 - Math.floor(4000 * market.SALES_TAX), 'cobra el precio del pedido');
  market.cancel(b, { id: r.order.id });
  assert.strictEqual(b.coins, before - 4000 - feeB, 'cancelar devuelve lo no usado (no la comisión)');
  assert.throws(() => market.cancel(s, { id: r.order.id }));
});

test('mercado: no se puede vender lo que no se tiene ni comprarse a uno mismo', () => {
  const u = user('pobre', { items: { ticket: 1 } });
  assert.throws(() => market.sell(u, { kind: 'item', itemId: 'master-ball', qty: 1, price: 10 }));
  assert.throws(() => market.sell(u, { kind: 'poke', pokeId: 25, qty: 1, price: 10 }));
  assert.throws(() => market.sell(u, { kind: 'dust', qty: 50, price: 10 }));
  market.sell(u, { kind: 'item', itemId: 'ticket', qty: 1, price: 100 });
  assert.throws(() => market.buy(u, { kind: 'item', itemId: 'ticket', qty: 1, price: 100, instant: true }), /No hay ofertas/);
});

test('mercado: 2.000 órdenes aleatorias conservan monedas y artículos', () => {
  const traders = Array.from({ length: 5 }, (_, i) => user('trader' + i, { coins: 1_000_000, dust: 5000, items: { 'rare-candy': 200 } }));
  for (const t of traders) delete t.progress; // sin recompensas de misiones: solo cuenta el dinero del mercado
  const total = () => {
    const m = market.state();
    let coins = 0;
    let candies = 0;
    let dust = 0;
    for (const t of traders) { coins += t.coins; candies += t.items['rare-candy'] || 0; dust += t.dust; }
    for (const o of m.orders.filter((x) => x.username.startsWith('trader'))) {
      if (o.side === 'buy') coins += o.qty * o.price;
      else if (o.kind === 'item') candies += o.qty;
      else dust += o.qty;
    }
    return { coins, candies, dust };
  };
  const start = total();
  let fees = 0;
  let taxes = 0;
  for (let i = 0; i < 2000; i++) {
    const t = traders[Math.floor(Math.random() * traders.length)];
    const goods = Math.random() < 0.5 ? { kind: 'item', itemId: 'rare-candy' } : { kind: 'dust' };
    const qty = 1 + Math.floor(Math.random() * 5);
    const price = 50 + Math.floor(Math.random() * 100);
    const instant = Math.random() < 0.3;
    try {
      const r = Math.random() < 0.5 ? market.sell(t, { ...goods, qty, price, instant }) : market.buy(t, { ...goods, qty, price, instant });
      if (r.order) fees += Math.max(1, Math.ceil(r.order.qty0 * r.order.price * market.SETUP_FEE));
    } catch { /* sin contrapartida o sin saldo */ }
    if (Math.random() < 0.05) {
      const mine = market.state().orders.filter((o) => o.username === t.username);
      if (mine.length) market.cancel(t, { id: mine[0].id });
    }
  }
  const end = total();
  assert.strictEqual(end.candies, start.candies, 'ningún caramelo aparece ni desaparece');
  assert.strictEqual(end.dust, start.dust, 'ni el polvo');
  // Las monedas solo salen por comisiones e impuestos.
  assert.ok(end.coins <= start.coins - fees, 'las comisiones salen del sistema');
  taxes = start.coins - fees - end.coins;
  assert.ok(taxes >= 0);
});

test('RTP de Plinko entre 94 % y 98 %', () => {
  for (const r of Object.keys(plinko.TABLES)) {
    const v = plinko.rtp(r);
    assert.ok(v > 0.94 && v < 0.98, `${r}: ${v}`);
  }
});

test('Minas: el multiplicador incluye el margen de la casa', () => {
  assert.ok(mines.multiplier(3, 1) < 25 / 22);
  assert.ok(mines.multiplier(24, 1) < 25);
});

test('Crash: retirarse en ×2 devuelve ~97 %', () => {
  let w = 0;
  const N = 100000;
  for (let i = 0; i < N; i++) if (crash.crashPoint() > 2) w++;
  const rtp = (w / N) * 2;
  assert.ok(rtp > 0.94 && rtp < 0.99, String(rtp));
});

test('Video Póker clasifica las manos', () => {
  assert.strictEqual(videopoker.classify(['As', 'Ks', 'Qs', 'Js', 'Ts']), 'Escalera real');
  assert.strictEqual(videopoker.classify(['Jh', 'Jd', '2c', '5s', '9h']), 'Jotas o mejor');
  assert.strictEqual(videopoker.classify(['Th', 'Td', '2c', '5s', '9h']), null);
});

test('Blackjack: los ases cuentan 1 u 11', () => {
  assert.strictEqual(blackjack.total(['As', 'Kd']).t, 21);
  assert.strictEqual(blackjack.total(['As', 'Ad', '9c']).t, 21);
  assert.strictEqual(blackjack.total(['Ks', 'Qd', '5c']).t, 25);
});

test('duelos a ciegas: la lista pública no revela el Pokémon del retador', () => {
  const duel = require('../server/games/duel');
  const u = user('retador', { collection: { 6: { n: 1, s: 0 } } });
  const { duel: d } = duel.create(u, { pokeId: 6, shiny: false, wager: 0 });
  const pub = duel.listPublic().find((x) => x.id === d.id);
  assert.ok(pub);
  assert.strictEqual(pub.poke, undefined);
  assert.ok(!JSON.stringify(pub).includes('"id":6'));
  duel.cancel(u, { id: d.id });
});

test('depósito: lo que está en juego se devuelve si el servidor se apaga de golpe', () => {
  const duel = require('../server/games/duel');
  const u = user('apostador', { coins: 1000, collection: { 6: { n: 1, s: 0 } } });
  duel.create(u, { pokeId: 6, shiny: false, wager: 300 });
  assert.strictEqual(u.coins, 700);
  assert.strictEqual(Object.values(db.data.escrow).filter((e) => e.userId === u.id).reduce((s, e) => s + e.amount, 0), 300);
  // Simula un arranque tras un apagado brusco: el reto se pierde pero el dinero vuelve.
  const back = db.refundEscrow();
  assert.ok(back.total >= 300);
  assert.strictEqual(u.coins, 1000);
  assert.deepStrictEqual(db.data.escrow, {});
});

test('mercado: los anuncios del formato antiguo pasan a ser órdenes de venta', () => {
  const s = user('antiguo');
  db.data.market.listings = [{ id: 9001, sellerId: s.id, seller: s.username, kind: 'item', itemId: 'lucky-egg', qty: 2, price: 2000, createdAt: Date.now() }];
  market.init();
  const o = market.state().orders.find((x) => x.id === 9001);
  assert.ok(o);
  assert.strictEqual(o.side, 'sell');
  assert.strictEqual(o.price, 1000, 'el precio total pasa a precio por unidad');
  assert.strictEqual(o.qty, 2);
  assert.strictEqual(db.data.market.listings, undefined);
});

test('mercado: duración de las órdenes (1/3/7/14 días, 14 por defecto) y validación', () => {
  const s = user('duracion', { items: { 'lucky-egg': 10 }, coins: 100000 });
  const t0 = Date.now();
  const def = market.sell(s, { kind: 'item', itemId: 'lucky-egg', qty: 1, price: 100 });
  assert.ok(Math.abs(def.order.expiresAt - (t0 + 14 * 86400000)) < 5000);
  const d3 = market.sell(s, { kind: 'item', itemId: 'lucky-egg', qty: 1, price: 100, days: 3 });
  assert.ok(Math.abs(d3.order.expiresAt - (t0 + 3 * 86400000)) < 5000);
  const b1 = market.buy(s, { kind: 'item', itemId: 'master-ball', qty: 1, price: 50, days: '7' });
  assert.ok(Math.abs(b1.order.expiresAt - (t0 + 7 * 86400000)) < 5000);
  for (const days of [0, 2, 15, -1, 'x']) {
    assert.throws(() => market.sell(s, { kind: 'item', itemId: 'lucky-egg', qty: 1, price: 100, days }), /Duración/);
    assert.throws(() => market.buy(s, { kind: 'item', itemId: 'master-ball', qty: 1, price: 50, days }), /Duración/);
  }
  assert.ok(market.state().orders.find((o) => o.id === d3.order.id).expiresAt);
});

test('mercado: la caducidad usa expiresAt y devuelve el depósito (y cae a 14 días en órdenes antiguas)', () => {
  const s = user('caduca', { items: { 'lucky-egg': 3 }, coins: 100000 });
  const a = market.sell(s, { kind: 'item', itemId: 'lucky-egg', qty: 1, price: 100, days: 1 });
  const b = market.sell(s, { kind: 'item', itemId: 'lucky-egg', qty: 1, price: 100, days: 7 });
  const old = market.sell(s, { kind: 'item', itemId: 'lucky-egg', qty: 1, price: 100 });
  const raw = (o) => db.data.market.orders.find((x) => x.id === o.id);
  raw(a.order).expiresAt = Date.now() - 1000; // caducada
  delete raw(old.order).expiresAt; // orden antigua sin expiresAt
  raw(old.order).createdAt = Date.now() - 13 * 86400000; // aún vigente
  assert.ok(!s.items['lucky-egg']);
  market.sweep();
  assert.ok(!raw(a.order), 'la caducada desaparece');
  assert.ok(raw(b.order) && raw(old.order), 'las vigentes siguen');
  assert.strictEqual(s.items['lucky-egg'], 1, 'se devuelve el depósito');
  raw(old.order).createdAt = Date.now() - 15 * 86400000;
  market.sweep();
  assert.ok(!raw(old.order));
  assert.strictEqual(s.items['lucky-egg'], 2);
});

// (Usa Huevos Suerte: el test aleatorio de arriba deja pedidos de Caramelos Raro abiertos que a veces llenaban la orden barata.)
test('mercado: orderId llena solo esa orden aunque haya otras más baratas', () => {
  const a = user('barata1', { items: { 'lucky-egg': 2 } });
  const c = user('cara1', { items: { 'lucky-egg': 2 } });
  const b = user('elegidor', { coins: 100000 });
  const o1 = market.sell(a, { kind: 'item', itemId: 'lucky-egg', qty: 2, price: 100 }).order;
  const o2 = market.sell(c, { kind: 'item', itemId: 'lucky-egg', qty: 2, price: 500 }).order;
  const r = market.buy(b, { kind: 'item', itemId: 'lucky-egg', qty: 1, price: 500, orderId: o2.id });
  assert.strictEqual(r.spent, 500);
  assert.strictEqual(market.state().orders.find((o) => o.id === o1.id).qty, 2, 'la barata no se toca');
  assert.strictEqual(market.state().orders.find((o) => o.id === o2.id).qty, 1);
  assert.throws(() => market.buy(b, { kind: 'item', itemId: 'lucky-egg', qty: 1, price: 500, orderId: 999999 }), /No hay ofertas/);
});
