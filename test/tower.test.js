'use strict';
// Torre Batalla: equipos de alquiler válidos, rachas, recompensas (solo PB, con tope diario), cambios y persistencia de la carrera.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-tw-'));

const db = require('../server/db');
const sd = require('../server/sdmap');
const sdw = require('../server/showdown');
const tower = require('../server/tower');
const bpdata = require('../server/bpdata');
const hub = require('../server/hub');

let n = 0;
function player(extra = {}) {
  const name = 'tw' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 1000, dust: 0, buddy: null, items: {}, buffs: {}, games: {}, collection: {}, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 5, createdAt: Date.now() - 9 * 864e5, ...extra };
  db.addUser(u);
  return u;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('waitFor: tiempo agotado'); await wait(10); } }
// Empieza la carrera y elige a los primeros del ofrecimiento.
function begin(u, format = 'singles') {
  tower.start(u, { format });
  const need = tower.PICK[format];
  tower.pick(u, { picks: [...Array(need).keys()] });
}
// El combate se gana (o se pierde) rindiendo a un bando: el rival de la CPU o el jugador.
async function finish(u, win) {
  const b = sdw.byUser.get(u.id);
  assert.ok(b && b.tower, 'hay un combate de la Torre');
  b.forfeit(win ? b.sides[1] : b.sides[0]);
  await b.done;
  return b;
}

test('alquileres: conjuntos legales de Showdown (aprendibles), nivel 50, 4 movimientos, especies distintas', () => {
  const { TeamValidator } = sd.ps();
  const v = TeamValidator.get('gen9customgame@@@Obtainable');
  for (const format of tower.FORMATS) {
    for (let i = 0; i < 12; i++) {
      const offer = tower.offerFor(format);
      assert.strictEqual(offer.length, tower.OFFER);
      assert.strictEqual(new Set(offer.map((m) => sd.speciesOf(m.roster.id).baseSpecies)).size, tower.OFFER, 'especies distintas');
      for (const m of offer) {
        assert.strictEqual(m.set.level, 50);
        assert.ok(m.set.moves.length >= 1 && m.set.moves.length <= 4 && new Set(m.set.moves).size === m.set.moves.length);
        assert.strictEqual(m.roster.name, m.set.name);
        const evs = Object.values(m.set.evs).reduce((a, b) => a + b, 0);
        assert.ok(evs <= 510);
        const problems = v.validateTeam([m.set]);
        assert.strictEqual(problems, null, `${m.set.species}: ${JSON.stringify(problems)} ${m.set.moves}`);
      }
    }
  }
});

test('rivales: tamaño del equipo, fuerza creciente y Jefes de la Torre con nombre cada 21 combates', () => {
  assert.deepStrictEqual([1, 7, 8, 14, 15, 21, 22].map((n) => tower.isBoss(n)), [false, false, false, false, false, true, false]);
  assert.ok(tower.isBoss(42) && tower.isBoss(63));
  const f = tower.foeFor('singles', 3);
  assert.strictEqual(f.mons.length, 3);
  assert.strictEqual(f.boss, false);
  const boss = tower.foeFor('doubles', 21);
  assert.strictEqual(boss.mons.length, 4);
  assert.ok(boss.boss && boss.who.name === 'Magno' && boss.who.cls === 'Jefe de la Torre');
  assert.strictEqual(tower.foeFor('singles', 42).who.name, 'Valeria');
  const bst = (m) => Object.values(sd.speciesOf(m.roster.id).baseStats).reduce((a, b) => a + b, 0);
  for (let i = 0; i < 8; i++) for (const m of tower.foeFor('singles', 1).mons) assert.ok(bst(m) <= 450, 'los primeros rivales son flojos');
  for (const m of tower.foeFor('singles', 21).mons) assert.ok(bst(m) >= 540);
  assert.deepStrictEqual([1, 7, 8, 14, 15, 30].map(tower.bpForWin), [1, 1, 2, 2, 3, 3]);
  assert.strictEqual(tower.DAY_CAP, bpdata.CAPS.tower);
});

test('una IA puede jugar un combate completo con equipos de alquiler', async () => {
  const mk = (cpu) => { const mons = tower.foeFor('singles', 5).mons; return { sets: mons.map((m) => m.set), roster: mons.map((m) => m.roster) }; };
  const r = await sdw.runAiBattle({ format: 'singles', teamA: mk(), teamB: mk(), level: 'fair', timeoutMs: 60000 });
  assert.ok(r.winner === 0 || r.winner === 1 || r.winner === null);
});

