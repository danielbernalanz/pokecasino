'use strict';
// Torre Batalla: carrera de combates contra la CPU con equipos de ALQUILER (conjuntos de los combates aleatorios de Showdown,
// nivel 50): no hace falta tener buenos Pokémon. Antes de cada carrera se eligen 3 de 6 (Individual) o 4 de 6 (Dobles); tras cada
// victoria se puede cambiar uno de los tuyos por uno del rival derrotado. 7 combates = una «ronda»; el combate 21 (y cada 21)
// es contra un Jefe de la Torre. Recompensas: solo PB (1 → 3 por victoria según la ronda y +10 al cerrar cada ronda, con un
// tope diario propio de 40 PB) y títulos a las rachas de 21 / 50 / 100. NUNCA monedas.
// El estado de la carrera vive en `u.tower.run` (sobrevive a los reinicios); el combate en curso es un combate normal de la CPU
// con la marca `tower` (se guarda y se reconstruye como los demás, ver showdown.js).
const crypto = require('crypto');
const db = require('./db');
const hub = require('./hub');
const sd = require('./sdmap');
const { BY_ID } = require('./pokedex');
const { shuffle, pick, randInt } = require('./rng');

const FORMATS = ['singles', 'doubles'];
const PICK = { singles: 3, doubles: 4 }; // Pokémon que lleva el jugador
const OFFER = 6; // rentals ofrecidos
const ROUND = 7;
const BOSS_EVERY = 21;
const DAY_CAP = 40; // PB al día que puede dar la Torre (bpdata.CAPS.tower)
const ROUND_BONUS = 10;
const MEDALS = [[21, 'torre-21'], [50, 'torre-50'], [100, 'torre-100']];
const LEVEL = 50;

const bpForWin = (n) => (n <= ROUND ? 1 : n <= 2 * ROUND ? 2 : 3);
const isBoss = (n) => n % BOSS_EVERY === 0;
const roundOf = (n) => Math.floor((n - 1) / ROUND) + 1;

const BOSSES = [
  { id: 'magno', name: 'Magno', cls: 'Jefe de la Torre', quote: 'Soy Magno, el Jefe de la Torre Batalla. ¡Hasta aquí ha llegado tu racha!' },
  { id: 'valeria', name: 'Valeria', cls: 'Jefa de la Torre', quote: 'Pocos llegan al piso 42. Pocos se van sin perder.' },
  { id: 'tomas', name: 'Tomás', cls: 'Jefe de la Torre', quote: 'La Torre no se acaba nunca. ¿Y tu aguante?' },
  { id: 'elena', name: 'Elena', cls: 'Jefa de la Torre', quote: 'Cada piso es más difícil que el anterior. Y yo soy el último.' },
];
const FOE_CLS = ['Cadete', 'Veterano', 'Estudiante', 'Excursionista', 'Nadador', 'Karateka', 'Ingeniero', 'Médium', 'Pescador', 'Domador', 'Corredor', 'Explorador'];
const FOE_NAMES = ['Raúl', 'Irene', 'Dani', 'Nuria', 'Álex', 'Sofía', 'Mateo', 'Carla', 'Hugo', 'Lola', 'Pau', 'Marina', 'Iker', 'Julia', 'Saúl', 'Blanca'];

// ---- Rentals ----
// Pool de especies con conjunto de combates aleatorios (los que no son formas) y rango de fuerza (suma de base).
let POOL = null;
const randbats = (file) => { try { return require('pokemon-showdown/dist/data/random-battles/gen9/' + file); } catch { return {}; } };
const SRC = {};
function pool() {
  if (POOL) return POOL;
  SRC.singles = randbats('sets.json');
  SRC.doubles = randbats('doubles-sets.json');
  POOL = [];
  const ids = new Set([...Object.keys(SRC.singles), ...Object.keys(SRC.doubles)]);
  for (const key of ids) {
    let sp;
    try { const s = sd.ps().Dex.species.get(key); if (!s.exists || !s.num || !sd.canBattle(s.num)) continue; sp = sd.speciesOf(s.num); } catch { continue; }
    if (sp.id !== key || !BY_ID.has(sp.num)) continue; // solo especies base (nada de formas) que existan en nuestra Pokédex
    const tags = sp.tags || [];
    if (sp.eventOnly || sp.isNonstandard) continue;
    const bst = Object.values(sp.baseStats).reduce((a, b) => a + b, 0);
    POOL.push({ key, num: sp.num, sp, bst, legend: tags.includes('Restricted Legendary') || tags.includes('Mythical') || tags.includes('Sub-Legendary') });
  }
  return POOL;
}

