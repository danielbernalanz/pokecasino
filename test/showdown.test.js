'use strict';
// Combates con el simulador de Pokémon Showdown: mapeo de ejemplares, nombres en español, partidas completas con IA,
// apuestas PvP, validación de elecciones, tope de combates simultáneos y tope diario de recompensas.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-sd-'));
process.env.SD_MAX_BATTLES = '2';

const db = require('../server/db');
const hub = require('../server/hub');
const specimen = require('../server/specimen');
const sd = require('../server/sdmap');
const sdw = require('../server/showdown');
const trainers = require('../server/trainers');
const { DEX, BY_ID } = require('../server/pokedex');
const ES = require('../server/sd-es.json');

let n = 0;
function user(extra = {}) {
  const name = 'sd' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 50000, dust: 0, buddy: null, items: {}, buffs: {}, games: {}, collection: {}, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, createdAt: Date.now() - 9 * 864e5, ...extra };
  db.addUser(u);
  return u;
}
function withMons(ids) {
  const u = user({ collection: Object.fromEntries(ids.map((id) => [id, { n: 1, s: 0 }])) });
  specimen.syncAll(u);
  return u;
}
const members = (u, ids) => ids.map((id) => ({ id, uid: u.mons[id][0].uid }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('waitFor: tiempo agotado'); await wait(10); } }
const asking = (side) => !!(side.req && !side.req.wait && !side.chosen);

test('el simulador no se carga hasta que hace falta', () => {
  // (otros archivos de prueba no comparten proceso con este)
  assert.ok(!Object.keys(require.cache).some((k) => k.includes('pokemon-showdown/dist/sim')), 'cargado antes de tiempo');
});

test('ejemplar → conjunto de Showdown: naturaleza, IVs, nivel, habilidad y movimientos reales', () => {
  const { Dex } = sd.ps();
  // Las 25 naturalezas coinciden con las del simulador (+ y −).
  const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  for (const nat of specimen.NATURES) {
    const en = Dex.natures.get(sd.NATURE_EN[nat.name]);
    assert.ok(en.exists, nat.name);
    assert.strictEqual(en.plus || null, nat.up ? STATS[nat.up] : null, `${nat.name} +`);
    assert.strictEqual(en.minus || null, nat.down ? STATS[nat.down] : null, `${nat.name} −`);
  }
  const u = withMons([25, 6, 81, 29]);
  const pika = u.mons[25][0];
  pika.nature = 'Alegre'; pika.ivs = [1, 2, 3, 4, 5, 6]; pika.level = 37; pika.friendship = 200; pika.nick = 'Rayito';
  const { set, roster } = sd.toSet(25, pika, { level: 'real' });
  assert.strictEqual(set.nature, 'Jolly');
  assert.deepStrictEqual(set.ivs, { hp: 1, atk: 2, def: 3, spa: 4, spd: 5, spe: 6 });
  assert.strictEqual(set.level, 37);
  assert.strictEqual(sd.toSet(25, pika, { level: 'fair' }).set.level, 50);
  assert.strictEqual(set.happiness, 200);
  assert.strictEqual(set.name, 'Rayito');
  assert.strictEqual(roster.id, 25);
  assert.strictEqual(set.species, 'Pikachu');
  // Habilidad real y no oculta; movimientos legales (≤ 4, existentes, del learnset).
  for (const id of [25, 6, 81, 29, 150, 132, 129]) {
    const m = specimen.make(id);
    sd.ensureSd(id, m);
    const sp = sd.speciesOf(id);
    const real = [sp.abilities[0], sp.abilities[1]].filter(Boolean).map(sd.toID);
    assert.ok(real.includes(m.sdAbility), `${sp.name}: ${m.sdAbility}`);
    assert.ok(m.sdMoves.length >= 1 && m.sdMoves.length <= 4, `${sp.name} movimientos`);
    const learn = new Set(require('../server/moves').levelMoves(id).map((x) => x.move));
    for (const mv of m.sdMoves) { assert.ok(Dex.moves.get(mv).exists); assert.ok(learn.has(mv), `${sp.name} no aprende ${mv}`); assert.ok(m.learned.includes(mv)); }
  }
  // Determinista por uid: la misma habilidad siempre.
  const a = { uid: 'abc12345', ivs: [] }, b = { uid: 'abc12345', ivs: [] };
  sd.ensureSd(6, a); sd.ensureSd(6, b);
  assert.strictEqual(a.sdAbility, b.sdAbility);
  // Sexo: las especies sin sexo o de sexo fijo ignoran el del ejemplar.
  const mag = specimen.make(81); mag.gender = 'M';
  assert.strictEqual(sd.toSet(81, mag).set.gender, '');
  const nidoF = specimen.make(29); nidoF.gender = 'M';
  assert.strictEqual(sd.toSet(29, nidoF).set.gender, 'F');
  // Si evoluciona, se recalcula lo que ya no es legal.
  const ev = specimen.make(133);
  sd.ensureSd(133, ev);
  sd.ensureSd(134, ev);
  assert.ok(sd.allAbilitiesOf(134).some((x) => x.id === ev.sdAbility));
  // Cambiar movimientos: solo entre los aprendidos.
  const pk = specimen.make(25);
  pk.learned.push('thunderbolt', 'surf');
  assert.deepStrictEqual(sd.validateSd(25, pk, { moves: ['thunderbolt', 'surf'] }).sdMoves, ['thunderbolt', 'surf']);
  assert.throws(() => sd.validateSd(25, pk, { moves: ['hydrocannon'] }));
  assert.throws(() => sd.validateSd(25, pk, { moves: ['thunderbolt', 'thunderbolt'] }));
  assert.throws(() => sd.validateSd(25, pk, { moves: ['a', 'b', 'c', 'd', 'e'] }));
  assert.throws(() => sd.validateSd(25, pk, { ability: 'wonderguard' }));
  // Todos los Pokémon del casino se pueden mapear.
  assert.ok(DEX.every((p) => sd.canBattle(p.id)), 'hay especies sin equivalente en Showdown');
});

