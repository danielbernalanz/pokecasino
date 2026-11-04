'use strict';
// Liga Pokémon: clasificatoria PvP por temporadas mensuales (mes natural en hora de España).
//  - Una puntuación Elo por formato (Individual y Dobles): empieza en 1000, K = 32, suelo 0.
//  - Rangos como las Poké Balls de los juegos: Poké Ball < 1100 · Super Ball 1100 · Ultra Ball 1250 · Master Ball 1400
//    (y «Top 3» de la temporada en cada formato).
//  - Anti-abuso (docs/ANTIABUSO.md): solo cuentan los combates contra OTRA cuenta, con cuentas de nivel ≥ 3 y ≥ 3 días
//    (transfer.young), mínimo 3 turnos, máximo 5 combates puntuados contra el mismo rival al día. Rendirse, agotar el
//    tiempo o abandonar cuenta como derrota (ya lo decide el combate).
//  - Fin de temporada: premios cosméticos / PB (y monedas pequeñas solo a Master Ball y Top 3, ≤ 2.000) según el rango más
//    alto alcanzado, y reinicio suave: nueva puntuación = 1000 + (puntuación − 1000) / 2.
// El reloj se puede inyectar (`_setClock`, o la variable LEAGUE_FAKE_NOW=<fecha ISO>, que luego avanza en tiempo real) para probar.
const db = require('./db');

const START = 1000;
const K = 32;
const TIERS = [
  { id: 'poke', name: 'Poké Ball', min: 0, sprite: 'poke-ball' },
  { id: 'great', name: 'Super Ball', min: 1100, sprite: 'great-ball' },
  { id: 'ultra', name: 'Ultra Ball', min: 1250, sprite: 'ultra-ball' },
  { id: 'master', name: 'Master Ball', min: 1400, sprite: 'master-ball' },
];
const MIN_TURNS = 3;
const MAX_VS_DAY = 5; // combates puntuados contra el mismo rival al día
const MIN_GAMES_REWARD = 5; // combates puntuados en la temporada para cobrar premios
const MIN_GAMES_TOP = 10; // y para optar al Top 3 de un formato
const TOP_N = 3;
const BOARD_N = 20;
const HIST_KEEP = 12;
const FORMATS = ['singles', 'doubles'];
// Premios por rango más alto alcanzado (PB sin tope diario: es un premio de temporada).
const REWARDS = [
  { bp: 20 },
  { bp: 40, frame: 'frame-liga-super', title: 'liga-super' },
  { bp: 80, frame: 'frame-liga-ultra', title: 'liga-ultra' },
  { bp: 150, frame: 'frame-liga-master', title: 'liga-master', coins: 1000 },
];
const TOP_REWARD = { frame: 'frame-liga-top', title: 'liga-top', coins: 2000 }; // el Top 3 cobra 2.000 en total (no se suman)
const MAX_COINS = 2000;
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// ---- Reloj ----
let clock = null;
if (process.env.LEAGUE_FAKE_NOW) {
  const base = Date.parse(process.env.LEAGUE_FAKE_NOW);
  if (Number.isFinite(base)) { const t0 = Date.now(); clock = () => base + (Date.now() - t0); }
}
const now = () => (clock ? clock() : Date.now());
const _setClock = (fn) => { clock = fn; topCache = null; };

const DTF = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function madrid(ms) {
  const o = {};
  for (const p of DTF.formatToParts(new Date(ms))) o[p.type] = Number(p.value);
  return o; // { year, month, day, hour, minute, second }
}
const offsetAt = (ms) => { const p = madrid(ms); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000; };
const pad = (n) => String(n).padStart(2, '0');
const seasonOf = (ms = now()) => { const p = madrid(ms); return `${p.year}-${pad(p.month)}`; };
const dayOf = (ms = now()) => { const p = madrid(ms); return `${p.year}-${pad(p.month)}-${pad(p.day)}`; };
// Primer instante (UTC, ms) del mes que sigue a la temporada que contiene `ms`, en hora de Madrid.
function seasonEnd(ms = now()) {
  const p = madrid(ms);
  const y = p.month === 12 ? p.year + 1 : p.year;
  const m = p.month === 12 ? 0 : p.month;
  const guess = Date.UTC(y, m, 1);
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return t;
}
const labelOf = (key) => { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };

