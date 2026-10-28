'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-specimen-'));

const db = require('../server/db');
const gacha = require('../server/gacha');
const sp = require('../server/specimen');
const duel = require('../server/games/duel');
const battle = require('../server/games/battle');
const { BY_ID } = require('../server/pokedex');

let n = 0;
function user(extra = {}) {
  const name = 'spec' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 100000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection: {}, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, ...extra };
  db.addUser(u);
  return u;
}
const uids = (u, id) => u.mons[id].map((m) => m.uid);

test('sync genera ejemplares válidos y excluye estrellas de Caramelo Raro', () => {
  const u = user({ collection: { 25: { n: 4, s: 1, cn: 2 }, 6: { n: 1, s: 0 } } });
  sp.syncAll(u);
  assert.strictEqual(u.mons[25].length, 2);
  assert.strictEqual(u.mons[25].filter((m) => m.shiny).length, 1);
  assert.strictEqual(u.mons[6].length, 1);
  for (const m of [...u.mons[25], ...u.mons[6]]) {
    assert.match(m.uid, /^[0-9a-f]{8}$/);
    assert.strictEqual(m.ivs.length, 6);
    assert.ok(m.ivs.every((v) => v >= 0 && v <= 31));
    assert.strictEqual(m.moves.length, 4);
    assert.ok(sp.NATURES.some((x) => x.name === m.nature));
    assert.ok(['M', 'F'].includes(m.gender));
  }
  assert.strictEqual(sp.NATURES.length, 25);
  const leg = user({ collection: { 150: { n: 1, s: 0 } } });
  sp.syncAll(leg);
  assert.strictEqual(leg.mons[150][0].gender, null);
});

test('encoger quita la peor copia y respeta compañero y favorito', () => {
  const u = user({ collection: { 25: { n: 4, s: 0 } } });
  sp.sync(u, 25);
  const [a, b, c, d] = u.mons[25];
  a.level = 50; a.ivs = Array(6).fill(31); // mejor
  b.fav = true; b.level = 1; b.friendship = 0; b.ivs = Array(6).fill(0);
  c.level = 1; c.friendship = 0; c.ivs = Array(6).fill(0); // compañero, la peor
  d.level = 2; d.ivs = Array(6).fill(5);
  u.buddy = { id: 25, shiny: false, uid: c.uid };
  u.collection[25].n = 3;
  sp.sync(u, 25);
  assert.deepStrictEqual(new Set(uids(u, 25)), new Set([a.uid, b.uid, c.uid]));
  u.collection[25].n = 2;
  sp.sync(u, 25);
  assert.deepStrictEqual(new Set(uids(u, 25)), new Set([b.uid, c.uid])); // el favorito se conserva antes que la mejor
  u.collection[25].n = 1;
  sp.sync(u, 25);
  assert.strictEqual(u.mons[25].length, 1);
  assert.strictEqual(u.mons[25][0].uid, c.uid); // el compañero es lo último que se pierde
  delete u.collection[25];
  sp.sync(u, 25);
  assert.strictEqual(u.mons[25], undefined);
});

test('el número de variocolores coincide con c.s', () => {
  const u = user({ collection: { 133: { n: 4, s: 2 } } });
  sp.sync(u, 133);
  assert.strictEqual(u.mons[133].filter((m) => m.shiny).length, 2);
  u.collection[133].s = 1;
  sp.sync(u, 133);
  assert.strictEqual(u.mons[133].filter((m) => m.shiny).length, 1);
  u.collection[133].s = 4;
  sp.sync(u, 133);
  assert.strictEqual(u.mons[133].filter((m) => m.shiny).length, 4);
  gacha.grant(u, 133, true); // 5.ª copia variocolor
  sp.sync(u, 133);
  assert.strictEqual(u.mons[133].length, 5);
  assert.strictEqual(u.mons[133].filter((m) => m.shiny).length, 5);
});

test('pc:release da el mismo polvo que release y quita ese uid', () => {
  const u1 = user({ collection: { 25: { n: 3, s: 0 } } });
  const u2 = user({ collection: { 25: { n: 3, s: 0 } } });
  const ref = gacha.release(u2, { id: 25, count: 1 });
  sp.sync(u1, 25);
  const target = u1.mons[25][1].uid;
  const out = sp.release(u1, { id: 25, uid: target });
  assert.strictEqual(out.dust, ref.dust);
  assert.strictEqual(u1.dust, u2.dust);
  assert.strictEqual(u1.collection[25].n, 2);
  assert.ok(!uids(u1, 25).includes(target));
  assert.strictEqual(u1.mons[25].length, 2);
  // Última copia: no se puede.
  const solo = user({ collection: { 25: { n: 1, s: 0 } } });
  sp.sync(solo, 25);
  assert.throws(() => sp.release(solo, { id: 25, uid: solo.mons[25][0].uid }));
  assert.strictEqual(solo.mons[25].length, 1);
  assert.ok(!solo.mons[25][0].drop);
});