test('megaevolución: la piedra se pone sola y solo si está desbloqueada', () => {
  const u = withMons([6]);
  const mega = require('../server/mega');
  const sp = u.mons[6][0];
  assert.throws(() => sdw.resolveTeam(u, [{ id: 6, uid: sp.uid, mega: 10034 }], { format: 'singles', level: 'fair' }), /desbloqueada/);
  mega.megasOf(u)[10034] = Date.now();
  const { sets } = sdw.resolveTeam(u, [{ id: 6, uid: sp.uid, mega: 10034 }], { format: 'singles', level: 'fair' });
  assert.strictEqual(sets[0].item, 'charizarditex');
  assert.throws(() => sdw.resolveTeam(u, [{ id: 6, uid: sp.uid, mega: 10033 }], { format: 'singles', level: 'fair' }));
});

test('nombres en español: movimientos, habilidades y objetos', () => {
  assert.strictEqual(ES.moves.thunderbolt, 'Rayo');
  assert.strictEqual(ES.moves.thundershock, 'Impactrueno');
  assert.strictEqual(ES.moves.flamethrower, 'Lanzallamas');
  assert.strictEqual(ES.moves.protect, 'Protección');
  assert.strictEqual(ES.abilities.intimidate, 'Intimidación');
  assert.strictEqual(ES.abilities.static, 'Electricidad Estática');
  assert.strictEqual(ES.items.charizarditex, 'Charizardita X');
  // Todo lo que el juego puede dar por defecto está traducido.
  const missing = [];
  for (const p of DEX.slice(0, 400)) {
    const m = specimen.make(p.id);
    sd.ensureSd(p.id, m);
    if (!ES.abilities[m.sdAbility]) missing.push(m.sdAbility);
    for (const mv of m.sdMoves) if (!ES.moves[mv] || !ES.meta[mv]) missing.push(mv);
  }
  assert.deepStrictEqual(missing, []);
});

test('validación de elecciones: acepta las legítimas y rechaza basura', () => {
  for (const ok of ['move 1', 'move 2 1', 'move 3 -2', 'move 1 mega', 'move 1 2 mega', 'switch 4', 'team 1234', 'default', 'move 1 1, move 2 2', 'move 1, switch 3', 'pass', 'shift', 'move 1, pass']) {
    assert.ok(sdw.validChoice(ok), ok);
  }
  for (const bad of ['', 'move', 'move 9', 'move 0', 'switch 7', 'team 0', 'team 1234567', 'move 1 terastallize', '>forcewin p1', 'move 1\n>forcewin p1', 'move 1; rm -rf', '/choose move 1', 'move 1 1 1', 'x'.repeat(101), 'move 1, '.repeat(20), 'MOVE 1', null, undefined, 5, {}, ['move 1']]) {
    assert.ok(!sdw.validChoice(bad), String(bad));
  }
});