// ---- Datos del jugador ----
const tierOf = (r) => (r >= TIERS[3].min ? 3 : r >= TIERS[2].min ? 2 : r >= TIERS[1].min ? 1 : 0);
const blank = () => ({ r: START, w: 0, l: 0, d: 0, peak: START });
function ensure(u) {
  const L = (u.league ||= {});
  if (!L.season) L.season = db.data.league ? db.data.league.season : seasonOf();
  for (const f of FORMATS) if (!L[f]) L[f] = blank();
  L.played = L.played || 0;
  L.best = L.best || 0;
  L.hist = L.hist || [];
  return L;
}
const games = (f) => f.w + f.l + f.d;
const seasonGames = (L) => FORMATS.reduce((s, f) => s + games(L[f]), 0);
const rating = (u, format) => (u.league && u.league[format] ? u.league[format].r : START);

function canRank(u) {
  if (u.npc) throw new Error('Los comerciantes NPC no juegan la Clasificatoria.');
  if (require('./transfer').young(u)) throw new Error('La Clasificatoria exige nivel 3 y una cuenta de al menos 3 días.');
}
const ok = (u) => { try { canRank(u); return true; } catch { return false; } };

function vsToday(u, oppId) {
  const L = u.league;
  if (!L || !L.vs || L.vs.day !== dayOf()) return 0;
  return L.vs.n[oppId] || 0;
}

// ---- Top 3 y tabla ----
let topCache = null;
function board(format, n = BOARD_N) {
  const season = db.data.league ? db.data.league.season : seasonOf();
  return Object.values(db.data.users)
    .filter((u) => !u.npc && !u.banned && u.league && u.league.season === season && u.league[format] && games(u.league[format]) > 0)
    .sort((a, b) => b.league[format].r - a.league[format].r || b.league[format].w - a.league[format].w || a.username.localeCompare(b.username))
    .slice(0, n);
}
function topSet(format) {
  return new Set(board(format, 50).filter((u) => games(u.league[format]) >= MIN_GAMES_TOP && u.league[format].r >= TIERS[1].min).slice(0, TOP_N).map((u) => u.id));
}
function tops() {
  if (!topCache || Date.now() - topCache.at > 30000) topCache = { at: Date.now(), singles: topSet('singles'), doubles: topSet('doubles') };
  return topCache;
}
const flushTops = () => { topCache = null; };

// Emblema público: null si nunca ha jugado la Clasificatoria. `format`: el de ese formato; si no, el mejor de los dos.
function emblem(u, format) {
  const L = u && u.league;
  if (!L || !L.played) return null;
  const r = format ? L[format].r : Math.max(L.singles.r, L.doubles.r);
  const t = tops();
  const top = format ? t[format].has(u.id) : t.singles.has(u.id) || t.doubles.has(u.id);
  return { t: tierOf(r), r, top };
}

// ---- Puntuación ----
const expected = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));
function eloDelta(ra, rb, score) { return Math.round(K * (score - expected(ra, rb))); }

/**
 * Registra un combate clasificatorio terminado.
 * @param {object[]} players los dos usuarios (lado 0 y lado 1)
 * @param {string} format
 * @param {number|null} winner 0 | 1 | null (empate)
 * @param {number} turns
 * @returns {{rated: boolean, why?: string, side?: object[]}}
 */
