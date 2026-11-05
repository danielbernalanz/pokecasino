'use strict';
const os = require('os'), path = require('path'), fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-tutor-'));
const db = require('../server/db');
const specimen = require('../server/specimen');
const moves = require('../server/moves');
const tutor = require('../server/tutor');
const daycare = require('../server/daycare');
const items = require('../server/items');
const npc = require('../server/npc');
const exp = require('../server/expedition');

let n = 0;
function user(collection = {}, extra = {}) {
  const name = 'tu' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 1000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 5, createdAt: Date.now() - 9 * 864e5, ...extra };
  db.addUser(u); specimen.syncAll(u); return u;
}

test('movimientos huevo: el bebé hereda los que cualquiera de los padres tiene aprendidos', () => {
  const egg = moves.eggMoves(1);
  assert.ok(egg.length > 0);
  const a = { learned: [egg[0], 'tackle'] }, b = { learned: ['growl'] };
  assert.deepStrictEqual(daycare.inheritedEggMoves(1, [a, b]), [egg[0]]);
  assert.deepStrictEqual(daycare.inheritedEggMoves(1, [b, { learned: [egg[egg.length - 1]] }]), [egg[egg.length - 1]]);
  assert.deepStrictEqual(daycare.inheritedEggMoves(1, [b, b]), []);
});

test('Tutor: lista, cuesta fragmentos del color del tipo y no se gasta si falla', () => {
  const u = user({ 25: { n: 1, s: 0 } });
  const m = u.mons[25][0];
  const list = tutor.list(u, { id: 25, uid: m.uid }).moves;
  assert.ok(list.length > 0 || moves.tutorMoves(25).length === 0);
  const id = [...Object.keys(u.collection)][0];
  const sp = require('../server/pokedex').DEX.find((p) => moves.tutorMoves(p.id).length > 2).id;
  const w = user({ [sp]: { n: 1, s: 0 } });
  const t = tutor.list(w, { id: sp, uid: w.mons[sp][0].uid }).moves.find((x) => !x.known);
  assert.throws(() => tutor.learn(w, { id: sp, uid: w.mons[sp][0].uid, move: t.move }), /Necesitas/);
  w.items[t.color] = 5;
  const r = tutor.learn(w, { id: sp, uid: w.mons[sp][0].uid, move: t.move });
  assert.ok(r.learned.includes(t.move));
  assert.strictEqual(w.items[t.color], 5 - tutor.COST);
  assert.throws(() => tutor.learn(w, { id: sp, uid: w.mons[sp][0].uid, move: t.move }), /Ya conoce/);
  assert.throws(() => tutor.learn(w, { id: sp, uid: w.mons[sp][0].uid, move: 'splash' }), /no puede/);
  assert.ok(id);
});

test('fragmentos: tope diario, PNJ no los comercian', () => {
  const u = user();
  const zone = exp.ZONE_BY_ID.get('mar');
  const realRand = Math.random;
  for (let i = 0; i < 30; i++) tutor.expeditionLoot(u, zone, 12);
  const total = Object.keys(u.items).filter((k) => k.startsWith('shard-')).reduce((s, k) => s + u.items[k], 0);
  assert.strictEqual(total, tutor.DAY_CAP);
  for (const id of Object.keys(tutor.SHARDS)) {
    const a = { kind: 'item', itemId: id };
    assert.ok(npc.bounds(a));
    for (const p of npc.NPCS) assert.ok(!npc.inFocus(p, a));
    assert.ok(items.ITEMS[id].shard);
  }
  assert.ok(realRand);
});