test('combate completo individual y en dobles entre dos IA, sin dejar el simulador abierto', async () => {
  for (const [format, size] of [['singles', 6], ['doubles', 4]]) {
    const A = trainers.buildTeam(trainers.BY_TRAINER.get('sergio'), size, { doubles: format === 'doubles' });
    const B = trainers.buildTeam(trainers.BY_TRAINER.get('misty'), size, { doubles: format === 'doubles' });
    const t0 = Date.now();
    const r = await sdw.runAiBattle({ format, teamA: A, teamB: B, timeoutMs: 40000 });
    assert.ok(!r.aborted, `${format} abortado`);
    assert.ok(r.winner === 0 || r.winner === 1 || r.winner === null);
    assert.ok(r.turns >= 2, `${format}: ${r.turns} turnos`);
    assert.ok(r.log.some((l) => l.startsWith('|win|') || l === '|tie'), 'sin final');
    assert.ok(r.log.some((l) => l.startsWith('|move|')), 'sin ataques');
    assert.ok(Date.now() - t0 < 30000, 'tarda demasiado');
  }
  assert.strictEqual(sdw.battles.size, 0, 'quedan combates abiertos');
});

test('la IA elige el ataque con más daño y cambia o remata con criterio', () => {
  const { Brain } = require('../server/sdai');
  const brain = new Brain('p1');
  brain.feed(['|poke|p2|Gyarados, L50, M|', '|switch|p2a: Gyarados|Gyarados, L50, M|100/100']);
  const req = {
    active: [{ moves: [{ move: 'Tackle', id: 'tackle', pp: 35, maxpp: 35, target: 'normal', disabled: false }, { move: 'Thunderbolt', id: 'thunderbolt', pp: 15, maxpp: 15, target: 'normal', disabled: false }] }],
    side: { id: 'p1', pokemon: [{ ident: 'p1: Pikachu', details: 'Pikachu, L50, M', condition: '110/110', active: true, stats: { atk: 67, def: 60, spa: 70, spd: 70, spe: 121 }, moves: ['tackle', 'thunderbolt'], ability: 'static', item: '' }] },
  };
  for (let i = 0; i < 20; i++) assert.strictEqual(brain.decide(req), 'move 2', 'Rayo es supereficaz contra Gyarados');
});