function record(players, format, winner, turns) {
  if (!FORMATS.includes(format)) return { rated: false, why: 'formato' };
  const [a, b] = players;
  if (!a || !b || a.id === b.id) return { rated: false, why: 'misma cuenta' };
  if (!ok(a) || !ok(b)) return { rated: false, why: 'cuenta nueva' };
  if (turns < MIN_TURNS) return { rated: false, why: `menos de ${MIN_TURNS} turnos` };
  const La = ensure(a), Lb = ensure(b);
  const day = dayOf();
  for (const [L] of [[La], [Lb]]) if (!L.vs || L.vs.day !== day) L.vs = { day, n: {} };
  if ((La.vs.n[b.id] || 0) >= MAX_VS_DAY || (Lb.vs.n[a.id] || 0) >= MAX_VS_DAY) return { rated: false, why: `ya habéis jugado ${MAX_VS_DAY} combates puntuados hoy` };
  La.vs.n[b.id] = (La.vs.n[b.id] || 0) + 1;
  Lb.vs.n[a.id] = (Lb.vs.n[a.id] || 0) + 1;
  const fa = La[format], fb = Lb[format];
  const sa = winner === null || winner === undefined ? 0.5 : winner === 0 ? 1 : 0;
  const da = eloDelta(fa.r, fb.r, sa);
  const db_ = eloDelta(fb.r, fa.r, 1 - sa);
  const out = [];
  for (const [u, L, f, d, s] of [[a, La, fa, da, sa], [b, Lb, fb, db_, 1 - sa]]) {
    f.r = Math.max(0, f.r + d);
    if (s === 1) f.w++; else if (s === 0) f.l++; else f.d++;
    f.peak = Math.max(f.peak, f.r);
    L.played++;
    L.best = Math.max(L.best, tierOf(f.peak));
    out.push({ delta: d, rating: f.r, tier: tierOf(f.r), tierName: TIERS[tierOf(f.r)].name });
  }
  flushTops();
  db.save();
  return { rated: true, side: out };
}

// ---- Fin de temporada ----
function rewardFor(best, top) {
  const base = REWARDS[best];
  if (!top) return { ...base };
  return { ...base, frame: TOP_REWARD.frame, title: TOP_REWARD.title, coins: TOP_REWARD.coins, top: true };
}

function finalize(oldSeason, newSeason) {
  const hub = require('./hub');
  const items = require('./items');
  const progress = require('./progress');
  const topS = topSet('singles'), topD = topSet('doubles'); // (la tabla aún es la de la temporada que acaba)
  let n = 0;
  for (const u of Object.values(db.data.users)) {
    const L = u.league;
    if (!L || L.season === newSeason) continue;
    const g = seasonGames(L);
    const top = topS.has(u.id) || topD.has(u.id);
    const peak = Math.max(L.singles.peak, L.doubles.peak);
    const best = Math.max(L.best || 0, tierOf(peak));
    const entry = { season: L.season, singles: { r: L.singles.r, w: L.singles.w, l: L.singles.l, d: L.singles.d }, doubles: { r: L.doubles.r, w: L.doubles.w, l: L.doubles.l, d: L.doubles.d }, best, top, games: g, reward: null };
    if (g >= MIN_GAMES_REWARD && !u.npc && !u.banned) {
      const rw = rewardFor(best, top);
      rw.coins = Math.min(rw.coins || 0, MAX_COINS);
      entry.reward = { ...rw };
      u.bp = Math.max(0, Math.floor(u.bp || 0)) + (rw.bp || 0);
      if (rw.coins) { u.coins += rw.coins; hub.ledger(u, rw.coins, 'reward', `Liga Pokémon ${labelOf(L.season)}`); }
      if (rw.frame) items.give(u, rw.frame, 1);
      if (rw.title && u.progress && u.progress.titles && !u.progress.titles.includes(rw.title)) u.progress.titles.push(rw.title);
      const parts = [`🎖️ +${rw.bp} PB`];
      if (rw.coins) parts.push(`🪙 +${rw.coins}`);
      if (rw.frame) parts.push(items.ITEMS[rw.frame].name);
      if (rw.title) parts.push(`título «${progress.titleText(rw.title)}»`);
      hub.emitUser(u.id, 'toast', { kind: 'quest', text: `🏆 Liga ${labelOf(L.season)} terminada (${TIERS[best].name}${top ? ' · Top 3' : ''}): ${parts.join(', ')}` });
    }
    L.hist.unshift(entry);
    L.hist.length = Math.min(L.hist.length, HIST_KEEP);
    // Reinicio suave.
    for (const f of FORMATS) {
      const r = Math.max(0, Math.round(START + (L[f].r - START) / 2));
      L[f] = { r, w: 0, l: 0, d: 0, peak: r };
    }
    L.season = newSeason;
    L.best = 0;
    L.vs = { day: dayOf(), n: {} };
    hub.pushMe(u);
    n++;
  }
  return n;
}

