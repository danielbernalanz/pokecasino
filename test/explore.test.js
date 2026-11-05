'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-explore-'));

const db = require('../server/db');
const explore = require('../server/explore');

function user(name) {
  const u = { id: 'id-' + name, username: name, coins: 1000, dust: 0, items: {}, buffs: {}, games: {}, collection: {}, stats: {}, pity: {}, daily: {}, xp: 0, level: 1 };
  db.addUser(u);
  return u;
}

test('explorar un apartado da 50 monedas una sola vez', () => {
  const u = user('curioso');
  assert.deepStrictEqual(explore.visit(u, { section: 'huerto' }), { reward: 50 });
  assert.strictEqual(u.coins, 1050);
  assert.deepStrictEqual(explore.visit(u, { section: 'huerto' }), { reward: 0 });
  assert.strictEqual(u.coins, 1050);
  assert.deepStrictEqual(explore.visit(u, { section: 'pc' }), { reward: 50 });
  assert.strictEqual(u.coins, 1100);
});

test('apartados desconocidos o datos raros no dan nada', () => {
  const u = user('tramposo');
  for (const p of [{ section: 'admin' }, { section: 123 }, { section: '__proto__' }, {}, undefined, { section: 'lobby' }]) assert.deepStrictEqual(explore.visit(u, p), { reward: 0 });
  assert.strictEqual(u.coins, 1000);
});

test('el máximo total son 15 apartados', () => {
  const u = user('explorador');
  for (const s of explore.SECTIONS) explore.visit(u, { section: s });
  assert.strictEqual(explore.SECTIONS.size, 15);
  assert.strictEqual(u.coins, 1000 + 15 * explore.REWARD);
});