test('carrera: elegir equipo, combatir, la racha sube con cada victoria y se pierde al caer', async () => {
  const u = player();
  const coins = u.coins;
  assert.throws(() => tower.pick(u, { picks: [0, 1, 2] }), /equipo que elegir/);
  assert.throws(() => tower.start(u, { format: 'raro' }), /Formato/);
  tower.start(u, { format: 'singles' });
  assert.throws(() => tower.start(u, { format: 'singles' }), /Ya tienes una carrera/);
  assert.throws(() => tower.fight(u), /elige tu equipo/);
  assert.throws(() => tower.pick(u, { picks: [0, 1] }), /Elige 3/);
  assert.throws(() => tower.pick(u, { picks: [0, 0, 1] }), /Elige 3/);
  assert.throws(() => tower.pick(u, { picks: [0, 1, 9] }), /Elige 3/);
  tower.pick(u, { picks: [5, 1, 3] });
  const v0 = tower.state(u);
  assert.strictEqual(v0.run.phase, 'ready');
  assert.strictEqual(v0.run.team.length, 3);
  assert.deepStrictEqual([v0.run.next.n, v0.run.next.boss, v0.run.next.bp], [1, false, 1]);
  const r = tower.fight(u);
  assert.ok(r.battle.tower && r.battle.tower.n === 1 && r.battle.mode === 'cpu');
  assert.throws(() => tower.fight(u), /combate en curso/);
  assert.throws(() => tower.abandon(u), /pleno combate/);
  const b = await finish(u, true);
  assert.strictEqual(b.affection, false, 'sin efectos de amistad');
  const st = tower.state(u);
  assert.strictEqual(st.run.streak, 1);
  assert.strictEqual(st.run.phase, 'swap');
  assert.strictEqual(u.bp, 1);
  assert.strictEqual(st.best.singles, 1);
  assert.strictEqual(u.coins, coins, 'la Torre nunca da monedas');
  assert.strictEqual(u.btHist[0].tower, 1);
  // Segundo combate sin cambiar (se salta el cambio) y se pierde: la carrera termina, el récord se conserva.
  tower.fight(u);
  assert.strictEqual(tower.state(u).run.next.n, 2);
  await finish(u, true);
  assert.strictEqual(u.tower.run.streak, 2);
  tower.fight(u);
  await finish(u, false);
  assert.strictEqual(u.tower.run, null);
  assert.strictEqual(tower.state(u).best.singles, 2);
  assert.strictEqual(u.bp, 2);
  assert.strictEqual(u.coins, coins);
  assert.strictEqual(tower.state(u).board.singles.find((r) => r.username === u.username).value, 2);
  // Una nueva carrera empieza de cero.
  begin(u);
  assert.strictEqual(tower.state(u).run.streak, 0);
  tower.abandon(u);
  assert.strictEqual(u.tower.run, null);
});

test('cambio opcional tras una victoria: uno de los tuyos por uno del rival, sin repetir especie', async () => {
  const u = player();
  begin(u);
  tower.fight(u);
  assert.throws(() => tower.swap(u, { out: 0, in: 0 }), /Ahora no/);
  await finish(u, true);
  const before = tower.state(u).run;
  assert.strictEqual(before.swap.length, 3);
  assert.throws(() => tower.swap(u, { out: 7, in: 0 }), /no válida/);
  const foe = before.swap[1];
  const mine = u.tower.run.team.map((m) => m.roster.id);
  const clash = mine.includes(foe.id);
  if (clash) {
    const idx = mine.indexOf(foe.id);
    assert.throws(() => tower.swap(u, { out: (idx + 1) % 3, in: 1 }), /especies/);
  }
  const r = tower.swap(u, { out: clash ? mine.indexOf(foe.id) : 0, in: 1 });
  assert.strictEqual(r.tower.run.phase, 'ready');
  assert.ok(r.tower.run.team.some((m) => m.id === foe.id), 'el Pokémon del rival ya es tuyo');
  assert.strictEqual(r.tower.run.team.length, 3);
  // Y el siguiente combate usa el equipo nuevo.
  const f = tower.fight(u);
  assert.ok(f.battle.roster.p1.some((x) => x.id === foe.id));
  await finish(u, false);
});

