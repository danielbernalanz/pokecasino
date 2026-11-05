'use strict';
// Teraincursiones cooperativas (1★–5★), con la idea de las incursiones de la 9.ª generación pero en un modelo por turnos sencillo y robusto:
//
//  · JEFE: un Pokémon teracristalizado (su Teratipo es su único tipo mientras dura el combate) con PS fijos según las estrellas. Al
//    llegar al 50 % de PS se cubre de un ESCUDO (25 % de sus PS) que absorbe el daño; al romperse pierde su próximo ataque. Ataca con su
//    Teratipo (a uno al azar, y cada 3 turnos a todos con menos potencia).
//  · EQUIPO: hasta 4 jugadores reales (uno cada vez, un Pokémon de la Caja cada uno, sus estadísticas reales a nivel 50, sus movimientos
//    equipados y su Teratipo). Las plazas libres las ocupan aliados de la CPU, así que también se puede jugar en solitario (tú + 3 aliados).
//    Todos eligen movimiento cada turno (30 s; si no, se elige solo y tras 3 turnos seguidos sin tiempo el jugador queda «en piloto automático»).
//    Cada jugador puede teracristalizar una vez por incursión (necesita el Orbe Teracristal): sus ataques de ese tipo suben (×1,5, ×2 si era
//    ya uno de sus tipos) y su tipo defensivo pasa a ser el Teratipo. Un Pokémon debilitado vuelve a salir (con los PS llenos) dos turnos
//    después, pero el equipo solo aguanta 4 debilitados en total. Máximo 20 turnos. El jefe es inmune a estados.
//  · SALAS: en solitario (empieza al momento), sala abierta (aparece en la lista, hasta 4 jugadores) o privada (por código de 4 letras). La sala
//    espera 2 minutos a que se una gente y completa con aliados CPU.
//  · ROTACIÓN: 2 jefes por estrella y día (día UTC), deterministas (hash de la fecha): son iguales para todos. Las estrellas se abren con medallas
//    (1★ 1 · 2★ 2 · 3★ 4 · 4★ 6 · 5★ 8).
//  · ROBUSTEZ: el estado vive en `db.data.raids` (se guarda en cada cambio) y las fechas límite son marcas de tiempo, así que un reinicio del
//    servidor, un jugador desconectado o una sala a medias se resuelven solos con el temporizador (`tick`).
//  · RECOMPENSAS (solo por ganar y con participación real; tope de 10 incursiones premiadas por jugador y día): Teralitos del tipo del jefe,
//    Caramelos Exp. (con tope diario de EXP propio), a veces una Menta o una Cápsula Habilidad, y la CAPTURA GARANTIZADA del jefe con su
//    Teratipo: gasta una Ball (mínimo Poké/Super/Ultra según las estrellas, ver MIN_BALL) y no puede escaparse. Nunca da monedas.
const crypto = require('crypto');
const db = require('./db');
const hub = require('./hub');
const { BY_ID, DEX, TYPES, effectiveness } = require('./pokedex');
const { rand: realRand } = require('./rng');

let RNG = realRand; // las pruebas lo sustituyen por uno determinista
const setRng = (f) => { RNG = f || realRand; };
const ri = (a, b) => a + Math.floor(RNG() * (b - a + 1));

// ---------- Constantes ----------
const STARS = [1, 2, 3, 4, 5];
const BADGES = { 1: 1, 2: 2, 3: 4, 4: 6, 5: 8 }; // medallas necesarias
const LEVEL = { 1: 20, 2: 30, 3: 40, 4: 50, 5: 60 }; // nivel del jefe (y del Pokémon capturado)
const HP = { 1: 1000, 2: 1500, 3: 2200, 4: 2600, 5: 3000 }; // PS del jefe (el equipo hace ≈ 230 por turno con tipos neutros)
const BOSS_POWER = { 1: 40, 2: 45, 3: 52, 4: 48, 5: 48 };
const ALLY_POWER = { 1: 60, 2: 70, 3: 80, 4: 85, 5: 90 };
const PERFECT_IVS = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 4 }; // IV a 31 del jefe capturado
const SLOTS = 2; // jefes por estrella y día
const DAILY = 10; // incursiones premiadas por jugador y día
const MAX_KOS = 4;
const MAX_TURNS = 20;
const TURN_MS = Number(process.env.RAID_TURN_MS) || 30 * 1000;
const SOLO_TURN_MS = 5 * 60 * 1000;
const LOBBY_MS = Number(process.env.RAID_LOBBY_MS) || 2 * 60 * 1000;
const KEEP_MS = 6 * 3600e3; // una incursión terminada se conserva 6 h
const CLAIM_MS = 24 * 3600e3; // la captura del jefe se puede reclamar durante 24 h
const AFK_AFTER = 3;
const SHIELD_AT = 0.5;
const SHIELD_FRAC = 0.25;
const AREA_EVERY = 3;
const AREA_POWER = 0.55;
const MAX_PLAYERS = 4;
const SHINY = 1 / 1024;
const HA_CHANCE = 0.02;

