'use strict';
// Medallas al vencer a los Líderes de Gimnasio, Alto Mando (carrera sin curar) y dinero de los combates (premio real, Moneda Amuleto, Día de Pago, Recogida).
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-gyms-'));
process.env.SD_MAX_BATTLES = '4';

const db = require('../server/db');
const hub = require('../server/hub');
const specimen = require('../server/specimen');
const sdw = require('../server/showdown');
const trainers = require('../server/trainers');
const progress = require('../server/progress');
const elite = require('../server/elite');
const bm = require('../server/battlemoney');
const { Brain } = require('../server/sdai');
const { BY_ID } = require('../server/pokedex');

let n = 0;
function user(extra = {}) {
  const name = 'gy' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 1000, dust: 0, buddy: null, items: {}, buffs: {}, games: {}, collection: {}, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, createdAt: Date.now() - 9 * 864e5, ...extra };
  db.addUser(u);
  return u;
}
const STRONG = [150, 149, 248, 373, 445, 474]; // Mewtwo, Dragonite, Tyranitar, Salamence, Garchomp, Porygon-Z
function strong(ids = STRONG, level = 100) {
  const u = user({ collection: Object.fromEntries(ids.map((id) => [id, { n: 1, s: 0 }])) });
  specimen.syncAll(u);
  for (const id of ids) { const m = u.mons[id][0]; m.level = level; m.exp = 0; require('../server/exp').ensure(id, m); }
  return u;
}
const team = (u, ids = STRONG) => ids.filter((id) => u.mons[id]).map((id) => ({ id, uid: u.mons[id][0].uid }));
const withBadges = (u, k) => { u.progress.badges = trainers.BADGE_IDS.slice(0, k); return u; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Juega por el jugador con la IA hasta que acaba el combate (devuelve el resultado).
async function autoplay(b, u) {
  const br = new Brain('p1');
  br.feed(b.sides[0].log);
  let seen = b.sides[0].log.length;
  const t0 = Date.now();
  while (!b.finished && Date.now() - t0 < 60000) {
    const side = b.sides[0];
    if (side.log.length > seen) { br.feed(side.log.slice(seen)); seen = side.log.length; }
    if (side.req && !side.req.wait && !side.chosen && !b.over) {
      try { sdw.choose(u, { id: b.id, choice: br.decide(side.req) || 'default' }); } catch { /* ya elegido */ }
    }
    await wait(10);
  }
  return b.done;
}
const endOf = (u) => new Promise((resolve) => { const orig = hub.emitUser; hub.emitUser = (id, ev, p) => { if (id === u.id && ev === 'battle:end') { hub.emitUser = orig; resolve(p); } return orig(id, ev, p); }; });
async function play(u, start) {
  const ended = endOf(u);
  const v = start();
  const b = sdw.battles.get((v.battle || v).id);
  await autoplay(b, u);
  return { end: await ended, b };
}

// ---------- Orden de los gimnasios ----------
test('los líderes tienen los equipos de nivel fijo de los juegos (Nv. 14 … 50) y su especialidad', () => {
  const lv = trainers.GYMS.map((t) => trainers.highest(t));
  assert.deepStrictEqual(lv, [14, 21, 24, 29, 43, 43, 47, 50]);
  assert.deepStrictEqual(trainers.GYMS.map((t) => t.name), ['Brock', 'Misty', 'Teniente Surge', 'Erika', 'Koga', 'Sabrina', 'Blaine', 'Giovanni']);
  assert.deepStrictEqual(trainers.GYMS.map((t) => t.badge), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const t of trainers.GYMS) assert.ok(t.team.length >= 2 && t.team.every(([id, l]) => BY_ID.has(id) && l >= 5), t.id);
  // Cada equipo tiene Pokémon de su tipo (excepto trampas conocidas: Misty lleva Staryu/Starmie, Surge un Voltorb…).
  const types = (id) => BY_ID.get(id).types;
  assert.ok(trainers.BY_TRAINER.get('brock').team.every(([id]) => types(id).some((x) => ['rock', 'ground'].includes(x))));
  assert.ok(trainers.BY_TRAINER.get('misty').team.every(([id]) => types(id).includes('water')));
  assert.ok(trainers.BY_TRAINER.get('koga').team.every(([id]) => types(id).includes('poison')));
});

test('orden de gimnasios: cada líder se abre con la medalla anterior (y las medallas ya ganadas no se pierden)', () => {
  const t = (id) => trainers.BY_TRAINER.get(id);
  const fresh = user();
  assert.ok(trainers.unlocked(t('brock'), fresh));
  for (const id of ['misty', 'surge', 'erika', 'koga', 'sabrina', 'blaine', 'giovanni', 'lance']) assert.ok(!trainers.unlocked(t(id), fresh), id);
  assert.match(trainers.lockText(t('misty')), /Brock/);
  const two = withBadges(user(), 2);
  assert.ok(trainers.unlocked(t('surge'), two) && !trainers.unlocked(t('erika'), two));
  // Cuentas antiguas con medallas salteadas (Trueno sin Cascada): pueden retar a los anteriores a su medalla más alta.
  const old = user();
  old.progress.badges = ['roca', 'trueno'];
  assert.ok(trainers.unlocked(t('misty'), old), 'Misty (le falta su medalla)');
  assert.ok(trainers.unlocked(t('surge'), old), 'Surge (revancha)');
  assert.ok(trainers.unlocked(t('erika'), old), 'Erika (tiene Trueno)');
  assert.ok(!trainers.unlocked(t('koga'), old));
  assert.ok(trainers.unlocked(t('lance'), withBadges(user(), 8)));
  const view = trainers.listFor(withBadges(user(), 1));
  assert.ok(view.find((x) => x.id === 'misty').locked === false && view.find((x) => x.id === 'surge').locked === true);
  assert.deepStrictEqual(view.find((x) => x.id === 'brock').badge, { n: 1, id: 'roca', got: true });
  assert.ok(!view.some((x) => ['lorelei', 'bruno', 'agatha', 'azul'].includes(x.id)), 'el resto del Alto Mando solo en su carrera');
  assert.throws(() => sdw.startCpu(withBadges(strong(), 1), { trainer: 'lorelei', format: 'singles', level: 'real', team: [] }), /Alto Mando/);
  assert.throws(() => sdw.startCpu(strong(), { trainer: 'misty', format: 'singles', level: 'real', team: [] }), /Brock/);
});

test('los líderes combaten con equipo entero: Individual, niveles reales, IA lista y objetos desde el 4.º', () => {
  for (const t of trainers.GYMS) {
    const { sets, roster } = trainers.buildTeam(t, 6, { level: 'fair', avgLevel: 5 });
    assert.strictEqual(sets.length, t.team.length, t.id);
    assert.deepStrictEqual(roster.map((r) => r.level), t.team.map((x) => x[1]), 'nivel fijo sea cual sea el del jugador: ' + t.id);
    if (t.badge >= 4) assert.ok(sets.every((s) => s.item), `${t.id} lleva objeto`);
    else assert.ok(sets.every((s) => !s.item), `${t.id} sin objeto`);
  }
  assert.strictEqual(trainers.buildTeam(trainers.BY_TRAINER.get('brock'), 6, { bonus: 5 }).roster[1].level, 19, 'las revanchas suben niveles');
  assert.ok(new Brain('p2', { smart: true }).smart);
});

// ---------- Vencer a un líder ----------
test('vencer a Brock: medalla una sola vez con sus premios; la revancha da EXP/PB pero ninguna medalla más', async () => {
  const u = strong();
  const c0 = u.coins;
  const first = await play(u, () => sdw.startCpu(u, { trainer: 'brock', format: 'doubles', level: 'fair', team: team(u) }));
  assert.ok(first.b.full && first.b.format === 'singles' && first.b.level === 'real', 'se fuerza Individual y niveles reales');
  assert.strictEqual(first.end.winner, 'you');
  assert.ok(first.end.badge.first && first.end.badge.id === 'roca' && first.end.badge.n === 1);
  assert.deepStrictEqual(u.progress.badges, ['roca']);
  assert.ok(u.progress.titles.includes('badge-roca'));
  assert.strictEqual(hub.maxBetFor(u), hub.MAX_BET_BY_BADGES[1]);
  assert.strictEqual(u.items.ticket, 2);
  assert.strictEqual(first.end.reward.prize.pay, 100, 'Líder de Gimnasio ×100');
  assert.strictEqual(first.end.reward.prize.level, 14);
  assert.strictEqual(u.coins, c0 + progress.BADGE_COINS + first.end.reward.coins, '500 de la medalla + el premio del combate');
  assert.strictEqual(first.end.reward.coins, Math.min(1400, trainers.COINS_DAY), 'premio ×100 × Nv. 14, con el tope diario');
  const c1 = u.coins;
  const again = await play(u, () => sdw.startCpu(u, { trainer: 'brock', format: 'singles', level: 'real', team: team(u) }));
  assert.strictEqual(again.end.winner, 'you');
  assert.strictEqual(again.end.badge.first, false, 'ya la tenía');
  assert.ok(again.end.reward.exp.length > 0 && again.end.reward.bp > 0 || again.end.reward.capped === false, 'sigue dando EXP y PB');
  assert.deepStrictEqual(u.progress.badges, ['roca']);
  assert.strictEqual(u.items.ticket, 2, 'ningún premio de medalla repetido');
  assert.ok(u.coins - c1 <= trainers.COINS_DAY, 'solo el premio del combate (con su tope)');
  // Con la medalla 1 se abre Misty: ganar da la 2 (Cascada) y paga 1.000.
  const misty = await play(u, () => sdw.startCpu(u, { trainer: 'misty', format: 'singles', level: 'real', team: team(u) }));
  assert.ok(misty.end.badge.first && misty.end.badge.id === 'cascada');
  assert.deepStrictEqual(u.progress.badges, ['roca', 'cascada']);
}, { timeout: 120000 });

test('perder contra un líder no da medalla ni cuesta nada', async () => {
  const u = strong([25], 5); // un Pikachu Nv. 5 contra Brock
  const c0 = u.coins;
  const r = await play(u, () => sdw.startCpu(u, { trainer: 'brock', format: 'singles', level: 'real', team: team(u, [25]) }));
  assert.strictEqual(r.end.winner, 'foe');
  assert.deepStrictEqual(u.progress.badges, []);
  assert.strictEqual(u.coins, c0);
}, { timeout: 120000 });

test('las medallas existentes se conservan con todo lo ganado (el combate contra ese líder es una revancha)', async () => {
  const u = strong();
  u.progress.badges = ['roca', 'trueno']; // antiguas: Trueno sin Cascada
  u.progress.titles.push('badge-roca', 'badge-trueno');
  const before = { coins: u.coins, items: { ...u.items }, bet: hub.maxBetFor(u) };
  assert.strictEqual(before.bet, hub.MAX_BET_BY_BADGES[2]);
  const r = await play(u, () => sdw.startCpu(u, { trainer: 'surge', format: 'singles', level: 'real', team: team(u) }));
  assert.strictEqual(r.end.badge.first, false);
  assert.deepStrictEqual(u.progress.badges, ['roca', 'trueno']);
  assert.strictEqual(u.items.ticket, before.items.ticket);
  assert.strictEqual(u.items['mystery-egg'], before.items['mystery-egg'], 'sin premios de medalla repetidos');
  assert.strictEqual(hub.maxBetFor(u), before.bet);
  const m = await play(u, () => sdw.startCpu(u, { trainer: 'misty', format: 'singles', level: 'real', team: team(u) }));
  assert.ok(m.end.badge.first, 'la que le faltaba sí');
  assert.deepStrictEqual(u.progress.badges, ['roca', 'trueno', 'cascada']);
}, { timeout: 120000 });

// ---------- Alto Mando ----------
test('Alto Mando: necesita las 8 medallas y solo una carrera a la vez', () => {
  const u = strong();
  assert.throws(() => elite.start(u, { team: team(u) }), /8 medallas/);
  assert.strictEqual(elite.view(u).unlocked, false);
  const v = elite.view(withBadges(u, 8));
  assert.deepStrictEqual(v.members.map((m) => m.name), ['Lorelei', 'Bruno', 'Agatha', 'Lance', 'Azul']);
  assert.deepStrictEqual(v.members.map((m) => m.n), [5, 5, 5, 5, 6]);
  assert.throws(() => elite.next(u), /ninguna carrera/);
});

test('Alto Mando: los PS, PP y estados pasan de un combate al siguiente, los debilitados quedan fuera y el Campeón entra en el Salón de la Fama (una vez; revancha más fuerte)', async () => {
  const u = withBadges(strong(), 8);
  u.progress.titles.push('campeon'); // como quien ya era Campeón por las 8 medallas antiguas
  const coinsBefore = u.coins;
  const first = await play(u, () => elite.start(u, { team: team(u) }));
  assert.strictEqual(first.b.elite.stage, 0);
  assert.ok(first.end.elite && first.end.elite.foe === 'Lorelei');
  const run = u.elite.run;
  assert.ok(run && run.stage === 1, 'la carrera sigue');
  const hurt = Object.values(run.carry);
  assert.ok(hurt.length === STRONG.length && hurt.every((c) => c.max > 0 && c.hp <= c.max));
  // Lo que cuenta el simulador al terminar se guarda tal cual; para comprobarlo de forma determinista se «hiere» a mano: el primero con 40 % de PS,
  // quemado y con 1 PP en su primer movimiento, y el último debilitado.
  const m0 = run.members[0];
  const c0 = run.carry[m0.uid];
  c0.hp = Math.max(1, Math.floor(c0.max * 0.4)); c0.s = 'brn';
  const firstMove = Object.keys(c0.pp)[0];
  c0.pp[firstMove] = 1;
  run.carry[run.members[run.members.length - 1].uid].hp = 0;
  // El siguiente combate arranca con esos PS (la petición del simulador ya los trae) y sin los debilitados.
  const alive = run.members.filter((m) => run.carry[m.uid].hp > 0);
  assert.strictEqual(alive.length, run.members.length - 1);
  const ended2 = endOf(u);
  const v2 = elite.next(u);
  const b2 = sdw.battles.get(v2.battle.id);
  await wait(200);
  assert.strictEqual(b2.elite.stage, 1);
  assert.strictEqual(b2.sides[0].sets.length, alive.length, 'solo los que siguen en pie');
  const req = b2.sides[0].req;
  assert.ok(req && req.teamPreview, 'vista previa');
  for (const p of req.side.pokemon) {
    const m = alive.find((x) => p.ident.endsWith(': ' + (BY_ID.get(x.id) || {}).name));
    const c = run.carry[m.uid];
    const [hp, max] = p.condition.split(' ')[0].split('/').map(Number);
    assert.ok(Math.abs(hp / max - c.hp / c.max) < 0.01, 'PS arrastrados (en proporción: los EV ganados pueden subir el máximo) ' + p.ident);
    assert.ok(hp >= 1 && hp <= max);
    if (m === m0) assert.ok(/ brn$/.test(p.condition), 'estado arrastrado: ' + p.condition);
  }
  // Los PP también: el primero en salir trae los que le quedaban.
  sdw.choose(u, { id: b2.id, choice: 'team 123456' });
  await wait(300);
  const act = b2.sides[0].req.active && b2.sides[0].req.active[0];
  assert.ok(act, 'primer turno');
  assert.strictEqual(act.moves.find((mv) => mv.id === firstMove).pp, 1, 'PP arrastrados');
  await autoplay(b2, u);
  const e2 = await ended2;
  assert.ok(e2.elite.foe === 'Bruno');
  // Seguimos hasta el final (si alguien pierde por mala suerte, se empieza otra carrera: lo que se comprueba es que la que se gana acaba en el Salón de la Fama).
  for (let attempt = 0; attempt < 4 && u.elite.clears === 0; attempt++) {
    if (!u.elite.run) { const ended = endOf(u); const first2 = sdw.battles.get(elite.start(u, { team: team(u) }).battle.id); await autoplay(first2, u); await ended; }
    for (let guard = 0; guard < 5 && u.elite.run; guard++) {
      const ended = endOf(u);
      const bn = sdw.battles.get(elite.next(u).battle.id);
      await autoplay(bn, u);
      await ended;
    }
  }
  assert.strictEqual(u.elite.run, null, 'la carrera terminó');
  assert.strictEqual(u.elite.clears, 1, 'Campeón: una entrada en el Salón de la Fama');
  assert.strictEqual(u.elite.hof.length, 1);
  assert.ok(u.elite.hof[0].team.length >= 1 && u.elite.hof[0].team.every((m) => m.id && m.level));
  assert.strictEqual(u.items['hi-amuletcoin'], 1, 'la primera vez, una Moneda Amuleto');
  assert.strictEqual(u.items['master-ball'] || 0, 0, 'el título ya lo tenía: no cobra dos veces');
  assert.ok(u.hist.income.battle <= trainers.COINS_DAY, 'los premios de combate respetan el tope diario');
  void coinsBefore;
  assert.strictEqual(elite.bonusFor(u), 3, 'revancha: +3 niveles');
  assert.strictEqual(elite.view(u).hof.length, 1);
}, { timeout: 300000 });

test('Alto Mando: perder acaba la carrera; un fallo del simulador la deja en el mismo combate; el Campeón nuevo cobra los premios del título', async () => {
  const u = withBadges(strong([25], 5), 8);
  const r = await play(u, () => elite.start(u, { team: team(u, [25]) }));
  assert.strictEqual(r.end.winner, 'foe');
  assert.ok(r.end.elite.ended);
  assert.strictEqual(u.elite.run, null);
  assert.throws(() => elite.next(u), /ninguna carrera/);
  // Un fallo del simulador (aborted) no avanza ni acaba la carrera.
  const w = withBadges(strong(), 8);
  const v = elite.start(w, { team: team(w) });
  const b = sdw.battles.get(v.battle.id);
  b.crash(new Error('prueba'));
  assert.ok(w.elite.run && w.elite.run.stage === 0, 'sigue en Lorelei');
  assert.throws(() => elite.start(w, { team: team(w) }), /en curso/);
  elite.abandon(w);
  assert.strictEqual(w.elite.run, null);
  // Premios del título la primera vez (sin título previo).
  const c = withBadges(strong(), 8);
  c.elite = { clears: 0, hof: [], amulet: false, run: { stage: 4, members: team(c), carry: {} } };
  const fake = { elite: { stage: 4 }, carryOut: {} };
  const out = elite.onEnd(c, fake, true);
  assert.ok(out.cleared && out.champion && out.amulet);
  assert.ok(c.progress.titles.includes('campeon') && c.items['master-ball'] === 1 && c.items['hi-amuletcoin'] === 1);
  assert.strictEqual(c.coins, 1000 + progress.CHAMPION_COINS);
}, { timeout: 120000 });

// ---------- Dinero de los combates ----------
test('premio en metálico: clase × nivel más alto del equipo rival', () => {
  assert.deepStrictEqual(bm.prizeMoney({ pay: 16 }, [12, 20, 18]), { pay: 16, level: 20, coins: 320 });
  assert.strictEqual(bm.prizeMoney(trainers.BY_TRAINER.get('giovanni'), [45, 42, 44, 45, 50]).coins, 5000);
  assert.strictEqual(trainers.BY_TRAINER.get('hugo').pay, 16, 'Pescador ×16');
  for (const t of trainers.TRAINERS) assert.ok(t.pay >= 16 && t.pay <= 150, t.id);
  assert.strictEqual(trainers.BY_TRAINER.get('brock').pay, 100);
});

// Combate ficticio (como en exp.test.js): el rival levels y la lista del jugador; `log`: lo que cuenta el simulador al jugador.
function fakeBattle(u, ids, { trainer = 'ramon', foeLevel = 20, log = [] } = {}) {
  const roster = ids.map((id) => ({ id, uid: u.mons[id][0].uid, level: 50, name: BY_ID.get(id).name }));
  const foes = [{ id: 74, level: foeLevel }, { id: 95, level: foeLevel - 2 }];
  const side = { roster, seen: new Set(roster.map((r) => r.name)), log };
  return { b: { trainer: trainers.BY_TRAINER.get(trainer), sides: [side, { roster: foes }] }, side };
}
function mons(ids) {
  const u = user({ collection: Object.fromEntries(ids.map((id) => [id, { n: 1, s: 0 }])) });
  specimen.syncAll(u);
  return u;
}
const resetDay = (u) => { u.btDay = { day: hub.dayKey(), wins: 0, coins: 0, pick: 0 }; };

test('premio de combate: la fórmula real, con el tope diario de siempre (800) y sin crear monedas de más', () => {
  const u = mons([25, 6]);
  const { b, side } = fakeBattle(u, [25, 6], { foeLevel: 20 }); // Montañero ×24 × Nv. 20 = 480
  const c0 = u.coins;
  const r1 = sdw.cpuReward(b, u, side);
  assert.strictEqual(r1.prize.base, 480);
  assert.strictEqual(r1.coins, 480);
  assert.strictEqual(u.coins, c0 + 480);
  const r2 = sdw.cpuReward(b, u, side);
  assert.strictEqual(r2.coins, 320, 'solo caben 320 más hoy');
  assert.ok(r2.prize.capped);
  assert.strictEqual(sdw.cpuReward(b, u, side).coins, 0);
  assert.strictEqual(u.coins, c0 + trainers.COINS_DAY);
  // Mañana otra vez; y tras 10 victorias premiadas no hay más premios.
  resetDay(u);
  let total = 0;
  for (let i = 0; i < trainers.WINS_PER_DAY + 3; i++) total += sdw.cpuReward(b, u, side).coins;
  assert.strictEqual(total, trainers.COINS_DAY);
  assert.strictEqual(u.btDay.wins, trainers.WINS_PER_DAY);
  assert.ok(sdw.cpuReward(b, u, side).capped);
  // Lo ingresado por combates en el día = el tope, nunca más (el registro de ingresos lo confirma).
  assert.ok((u.hist.income.battle || 0) <= 2 * trainers.COINS_DAY);
});

test('Moneda Amuleto: duplica el premio si algún participante la lleva, pero el tope diario no cambia', () => {
  const u = mons([25, 6]);
  const { b, side } = fakeBattle(u, [25, 6], { foeLevel: 10 }); // 240
  u.mons[6][0].item = 'amuletcoin'; // basta con que la lleve uno
  const r = sdw.cpuReward(b, u, side);
  assert.strictEqual(r.prize.base, 240);
  assert.ok(r.prize.amulet);
  assert.strictEqual(r.coins, 480);
  const r2 = sdw.cpuReward(b, u, side);
  assert.strictEqual(r2.coins, 480 - 160, 'el doble, pero solo caben 320 más (tope de 800)');
  assert.strictEqual(sdw.cpuReward(b, u, side).coins, 0);
  assert.strictEqual(u.btDay.coins, trainers.COINS_DAY);
  // Si quien la lleva no participó, no cuenta.
  const w = mons([25, 6]);
  const f = fakeBattle(w, [25, 6], { foeLevel: 10 });
  f.side.seen = new Set(['Pikachu']);
  f.side.roster = f.side.roster.filter((r2x) => r2x.id === 25);
  w.mons[6][0].item = 'amuletcoin';
  assert.strictEqual(sdw.cpuReward(f.b, w, f.side).coins, 240);
});

test('la Moneda Amuleto es un objeto equipable real: Tienda de Combate, sin efecto en el simulador', () => {
  const items = require('../server/items');
  const it = items.ITEMS['hi-amuletcoin'];
  assert.ok(it && it.held === 'amuletcoin' && it.bp === 40 && it.price === null);
  assert.strictEqual(it.name, 'Moneda Amuleto');
  assert.strictEqual(items.ITEMS['amulet-coin'].name, 'Moneda de la Suerte', 'el consumable antiguo conserva su efecto con otro nombre');
  assert.ok(require('../server/bp').holdable('amuletcoin'));
  const u = mons([52]);
  u.mons[52][0].item = 'amuletcoin';
  const { set } = require('../server/sdmap').toSet(52, u.mons[52][0], { level: 'real' });
  assert.strictEqual(set.item, '', 'el simulador no la conoce: no se le pasa');
});

test('Día de Pago: 5 × el nivel por cada uso que acierta, contado del registro del combate (y doblado con Moneda Amuleto, dentro del tope)', () => {
  const roster = [{ name: 'Meowth', level: 30 }, { name: 'Persian', level: 40 }];
  const log = [
    '|turn|1', '|move|p1a: Meowth|Pay Day|p2a: Geodude', '|-damage|p2a: Geodude|90/100',
    '|move|p2a: Geodude|Tackle|p1a: Meowth',
    '|turn|2', '|move|p1a: Meowth|Pay Day|p2a: Geodude', '|-miss|p1a: Meowth|p2a: Geodude',
    '|turn|3', '|move|p1a: Meowth|Pay Day|p2a: Geodude|[miss]',
    '|turn|4', '|move|p1a: Meowth|Pay Day|p2a: Gastly', '|-immune|p2a: Gastly',
    '|switch|p1a: Persian|Persian, L40|100/100',
    '|move|p1a: Persian|Pay Day|p2a: Geodude', '|-damage|p2a: Geodude|60/100',
    '|move|p2a: Geodude|Pay Day|p1a: Persian', '|-damage|p1a: Persian|90/100', // del rival: no cuenta
    '|move|p1a: Persian|Tackle|p2a: Geodude',
    '|win|x',
  ];
  const pd = bm.payDay(log, roster);
  assert.strictEqual(pd.uses, 2);
  assert.strictEqual(pd.coins, 5 * 30 + 5 * 40);
  assert.deepStrictEqual(pd.by, { Meowth: 1, Persian: 1 });
  assert.deepStrictEqual(bm.payDay([], roster), { uses: 0, coins: 0, by: {} });
  // En un combate: se suma al premio y cuenta para el mismo tope; con Amuleto, el doble.
  const u = mons([52, 53]);
  const f = fakeBattle(u, [52, 53], { foeLevel: 5, log: [log[1], '|-damage|p2a: Geodude|90/100', '|move|p1a: Pikachu|Tackle|p2a: Geodude'] });
  f.side.roster[0].name = 'Meowth'; f.side.roster[0].level = 50;
  f.side.log = ['|move|p1a: Meowth|Pay Day|p2a: Geodude', '|-damage|p2a: Geodude|90/100', '|move|p1a: Meowth|Pay Day|p2a: Geodude', '|-damage|p2a: Geodude|80/100'];
  const r = sdw.cpuReward(f.b, u, f.side); // Montañero ×24 × Nv. 5 = 120 + 2 × 250
  assert.strictEqual(r.prize.paydayUses, 2);
  assert.strictEqual(r.prize.payday, 500);
  assert.strictEqual(r.coins, 620);
  resetDay(u);
  u.mons[53][0].item = 'amuletcoin';
  const r2 = sdw.cpuReward(f.b, u, f.side);
  assert.strictEqual(r2.coins, (120 + 500) * 2 > trainers.COINS_DAY ? trainers.COINS_DAY : (120 + 500) * 2, 'doblado y con tope');
  assert.strictEqual(r2.prize.gross, 1240);
  assert.ok(r2.prize.capped && r2.coins === 800);
});

test('Día de Pago existe en el simulador y lo aprende Meowth (se ve en el registro del combate)', async () => {
  const sd = require('../server/sdmap');
  assert.ok(sd.moveInfo('payday'), 'el movimiento está');
  assert.ok(require('../server/moves').reachable(52, 20).some((x) => x.move === 'payday'), 'Meowth lo aprende por nivel');
  const u = mons([52]);
  const m = u.mons[52][0];
  m.level = 50; m.sdMoves = ['payday', 'scratch', 'bite', 'fakeout'];
  sd.ensureSd(52, m);
  m.sdMoves = ['payday', 'scratch', 'bite', 'fakeout'];
  const v = sdw.startCpu(u, { trainer: 'hugo', format: 'singles', level: 'real', team: team(u, [52]) });
  const b = sdw.battles.get(v.battle.id);
  const br = new Brain('p1');
  const t0 = Date.now();
  while (!b.finished && Date.now() - t0 < 20000) {
    const side = b.sides[0];
    if (side.req && !side.req.wait && !side.chosen && !b.over) {
      const choice = side.req.teamPreview ? 'team 1' : side.req.active ? 'move 1' : 'default';
      try { sdw.choose(u, { id: b.id, choice }); } catch { /* ya elegido */ }
    }
    await wait(10);
    if (side.log.some((l) => l.includes('|Pay Day|')) && !b.over) { b.forfeit(b.sides[1]); }
  }
  await b.done;
  void br;
  const log = b.sides[0].log;
  assert.ok(log.some((l) => /^\|move\|p1a: [^|]*\|Pay Day\|/.test(l)), 'aparece en el registro');
  assert.ok(bm.payDay(log, b.sides[0].roster).uses >= 1);
});

test('Recogida: 10 % por Pokémon con la habilidad tras cada victoria, tope de 5 hallazgos al día y objetos reales', () => {
  const items = require('../server/items');
  for (const [max, list] of bm.TABLE) {
    assert.ok(max >= 24 && list.length >= 6);
    for (const [kind, id] of list) {
      if (kind === 'berry') assert.ok(items.BERRIES[id], id);
      else if (kind !== 'stone') assert.ok(items.ITEMS[id], id);
    }
  }
  assert.strictEqual(bm.PICKUP_CHANCE, 0.1);
  assert.strictEqual(bm.PICKUP_DAY, 5);
  const u = user();
  const d = { pick: 0 };
  const six = Array.from({ length: 6 }, (_, i) => ({ name: 'Meowth' + i, level: 30 }));
  assert.deepStrictEqual(bm.rollPickup(u, six, d, () => 0.5), [], 'con tirada ≥ 10 % no hay nada');
  const found = bm.rollPickup(u, six, d, () => 0.05);
  assert.strictEqual(found.length, 5, 'tope diario de 5');
  assert.strictEqual(d.pick, 5);
  assert.deepStrictEqual(bm.rollPickup(u, six, d, () => 0.05), [], 'hoy ya no más');
  for (const f of found) {
    assert.ok(f.label && f.qty === 1);
    const have = f.kind === 'berry' ? (u.berries || {})[f.id] : u.items[f.id];
    assert.ok(have >= 1, f.id);
  }
  // Frecuencia ≈ 10 %.
  let hits = 0;
  for (let i = 0; i < 4000; i++) hits += bm.rollPickup(user(), [{ name: 'M', level: 10 }], { pick: 0 }).length;
  assert.ok(hits > 300 && hits < 500, `${hits} / 4000`);
});

test('Recogida en una victoria: solo los Pokémon con la habilidad, se muestra «¡X encontró …!» y respeta el tope diario', () => {
  const u = mons([52, 25]);
  u.mons[52][0].sdAbility = 'Pickup';
  u.mons[25][0].sdAbility = 'Static';
  const { b, side } = fakeBattle(u, [52, 25], { foeLevel: 10 });
  const orig = Math.random;
  let all = [];
  for (let i = 0; i < 200 && all.length < 5; i++) { resetDay(u); const r = sdw.cpuReward(b, u, side); all = all.concat(r.pickup); assert.ok(r.pickup.every((x) => x.name === 'Meowth'), 'solo Meowth'); }
  Math.random = orig;
  assert.ok(all.length >= 1, 'con 200 victorias alguna aparece');
  const d = { pick: 0 };
  assert.ok(bm.rollPickup(u, [{ name: 'Meowth', level: 5 }], d, () => 0).length === 1);
});

test('sin ajustes de combate nadie cobra más del tope: 10 victorias premiadas al día con todo activo', () => {
  const u = mons([52, 6]);
  u.mons[6][0].item = 'amuletcoin';
  const { b, side } = fakeBattle(u, [52, 6], { trainer: 'giovanni', foeLevel: 50, log: ['|move|p1a: Meowth|Pay Day|p2a: X', '|-damage|p2a: X|50/100'] });
  side.roster[0].name = 'Meowth';
  let total = 0;
  for (let i = 0; i < 30; i++) total += sdw.cpuReward(b, u, side).coins;
  assert.ok(total <= trainers.COINS_DAY, `${total}`);
  assert.strictEqual(total, trainers.COINS_DAY);
});

test('reinicio del servidor a mitad de la carrera: el combate se reconstruye con los mismos PS, PP y estados arrastrados', async () => {
  const u = withBadges(strong(), 8);
  const members = team(u);
  const carry = {};
  members.forEach((m, i) => { carry[m.uid] = { hp: 100 + i, max: 400, s: i === 0 ? 'par' : '', pp: { [(i === 0 ? 'x' : 'y')]: 1 } }; });
  u.elite = { clears: 0, hof: [], amulet: false, run: { stage: 2, members, carry } };
  const v = elite.next(u);
  const b = sdw.battles.get(v.battle.id);
  await wait(200);
  const snapOf = (bt) => JSON.stringify(bt.sides[0].req.side.pokemon.map((p) => [p.ident, p.condition]));
  const before = snapOf(b);
  assert.ok(/par/.test(before));
  sdw.refundAll();
  sdw._dropMemory();
  db.data.sdBattles = JSON.parse(JSON.stringify(db.data.sdBattles || {}));
  assert.strictEqual(db.data.sdBattles[b.id].el.stage, 2);
  assert.ok(db.data.sdBattles[b.id].el.carry.some(Boolean));
  await sdw.restoreAll();
  const b2 = sdw.battles.get(v.battle.id);
  assert.ok(b2 && b2.elite.stage === 2 && b2.full);
  await wait(200);
  assert.strictEqual(snapOf(b2), before, 'mismos PS y estado tras el reinicio');
  b2.forfeit(b2.sides[0]);
  await b2.done;
});

test('Alto Mando: si un miembro evoluciona entre combates, la carrera lo sigue por su uid', () => {
  const candy = require('../server/candy');
  const exp = require('../server/exp');
  const u = withBadges(strong([4, 6], 100), 8);
  const m = u.mons[4][0];
  m.level = 20; m.exp = exp.expAt(4, 20);
  const E = elite.stateOf(u);
  E.run = { stage: 1, members: [{ id: 4, uid: m.uid }], carry: { [m.uid]: { hp: 50, max: 60, s: '', pp: {} } }, at: Date.now() };
  assert.strictEqual(candy.evolve(u, { id: 4, uid: m.uid, to: 5 }).name, 'Charmeleon');
  assert.doesNotThrow(() => elite.view(u));
  assert.strictEqual(E.run.members[0].id, 5, 'la vista actualiza la especie del miembro');
  E.run.members[0].id = 4; // como si no se hubiera mirado
  const b = elite.next(u).battle; // empieza el siguiente combate sin romper la carrera
  assert.ok(b && E.run && E.run.members[0].id === 5);
  sdw.byUser.get(u.id) && sdw.byUser.get(u.id).forfeit(sdw.byUser.get(u.id).sides[0]);
});