test('PB: 1 → 3 por victoria, +10 al cerrar cada ronda, tope diario de 40 y nunca monedas; medallas en 21 / 50 / 100', async () => {
  const u = player();
  const coins = u.coins;
  begin(u);
  // Racha 6 → el combate 7 cierra la ronda 1: 1 + 10.
  u.tower.run.streak = 6;
  tower.fight(u);
  const ends = [];
  const off = hub.emitUser; // el aviso final lleva `tower`
  hub.emitUser = (id, ev, p) => { if (ev === 'battle:end' && id === u.id) ends.push(p); return off.call(hub, id, ev, p); };
  await finish(u, true);
  hub.emitUser = off;
  assert.strictEqual(u.bp, 11);
  assert.strictEqual(ends[0].tower.bp, 11);
  assert.ok(ends[0].tower.roundDone && ends[0].tower.round === 1);
  // Racha 13 → combate 14: 2 + 10 (total del día 23).
  u.tower.run.streak = 13; u.tower.run.phase = 'ready';
  tower.fight(u); await finish(u, true);
  assert.strictEqual(u.bp, 23);
  // Racha 20 → el combate 21 es del Jefe, vale 3 + 10 pero solo caben 17 más.
  u.tower.run.streak = 20; u.tower.run.phase = 'ready';
  const fr = tower.fight(u);
  assert.ok(fr.battle.tower.boss);
  assert.match(fr.battle.foe, /Jefe de la Torre/);
  assert.strictEqual(fr.battle.trainer.name, 'Magno');
  const b = await finish(u, true);
  assert.strictEqual(u.bp, 36);
  assert.ok(u.tower.medals['torre-21']);
  assert.ok(u.progress.titles.includes('torre-21'));
  assert.strictEqual(require('../server/progress').titleText('torre-21'), 'Aspirante de la Torre');
  // Otra victoria: solo caben 4 PB hasta el tope diario.
  u.tower.run.streak = 21; u.tower.run.phase = 'ready';
  tower.fight(u); await finish(u, true);
  assert.strictEqual(u.bp, 39);
  u.tower.run.streak = 22; u.tower.run.phase = 'ready';
  tower.fight(u); await finish(u, true);
  assert.strictEqual(u.bp, 40, 'tope diario de la Torre');
  u.tower.run.streak = 23; u.tower.run.phase = 'ready';
  tower.fight(u); await finish(u, true);
  assert.strictEqual(u.bp, 40);
  assert.strictEqual(u.coins, coins);
  assert.strictEqual(tower.state(u).bpToday, 40);
  // El tope es independiente de los de CPU y PvP.
  assert.strictEqual(require('../server/bp').cpuWin(u, 6), 3);
  // Medallas 50 y 100.
  u.tower.run.streak = 49; u.tower.run.phase = 'ready';
  tower.fight(u); await finish(u, true);
  assert.ok(u.progress.titles.includes('torre-50') && !u.progress.titles.includes('torre-100'));
  u.tower.run.streak = 99; u.tower.run.phase = 'ready';
  tower.fight(u); await finish(u, true);
  assert.ok(u.progress.titles.includes('torre-100'));
  assert.strictEqual(tower.state(u).best.singles, 100);
  // Pasa el día: el tope se renueva.
  u.bpDay.day = '2000-01-01';
  assert.strictEqual(tower.state(u).bpToday, 0);
});

test('dobles: equipo de 4 y rivales de 4', async () => {
  const u = player();
  begin(u, 'doubles');
  assert.strictEqual(tower.state(u).run.team.length, 4);
  const r = tower.fight(u);
  assert.strictEqual(r.battle.format, 'doubles');
  assert.strictEqual(r.battle.roster.p2.length, 4);
  await finish(u, true);
  assert.strictEqual(tower.state(u).best.doubles, 1);
  assert.strictEqual(tower.state(u).best.singles, 0);
});

test('persistencia: la carrera y el combate en curso sobreviven a un reinicio (y el combate sigue siendo de la Torre)', async () => {
  const u = player();
  begin(u);
  u.tower.run.streak = 4;
  const r = tower.fight(u);
  await waitFor(() => sdw.battles.get(r.battle.id).sides[0].req);
  // Reinicio: se guarda todo, se olvida la memoria y se reconstruye desde lo guardado.
  sdw.refundAll(); sdw._dropMemory();
  db.data.sdBattles = JSON.parse(JSON.stringify(db.data.sdBattles));
  const saved = JSON.parse(JSON.stringify(u.tower));
  u.tower = saved;
  assert.strictEqual(await sdw.restoreAll(), 1);
  const b = sdw.battles.get(r.battle.id);
  assert.ok(b && b.tower && b.tower.n === 5 && b.trainer.cls);
  assert.strictEqual(b.view(b.sides[0]).tower.n, 5);
  assert.strictEqual(tower.state(u).run.phase, 'battle');
  assert.strictEqual(tower.state(u).run.streak, 4);
  b.forfeit(b.sides[1]);
  await b.done;
  assert.strictEqual(u.tower.run.streak, 5);
  assert.strictEqual(u.tower.run.phase, 'swap');
  // Si el combate guardado se pierde, la carrera no se pierde: vuelve a «lista».
  tower.fight(u);
  const id = u.tower.run.battleId;
  sdw.refundAll(); sdw._dropMemory();
  db.data.sdBattles = JSON.parse(JSON.stringify(db.data.sdBattles));
  db.data.sdBattles[id].v = '0.0.1';
  await sdw.restoreAll();
  assert.strictEqual(tower.state(u).run.phase, 'ready');
  assert.strictEqual(u.tower.run.streak, 5);
  assert.strictEqual(sdw.battles.size, 0);
});
