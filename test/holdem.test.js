'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-holdem-'));
process.env.POKER_SPEED = '1000';

const db = require('../server/db');
const holdem = require('../server/games/holdem');

test('botes paralelos con all-in corto', () => {
  const h = { players: [0, 1, 2], contrib: [100, 500, 500, 0, 0, 0], folded: {} };
  const pots = holdem.sidePots(h);
  assert.deepStrictEqual(pots, [{ amount: 300, eligible: [0, 1, 2] }, { amount: 800, eligible: [1, 2] }]);
});

test('lo apostado por un jugador retirado queda en el bote', () => {
  const h = { players: [0, 1, 2], contrib: [300, 100, 300, 0, 0, 0], folded: { 0: true } };
  const pots = holdem.sidePots(h);
  assert.strictEqual(pots.reduce((s, p) => s + p.amount, 0), 700);
  assert.ok(pots.every((p) => !p.eligible.includes(0)));
});

test('300 manos aleatorias conservan todas las fichas', async () => {
  const users = ['ana', 'ben', 'cris', 'dani'].map((name, k) => {
    const u = { id: 'u' + k, username: name, coins: 1000000, dust: 0, buddy: null, items: {}, buffs: {}, games: {}, collection: {}, stats: {}, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1 };
    db.addUser(u);
    return u;
  });
  const total = () => users.reduce((s, u) => s + u.coins, 0) + table().seats.reduce((s, x) => s + (x ? x.stack : 0), 0) + pot();
  const table = () => holdem._tables.get('pallet');
  const pot = () => { const h = table().hand; return h && !h.finished ? h.pot + h.bets.reduce((a, b) => a + b, 0) : 0; };
  users.forEach((u, i) => holdem.sit(u, { table: 'pallet', seat: i, buyIn: 400 + i * 300 }));
  const start = users.reduce((s, u) => s + u.coins, 0) + table().seats.reduce((s, x) => s + (x ? x.stack : 0), 0);
  let hands = 0;
  let lastNo = 0;
  for (let step = 0; step < 200000 && hands < 300; step++) {
    const t = table();
    const h = t.hand;
    if (h && h.no !== lastNo) { lastNo = h.no; hands++; }
    if (h && !h.finished && h.toAct >= 0) {
      const u = users.find((x) => x.id === t.seats[h.toAct].userId);
      const r = Math.random();
      const toCall = h.currentBet - h.bets[h.toAct];
      const type = r < 0.15 ? 'fold' : r < 0.6 ? (toCall ? 'call' : 'check') : r < 0.9 ? 'raise' : 'allin';
      const amount = h.currentBet + h.minRaise + Math.floor(Math.random() * 100);
      try { holdem.action(u, { table: 'pallet', type, amount }); } catch { holdem.action(u, { table: 'pallet', type: toCall ? 'call' : 'check' }); }
      assert.strictEqual(total(), start, `fichas descuadradas en la mano ${h.no}`);
    } else {
      // Recompra a quien se quede sin fichas y espera al siguiente reparto.
      t.seats.forEach((x, i) => { if (x && x.stack === 0 && !t.hand && users[i].coins >= 400) holdem.rebuy(users[i], { table: 'pallet', amount: 400 }); });
      await new Promise((r) => setTimeout(r, 2));
    }
  }
  assert.ok(hands >= 300, `solo se jugaron ${hands} manos`);
  const finalTotal = users.reduce((s, u) => s + u.coins, 0) + table().seats.reduce((s, x) => s + (x ? x.stack : 0), 0) + pot();
  assert.strictEqual(finalTotal, start);
  holdem.refundAll();
});