const OFF_ITEMS = ['lifeorb', 'focussash', 'expertbelt', 'leftovers', 'sitrusberry', 'lumberry', 'heavydutyboots', 'rockyhelmet', 'weaknesspolicy', 'choicescarf', 'choiceband', 'choicespecs'];
const CPU_OK = new Set(['lifeorb', 'focussash', 'expertbelt', 'leftovers', 'sitrusberry', 'lumberry', 'heavydutyboots', 'rockyhelmet', 'weaknesspolicy']); // la IA no maneja bien los objetos «Elección»
const BULKY = /bulky|support|tank|wall|setup sweeper|protect/i;

/** Conjunto de alquiler de una especie del pool: movimientos del conjunto de combates aleatorios, spread por rol. */
function buildMon(p, doubles, { cpu = false, usedItems = new Set() } = {}) {
  const src = (doubles ? SRC.doubles : SRC.singles)[p.key] || SRC.singles[p.key] || SRC.doubles[p.key];
  const entry = pick(src.sets);
  let poolMoves = (entry.movepool || []).map(sd.toID).filter((m) => sd.moveInfo(m));
  let moves = poolMoves.length <= 4 ? poolMoves.slice() : sd.pickFromPool(p.sp, poolMoves);
  if (moves.length < 4) for (const m of sd.defaultMoves(p.num, doubles)) if (moves.length < 4 && !moves.includes(m)) moves.push(m);
  const abilities = (entry.abilities || []).map(sd.toID);
  const own = Object.values(p.sp.abilities).map(sd.toID);
  const ability = abilities.find((a) => own.includes(a)) || own[0];
  const st = p.sp.baseStats;
  const phys = st.atk >= st.spa;
  const role = entry.role || '';
  const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  let nature;
  if (BULKY.test(role)) {
    evs.hp = 252; evs.def = 128; evs.spd = 128;
    nature = phys ? 'Impish' : 'Calm';
    if (st.atk < 60 && st.spa < 60) nature = 'Bold';
  } else {
    evs[phys ? 'atk' : 'spa'] = 252; evs.spe = 252; evs.hp = 4;
    nature = phys ? (st.spe >= 80 ? 'Jolly' : 'Adamant') : (st.spe >= 80 ? 'Timid' : 'Modest');
  }
  const pool = (cpu ? OFF_ITEMS.filter((i) => CPU_OK.has(i)) : OFF_ITEMS).filter((i) => !usedItems.has(i));
  const item = pool.length ? pick(pool) : '';
  usedItems.add(item);
  const gender = p.sp.gender ? (p.sp.gender === 'N' ? '' : p.sp.gender) : (Math.random() < 0.5 ? 'M' : 'F');
  const name = sd.speciesOf(p.num).name;
  const set = {
    name, species: p.sp.name, item, ability, moves, nature, gender, evs,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: LEVEL, shiny: false, happiness: 70, pokeball: 'pokeball',
  };
  return { set, roster: { name, id: p.num, shiny: false, level: LEVEL, gender: gender || null, mega: 0, uid: crypto.randomBytes(4).toString('hex') } };
}

let VAL = null;
// Legal en Showdown: movimientos aprendibles, habilidad real y nada que solo exista en eventos (se descarta y se prueba otra especie).
function legal(set) {
  VAL ||= sd.ps().TeamValidator.get('gen9customgame@@@Obtainable');
  return VAL.validateTeam([set]) === null;
}

/** `n` Pokémon de alquiler de especies distintas con suma de base entre lo y hi (y legales). */
function genTeam(n, lo, hi, doubles, { cpu = false } = {}) {
  let list = pool().filter((p) => p.bst >= lo && p.bst <= hi && !p.legend);
  if (list.length < n * 3) list = pool().filter((p) => !p.legend);
  const out = [];
  const seen = new Set();
  const used = new Set();
  for (const p of shuffle(list)) {
    if (out.length >= n) break;
    if (seen.has(p.sp.baseSpecies)) continue;
    const m = buildMon(p, doubles, { cpu, usedItems: used });
    if (!legal(m.set)) continue;
    seen.add(p.sp.baseSpecies);
    out.push(m);
  }
  return out;
}

function offerFor(format) { return genTeam(OFFER, 430, 600, format === 'doubles'); }

// Fuerza del rival según el número de combate: los jefes, lo más duro (sin legendarios restringidos).
function foeBand(n) {
  if (isBoss(n)) return [540, 680];
  if (n <= ROUND) return [300, 450];
  if (n <= 2 * ROUND) return [380, 520];
  if (n <= 3 * ROUND) return [440, 590];
  return [480, 640];
}
function foeFor(format, n) {
  const doubles = format === 'doubles';
  const size = PICK[format];
  const [lo, hi] = foeBand(n);
  const mons = genTeam(size, lo, hi, doubles, { cpu: true });
  const boss = isBoss(n);
  const who = boss ? BOSSES[(n / BOSS_EVERY - 1) % BOSSES.length] : { id: 'cpu', name: pick(FOE_NAMES), cls: pick(FOE_CLS), quote: '¡A por el siguiente piso!' };
  return { who, mons, boss };
}