test('PvP: cancelar devuelve la apuesta; ganar paga el bote menos la comisión; el empate devuelve', async () => {
  const ids = [25, 6, 9];
  const a = withMons(ids), b = withMons(ids);
  const t = (u) => members(u, ids);
  const coins0 = a.coins;
  const r = sdw.challenge(a, { format: 'singles', level: 'fair', wager: 1000, team: t(a) });
  assert.strictEqual(a.coins, coins0 - 1000);
  assert.strictEqual(Object.values(db.data.escrow).filter((e) => e.userId === a.id).reduce((s, e) => s + e.amount, 0), 1000);
  sdw.cancel(a, { id: r.challenge });
  assert.strictEqual(a.coins, coins0, 'cancelar devuelve');
  assert.strictEqual(Object.values(db.data.escrow).filter((e) => e.userId === a.id).length, 0);
  // Reto válido, aceptado y uno se rinde.
  const c2 = sdw.challenge(a, { format: 'singles', level: 'fair', wager: 1000, team: t(a) });
  assert.throws(() => sdw.accept(a, { id: c2.challenge, team: t(a) }), /propio/);
  const bc0 = b.coins;
  const acc = sdw.accept(b, { id: c2.challenge, team: t(b) });
  assert.strictEqual(b.coins, bc0 - 1000);
  const bat = sdw.battles.get(acc.battle.id);
  assert.ok(bat);
  assert.strictEqual(Object.values(db.data.escrow).filter((e) => [a.id, b.id].includes(e.userId)).length, 2);
  assert.throws(() => sdw.challenge(a, { format: 'singles', level: 'fair', wager: 0, team: t(a) }), /Ya estás en un combate/);
  sdw.forfeit(a, { id: bat.id });
  const res = await bat.done;
  assert.strictEqual(res.winner, 1);
  const prize = Math.floor(1000 * 2 * (1 - sdw.RAKE));
  // (la experiencia de la apuesta puede subir de nivel y dar su pequeño premio de nivel)
  const lvl = (u) => (u.hist.log || []).filter((e) => e.r === 'level').reduce((s, e) => s + e.d, 0);
  assert.strictEqual(b.coins - lvl(b), bc0 - 1000 + prize, 'el ganador cobra el bote menos la comisión');
  assert.strictEqual(a.coins - lvl(a), coins0 - 1000);
  assert.strictEqual(prize, 1900);
  assert.strictEqual(Object.values(db.data.escrow).filter((e) => [a.id, b.id].includes(e.userId)).length, 0);
  assert.strictEqual(b.btHist[0].won, true);
  assert.strictEqual(a.btHist[0].won, false);
  assert.ok(sdw.replay(b, { id: bat.id }).replay.log.length > 5, 'hay repetición');
  assert.strictEqual(sdw.replay(user(), { id: bat.id }).replay, null, 'solo los participantes ven la repetición');
  // Total conservado salvo la comisión.
  assert.strictEqual(a.coins + b.coins - lvl(a) - lvl(b), coins0 + bc0 - (1000 * 2 - prize));
  // Si el simulador falla a mitad, se devuelve todo.
  const c3 = sdw.challenge(a, { format: 'singles', level: 'fair', wager: 500, team: t(a) });
  const before = [a.coins, b.coins];
  const l0 = [lvl(a), lvl(b)];
  sdw.accept(b, { id: c3.challenge, team: t(b) });
  const bat3 = [...sdw.battles.values()].find((x) => x.mode === 'pvp');
  bat3.crash(new Error('prueba'));
  await bat3.done;
  assert.deepStrictEqual([a.coins - lvl(a) + l0[0], b.coins - lvl(b) + l0[1]], [before[0] + 500, before[1]]);
  assert.strictEqual(Object.values(db.data.escrow).filter((e) => [a.id, b.id].includes(e.userId)).length, 0);
  assert.strictEqual(sdw.battles.size, 0);
  // Empate: cada uno recupera lo suyo.
  const c4 = sdw.challenge(a, { format: 'singles', level: 'fair', wager: 700, team: t(a) });
  const pre = [a.coins + 700, b.coins];
  const l1 = [lvl(a), lvl(b)];
  sdw.accept(b, { id: c4.challenge, team: t(b) });
  const bat4 = [...sdw.battles.values()].find((x) => x.mode === 'pvp');
  bat4.queueEnd(null);
  await bat4.done;
  assert.deepStrictEqual([a.coins - (lvl(a) - l1[0]), b.coins - (lvl(b) - l1[1])], pre, 'el empate devuelve las apuestas');
  assert.strictEqual(Object.values(db.data.escrow).filter((e) => [a.id, b.id].includes(e.userId)).length, 0);
});

test('PvP: equipos ilegales se rechazan (especie repetida, ajeno, demasiado grande)', () => {
  const a = withMons([25, 26]);
  const b = withMons([25]);
  const tm = (u, ids) => members(u, ids);
  assert.throws(() => sdw.resolveTeam(a, [], { format: 'singles', level: 'fair' }));
  assert.throws(() => sdw.resolveTeam(a, tm(a, [25]), { format: 'doubles', level: 'fair' }), /entre 2 y 6/);
  assert.throws(() => sdw.resolveTeam(a, [{ id: 25, uid: b.mons[25][0].uid }], { format: 'singles', level: 'fair' }), /No tienes/);
  a.collection[25].n = 2; specimen.sync(a, 25);
  assert.throws(() => sdw.resolveTeam(a, [{ id: 25, uid: a.mons[25][0].uid }, { id: 25, uid: a.mons[25][1].uid }], { format: 'singles', level: 'fair' }), /misma especie|repetido/);
  assert.throws(() => sdw.resolveTeam(a, tm(a, [25]), { format: 'singles', level: 'raro' }));
  assert.throws(() => sdw.resolveTeam(a, 'nope', { format: 'singles', level: 'fair' }));
});