// Recompensas por estrellas.
const SHARDS = { 1: [1, 2], 2: [2, 3], 3: [3, 5], 4: [4, 7], 5: [6, 10] }; // Teralitos del tipo del jefe (mín., máx.)
const CANDY = { 1: ['exp-xs', 2], 2: ['exp-s', 1], 3: ['exp-s', 2], 4: ['exp-m', 1], 5: ['exp-m', 2] };
const EXP_DAY = 9000; // EXP de Caramelos Exp. de Teraincursiones por jugador y día (= 90 PB de la Tienda de Combate)
const ITEM_CHANCE = { 1: 0, 2: 0, 3: 0.08, 4: 0.12, 5: 0.2 }; // Menta al azar
const CAPSULE_CHANCE = { 5: 0.05 };
// Ball mínima para capturar al jefe (precio mínimo en monedas): siempre mayor que lo que vale el Pokémon al liberarlo (test/raid.test.js).
const MIN_BALL = { 1: 'poke-ball', 2: 'poke-ball', 3: 'great-ball', 4: 'ultra-ball', 5: 'ultra-ball' };

// ---------- Jefes del día ----------
const bst = (p) => p.stats.reduce((a, b) => a + b, 0);
const POOL_RULES = {
  1: (p) => p.rarity === 'C' && bst(p) >= 250 && bst(p) <= 340,
  2: (p) => (p.rarity === 'C' || p.rarity === 'U') && bst(p) >= 300 && bst(p) <= 420,
  3: (p) => (p.rarity === 'U' || p.rarity === 'R') && bst(p) >= 380 && bst(p) <= 500,
  4: (p) => (p.rarity === 'R' || p.rarity === 'E') && bst(p) >= 450 && bst(p) <= 560,
  5: (p) => p.rarity === 'E' && bst(p) >= 500 && bst(p) <= 640,
};
const POOLS = {};
const poolOf = (star) => (POOLS[star] ||= DEX.filter(POOL_RULES[star]));
const h32 = (s) => crypto.createHash('sha256').update(String(s)).digest().readUInt32BE(0);
const dayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

// Jefes de un día: 2 por estrella, distintos, y un Teratipo al azar (determinista por fecha).
function bossesOf(day = dayKey()) {
  const out = [];
  for (const star of STARS) {
    const pool = poolOf(star);
    const used = new Set();
    for (let slot = 0; slot < SLOTS; slot++) {
      let k = h32(`raid:${day}:${star}:${slot}`) % pool.length;
      while (used.has(pool[k].id)) k = (k + 1) % pool.length;
      used.add(pool[k].id);
      out.push({ star, slot, id: pool[k].id, tera: TYPES[h32(`raidtera:${day}:${star}:${slot}`) % TYPES.length], level: LEVEL[star] });
    }
  }
  return out;
}
const bossOf = (day, star, slot) => bossesOf(day).find((b) => b.star === star && b.slot === slot) || null;

// ---------- Estadísticas ----------
const statsOf = (id, level, iv = 31) => BY_ID.get(id).stats.map((b, i) => {
  const core = Math.floor(((2 * b + iv) * level) / 100);
  return i === 0 ? core + level + 10 : core + 5;
});

// ---------- Datos de movimientos (del simulador, solo la primera vez) ----------
let PS = null;
const dex = () => (PS ||= require('pokemon-showdown')).Dex;
const MOVE_CACHE = new Map();
function moveData(id) {
  if (MOVE_CACHE.has(id)) return MOVE_CACHE.get(id);
  const m = dex().moves.get(id);
  let out = null;
  if (m && m.exists) {
    const boosts = (m.target === 'self' && m.boosts) || (m.self && m.self.boosts) || null;
    out = {
      id: m.id, type: String(m.type).toLowerCase(), cat: m.category, power: m.basePower || 0, acc: m.accuracy === true ? null : m.accuracy,
      hits: Array.isArray(m.multihit) ? 3 : (m.multihit || 1), fixed: m.damage !== undefined && m.damage !== null, ohko: !!m.ohko,
      heal: m.heal && m.target === 'self' ? m.heal[0] / m.heal[1] : 0,
      boost: boosts ? { atk: boosts.atk || 0, spa: boosts.spa || 0 } : null,
    };
  }
  MOVE_CACHE.set(id, out);
  return out;
}
// Movimiento de la incursión: lo que el modelo sabe hacer con él. kind: 'dmg' | 'heal' | 'boost' | 'none'.
function moveOf(id) {
  const d = moveData(id);
  const name = require('./moves').name(id);
  if (!d) return { id, name, type: 'normal', cat: 'x', power: 0, acc: null, kind: 'none' };
  if (d.cat !== 'Status' && !d.ohko && (d.power > 0 || d.fixed)) return { id, name, type: d.type, cat: d.cat === 'Physical' ? 'p' : 's', power: d.fixed ? 40 : d.power * (d.hits > 1 ? d.hits : 1), acc: d.acc, kind: 'dmg' };
  if (d.heal) return { id, name, type: d.type, cat: 'x', power: 0, acc: null, kind: 'heal', heal: d.heal };
  if (d.boost && (d.boost.atk > 0 || d.boost.spa > 0)) return { id, name, type: d.type, cat: 'x', power: 0, acc: null, kind: 'boost', boost: d.boost };
  return { id, name, type: d.type, cat: 'x', power: 0, acc: null, kind: 'none' };
}

