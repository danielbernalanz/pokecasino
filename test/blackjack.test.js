'use strict';
// Blackjack: dividir y volver a dividir (hasta 4 manos, Ases incluidos), como en muchos casinos.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-bj-'));

const db = require('../server/db');
const cards = require('../server/cards');
// blackjack.js toma `deck` al cargarse: se envuelve antes para poder trucar la baraja en cada prueba.
const origDeck = cards.deck;
let rigged = null;
cards.deck = (k) => { const d = origDeck(k); return rigged ? d.filter((c) => !rigged.includes(c)).concat(rigged.slice().reverse()) : d; };
const bj = require('../server/games/blackjack');

let n = 0;
function user() {
  const u = { id: 'bj-' + ++n, username: 'Bj' + n, coins: 100000, dust: 0, items: {}, buffs: {}, games: {}, collection: {}, stats: {}, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 10, createdAt: 1 };
  db.addUser(u);
  return u;
}
// Baraja trucada: `top` son las primeras cartas en salir (jugador, jugador, crupier, crupier, y luego en orden).
function rig(top, fn) {
  rigged = top;
  try { return fn(); } finally { rigged = null; }
}

test('dividir Ases: cada mano recibe una sola carta y se cierra (sin pedir ni doblar)', () => {
  const u = user();
  const v = rig(['As', 'Ah', 'Kc', '7s', '9d', '5c'], () => bj.deal(u, { bet: 100 }));
  assert.ok(v.game.canSplit);
  const r = bj.act(u, { action: 'split' });
  assert.ok(r.game.done, 'con dos Ases que no reciben otro As la mano se resuelve sola');
  assert.strictEqual(r.game.hands.length, 2);
  assert.deepStrictEqual(r.game.hands.map((h) => h.cards.length), [2, 2]);
});

test('dividir Ases y recibir otro As: se puede volver a dividir y se pregunta por esa mano', () => {
  const u = user();
  // Tras dividir, la primera mano recibe 'Ad' (otro As) y la segunda '9d'.
  rig(['As', 'Ah', 'Kc', '7s', '9d', 'Ad', '5c', '6h', '8d', '2c'], () => {
    bj.deal(u, { bet: 100 });
    let r = bj.act(u, { action: 'split' });
    assert.ok(!r.game.done, 'la mano con otro As espera tu decisión');
    const hd = r.game.hands[r.game.active];
    assert.deepStrictEqual(hd.cards.map((c) => c[0]), ['A', 'A']);
    assert.ok(r.game.canSplit, 'se puede volver a dividir');
    assert.strictEqual(r.game.canHit, false, 'un As dividido no puede pedir carta');
    assert.strictEqual(r.game.canDouble, false, 'ni doblar');
    assert.throws(() => bj.act(u, { action: 'hit' }), /una carta/);
    r = bj.act(u, { action: 'split' });
    assert.strictEqual(r.game.hands.length, 3);
    assert.ok(r.game.done, 'tras re-dividir, cada As recibe su carta y se resuelve');
    const staked = r.game.hands.reduce((s, h) => s + h.bet, 0);
    assert.strictEqual(staked, 300, 'una apuesta por mano');
  });
});

test('como mucho 4 manos; un 21 tras dividir se planta solo', () => {
  const u = user();
  // Pareja de 8: al dividir, la 1.ª mano recibe 8 (re-dividir), y así hasta 4 manos.
  rig(['8s', '8h', 'Kc', '7s', '8d', '8c', '3h', '3d', '3s', '3c', 'Td', 'Th', 'Ts', 'Tc'], () => {
    bj.deal(u, { bet: 100 });
    let r = bj.act(u, { action: 'split' });
    while (r.game.canSplit) r = bj.act(u, { action: 'split' });
    assert.ok(r.game.hands.length <= bj.MAX_HANDS, `manos ${r.game.hands.length}`);
    assert.throws(() => bj.act(u, { action: 'split' }));
  });
  const w = user();
  rig(['Ts', 'Th', '9c', '7s', '5d', 'Ac'], () => {
    bj.deal(w, { bet: 100 });
    const r = bj.act(w, { action: 'split' });
    assert.ok(r.game.hands[0].done, 'T + A tras dividir = 21: se planta solo');
    assert.strictEqual(r.game.hands[0].total, 21);
  });
});