// Comprueba si ha cambiado el mes (al arrancar y cada minuto). Es idempotente.
function tick() {
  if (!db.data || !db.data.users) return false;
  const cur = seasonOf();
  const g = (db.data.league ||= { season: cur });
  if (g.season === cur) return false;
  const old = g.season;
  const n = finalize(old, cur);
  g.season = cur;
  flushTops();
  db.save();
  console.log(`  🏆 Liga: fin de la temporada ${old} (${n} jugador(es)); empieza ${cur}`);
  return true;
}
let timer = null;
function start() {
  tick();
  if (!timer) { timer = setInterval(() => { try { tick(); } catch (e) { console.error('Liga: error al cerrar la temporada', e); } }, 60 * 1000); timer.unref(); }
}

// ---- Vista para el cliente ----
const row = (u, format) => ({ username: u.username, level: u.level, buddy: u.buddy, ...require('./hub').looks(u), r: u.league[format].r, w: u.league[format].w, l: u.league[format].l, d: u.league[format].d, tier: tierOf(u.league[format].r), top: tops()[format].has(u.id) });

function state(u) {
  const cur = db.data.league ? db.data.league.season : seasonOf();
  const L = u.league && u.league.season === cur ? u.league : null;
  const mine = {};
  for (const f of FORMATS) {
    const x = L ? L[f] : blank();
    mine[f] = { r: x.r, w: x.w, l: x.l, d: x.d, peak: x.peak, tier: tierOf(x.r), top: !!(L && tops()[f].has(u.id)), next: tierOf(x.r) < 3 ? TIERS[tierOf(x.r) + 1].min : null };
  }
  let allowed = true, why = null;
  try { canRank(u); } catch (e) { allowed = false; why = e.message; }
  const end = seasonEnd();
  return {
    season: cur, label: labelOf(cur), endsAt: end, left: Math.max(0, end - now()), now: now(),
    mine, best: L ? Math.max(L.best, tierOf(Math.max(L.singles.peak, L.doubles.peak))) : 0, games: L ? seasonGames(L) : 0, allowed, why,
    board: { singles: board('singles').map((x) => row(x, 'singles')), doubles: board('doubles').map((x) => row(x, 'doubles')) },
    past: u.league ? u.league.hist : [],
    tiers: TIERS.map((t, i) => ({ name: t.name, min: t.min, sprite: t.sprite, reward: REWARDS[i] })),
    top: TOP_REWARD, rules: { minTurns: MIN_TURNS, maxVs: MAX_VS_DAY, minGames: MIN_GAMES_REWARD, minTop: MIN_GAMES_TOP, topN: TOP_N, k: K },
    vs: u.league && u.league.vs && u.league.vs.day === dayOf() ? u.league.vs.n : {},
  };
}

module.exports = {
  START, K, TIERS, REWARDS, TOP_REWARD, MIN_TURNS, MAX_VS_DAY, MIN_GAMES_REWARD, MIN_GAMES_TOP, FORMATS, MAX_COINS,
  now, _setClock, ok, seasonOf, seasonEnd, dayOf, labelOf, tierOf, ensure, rating, canRank, vsToday, board, emblem, eloDelta, record, tick, start, state, finalize, flushTops,
};