test('contra CPU: tope de combates simultáneos, recompensas y tope diario de victorias', async () => {
  const ids = [25, 6, 9];
  const mk = () => withMons(ids);
  const u1 = mk(), u2 = mk(), u3 = mk();
  const team = (u) => members(u, ids);
  const v1 = sdw.startCpu(u1, { trainer: 'ramon', format: 'singles', level: 'fair', team: team(u1) });
  const v2 = sdw.startCpu(u2, { trainer: 'clara', format: 'doubles', level: 'fair', team: team(u2) });
  assert.throws(() => sdw.startCpu(u3, { trainer: 'ramon', format: 'singles', level: 'fair', team: team(u3) }), /demasiados combates/);
  assert.throws(() => sdw.startCpu(u1, { trainer: 'ramon', format: 'singles', level: 'fair', team: team(u1) }), /Ya estás/);
  assert.strictEqual(sdw.battles.size, 2);
  assert.ok(v1.battle.roster.p2.length === 3 && v1.battle.pickN === 3);
  // Elección inválida o fuera de turno.
  assert.throws(() => sdw.choose(u1, { id: v1.battle.id, choice: 'move 9' }), /no válida/);
  assert.throws(() => sdw.choose(u3, { id: v1.battle.id, choice: 'move 1' }), /No participas/);
  // El rival CPU se rinde: gana el jugador y cobra una vez.
  const b1 = sdw.battles.get(v1.battle.id);
  await wait(250);
  sdw.choose(u1, { id: v1.battle.id, choice: 'team 123' }); // vista previa: así hay participantes
  await wait(250);
  const c0 = u1.coins;
  b1.forfeit(b1.sides[1]);
  await b1.done;
  assert.strictEqual(u1.coins, c0 + trainers.COINS[1]);
  assert.ok(u1.candy && Object.values(u1.candy).some((x) => x >= 2), 'caramelos de las familias');
  assert.strictEqual(u1.btHist[0].won, true);
  const b2 = sdw.battles.get(v2.battle.id);
  b2.forfeit(b2.sides[0]);
  await b2.done;
  assert.strictEqual(u2.btHist[0].won, false);
  assert.strictEqual(u2.coins, 50000, 'perder no cuesta nada');
  // Tope diario: tras 10 victorias con premio la 11.ª no paga.
  const p = mk();
  let paid = 0;
  for (let i = 0; i < trainers.WINS_PER_DAY + 2; i++) {
    const v = sdw.startCpu(p, { trainer: 'ramon', format: 'singles', level: 'fair', team: team(p) });
    const b = sdw.battles.get(v.battle.id);
    const before = p.coins;
    b.forfeit(b.sides[1]);
    await b.done;
    paid = (p.hist.income && p.hist.income.battle) || 0;
    void before;
  }
  assert.strictEqual(paid, trainers.WINS_PER_DAY * trainers.COINS[1], 'máximo diario');
  assert.strictEqual(sdw.dayWins(p).wins, trainers.WINS_PER_DAY);
  // Recompensa máxima diaria < recompensa diaria base.
  assert.ok(trainers.WINS_PER_DAY * Math.max(...Object.values(trainers.COINS)) <= require('../server/balance').DAILY_BASE);
  // Entrenadores con medallas: el campeón está bloqueado para un recién llegado.
  assert.throws(() => sdw.startCpu(withMons(ids), { trainer: 'lance', format: 'singles', level: 'fair', team: team(withMons(ids)) }));
  const fresh = withMons(ids);
  assert.throws(() => sdw.startCpu(fresh, { trainer: 'lance', format: 'singles', level: 'fair', team: team(fresh) }), /medallas/);
  assert.strictEqual(sdw.battles.size, 0);
});

test('turnos: tiempo agotado elige por defecto y 3 seguidos pierden el combate', async () => {
  // Reloj corto solo para esta prueba: se sustituyen los temporizadores del combate.
  const ids = [25, 6, 9];
  const u = withMons(ids);
  const v = sdw.startCpu(u, { trainer: 'hugo', format: 'singles', level: 'fair', team: members(u, ids) });
  const b = sdw.battles.get(v.battle.id);
  await wait(300);
  const side = b.sides[0];
  assert.ok(side.req && side.req.teamPreview, 'vista previa');
  for (let i = 0; i < sdw.MAX_TIMEOUTS; i++) {
    clearTimeout(side.timer);
    side.deadline = Date.now();
    b.timeout(side);
    await wait(250);
    if (i < sdw.MAX_TIMEOUTS - 1) { assert.ok(!b.over); side.chosen = false; }
  }
  const res = await b.done;
  assert.strictEqual(res.winner, 1);
  assert.ok(u.btHist[0].won === false);
});

