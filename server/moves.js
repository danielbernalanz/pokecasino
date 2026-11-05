'use strict';
// Movimientos como en los juegos: cada ejemplar tiene una lista de movimientos APRENDIDOS (`learned`, ids de Showdown) y
// hasta 4 EQUIPADOS (`sdMoves`, los que lleva a combate). Se aprenden por nivel, con MT (ver tm.js), por huevo o con tutor.
//  - Migración (una vez por ejemplar, `mv: 2`): aprendidos = movimientos por nivel de su especie con nivel ≤ el suyo;
//    equipados = los 4 últimos (como los Pokémon salvajes de los juegos).
//  - Al subir de nivel / evolucionar, los movimientos nuevos se aprenden solos si hay hueco; si no, quedan en `pending` y el
//    cliente pregunta «¿olvidar cuál?». Decir «No aprender» lo deja igualmente en `learned` (se puede equipar después, como el
//    Recordador de movimientos de Escarlata/Púrpura).
// Todo sale de server/learnsets.json (scripts/gen-learnsets.js): no hace falta cargar el simulador.
const db = require('./db');
const LS = require('./learnsets.json');
const ES = require('./sd-es.json');

const MAX_EQUIP = 4;
const VERSION = 2;
const toID = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const name = (id) => ES.moves[id] || id;

const rec = (id) => LS.sp[Number(id)] || null;

const LEVEL_CACHE = new Map();
// [{ move, level }] de la propia especie, por nivel (nivel 0 = al evolucionar).
function levelMoves(id) {
  id = Number(id);
  if (LEVEL_CACHE.has(id)) return LEVEL_CACHE.get(id);
  const r = rec(id);
  const out = [];
  if (r) for (let i = 0; i < r.l.length; i += 2) out.push({ move: LS.moves[r.l[i]], level: r.l[i + 1] });
  out.sort((a, b) => a.level - b.level || (a.move < b.move ? -1 : 1));
  if (!out.length) out.push({ move: 'tackle', level: 1 });
  LEVEL_CACHE.set(id, out);
  return out;
}
// Movimientos por nivel con nivel ≤ `level` (los de «al evolucionar» cuentan como nivel 1).
const reachable = (id, level) => levelMoves(id).filter((x) => x.level <= level);
// Los 4 últimos movimientos por nivel a ese nivel: el conjunto de un Pokémon salvaje.
function equipAt(id, level) {
  const list = [];
  for (const x of reachable(id, level)) if (!list.includes(x.move)) list.push(x.move);
  return list.slice(-MAX_EQUIP);
}
const levelOf = (m) => Math.max(1, Math.min(100, Math.floor(m.level) || 5));

// Rellena (una sola vez) `learned`, `sdMoves` y `pending` de un ejemplar. Tolera ejemplares falsos (entrenadores de la CPU).
function ensure(id, m) {
  if (m.mv === VERSION && Array.isArray(m.learned) && Array.isArray(m.sdMoves) && m.sdMoves.length) {
    if (!Array.isArray(m.pending)) m.pending = [];
    return m;
  }
  const lv = levelOf(m);
  const learned = [];
  for (const x of reachable(id, lv)) if (!learned.includes(x.move)) learned.push(x.move);
  m.learned = learned;
  m.sdMoves = equipAt(id, lv);
  m.pending = [];
  m.mv = VERSION;
  return m;
}

// Añade un movimiento nuevo: se equipa solo si hay hueco; si no, queda pendiente de decidir.
function acquire(m, move, out) {
  if (m.learned.includes(move)) return;
  if (m.sdMoves.length < MAX_EQUIP) { m.learned.push(move); m.sdMoves.push(move); out.auto.push(move); return; }
  if (!m.pending.includes(move)) { m.pending.push(move); out.pending.push(move); }
}

