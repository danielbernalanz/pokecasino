'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-history-'));

const db = require('../server/db');
const hub = require('../server/hub');
const slots = require('../server/games/slots');
const blackjack = require('../server/games/blackjack');
const plinko = require('../server/games/plinko');
const gacha = require('../server/gacha');
const market = require('../server/market');
const items = require('../server/items');

function user(name, extra = {}) {
  const u = { id: 'id-' + name, username: name, coins: 50000, dust: 0, buddy: null, items: {}, buffs: {}, games: {}, collection: {}, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, ...extra };
  db.addUser(u);
  return u;
}
// Lo que explica el historial: movimientos sueltos + resultado neto de los juegos.
const explained = (u) => u.hist.log.reduce((s, m) => s + m.d, 0) + Object.values(u.hist.games).reduce((s, g) => s + g.won - g.bet, 0);

test('el historial explica cada moneda que entra y sale', () => {
  market.init();
  const a = user('ana');
  const b = user('beto');
  const start = { a: a.coins, b: b.coins };
  for (let i = 0; i < 40; i++) slots.spin(a, { bet: 100 });
  for (let i = 0; i < 40; i++) plinko.drop(a, { bet: 50, risk: 'medium' });
  for (let i = 0; i < 30; i++) {
    blackjack.deal(a, { bet: 100 });
    try { blackjack.act(a, { action: 'double' }); } catch { /* no siempre se puede */ }
    while (!a.games.blackjack.done) blackjack.act(a, { action: 'stand' });
  }
  gacha.pull(a, { banner: gacha.BANNERS[0].id, count: 1 });
  items.buy(a, { itemId: 'ticket' });
  a.items['master-ball'] = 3;
  market.sell(a, { kind: 'item', itemId: 'master-ball', qty: 2, price: 4000 });
  market.buy(b, { kind: 'item', itemId: 'master-ball', qty: 1, price: 4000, instant: true });
  const order = market.sell(a, { kind: 'item', itemId: 'master-ball', qty: 1, price: 9000 }).order;
  market.cancel(a, { id: order.id });
  assert.strictEqual(explained(a), a.coins - start.a);
  assert.strictEqual(explained(b), b.coins - start.b);
  const h = hub.history(a);
  assert.ok(h.games.slots.n === 40 && h.games.blackjack.n === 30, 'cuenta partidas (doblar no es partida nueva)');
  assert.ok(h.days.length === 1 && h.days[0].c === a.coins);
  assert.ok(h.log.some((m) => m.r === 'market_sale') && h.log.some((m) => m.r === 'market_tax') && h.log.some((m) => m.r === 'gacha'));
});

test('la economía separa lo que se crea, se destruye y solo cambia de manos', () => {
  const d = hub.econDay();
  assert.ok(d.sink.gacha > 0 && d.sink.shop > 0 && d.sink.market_tax > 0 && d.sink.market_fee > 0);
  assert.strictEqual(d.src.market_sale, undefined, 'una venta entre jugadores no crea monedas');
  assert.ok(d.bet.slots === 4000 && d.rounds.slots === 40);
  assert.ok(d.active.includes('id-ana'));
});