// ---------- Reinicio del servidor a mitad de combate ----------
const { Brain } = require('../server/sdai');
function restart() {
  sdw.refundAll(); // lo que hace el apagado: guarda los combates
  sdw._dropMemory();
  db.data.sdBattles = JSON.parse(JSON.stringify(db.data.sdBattles || {})); // como si se leyera de disco
  db.refundEscrow(); // el arranque NO debe devolver los depósitos de combates guardados
  return sdw.restoreAll();
}
// Juega por un jugador con una IA hasta que acaba el combate.
async function autoplay(b, sides, users) {
  const brains = sides.map((i) => { const br = new Brain('p' + (i + 1), { doubles: b.format === 'doubles' }); br.feed(b.sides[i].log); return { i, br, seen: b.sides[i].log.length }; });
  const t0 = Date.now();
  while (!b.finished && Date.now() - t0 < 30000) {
    for (const x of brains) {
      const side = b.sides[x.i];
      if (side.log.length > x.seen) { x.br.feed(side.log.slice(x.seen)); x.seen = side.log.length; }
      if (side.req && !side.req.wait && !side.chosen && !b.over) {
        try { sdw.choose(users[x.i], { id: b.id, choice: x.br.decide(side.req) || 'default' }); } catch { /* ya elegido */ }
      }
    }
    await wait(15);
  }
  return b.done;
}
const reqKey = (r) => JSON.stringify(r.side.pokemon.map((p) => [p.ident, p.condition, p.active])) + JSON.stringify((r.active || []).map((a) => a.moves.map((m) => [m.id, m.pp])));

test('reinicio: un combate CPU se reconstruye igual (mismo turno y PS) y termina', async () => {
  const ids = [25, 6, 9];
  const u = withMons(ids);
  const v = sdw.startCpu(u, { trainer: 'hugo', format: 'singles', level: 'fair', team: members(u, ids) });
  const b = sdw.battles.get(v.battle.id);
  await waitFor(() => asking(b.sides[0]));
  sdw.choose(u, { id: b.id, choice: 'team 123' });
  await waitFor(() => asking(b.sides[0]) && b.sides[0].req.active);
  sdw.choose(u, { id: b.id, choice: 'move 1' });
  await waitFor(() => asking(b.sides[0]) && (b.turn >= 2 || b.sides[0].req.forceSwitch));
  await wait(50);
  const before = { key: reqKey(b.sides[0].req), turn: b.turn, logs: b.sides[0].log.length, foe: reqKey(b.sides[1].req) };
  assert.ok(before.turn >= 1, 'ha empezado el combate');
  assert.ok(db.data.sdBattles[b.id], 'guardado');
  const n = await restart();
  assert.strictEqual(n, 1);
  const b2 = sdw.battles.get(v.battle.id);
  assert.ok(b2 && b2 !== b);
  assert.strictEqual(b2.turn, before.turn);
  assert.strictEqual(reqKey(b2.sides[0].req), before.key, 'misma petición y mismos PS');
  assert.strictEqual(reqKey(b2.sides[1].req), before.foe);
  assert.strictEqual(b2.sides[0].log.length, before.logs);
  assert.strictEqual(b2.sides[0].chosen, false);
  assert.ok(b2.sides[0].deadline - Date.now() > sdw.TURN_MS, 'margen extra para el temporizador');
  assert.strictEqual(sdw.resume(u).battle.id, b.id);
  assert.strictEqual(sdw.activeFor ? 1 : 1, 1);
  const res = await autoplay(b2, [0], [u]);
  assert.ok(!res.aborted);
  assert.ok(!db.data.sdBattles[b.id], 'se borra al terminar');
  assert.strictEqual(sdw.battles.size, 0);
});