// ---------- Jugadores y aliados ----------
const MOVES_BY_TYPE = require('./games/battle').MOVES;
function monOfSpecimen(u, id, uid) {
  const specimen = require('./specimen');
  const m = specimen.find(u, { id, uid });
  specimen.assertFree(m, BY_ID.get(Number(id)).name);
  id = Number(id);
  require('./sdmap').ensureSd(id, m);
  const tera = require('./tera');
  const stats = specimen.computeStats(id, m, 50);
  const moves = (m.sdMoves || []).slice(0, 4).map(moveOf);
  if (!moves.length) moves.push(moveOf('tackle'));
  const p = BY_ID.get(id);
  return { id, uid: m.uid, name: m.nick || p.name, shiny: !!m.shiny, level: 50, stats, types: p.types.slice(), tera: tera.teraOf(id, m), moves, hp: stats[0], maxHp: stats[0], ko: 0, teraOn: false, teraUsed: false, boost: { atk: 0, spa: 0 } };
}
// Aliado de la CPU: un Pokémon de la rareza de la estrella con un ataque del tipo que mejor funcione contra el Teratipo del jefe.
function makeAlly(star, bossTera, avoid) {
  const pool = poolOf(star).filter((p) => !avoid.has(p.id));
  const p = pool[Math.floor(RNG() * pool.length)];
  avoid.add(p.id);
  const stats = statsOf(p.id, 50, 20);
  let best = p.types[0];
  for (const t of p.types) if (effectiveness(t, [bossTera]) > effectiveness(best, [bossTera])) best = t;
  const cat = p.stats[1] >= p.stats[3] ? 'p' : 's';
  const mv = { id: 'ally-' + best, name: MOVES_BY_TYPE[best] || 'Placaje', type: best, cat, power: ALLY_POWER[star], acc: 100, kind: 'dmg' };
  return { id: p.id, uid: null, name: p.name, shiny: false, level: 50, stats, types: p.types.slice(), tera: best, moves: [mv], hp: stats[0], maxHp: stats[0], ko: 0, teraOn: false, teraUsed: true, boost: { atk: 0, spa: 0 } };
}

// ---------- Cálculo ----------
const stage = (s) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
const typesNow = (mon) => (mon.teraOn ? [mon.tera] : mon.types);
function stabOf(mon, type) {
  if (mon.teraOn && mon.tera === type) return mon.types.includes(type) ? 2 : 1.5;
  return mon.types.includes(type) ? 1.5 : 1;
}
// Daño de un movimiento del jugador al jefe (sin aleatoriedad): para la vista previa y la IA.
function dmgToBoss(raid, mon, mv, rng = null) {
  const b = raid.boss;
  const special = mv.cat === 's';
  const A = mon.stats[special ? 3 : 1] * stage(mon.boost[special ? 'spa' : 'atk']);
  const D = b.stats[special ? 4 : 2];
  const base = Math.floor(Math.floor((Math.floor((2 * mon.level) / 5) + 2) * mv.power * A / Math.max(1, D)) / 50) + 2;
  const eff = effectiveness(mv.type, [b.tera]);
  if (eff === 0) return 0;
  const r = rng ? 0.85 + rng() * 0.15 : 0.925;
  return Math.max(1, Math.floor(base * stabOf(mon, mv.type) * eff * r));
}
function dmgToMon(raid, mon, power, rng) {
  const b = raid.boss;
  const special = b.stats[3] > b.stats[1];
  const A = b.stats[special ? 3 : 1];
  const D = mon.stats[special ? 4 : 2];
  const base = Math.floor(Math.floor((Math.floor((2 * b.level) / 5) + 2) * power * A / Math.max(1, D)) / 50) + 2;
  const eff = effectiveness(b.tera, typesNow(mon));
  const crit = rng() < 1 / 24 ? 1.5 : 1;
  return { dmg: eff === 0 ? 0 : Math.max(1, Math.floor(base * 1.5 * eff * crit * (0.85 + rng() * 0.15))), eff, crit: crit > 1 };
}
const effLabel = (e) => (e === 0 ? 'sin efecto' : e > 1 ? 'muy eficaz' : e < 1 ? 'poco eficaz' : '');

// Mejor movimiento (el de más daño esperado; curar si está muy tocado y puede).
function bestMove(raid, p) {
  const mon = p.mon;
  let bi = -1; let bd = -1;
  mon.moves.forEach((mv, i) => {
    if (mv.kind !== 'dmg') return;
    const d = dmgToBoss(raid, mon, mv) * (mv.acc ? mv.acc / 100 : 1);
    if (d > bd) { bd = d; bi = i; }
  });
  const healIdx = mon.moves.findIndex((mv) => mv.kind === 'heal');
  if (healIdx >= 0 && mon.hp < mon.maxHp * 0.35) return healIdx;
  if (bi >= 0) return bi;
  return healIdx >= 0 ? healIdx : 0;
}

