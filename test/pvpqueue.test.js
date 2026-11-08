'use strict';
// «Buscar rival»: cola de emparejamiento PvP (mismo formato, nivel y banda de apuesta).
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-q-'));

const db = require('../server/db');
const specimen = require('../server/specimen');
const sdw = require('../server/showdown');

let n = 0;
function withMons(ids) {
  const name = 'q' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 50000, dust: 0, buddy: null, items: {}, buffs: {}, games: {}, collection: Object.fromEntries(ids.map((id) => [id, { n: 1, s: 0 }])), stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 3, createdAt: Date.now() - 9 * 864e5 };
  db.addUser(u);
  specimen.syncAll(u);
  return u;
}
const IDS = [25, 6, 9, 3];
const members = (u, ids = IDS) => ids.map((id) => ({ id, uid: u.mons[id][0].uid }));
const esc = (...us) => Object.values(db.data.escrow).filter((e) => us.some((u) => u.id === e.userId));

test('dos jugadores en cola empiezan un combate y la apuesta se deposita una sola vez', async () => {
  const a = withMons(IDS), b = withMons(IDS);
  const a0 = a.coins, b0 = b.coins;
  const r1 = sdw.enqueue(a, { format: 'singles', level: 'fair', band: 'small', team: members(a) });
  assert.strictEqual(r1.matched, false);
  assert.ok(sdw.isQueued(a.id));
  assert.strictEqual(a.coins, a0, 'en la cola aún no se cobra');
  assert.strictEqual(sdw.queueInfo().singles, 1);
  const r2 = sdw.enqueue(b, { format: 'singles', level: 'fair', band: 'small', team: members(b) });
  assert.strictEqual(r2.matched, true);
  const bat = sdw.battles.get(r2.battle.id);
  assert.ok(bat && bat.mode === 'pvp' && bat.wager === sdw.BANDS.small);
  assert.strictEqual(a.coins, a0 - 50);
  assert.strictEqual(b.coins, b0 - 50);
  assert.strictEqual(esc(a, b).length, 2, 'un depósito por jugador');
  assert.strictEqual(esc(a, b).reduce((s, e) => s + e.amount, 0), 100);
  assert.ok(!sdw.isQueued(a.id) && !sdw.isQueued(b.id));
  assert.strictEqual(sdw.challenges.size, 0);
  // Ya en combate: no pueden volver a la cola.
  assert.throws(() => sdw.enqueue(a, { format: 'singles', level: 'fair', band: 'none', team: members(a) }), /Ya estás en un combate/);
  sdw.forfeit(a, { id: bat.id });
  await bat.done;
  assert.strictEqual(esc(a, b).length, 0);
});

test('cancelar saca de la cola; no se emparejan formatos, niveles ni bandas distintas', () => {
  const a = withMons(IDS), b = withMons(IDS), c = withMons(IDS), d = withMons(IDS);
  sdw.enqueue(a, { format: 'singles', level: 'fair', band: 'none', team: members(a) });
  assert.strictEqual(sdw.enqueue(b, { format: 'doubles', level: 'fair', band: 'none', team: members(b) }).matched, false);
  assert.strictEqual(sdw.enqueue(c, { format: 'singles', level: 'real', band: 'none', team: members(c) }).matched, false);
  assert.strictEqual(sdw.enqueue(d, { format: 'singles', level: 'fair', band: 'medium', team: members(d) }).matched, false);
  assert.deepStrictEqual([a, b, c, d].map((u) => sdw.isQueued(u.id)), [true, true, true, true]);
  sdw.unqueue(a);
  assert.ok(!sdw.isQueued(a.id));
  sdw.unqueueUser(b.id); sdw.unqueue(c); sdw.unqueue(d);
  assert.strictEqual(sdw.queue.size, 0);
  assert.strictEqual(esc(a, b, c, d).length, 0);
});

test('un mismo jugador no se empareja consigo mismo y volver a buscar reemplaza la búsqueda', () => {
  const a = withMons(IDS);
  sdw.enqueue(a, { format: 'singles', level: 'fair', band: 'none', team: members(a) });
  const again = sdw.enqueue(a, { format: 'singles', level: 'fair', band: 'none', team: members(a) });
  assert.strictEqual(again.matched, false);
  assert.strictEqual(sdw.queue.size, 1);
  sdw.unqueue(a);
});

test('validaciones: banda, equipo y monedas', () => {
  const a = withMons(IDS);
  assert.throws(() => sdw.enqueue(a, { format: 'singles', level: 'fair', band: 'enorme', team: members(a) }), /Apuesta no válida/);
  assert.throws(() => sdw.enqueue(a, { format: 'singles', level: 'fair', band: 'none', team: [] }), /Lleva/);
  a.coins = 10;
  assert.throws(() => sdw.enqueue(a, { format: 'singles', level: 'fair', band: 'small', team: members(a) }), /monedas/);
  assert.strictEqual(sdw.queue.size, 0);
});

test('quien tenía un reto abierto con el máximo de retos se saca de la cola sin romper al otro', () => {
  const a = withMons(IDS), b = withMons(IDS);
  sdw.enqueue(a, { format: 'singles', level: 'fair', band: 'none', team: members(a) });
  const c1 = sdw.challenge(a, { format: 'singles', level: 'fair', wager: 0, team: members(a) });
  const c2 = sdw.challenge(a, { format: 'singles', level: 'fair', wager: 0, team: members(a) });
  const r = sdw.enqueue(b, { format: 'singles', level: 'fair', band: 'none', team: members(b) });
  assert.strictEqual(r.matched, false, 'a no puede crear otro reto: se descarta');
  assert.ok(!sdw.isQueued(a.id) && sdw.isQueued(b.id));
  sdw.cancel(a, { id: c1.challenge }); sdw.cancel(a, { id: c2.challenge }); sdw.unqueue(b);
});

test('la opción de amistad forma parte de la clave de emparejamiento', async () => {
  const a = withMons(IDS), b = withMons(IDS), c = withMons(IDS);
  sdw.enqueue(a, { format: 'singles', level: 'fair', band: 'none', bond: true, team: members(a) });
  assert.strictEqual(sdw.enqueue(b, { format: 'singles', level: 'fair', band: 'none', bond: false, team: members(b) }).matched, false);
  const r = sdw.enqueue(c, { format: 'singles', level: 'fair', band: 'none', team: members(c) }); // por defecto activada
  assert.strictEqual(r.matched, true);
  const bat = sdw.battles.get(r.battle.id);
  assert.strictEqual(bat.affection, 'both');
  assert.throws(() => sdw.enqueue(withMons(IDS), { format: 'singles', level: 'fair', band: 'none', bond: 1, team: [] }), /amistad/);
  sdw.unqueue(b);
  sdw.forfeit(a, { id: bat.id });
  await bat.done;
});