// ---- Estado del jugador ----
function ensure(u) {
  const T = (u.tower ||= {});
  T.best ||= { singles: 0, doubles: 0 };
  T.runs = T.runs || 0;
  T.wins = T.wins || 0;
  T.medals ||= {};
  return T;
}
const strip = (m) => ({ id: m.roster.id, name: m.set.name, item: m.set.item, ability: m.set.ability, moves: m.set.moves, nature: m.set.nature, gender: m.roster.gender });
const clone = (x) => JSON.parse(JSON.stringify(x));

function battleAlive(u, run) {
  const sdw = require('./showdown');
  const b = sdw.byUser.get(u.id);
  if (b && b.id === run.battleId) return true;
  return !!(run.battleId && db.data.sdBattles && db.data.sdBattles[run.battleId]);
}
// Si el combate de la carrera ya no existe (se interrumpió), la carrera vuelve a «lista».
function heal(u) {
  const run = u.tower && u.tower.run;
  if (run && run.phase === 'battle' && !battleAlive(u, run)) { run.phase = 'ready'; run.battleId = null; db.save(); }
  return run || null;
}
function onAbort(userId, battleId) {
  const u = db.userById(userId);
  const run = u && u.tower && u.tower.run;
  if (run && run.phase === 'battle' && (!battleId || run.battleId === battleId)) { run.phase = 'ready'; run.battleId = null; db.save(); }
}

function dayBp(u) { return require('./bp').day(u).tower || 0; }

function endRun(u, why) {
  const T = ensure(u);
  const run = T.run;
  T.run = null;
  T.runs++;
  db.save();
  return run ? { streak: run.streak, format: run.format, why } : null;
}

function view(u) {
  const T = ensure(u);
  const run = heal(u);
  const out = {
    best: T.best, runs: T.runs, medals: T.medals, bpToday: dayBp(u), bpCap: DAY_CAP,
    rules: { pick: PICK, offer: OFFER, round: ROUND, boss: BOSS_EVERY, roundBonus: ROUND_BONUS, medals: MEDALS.map(([n]) => n) },
    run: null,
  };
  if (run) {
    const n = run.streak + 1;
    out.run = {
      id: run.id, format: run.format, streak: run.streak, phase: run.phase, battleId: run.battleId || null,
      offer: run.phase === 'pick' ? run.offer.map(strip) : null, team: run.team ? run.team.map(strip) : null,
      swap: run.phase === 'swap' && run.swap ? run.swap.map(strip) : null,
      next: { n, round: roundOf(n), inRound: ((n - 1) % ROUND) + 1, boss: isBoss(n), bp: bpForWin(n) + (n % ROUND === 0 ? ROUND_BONUS : 0) },
      foe: run.foe ? { name: run.foe.name, cls: run.foe.cls, boss: !!run.foe.boss } : null,
    };
  }
  return out;
}

// ---- Acciones ----
function start(u, { format }) {
  if (!FORMATS.includes(format)) throw new Error('Formato no válido.');
  if (u.npc) throw new Error('Los comerciantes NPC no usan la Torre Batalla.');
  const T = ensure(u);
  const run = heal(u);
  if (run) throw new Error('Ya tienes una carrera en la Torre: continúala o abandónala.');
  const sdw = require('./showdown');
  if (sdw.byUser.has(u.id)) throw new Error('Ya estás en un combate.');
  sdw.unqueueUser(u.id);
  T.run = { id: crypto.randomBytes(4).toString('hex'), format, streak: 0, phase: 'pick', offer: offerFor(format), team: null, swap: null, foe: null, foeMons: null, battleId: null, at: Date.now() };
  db.save();
  return { tower: view(u) };
}

function pickTeam(u, { picks }) {
  const run = heal(u);
  if (!run || run.phase !== 'pick') throw new Error('No hay ningún equipo que elegir.');
  const need = PICK[run.format];
  if (!Array.isArray(picks) || picks.length !== need || picks.some((i) => !Number.isInteger(i) || i < 0 || i >= run.offer.length) || new Set(picks).size !== need) {
    throw new Error(`Elige ${need} Pokémon distintos de los ${run.offer.length} ofrecidos.`);
  }
  run.team = picks.map((i) => run.offer[i]);
  run.offer = null;
  run.phase = 'ready';
  db.save();
  return { tower: view(u) };
}