// ---------- Estado ----------
const store = () => (db.data.raids ||= {});
const newCode = () => {
  const used = new Set(Object.values(store()).filter((r) => r.state === 'lobby' || r.state === 'battle').map((r) => r.code));
  for (let i = 0; i < 100; i++) {
    const c = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
    if (!used.has(c)) return c;
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase();
};
const badgeCount = (u) => ((u.progress && u.progress.badges) || []).length;
const unlocked = (u, star) => badgeCount(u) >= BADGES[star];
const humans = (r) => r.players.filter((p) => p.human);
const activeHumans = (r) => r.players.filter((p) => p.human && !p.afk && !p.left && !p.mon.ko);
const raidOf = (userId) => Object.values(store()).find((r) => (r.state === 'lobby' || r.state === 'battle' || (r.over && r.players.some((p) => p.userId === userId && p.human && !p.dismissed))) && r.players.some((p) => p.userId === userId && p.human && !p.left && !p.dismissed)) || null;

function dayState(u, now = Date.now()) {
  const d = (u.raid ||= { day: '', n: 0, exp: 0, claims: [], st: { played: 0, won: 0 } });
  d.claims ||= []; d.st ||= { played: 0, won: 0 };
  const k = dayKey(now);
  if (d.day !== k) { d.day = k; d.n = 0; d.exp = 0; }
  d.claims = d.claims.filter((c) => now - c.at < CLAIM_MS);
  return d;
}

function bossView(raid) {
  const b = raid.boss;
  return { id: b.id, tera: b.tera, level: b.level, star: raid.star, hp: b.hp, hpMax: b.hpMax, shield: { on: b.shield.on, hp: b.shield.hp, max: b.shield.max, done: b.shield.done }, stunned: b.stunned };
}
function monView(mon) {
  return { id: mon.id, name: mon.name, shiny: mon.shiny, hp: mon.hp, maxHp: mon.maxHp, ko: mon.ko, tera: mon.tera, teraOn: mon.teraOn, teraUsed: mon.teraUsed, types: mon.types };
}
// Lo que ve cada jugador.
function viewFor(raid, userId) {
  const me = raid.players.findIndex((p) => p.userId === userId && p.human);
  const p = me >= 0 ? raid.players[me] : null;
  const v = {
    id: raid.id, code: raid.code, star: raid.star, state: raid.state, over: !!raid.over, win: raid.over ? raid.state === 'won' : undefined, mode: raid.mode, open: raid.open, host: raid.hostName, turn: raid.turn, maxTurns: MAX_TURNS, kos: raid.kos, maxKos: MAX_KOS,
    deadline: raid.deadline, boss: bossView(raid), log: raid.log.slice(-40), why: raid.why || null,
    players: raid.players.map((x) => ({ name: x.name, human: x.human, afk: !!x.afk, left: !!x.left, chosen: !!x.choice, mon: monView(x.mon) })),
    me: p ? { idx: me, host: raid.hostId === userId, chosen: !!p.choice, choice: p.choice, acts: p.acts, afk: !!p.afk, orb: require('./tera').hasOrb(db.userById(userId) || { items: {} }), reward: raid.rewards ? raid.rewards[userId] || null : null,
      moves: p.mon.moves.map((mv, i) => ({ i, name: mv.name, type: mv.type, cat: mv.cat, power: mv.power, kind: mv.kind, acc: mv.acc, eff: mv.kind === 'dmg' ? effectiveness(mv.type, [raid.boss.tera]) : null, dmg: mv.kind === 'dmg' ? dmgToBoss(raid, p.mon, mv) : 0 })) } : null,
  };
  return v;
}
function push(raid) {
  for (const p of humans(raid)) if (!p.left) hub.emitUser(p.userId, 'raid:state', viewFor(raid, p.userId));
  if (raid.open && raid.state === 'lobby') pushList();
}
const publicList = () => Object.values(store()).filter((r) => r.state === 'lobby' && r.open).map((r) => ({ id: r.id, star: r.star, boss: r.boss.id, tera: r.boss.tera, host: r.hostName, n: humans(r).length, max: MAX_PLAYERS, deadline: r.deadline, code: r.code }));
const pushList = () => hub.broadcast('raid:list', publicList());
const save = () => db.save();

const logLine = (raid, text) => { raid.log.push(text); if (raid.log.length > 80) raid.log.splice(0, raid.log.length - 80); };

// ---------- Crear, unirse, salir ----------
function assertCanPlay(u) {
  if (u.npc) throw new Error('Los comerciantes NPC no hacen Teraincursiones.');
  const cur = raidOf(u.id);
  if (cur && cur.over) { const me = cur.players.find((x) => x.userId === u.id && x.human); if (me) me.dismissed = true; } // el resultado anterior se cierra solo
  else if (cur) throw new Error('Ya estás en una Teraincursión.');
  require('./tera').ensureOrb(u);
}
function playerOf(u, id, uid) {
  return { userId: u.id, name: u.username, human: true, mon: monOfSpecimen(u, id, uid), choice: null, acts: 0, timeouts: 0, afk: false, left: false, dismissed: false };
}
const hostRaidAllowed = (u, star) => { if (!unlocked(u, star)) throw new Error(`Las incursiones de ${star}★ se abren con ${BADGES[star]} medalla${BADGES[star] > 1 ? 's' : ''} (llevas ${badgeCount(u)}).`); };

function create(u, { star, slot = 0, id, uid, mode = 'solo' } = {}, now = Date.now()) {
  assertCanPlay(u);
  star = Number(star); slot = Number(slot);
  if (!STARS.includes(star) || !(slot >= 0 && slot < SLOTS)) throw new Error('Incursión no válida.');
  if (!['solo', 'open', 'private'].includes(mode)) throw new Error('Tipo de sala no válido.');
  hostRaidAllowed(u, star);
  const b = bossOf(dayKey(now), star, slot);
  const stats = statsOf(b.id, b.level);
  const hpMax = HP[star];
  const host = playerOf(u, id, uid);
  const raid = {
    id: crypto.randomBytes(4).toString('hex'), code: newCode(), star, slot, day: dayKey(now), mode, open: mode === 'open', hostId: u.id, hostName: u.username, createdAt: now,
    boss: { id: b.id, tera: b.tera, level: b.level, stats, hp: hpMax, hpMax, shield: { on: false, hp: 0, max: Math.round(hpMax * SHIELD_FRAC), done: false }, stunned: false },
    players: [host], state: 'lobby', over: false, turn: 0, kos: 0, log: [], deadline: now + LOBBY_MS, rewards: null, why: null,
  };
  store()[raid.id] = raid;
  dayState(u, now).st.played++;
  if (mode === 'solo') startBattle(raid, now);
  else { logLine(raid, `${u.username} ha abierto una sala de ${star}★.`); save(); push(raid); }
  save();
  return { raid: viewFor(raid, u.id) };
}

function join(u, { id, code, uid, monId } = {}, now = Date.now()) {
  assertCanPlay(u);
  const raid = Object.values(store()).find((r) => r.state === 'lobby' && ((id && r.id === String(id)) || (code && r.code === String(code).toUpperCase().trim())));
  if (!raid) throw new Error('Esa sala ya no existe (o ya ha empezado).');
  hostRaidAllowed(u, raid.star);
  if (humans(raid).length >= MAX_PLAYERS) throw new Error('La sala está completa.');
  raid.players.push(playerOf(u, monId, uid));
  dayState(u, now).st.played++;
  logLine(raid, `${u.username} se ha unido.`);
  if (humans(raid).length >= MAX_PLAYERS) startBattle(raid, now);
  else { save(); push(raid); }
  return { raid: viewFor(raid, u.id) };
}

function startBattle(raid, now = Date.now()) {
  if (raid.state !== 'lobby') return;
  const avoid = new Set([raid.boss.id, ...raid.players.map((p) => p.mon.id)]);
  while (raid.players.length < MAX_PLAYERS) raid.players.push({ userId: null, name: 'Aliado CPU', human: false, mon: makeAlly(raid.star, raid.boss.tera, avoid), choice: null, acts: 0, timeouts: 0, afk: false, left: false, dismissed: true });
  raid.state = 'battle';
  raid.open = false;
  raid.turn = 1;
  const solo = humans(raid).length === 1;
  raid.deadline = now + (solo ? SOLO_TURN_MS : TURN_MS);
  logLine(raid, `¡${BY_ID.get(raid.boss.id).name} se ha teracristalizado de tipo ${tera().TYPE_ES[raid.boss.tera]}! (${raid.star}★)`);
  save(); push(raid); pushList();
}
const tera = () => require('./tera');

function start(u, _p, now = Date.now()) {
  const raid = raidOf(u.id);
  if (!raid || raid.state !== 'lobby') throw new Error('No tienes ninguna sala por empezar.');
  if (raid.hostId !== u.id) throw new Error('Solo quien creó la sala puede empezar.');
  startBattle(raid, now);
  return { raid: viewFor(raid, u.id) };
}

// Salir: en la sala (el anfitrión la cancela) o en el combate (tu Pokémon pasa a manos de la CPU y no cobras).
function leave(u) {
  const raid = raidOf(u.id);
  if (!raid) return { raid: null };
  const p = raid.players.find((x) => x.userId === u.id && x.human);
  if (raid.over) { p.dismissed = true; save(); return { raid: null }; }
  if (raid.state === 'lobby') {
    if (raid.hostId === u.id) {
      raid.state = 'cancelled'; raid.over = true; raid.why = 'La sala se ha cancelado.';
      for (const x of humans(raid)) if (x.userId !== u.id) { hub.emitUser(x.userId, 'raid:state', null); hub.emitUser(x.userId, 'toast', { kind: 'info', text: 'La sala de Teraincursión se ha cancelado.' }); }
      delete store()[raid.id];
    } else raid.players = raid.players.filter((x) => x !== p);
    save(); push(raid); pushList();
    return { raid: null };
  }
  p.human = false; p.left = true; p.dismissed = true; p.choice = null;
  logLine(raid, `${u.username} ha abandonado la incursión: su Pokémon sigue con la CPU.`);
  if (!humans(raid).length) { raid.state = 'abandoned'; raid.over = true; raid.why = 'Todos los jugadores se han ido.'; } else maybeResolve(raid);
  save(); push(raid);
  return { raid: null };
}

// ---------- Turnos ----------
function choose(u, { move, tera: wantTera } = {}, now = Date.now()) {
  const raid = raidOf(u.id);
  if (!raid || raid.state !== 'battle') throw new Error('No estás en una incursión en curso.');
  const p = raid.players.find((x) => x.userId === u.id && x.human);
  if (p.mon.ko) throw new Error('Tu Pokémon está debilitado: volverá enseguida.');
  move = Number(move);
  const mv = p.mon.moves[move];
  if (!Number.isInteger(move) || !mv) throw new Error('Movimiento no válido.');
  let t = false;
  if (wantTera) {
    if (!tera().hasOrb(u)) throw new Error('Necesitas el Orbe Teracristal (se consigue con la primera medalla).');
    if (p.mon.teraUsed) throw new Error('Ya has teracristalizado en esta incursión.');
    t = true;
  }
  p.choice = { m: move, t };
  p.timeouts = 0; p.afk = false;
  maybeResolve(raid, now);
  save(); push(raid);
  return { raid: viewFor(raid, u.id) };
}
function maybeResolve(raid, now = Date.now()) {
  if (raid.over || raid.state !== 'battle') return;
  if (activeHumans(raid).every((p) => p.choice)) resolveTurn(raid, now);
}

function autoPick(raid, p) { return { m: bestMove(raid, p), t: false }; }

function hitBoss(raid, p, mv, tcn) {
  const b = raid.boss;
  const name = p.mon.name;
  if (mv.acc && RNG() * 100 >= mv.acc) { logLine(raid, `${name} usó ${mv.name}, pero falló.`); return; }
  let dmg = dmgToBoss(raid, p.mon, mv, RNG);
  const crit = RNG() < 1 / 24;
  if (crit) dmg = Math.floor(dmg * 1.5);
  const eff = effectiveness(mv.type, [b.tera]);
  logLine(raid, `${name} usó ${mv.name}${eff === 0 ? ' pero no afecta al jefe…' : `: ${dmg} de daño${crit ? ' (¡golpe crítico!)' : ''}${effLabel(eff) ? ', ' + effLabel(eff) : ''}`}.`);
  if (!dmg) return;
  if (b.shield.on) {
    b.shield.hp -= dmg;
    if (b.shield.hp <= 0) { b.shield.on = false; b.shield.hp = 0; b.stunned = true; logLine(raid, '¡El escudo del jefe se ha roto! Pierde su próximo ataque.'); }
    return;
  }
  b.hp -= dmg;
  // Al llegar al 50 % el golpe se detiene y aparece el escudo (aunque el golpe fuera de sobra para rematarlo).
  if (!b.shield.done && b.hp <= b.hpMax * SHIELD_AT) {
    b.hp = Math.ceil(b.hpMax * SHIELD_AT);
    b.shield = { ...b.shield, on: true, hp: b.shield.max, done: true };
    logLine(raid, '¡Un escudo de cristales cubre al jefe! Rómpelo antes de seguir dañándolo.');
  }
  if (b.hp < 0) b.hp = 0;
}

function resolveTurn(raid, now = Date.now()) {
  if (raid.over) return;
  const t = raid.turn;
  logLine(raid, `— Turno ${t} —`);
  // 1) Acciones de los Pokémon en pie (por velocidad).
  const acting = raid.players.filter((p) => !p.mon.ko).sort((a, b) => b.mon.stats[5] - a.mon.stats[5]);
  // (primero se cuenta quién ha respondido, para que quien eligió no pierda su participación si un aliado remata antes que él)
  const plan = acting.map((p) => {
    let ch = p.choice;
    if (p.human && !p.afk && !p.left) {
      if (ch) p.acts++;
      else {
        p.timeouts++;
        if (p.timeouts >= AFK_AFTER) { p.afk = true; logLine(raid, `${p.name} no responde: su Pokémon pasa al piloto automático.`); } else logLine(raid, `${p.name} se ha quedado sin tiempo.`);
      }
    }
    return { p, ch };
  });
  for (const x of plan) {
    const p = x.p;
    let ch = x.ch;
    if (!ch) ch = autoPick(raid, p);
    const mon = p.mon;
    const mv = mon.moves[ch.m] || mon.moves[0];
    if (ch.t && !mon.teraUsed) {
      mon.teraOn = true; mon.teraUsed = true;
      logLine(raid, `¡${mon.name} se ha teracristalizado de tipo ${tera().TYPE_ES[mon.tera]}!`);
    }
    if (mv.kind === 'dmg') hitBoss(raid, p, mv);
    else if (mv.kind === 'heal') {
      const heal = Math.floor(mon.maxHp * mv.heal);
      mon.hp = Math.min(mon.maxHp, mon.hp + heal);
      logLine(raid, `${mon.name} usó ${mv.name} y recuperó ${heal} PS.`);
    } else if (mv.kind === 'boost') {
      mon.boost.atk = Math.min(4, mon.boost.atk + mv.boost.atk);
      mon.boost.spa = Math.min(4, mon.boost.spa + mv.boost.spa);
      logLine(raid, `${mon.name} usó ${mv.name}: ¡sube su ataque!`);
    } else logLine(raid, `${mon.name} usó ${mv.name}, pero el jefe es inmune a ese tipo de movimientos.`);
    p.choice = null;
    if (raid.boss.hp <= 0) return finish(raid, true, now);
  }
  for (const p of raid.players) p.choice = null;
  // 2) El jefe.
  const bname = BY_ID.get(raid.boss.id).name;
  if (raid.boss.stunned) { raid.boss.stunned = false; logLine(raid, `${bname} está aturdido y no puede atacar.`); } else bossAttack(raid, t, bname);
  // 3) Final de turno: vuelven los debilitados.
  for (const p of raid.players) {
    if (p.mon.ko > 0) {
      if (p.mon.ko === 1) { p.mon.ko = 0; p.mon.hp = p.mon.maxHp; logLine(raid, `¡${p.mon.name} vuelve al combate con los PS llenos!`); } else p.mon.ko--;
    }
  }
  if (raid.kos >= MAX_KOS) return finish(raid, false, now, 'Se han debilitado demasiados Pokémon.');
  raid.turn++;
  if (raid.turn > MAX_TURNS) return finish(raid, false, now, 'Se ha acabado el tiempo: el jefe escapa.');
  const solo = humans(raid).length <= 1;
  raid.deadline = now + (solo ? SOLO_TURN_MS : TURN_MS);
  save(); push(raid);
  // Si ya nadie puede decidir (todos en automático) el siguiente turno se resuelve solo (en el siguiente `tick`).
}

function bossAttack(raid, t, bname) {
  const alive = raid.players.filter((p) => !p.mon.ko);
  if (!alive.length) return;
  const area = t % AREA_EVERY === 0;
  const power = BOSS_POWER[raid.star] * (area ? AREA_POWER : 1);
  const targets = area ? alive : [alive[Math.floor(RNG() * alive.length)]];
  logLine(raid, area ? `¡${bname} lanza un ataque a todo el equipo!` : `${bname} ataca a ${targets[0].mon.name}.`);
  for (const p of targets) {
    const r = dmgToMon(raid, p.mon, power, RNG);
    p.mon.hp = Math.max(0, p.mon.hp - r.dmg);
    if (area) logLine(raid, `${p.mon.name} recibe ${r.dmg} de daño${effLabel(r.eff) ? ' (' + effLabel(r.eff) + ')' : ''}.`);
    else logLine(raid, `${p.mon.name} recibe ${r.dmg} de daño${r.crit ? ' (¡golpe crítico!)' : ''}${effLabel(r.eff) ? ', ' + effLabel(r.eff) : ''}.`);
    if (p.mon.hp <= 0) {
      p.mon.ko = 2; raid.kos++;
      logLine(raid, `¡${p.mon.name} se ha debilitado! (${raid.kos}/${MAX_KOS})`);
    }
  }
}

// Temporizador: salas que esperan, turnos con plazo vencido y turnos que nadie va a decidir (todos en automático).
function tick(now = Date.now()) {
  let changed = false;
  for (const raid of Object.values(store())) {
    if (raid.over) {
      if (now - (raid.endedAt || now) > KEEP_MS) { delete store()[raid.id]; changed = true; }
      continue;
    }
    if (raid.state === 'lobby' && now >= raid.deadline) { startBattle(raid, now); changed = true; continue; }
    if (raid.state === 'battle') {
      if (!activeHumans(raid).length || now >= raid.deadline) { resolveTurn(raid, now); changed = true; }
    }
  }
  if (changed) save();
}

// ---------- Final y recompensas ----------
function finish(raid, win, now, why = null) {
  raid.over = true; raid.state = win ? 'won' : 'lost'; raid.endedAt = now; raid.why = why;
  raid.rewards = {};
  logLine(raid, win ? `¡${BY_ID.get(raid.boss.id).name} ha sido derrotado!` : (why || 'La incursión ha fracasado.'));
  for (const p of humans(raid)) {
    const u = db.userById(p.userId);
    if (!u) continue;
    if (win) raid.rewards[p.userId] = reward(u, raid, p, now);
    hub.pushMe(u);
  }
  if (win) for (const p of humans(raid)) hub.track(db.userById(p.userId), 'raid_win');
  save(); push(raid);
}
// Cuántas acciones propias se piden para cobrar: un tercio de los turnos jugados (así no se puede cobrar dejando a la CPU).
const needActs = (raid) => Math.max(1, Math.ceil((raid.turn) / 3));

function reward(u, raid, p, now) {
  const d = dayState(u, now);
  const star = raid.star;
  if (p.acts < needActs(raid)) return { none: true, why: 'Participaste muy poco en el combate (hay que elegir movimiento en al menos un tercio de los turnos).' };
  d.st.won++;
  if (d.n >= DAILY) return { capped: true, why: `Ya has cobrado ${DAILY} incursiones hoy: esta no da recompensas.` };
  d.n++;
  const items = require('./items');
  const r = { shards: null, candy: null, item: null, capture: true, xp: 0 };
  const type = raid.boss.tera;
  const [lo, hi] = SHARDS[star];
  const n = ri(lo, hi);
  items.give(u, tera().shardId(type), n);
  r.shards = { type, n };
  const [cid, cn] = CANDY[star];
  const cexp = require('./exp').CANDY_EXP[cid];
  let give = 0;
  while (give < cn && d.exp + cexp * (give + 1) <= EXP_DAY) give++;
  if (give) { require('./candy').giveExp(u, cid, give); d.exp += cexp * give; r.candy = { id: cid, n: give }; } else r.candyCapped = true;
  if (RNG() < (ITEM_CHANCE[star] || 0)) {
    const mints = Object.keys(items.ITEMS).filter((k) => k.startsWith('mint-'));
    r.item = mints[Math.floor(RNG() * mints.length)];
    items.give(u, r.item, 1);
  } else if (RNG() < (CAPSULE_CHANCE[star] || 0)) { r.item = 'ability-capsule'; items.give(u, r.item, 1); }
  r.xp = hub.addXp(u, 10 * star, { flat: true }) || 0;
  d.claims.push({ id: crypto.randomBytes(4).toString('hex'), rid: raid.id, star, boss: raid.boss.id, tera: type, level: raid.boss.level, at: now });
  db.save();
  return r;
}

// ---------- Captura del jefe (garantizada) ----------
function ballOk(star, ballId) {
  const balls = require('./balls');
  if (!balls.isBall(ballId)) return false;
  const price = balls.BALLS[ballId].price;
  if (price === null) return true; // Master Ball
  return price >= balls.BALLS[MIN_BALL[star]].price;
}
function claim(u, { claim: cid, ball } = {}, now = Date.now()) {
  const d = dayState(u, now);
  const c = d.claims.find((x) => x.id === String(cid));
  if (!c) throw new Error('Esa captura ya no está disponible (se puede reclamar durante 24 h).');
  const balls = require('./balls');
  ball = String(ball || '');
  if (!ballOk(c.star, ball)) throw new Error(`Para capturar a un jefe de ${c.star}★ necesitas una ${balls.BALLS[MIN_BALL[c.star]].name} o mejor.`);
  if (!(u.items[ball] > 0)) throw new Error(`No te queda ninguna ${balls.nameOf(ball)}.`);
  const items = require('./items');
  const capture = require('./capture');
  const specimenMod = require('./specimen');
  items.take(u, ball);
  d.claims = d.claims.filter((x) => x !== c);
  const ivs = Array.from({ length: 6 }, () => ri(0, 31));
  const order = [0, 1, 2, 3, 4, 5].sort(() => RNG() - 0.5);
  for (let i = 0; i < PERFECT_IVS[c.star]; i++) ivs[order[i]] = 31;
  const e = {
    zone: 'raid', id: c.boss, level: c.level, ivs, nature: specimenMod.NATURES[ri(0, specimenMod.NATURES.length - 1)].name, size: capture.rollSize(RNG), shiny: RNG() < SHINY,
    ha: !!(require('./moves').abilitiesOf(c.boss).hidden && RNG() < HA_CHANCE), mark: null, legend: false, outbreak: false,
  };
  const got = capture.finishCapture(u, e, ball, now);
  const m = got.uid ? specimenMod.find(u, { id: c.boss, uid: got.uid }) : null;
  if (m) { m.tera = c.tera; m.caught = { ...(m.caught || {}), zone: 'raid', raid: c.star, level: c.level, at: now }; }
  if (c.star >= 4) hub.feed('capture', `💎 ${u.username} ha capturado a ${BY_ID.get(c.boss).name} (${c.star}★, Teratipo ${tera().TYPE_ES[c.tera]}) en una Teraincursión`, { pokeId: c.boss, shiny: e.shiny });
  db.save();
  return { got: { ...got, tera: c.tera, star: c.star } };
}

// ---------- Vista general ----------
function view(u, now = Date.now()) {
  tera().ensureOrb(u);
  const d = dayState(u, now);
  const day = dayKey(now);
  const raid = raidOf(u.id);
  return {
    day, daily: DAILY, done: d.n, left: Math.max(0, DAILY - d.n), exp: d.exp, expMax: EXP_DAY, stats: d.st,
    badges: badgeCount(u), orb: tera().hasOrb(u),
    stars: STARS.map((s) => ({ star: s, badges: BADGES[s], locked: !unlocked(u, s), level: LEVEL[s], minBall: MIN_BALL[s], shards: SHARDS[s], candy: CANDY[s] })),
    bosses: bossesOf(day).map((b) => ({ ...b, hpMax: HP[b.star], locked: !unlocked(u, b.star) })),
    open: publicList(), raid: raid ? viewFor(raid, u.id) : null,
    claims: d.claims.map((c) => ({ id: c.id, star: c.star, boss: c.boss, tera: c.tera, level: c.level, left: Math.max(0, CLAIM_MS - (now - c.at)), minBall: MIN_BALL[c.star] })),
    nextRotation: Date.parse(day + 'T00:00:00Z') + 864e5,
  };
}
// Candidatos para llevar a la incursión (misma lista que Captura, con el Teratipo).
function team(u) {
  const cap = require('./capture').team(u);
  const t = tera();
  const by = new Map();
  for (const [id, arr] of Object.entries(u.mons || {})) for (const m of arr) by.set(m.uid, t.teraOf(Number(id), m));
  return { total: cap.total, mons: cap.mons.map((m) => ({ ...m, tera: by.get(m.uid) })) };
}

// Al arrancar: las fechas límite se amplían (un reinicio no debe castigar a nadie) y arranca el temporizador.
let timer = null;
function start_(now = Date.now()) {
  for (const raid of Object.values(store())) {
    if (raid.over) continue;
    raid.deadline = Math.max(raid.deadline, now + (raid.state === 'lobby' ? LOBBY_MS : humans(raid).length <= 1 ? SOLO_TURN_MS : TURN_MS));
  }
  save();
  if (!timer) { timer = setInterval(() => { try { tick(); } catch (e) { console.error('Teraincursiones:', e); } }, 1000); timer.unref(); }
}
const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

const STATIC = { stars: STARS, badges: BADGES, level: LEVEL, hp: HP, daily: DAILY, maxKos: MAX_KOS, maxTurns: MAX_TURNS, maxPlayers: MAX_PLAYERS, turnMs: TURN_MS, lobbyMs: LOBBY_MS, minBall: MIN_BALL, shards: SHARDS, candy: CANDY, expDay: EXP_DAY, shieldAt: SHIELD_AT, shieldFrac: SHIELD_FRAC, areaEvery: AREA_EVERY, perfectIvs: PERFECT_IVS };

module.exports = {
  STARS, BADGES, LEVEL, HP, BOSS_POWER, ALLY_POWER, DAILY, MAX_KOS, MAX_TURNS, TURN_MS, LOBBY_MS, SOLO_TURN_MS, CLAIM_MS, KEEP_MS, SHARDS, CANDY, EXP_DAY, ITEM_CHANCE, MIN_BALL, PERFECT_IVS, SHIELD_AT, SHIELD_FRAC, AFK_AFTER, STATIC,
  bossesOf, bossOf, poolOf, statsOf, moveOf, dayKey, dayState, unlocked, view, team, create, join, start, leave, choose, tick, claim, viewFor, publicList, raidOf, needActs, resolveTurn, bestMove, ballOk,
  begin: start_, stop, setRng, store, dmgToBoss, dmgToMon, makeAlly,
};