test('liberar un variocolor baja s; liberar uno normal no', () => {
  const u = user({ collection: { 25: { n: 3, s: 1 } } });
  sp.sync(u, 25);
  const shiny = u.mons[25].find((m) => m.shiny);
  sp.release(u, { id: 25, uid: shiny.uid });
  assert.strictEqual(u.collection[25].s, 0);
  assert.strictEqual(u.collection[25].n, 2);
  assert.ok(u.mons[25].every((m) => !m.shiny));
  const v = user({ collection: { 25: { n: 3, s: 1 } } });
  sp.sync(v, 25);
  const plain = v.mons[25].find((m) => !m.shiny);
  sp.release(v, { id: 25, uid: plain.uid });
  assert.strictEqual(v.collection[25].s, 1);
  assert.strictEqual(v.mons[25].filter((m) => m.shiny).length, 1);
});

test('mote saneado, favorito y validación de entradas', () => {
  const u = user({ collection: { 25: { n: 1, s: 0 } } });
  sp.sync(u, 25);
  const uid = u.mons[25][0].uid;
  assert.strictEqual(sp.sanitizeNick('  Chispa\u0000​\n  Mega Larga Muy  '), 'Chispa Mega');
  sp.nick(u, { id: 25, uid, nick: '  Rayo\u0007  ' });
  assert.strictEqual(u.mons[25][0].nick, 'Rayo');
  sp.fav(u, { id: 25, uid, fav: true });
  assert.strictEqual(u.mons[25][0].fav, true);
  assert.throws(() => sp.nick(u, { id: 25, uid: 'zzzzzzzzzzzz', nick: 'x' }));
  assert.throws(() => sp.nick(u, { id: 'abc', uid, nick: 'x' }));
  assert.throws(() => sp.nick(u, { id: 6, uid, nick: 'x' }));
  const box = sp.boxView(u);
  assert.strictEqual(box.mons.length, 1);
  assert.strictEqual(box.mons[0].stats.length, 6);
});

test('el duelo incluye datos del ejemplar y el combate simula con y sin ellos', () => {
  const u = user({ collection: { 25: { n: 3, s: 0 } } });
  sp.sync(u, 25);
  u.mons[25][2].ivs = Array(6).fill(31);
  u.buddy = { id: 25, shiny: false, uid: u.mons[25][0].uid };
  const pick = duel.create(u, { pokeId: 25, wager: 0 }).duel.poke;
  assert.strictEqual(pick.uid, u.mons[25][0].uid); // el compañero
  assert.strictEqual(pick.ivs.length, 6);
  u.buddy = null;
  const best = duel.create(u, { pokeId: 25, wager: 0 }).duel.poke;
  assert.strictEqual(best.uid, u.mons[25][2].uid);
  const old = { id: 6, shiny: false, stars: 2, owner: 'x' };
  const withSp = { ...best, id: 6, nick: 'Chispa' };
  for (const [a, b] of [[old, old], [withSp, old], [old, withSp]]) {
    const r = battle.simulate(a, b);
    assert.ok(r.log.length > 0 && [0, 1].includes(r.winner));
  }
  assert.strictEqual(battle.simulate(withSp, old).fighters[0].nick, 'Chispa');
  assert.ok(BY_ID.get(6));
});

test('los factores del ejemplar son pequeños (±5 % IV, ±10 % naturaleza)', () => {
  const base = battle.fighter({ id: 6, shiny: false, stars: 1, owner: 'x' });
  const max = battle.fighter({ id: 6, shiny: false, stars: 1, owner: 'x', ivs: Array(6).fill(31), nature: 'Audaz' });
  const min = battle.fighter({ id: 6, shiny: false, stars: 1, owner: 'x', ivs: Array(6).fill(0), nature: 'Osada' });
  assert.ok(max.hp / base.hp <= 1.051 && min.hp / base.hp >= 0.949);
  assert.ok(max.atk / base.atk <= 1.05 * 1.1 + 0.01 && min.atk / base.atk >= 0.95 * 0.9 - 0.01);
});

test('liberar un favorito o el compañero suelta ese ejemplar y no otro', () => {
  const specimen = require('../server/specimen');
  const u = { id: 'fav-rel', username: 'favrel', coins: 0, dust: 0, items: {}, collection: { 25: { n: 3, s: 0 } }, mons: {} };
  const arr = specimen.sync(u, 25);
  arr[0].fav = true;
  u.buddy = { id: 25, shiny: false, uid: arr[1].uid };
  const favUid = arr[0].uid;
  for (const m of arr) m.drop = false;
  arr[0].drop = true;
  u.collection[25].n = 2;
  const left = specimen.sync(u, 25);
  assert.ok(!left.some((m) => m.uid === favUid));
  assert.ok(left.some((m) => m.uid === u.buddy.uid));
});