test('reinicio: PvP con apuesta se restaura, se paga una sola vez y el depósito sobrevive', async () => {
  const ids = [25, 6, 9];
  const a = withMons(ids), b = withMons(ids);
  const t = (u) => members(u, ids);
  const c0 = [a.coins, b.coins];
  const c = sdw.challenge(a, { format: 'singles', level: 'fair', wager: 400, team: t(a) });
  const acc = sdw.accept(b, { id: c.challenge, team: t(b) });
  const bat = sdw.battles.get(acc.battle.id);
  await waitFor(() => asking(bat.sides[0]) && asking(bat.sides[1]));
  sdw.choose(a, { id: bat.id, choice: 'team 123' });
  sdw.choose(b, { id: bat.id, choice: 'team 123' });
  await waitFor(() => asking(bat.sides[0]) && asking(bat.sides[1]) && bat.sides[0].req.active);
  sdw.choose(a, { id: bat.id, choice: 'move 1' }); // b aún no ha elegido
  await wait(60);
  const turn = bat.turn;
  const keyB = reqKey(bat.sides[1].req);
  const coinsMid = [a.coins, b.coins];
  assert.strictEqual(await restart(), 1);
  assert.deepStrictEqual([a.coins, b.coins], coinsMid, 'el arranque no devuelve el depósito');
  assert.strictEqual(Object.values(db.data.escrow).filter((e) => [a.id, b.id].includes(e.userId)).length, 2);
  const b2 = sdw.battles.get(bat.id);
  assert.strictEqual(b2.turn, turn);
  assert.strictEqual(b2.sides[0].chosen, true, 'la elección de a se conserva');
  assert.strictEqual(b2.sides[1].chosen, false);
  assert.strictEqual(reqKey(b2.sides[1].req), keyB);
  const res = await autoplay(b2, [0, 1], [a, b]);
  assert.ok(!res.aborted && (res.winner === 0 || res.winner === 1));
  await wait(50);
  const lvl = (u) => (u.hist.log || []).filter((e) => e.r === 'level').reduce((s, e) => s + e.d, 0);
  assert.strictEqual(a.coins + b.coins - lvl(a) - lvl(b), c0[0] + c0[1] - 800 + 760, 'bote pagado exactamente una vez (menos 5 %)');
  assert.strictEqual(Object.values(db.data.escrow).filter((e) => [a.id, b.id].includes(e.userId)).length, 0);
  assert.ok(!db.data.sdBattles[bat.id]);
  assert.strictEqual(await restart(), 0, 'nada que restaurar después');
});

test('reinicio: un registro dañado o de otra versión del simulador devuelve las apuestas', async () => {
  const ids = [25, 6, 9];
  for (const breakIt of [(s) => { s.seed = 'x'; }, (s) => { s.v = '0.0.1'; }, (s) => { s.sides[1].userId = 'nadie'; }]) {
    const a = withMons(ids), b = withMons(ids);
    const c0 = [a.coins, b.coins];
    const c = sdw.challenge(a, { format: 'singles', level: 'fair', wager: 300, team: members(a, ids) });
    const bat = sdw.battles.get(sdw.accept(b, { id: c.challenge, team: members(b, ids) }).battle.id);
    await wait(100);
    sdw.refundAll(); sdw._dropMemory();
    db.data.sdBattles = JSON.parse(JSON.stringify(db.data.sdBattles));
    breakIt(db.data.sdBattles[bat.id]);
    await sdw.restoreAll();
    assert.ok(!db.data.sdBattles[bat.id]);
    assert.strictEqual(sdw.battles.size, 0);
    const back = (u) => (u.coins - ((u.hist.log || []).filter((e) => e.r === 'level').reduce((s, e) => s + e.d, 0)));
    assert.strictEqual(back(a), c0[0]);
    assert.strictEqual(Object.values(db.data.escrow).filter((e) => [a.id, b.id].includes(e.userId)).length, 0);
    assert.strictEqual(back(b), c0[1], 'b recupera lo suyo');
  }
});

test('abandono: 15 minutos sin elegir pierden el combate (PvP: el rival cobra)', async () => {
  const ids = [25, 6, 9];
  const a = withMons(ids), b = withMons(ids);
  const c = sdw.challenge(a, { format: 'singles', level: 'fair', wager: 200, team: members(a, ids) });
  const bat = sdw.battles.get(sdw.accept(b, { id: c.challenge, team: members(b, ids) }).battle.id);
  await wait(200);
  assert.strictEqual(bat.expire(), false);
  sdw.choose(b, { id: bat.id, choice: 'team 123' });
  bat.sides[0].askedAt = Date.now() - sdw.ABANDON_MS - 1000;
  assert.strictEqual(bat.expire(), true);
  const res = await bat.done;
  assert.strictEqual(res.winner, 1);
  assert.ok(!db.data.sdBattles[bat.id]);
  assert.strictEqual(sdw.battles.size, 0);
});