// Nivel `from` → `to`: movimientos por nivel nuevos.
function onLevel(id, m, from, to) {
  ensure(id, m);
  const out = { auto: [], pending: [] };
  for (const x of levelMoves(id)) if (x.level > from && x.level <= to) acquire(m, x.move, out);
  return out;
}
// Evolución a `id`: aprende los de «al evolucionar» y los de su nivel actual que le falten (conserva todo lo aprendido).
function onEvolve(id, m) {
  ensure(id, m);
  const out = { auto: [], pending: [] };
  for (const x of reachable(id, levelOf(m))) acquire(m, x.move, out);
  return out;
}

// ---- Compatibilidad por especie (MT, huevo, tutor) ----
const SETS = new Map();
function setOf(id, key) {
  const k = key + id;
  let s = SETS.get(k);
  if (!s) { const r = rec(id); s = new Set(r ? r[key].map((i) => LS.moves[i]) : []); SETS.set(k, s); }
  return s;
}
const tmCompat = (id, move) => setOf(id, 'm').has(move);
const eggMoves = (id) => [...setOf(id, 'e')];
const tutorMoves = (id) => [...setOf(id, 't')];
const abilitiesOf = (id) => { const r = rec(id); return r ? { normal: r.a, hidden: r.h || null } : { normal: [], hidden: null }; };

// Datos de un movimiento para el cliente.
function card(move) {
  const x = ES.meta[move];
  return x ? { id: move, type: x[0], cat: x[1], bp: x[2], acc: x[3], pp: x[4] } : { id: move, type: 'normal', cat: 'x', bp: 0, acc: 0, pp: 0 };
}

// ---- Acciones del jugador ----
// `pc:moves`: cambia los 4 equipados (fuera de combate, solo entre los aprendidos).
function setEquipped(u, p) {
  const specimen = require('./specimen');
  const m = specimen.find(u, p);
  ensure(Number(p.id), m);
  const list = p.moves;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_EQUIP) throw new Error('Elige de 1 a 4 movimientos.');
  const ids = list.map(toID);
  if (new Set(ids).size !== ids.length) throw new Error('Movimiento repetido.');
  for (const x of ids) if (!m.learned.includes(x)) throw new Error('Ese Pokémon aún no ha aprendido uno de esos movimientos.');
  m.sdMoves = ids;
  db.save();
  return { eq: m.sdMoves };
}

// `pc:learn`: resuelve un movimiento pendiente. `replace` = movimiento equipado que se olvida (o vacío = «No aprender»).
function learn(u, p) {
  const specimen = require('./specimen');
  const m = specimen.find(u, p);
  ensure(Number(p.id), m);
  const move = toID(p.move);
  const i = m.pending.indexOf(move);
  if (i < 0) throw new Error('Ese movimiento no está pendiente.');
  const replace = p.replace ? toID(p.replace) : '';
  m.pending.splice(i, 1);
  if (!m.learned.includes(move)) m.learned.push(move);
  if (replace) {
    const j = m.sdMoves.indexOf(replace);
    if (j < 0) { m.pending.splice(i, 0, move); throw new Error('Ese movimiento no está equipado.'); }
    m.sdMoves[j] = move;
  } else if (p.equip && m.sdMoves.length < MAX_EQUIP && !m.sdMoves.includes(move)) {
    m.sdMoves.push(move);
  }
  db.save();
  return { eq: m.sdMoves, learned: m.learned, pending: m.pending };
}

// Añade un movimiento aprendido por otra vía (MT, huevo, tutor). Con `equip` lo mete en un hueco libre si lo hay.
function teach(id, m, move, { equip = true } = {}) {
  ensure(Number(id), m);
  if (m.learned.includes(move)) throw new Error('Ya conoce ese movimiento.');
  m.learned.push(move);
  m.pending = m.pending.filter((x) => x !== move);
  if (equip && m.sdMoves.length < MAX_EQUIP) { m.sdMoves.push(move); return 'equipped'; }
  return 'learned';
}

module.exports = {
  MAX_EQUIP, VERSION, toID, name, card, levelMoves, reachable, equipAt, ensure, onLevel, onEvolve, tmCompat, eggMoves, tutorMoves, abilitiesOf,
  setEquipped, learn, teach, TM_NUMBERS: LS.tm,
};
