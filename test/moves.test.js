'use strict';
// Movimientos como en los juegos: aprendidos/equipados, migración, cola de aprendizaje al subir de nivel o evolucionar,
// validación de pc:moves / pc:learn y equipos de combate con solo movimientos legales.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-moves-'));

const db = require('../server/db');
const specimen = require('../server/specimen');
const candy = require('../server/candy');
const moves = require('../server/moves');
const sdw = require('../server/showdown');
const sd = require('../server/sdmap');
const trainers = require('../server/trainers');
const exp = require('../server/expedition');

let n = 0;
function user(collection = {}, extra = {}) {
  const name = 'mv' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 100000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, candy: { '*': 99999 }, ...extra };
  db.addUser(u);
  specimen.syncAll(u);
  return u;
}
const ref = (u, id, i = 0) => ({ id, uid: u.mons[id][i].uid });

test('ejemplares nuevos nacen con los movimientos por nivel de su nivel (últimos 4)', () => {
  const u = user({ 1: { n: 1, s: 0 }, 25: { n: 1, s: 0 } });
  const b = u.mons[1][0];
  assert.strictEqual(b.mv, 2);
  assert.deepStrictEqual(b.learned.slice().sort(), ['growl', 'tackle', 'vinewhip']);
  assert.deepStrictEqual(b.sdMoves.slice().sort(), ['growl', 'tackle', 'vinewhip']);
  const p = u.mons[25][0];
  assert.ok(p.sdMoves.length >= 1 && p.sdMoves.length <= 4);
  for (const mv of p.sdMoves) assert.ok(p.learned.includes(mv));
});

test('migración B: ejemplares antiguos se reinician a los 4 últimos movimientos por nivel y aprenden todo lo anterior', () => {
  const u = user({ 6: { n: 1, s: 0 } });
  const m = u.mons[6][0];
  // Estado antiguo: sin `mv`, con movimientos libres del learnset completo.
  delete m.mv; delete m.learned; delete m.pending;
  m.sdMoves = ['hydropump', 'earthquake']; m.level = 40;
  sd.ensureSd(6, m);
  assert.strictEqual(m.mv, 2);
  const upto = moves.reachable(6, 40).map((x) => x.move);
  assert.deepStrictEqual(m.learned.slice().sort(), [...new Set(upto)].sort());
  assert.deepStrictEqual(m.sdMoves, moves.equipAt(6, 40));
  assert.ok(!m.sdMoves.includes('hydropump'));
  assert.strictEqual(m.sdMoves.length, 4);
  // Idempotente.
  const snap = JSON.stringify(m);
  sd.ensureSd(6, m);
  assert.strictEqual(JSON.stringify(m), snap);
  // Nivel 100: ve más movimientos que a nivel 40.
  assert.ok(moves.reachable(6, 100).length > upto.length);
});

test('subir de nivel: hueco libre = aprende solo; con 4 equipados, cola de pendientes', () => {
  const u = user({ 1: { n: 1, s: 0 } });
  const m = u.mons[1][0];
  const r = candy.levelUp(u, { ...ref(u, 1), times: 5 }); // 5 → 10: Drenadoras 6… Látigo cepa ya, Desarrollo 6, Drenadoras 9
  assert.strictEqual(m.level, 10);
  assert.deepStrictEqual(r.learned, ['growth'], 'ocupa el 4º hueco');
  assert.deepStrictEqual(r.pending, ['leechseed']);
  assert.deepStrictEqual(m.pending, ['leechseed']);
  assert.ok(!m.learned.includes('leechseed'));
  candy.levelUp(u, { ...ref(u, 1), times: 5 }); // 10 → 15
  assert.deepStrictEqual(m.pending, ['leechseed', 'razorleaf', 'poisonpowder', 'sleeppowder']);
  // Aprender reemplazando.
  const before = m.sdMoves.slice();
  const res = moves.learn(u, { ...ref(u, 1), move: 'razorleaf', replace: 'growl' });
  assert.ok(!res.eq.includes('growl') && res.eq.includes('razorleaf'));
  assert.ok(m.learned.includes('growl'), 'lo olvidado sigue aprendido');
  assert.strictEqual(res.eq.length, before.length);
  assert.ok(!m.pending.includes('razorleaf'));
  // «No aprender»: queda en aprendidos, no equipado.
  moves.learn(u, { ...ref(u, 1), move: 'leechseed', replace: '' });
  assert.ok(m.learned.includes('leechseed') && !m.sdMoves.includes('leechseed'));
  assert.ok(!m.pending.includes('leechseed'));
  // Errores.
  assert.throws(() => moves.learn(u, { ...ref(u, 1), move: 'surf', replace: '' }), /pendiente/);
  assert.throws(() => moves.learn(u, { ...ref(u, 1), move: 'poisonpowder', replace: 'surf' }), /equipado/);
  assert.ok(m.pending.includes('poisonpowder'), 'un fallo no pierde el pendiente');
});

