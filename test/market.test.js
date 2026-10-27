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

test('mercado: depósito, compra con comisión y entrega', () => {
  const s = user('vendedor', { items: { 'master-ball': 2 }, collection: { 150: { n: 1, s: 0 } } });
  const b = user('comprador');
  const l = market.create(s, { kind: 'item', itemId: 'master-ball', qty: 1, price: 5000 }).listing;
  assert.strictEqual(s.items['master-ball'], 1, 'el objeto queda en depósito');
  assert.throws(() => market.buy(s, { id: l.id }), /propio/);
  assert.throws(() => market.buy(b, { id: l.id, price: 4000 }), /precio/);
  market.buy(b, { id: l.id, price: 5000 });
  assert.strictEqual(b.coins, 5000);
  assert.strictEqual(b.items['master-ball'], 1);
  assert.strictEqual(s.coins, 10000 + 5000 - 250);
  assert.throws(() => market.buy(b, { id: l.id }), /disponible/, 'no se puede comprar dos veces');

  const p = market.create(s, { kind: 'poke', pokeId: 150, price: 100 }).listing;
  assert.ok(!s.collection[150], 'el Pokémon sale de la colección');
  market.cancel(s, { id: p.id });
  assert.strictEqual(s.collection[150].n, 1, 'cancelar lo devuelve');
});

test('mercado: no se puede vender lo que no se tiene', () => {
  const u = user('pobre');
  assert.throws(() => market.create(u, { kind: 'item', itemId: 'master-ball', qty: 1, price: 10 }));
  assert.throws(() => market.create(u, { kind: 'poke', pokeId: 25, price: 10 }));
  assert.throws(() => market.create(u, { kind: 'dust', qty: 50, price: 10 }));
  assert.strictEqual(market.state().listings.filter((l) => l.seller === 'pobre').length, 0);
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