function fight(u) {
  const run = heal(u);
  if (!run) throw new Error('No tienes ninguna carrera en la Torre.');
  if (run.phase === 'pick') throw new Error('Primero elige tu equipo.');
  if (run.phase === 'battle') throw new Error('Ya hay un combate en curso.');
  const n = run.streak + 1;
  const foe = foeFor(run.format, n);
  const sdw = require('./showdown');
  const b = sdw.startTowerBattle(u, {
    format: run.format, n, boss: foe.boss,
    foe: { name: foe.who.name, cls: foe.who.cls, quote: foe.who.quote, sets: clone(foe.mons.map((m) => m.set)), roster: clone(foe.mons.map((m) => m.roster)) },
    mine: { sets: clone(run.team.map((m) => m.set)), roster: clone(run.team.map((m) => m.roster)) },
  });
  run.phase = 'battle';
  run.battleId = b.id;
  run.swap = null;
  run.foe = { name: foe.who.name, cls: foe.who.cls, boss: foe.boss };
  run.foeMons = foe.mons;
  db.save();
  return { battle: b.view(b.sides[0]) };
}

function swap(u, p) {
  const run = heal(u);
  if (!run || run.phase !== 'swap') throw new Error('Ahora no se puede cambiar ningún Pokémon.');
  if (p.skip) { run.phase = 'ready'; run.swap = null; db.save(); return { tower: view(u) }; }
  const out = Number(p.out), inn = Number(p.in);
  if (!Number.isInteger(out) || out < 0 || out >= run.team.length || !Number.isInteger(inn) || inn < 0 || inn >= run.swap.length) throw new Error('Elección no válida.');
  const take = run.swap[inn];
  const base = (m) => sd.speciesOf(m.roster.id).baseSpecies;
  if (run.team.some((m, i) => i !== out && base(m) === base(take))) throw new Error('Cláusula de especies: ya llevas ese Pokémon.');
  run.team[out] = take;
  run.phase = 'ready';
  run.swap = null;
  db.save();
  return { tower: view(u) };
}

function abandon(u) {
  const run = heal(u);
  if (!run) throw new Error('No tienes ninguna carrera en la Torre.');
  if (run.phase === 'battle') throw new Error('Estás en pleno combate: termínalo o rínde te desde la pantalla de combate.');
  const r = endRun(u, 'abandon');
  return { ended: r, tower: view(u) };
}

// ---- Fin de un combate de la Torre (lo llama showdown.js al liquidar) ----
function onEnd(u, b, won) {
  const T = ensure(u);
  const run = T.run;
  if (!run || run.battleId !== b.id) return null;
  const n = b.tower.n;
  run.battleId = null;
  if (!won) { // derrota, empate, rendición o abandono: acaba la carrera
    const best = T.best[run.format];
    const r = endRun(u, 'lost');
    return { won: false, n, streak: r.streak, ended: true, best, format: run.format };
  }
  run.streak = n;
  T.wins++;
  const prevBest = T.best[run.format];
  T.best[run.format] = Math.max(prevBest, run.streak);
  const want = bpForWin(n) + (n % ROUND === 0 ? ROUND_BONUS : 0);
  const got = require('./bp').award(u, 'tower', want);
  const medals = [];
  for (const [at, id] of MEDALS) {
    if (T.best[run.format] >= at && !T.medals[id]) {
      T.medals[id] = Date.now();
      if (u.progress && u.progress.titles && !u.progress.titles.includes(id)) u.progress.titles.push(id);
      medals.push({ at, id, title: require('./progress').titleText(id) });
    }
  }
  run.phase = 'swap';
  run.swap = run.foeMons;
  run.foeMons = null;
  db.save();
  if (n % ROUND === 0) hub.feed('tower', `🗼 ${u.username} ha completado la ronda ${roundOf(n)} de la Torre Batalla (racha de ${n})`);
  return {
    won: true, n, streak: run.streak, round: roundOf(n), roundDone: n % ROUND === 0, boss: !!b.tower.boss, bp: got, bpWanted: want, capped: got < want,
    bpToday: dayBp(u), bpCap: DAY_CAP, best: T.best[run.format], newBest: run.streak > prevBest, medals, format: run.format,
  };
}

function board(format, n = 20) {
  return Object.values(db.data.users)
    .filter((u) => !u.npc && !u.banned && u.tower && u.tower.best && u.tower.best[format] > 0)
    .sort((a, b) => b.tower.best[format] - a.tower.best[format] || a.username.localeCompare(b.username))
    .slice(0, n)
    .map((u) => ({ username: u.username, level: u.level, buddy: u.buddy, ...hub.looks(u), value: u.tower.best[format] }));
}

function state(u) {
  return { ...view(u), board: { singles: board('singles'), doubles: board('doubles') } };
}

module.exports = {
  FORMATS, PICK, OFFER, ROUND, BOSS_EVERY, DAY_CAP, ROUND_BONUS, MEDALS, LEVEL, BOSSES,
  bpForWin, isBoss, roundOf, pool, buildMon, offerFor, foeFor, foeBand, ensure, view, state, board,
  start, pick: pickTeam, fight, swap, abandon, onEnd, onAbort, heal,
};