test('pc:moves: solo entre los aprendidos, 1–4, sin repetidos; se puede cambiar libremente', () => {
  const u = user({ 25: { n: 1, s: 0 } });
  const m = u.mons[25][0];
  m.level = 50; delete m.mv; sd.ensureSd(25, m);
  const L = m.learned;
  assert.ok(L.length > 4);
  const pick = L.slice(0, 2);
  assert.deepStrictEqual(moves.setEquipped(u, { ...ref(u, 25), moves: pick }).eq, pick);
  assert.deepStrictEqual(m.sdMoves, pick);
  assert.throws(() => moves.setEquipped(u, { ...ref(u, 25), moves: [] }), /1 a 4/);
  assert.throws(() => moves.setEquipped(u, { ...ref(u, 25), moves: L.slice(0, 5) }), /1 a 4/);
  assert.throws(() => moves.setEquipped(u, { ...ref(u, 25), moves: [L[0], L[0]] }), /repetido/);
  assert.throws(() => moves.setEquipped(u, { ...ref(u, 25), moves: [L[0], 'hydrocannon'] }), /aprendido/);
  assert.throws(() => moves.setEquipped(u, { ...ref(u, 25), moves: 'thunderbolt' }), /1 a 4/);
  assert.deepStrictEqual(m.sdMoves, pick, 'tras errores no cambia');
  assert.throws(() => moves.setEquipped(u, { id: 25, uid: 'nope', moves: pick }));
});

test('evolución: conserva lo aprendido y añade los movimientos de la nueva especie a su nivel', () => {
  const u = user({ 4: { n: 1, s: 0 } });
  const m = u.mons[4][0];
  m.level = 20; delete m.mv; sd.ensureSd(4, m);
  const old = m.learned.slice();
  const eqBefore = m.sdMoves.slice();
  const r = candy.evolve(u, { ...ref(u, 4), to: 5 });
  assert.strictEqual(r.to, 5);
  for (const x of old) assert.ok(m.learned.includes(x), 'conserva ' + x);
  const want = moves.reachable(5, 20).map((x) => x.move).filter((x) => !old.includes(x));
  const got = [...r.learned, ...r.pending];
  assert.deepStrictEqual(got.slice().sort(), [...new Set(want)].sort());
  assert.deepStrictEqual(m.sdMoves.slice(0, 4).filter((x) => eqBefore.includes(x)).length >= Math.min(eqBefore.length, 4) - r.pending.length, true);
  assert.ok(m.sdMoves.length <= 4);
});

test('expedición: los niveles ganados fuera también ponen movimientos en cola', () => {
  const u = user({ 1: { n: 1, s: 0 } });
  const m = u.mons[1][0];
  exp.send(u, { zone: 'bosque', hours: 12, team: [ref(u, 1)] });
  u.expeditions[0].end = Date.now() - 1;
  const lvBefore = m.level;
  exp.claim(u, { id: u.expeditions[0].id });
  assert.ok(m.level > lvBefore);
  const reached = moves.reachable(1, m.level).map((x) => x.move);
  for (const mv of reached) assert.ok(m.learned.includes(mv) || m.pending.includes(mv), mv);
});

test('los equipos de combate solo llevan movimientos aprendidos (también tras migrar)', () => {
  const u = user({ 6: { n: 1, s: 0 }, 25: { n: 1, s: 0 } });
  for (const id of [6, 25]) { const m = u.mons[id][0]; m.level = 30; delete m.mv; sd.ensureSd(id, m); }
  const { sets } = sdw.resolveTeam(u, [ref(u, 6), ref(u, 25)], { format: 'singles', level: 'fair' });
  assert.strictEqual(sets[0].level, 50, 'estadísticas normalizadas');
  for (const [i, id] of [6, 25].entries()) {
    const m = u.mons[id][0];
    assert.deepStrictEqual(sets[i].moves, m.sdMoves);
    for (const mv of sets[i].moves) assert.ok(m.learned.includes(mv));
    assert.ok(moves.levelMoves(id).some((x) => sets[i].moves.includes(x.move)));
  }
  // «Nivel 50 justo»: los movimientos son los del nivel real (30), no los de 50.
  assert.deepStrictEqual(sets[0].moves.slice().sort(), moves.equipAt(6, 30).slice().sort());
});

test('entrenadores de la CPU básicos usan movimientos por nivel acordes al equipo del jugador', () => {
  const t = trainers.TRAINERS.find((x) => x.tier === 1);
  const { sets } = trainers.buildTeam(t, 3, { level: 'real', avgLevel: 8 });
  for (const s of sets) {
    const id = require('../server/pokedex').DEX.find((p) => sd.speciesOf(p.id).name === s.species).id;
    const legal = new Set(moves.reachable(id, 10).map((x) => x.move));
    for (const mv of s.moves) assert.ok(legal.has(mv), `${s.species} ${mv}`);
  }
});

test('boxView expone aprendidos, equipados y pendientes', () => {
  const u = user({ 1: { n: 1, s: 0 } });
  const v = specimen.boxView(u).mons[0];
  assert.ok(Array.isArray(v.eq) && Array.isArray(v.learned) && Array.isArray(v.pending));
});
