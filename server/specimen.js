'use strict';
// Pokémon únicos: cada copia «real» de una especie tiene sus propios datos (naturaleza, IVs, mote…).
// La colección (`collection[id] = { n, s, cn }`) sigue siendo la fuente de verdad de los CONTADORES;
// `u.mons[id]` es una lista de ejemplares que se sincroniza perezosamente con ese contador.
const crypto = require('crypto');
const db = require('./db');
const { BY_ID } = require('./pokedex');
const { rand, randInt, pick } = require('./rng');
const { MOVES } = require('./games/battle');
const movesMod = require('./moves');
const abilities = require('./abilities');

// [nombre, +stat, −stat] sobre el orden hp, atk, def, spa, spd, spe (índices 1..5; null = neutra).
const NATURES = [
  ['Fuerte'], ['Huraña', 1, 2], ['Audaz', 1, 5], ['Firme', 1, 3], ['Pícara', 1, 4],
  ['Osada', 2, 1], ['Dócil'], ['Plácida', 2, 5], ['Agitada', 2, 3], ['Floja', 2, 4],
  ['Miedosa', 5, 1], ['Activa', 5, 2], ['Seria'], ['Alegre', 5, 3], ['Ingenua', 5, 4],
  ['Modesta', 3, 1], ['Afable', 3, 2], ['Mansa', 3, 5], ['Tímida'], ['Alocada', 3, 4],
  ['Serena', 4, 1], ['Amable', 4, 2], ['Grosera', 4, 5], ['Cauta', 4, 3], ['Rara'],
].map(([name, up = null, down = null]) => ({ name, up, down }));
const NATURE_BY_NAME = new Map(NATURES.map((n) => [n.name, n]));
const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

const ABILITIES = {
  fire: 'Mar Llamas', water: 'Torrente', grass: 'Espesura', electric: 'Electricidad Estática', bug: 'Enjambre', normal: 'Intimidación',
  poison: 'Punto Tóxico', ground: 'Velo Arena', flying: 'Ojo Compuesto', psychic: 'Sincronía', ghost: 'Levitación', rock: 'Robustez',
  ice: 'Manto Níveo', dragon: 'Piel Escama', dark: 'Francotirador', steel: 'Cuerpo Puro', fairy: 'Rizos Rosados', fighting: 'Entusiasmo',
};
const GENERIC_ABILITY = 'Impasible';

const EXTRA = {
  normal: ['Hiperrayo', 'Derribo', 'Cola Férrea'], fire: ['Envite Ígneo', 'Llamarada', 'Colmillo Ígneo'], water: ['Hidrobomba', 'Cascada', 'Pistola Agua'],
  electric: ['Trueno', 'Voltio Cruel', 'Onda Trueno'], grass: ['Hoja Afilada', 'Latigazo', 'Energibola'], ice: ['Ventisca', 'Canto Helado', 'Colmillo Hielo'],
  fighting: ['Puño Dinámico', 'Mach Punch', 'Onda Certera'], poison: ['Residuos', 'Puya Nociva', 'Tóxico'], ground: ['Excavar', 'Tierra Viva', 'Terratemblor'],
  flying: ['Pájaro Osado', 'Respiro', 'Aire Afilado'], psychic: ['Psicorrayo', 'Paz Mental', 'Cabezazo Zen'], bug: ['Zumbido', 'Chupavidas', 'Pin Misil'],
  rock: ['Roca Afilada', 'Pedrada', 'Poder Pasado'], ghost: ['Garra Umbría', 'Come Sueños', 'Puño Sombra'], dragon: ['Garra Dragón', 'Cometa Draco', 'Cola Dragón'],
  dark: ['Mordisco', 'Juego Sucio', 'Pulso Umbrío'], steel: ['Foco Resplandor', 'Garra Metal', 'Bola Acero'], fairy: ['Brillo Mágico', 'Beso Drenaje', 'Viento Feérico'],
};
const FALLBACK_MOVES = ['Placaje', 'Protección', 'Danza Espada', 'Descanso'];

const makeUid = () => crypto.randomBytes(4).toString('hex');
const isFixed = (p) => p.rarity === 'L' || p.rarity === 'M';

function movesFor(p) {
  const out = [];
  const add = (m) => { if (m && !out.includes(m) && out.length < 4) out.push(m); };
  for (const t of p.types) add(MOVES[t]);
  const pool = p.types.flatMap((t) => EXTRA[t] || []);
  while (out.length < 3 && pool.length) add(pool.splice(randInt(0, pool.length - 1), 1)[0]);
  add('Placaje');
  add('Protección');
  for (const m of FALLBACK_MOVES) add(m);
  return out;
}

function make(id, shiny = false) {
  const p = BY_ID.get(id);
  const m = {
    uid: makeUid(), nature: pick(NATURES).name, ivs: Array.from({ length: 6 }, () => randInt(0, 31)), level: 5, exp: 0, friendship: 70,
    gender: isFixed(p) ? null : (rand() < 0.5 ? 'M' : 'F'), ability: ABILITIES[p.types[0]] || GENERIC_ABILITY, moves: movesFor(p),
    nick: '', fav: false, shiny: !!shiny, at: Date.now(),
  };
  movesMod.ensure(id, m); // movimientos por nivel (aprendidos y equipados)
  return m;
}

function sanitizeNick(s) {
  const clean = String(s ?? '').replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').trim();
  return Array.from(clean).slice(0, 12).join('').trim();
}

const ivTotal = (m) => m.ivs.reduce((s, v) => s + v, 0);
// Valor ascendente: lo menos valioso primero.
const byValue = (a, b) => a.level - b.level || a.friendship - b.friendship || ivTotal(a) - ivTotal(b) || b.at - a.at;

function sync(u, id) {
  u.mons ||= {};
  const c = u.collection[id];
  const want = c && BY_ID.has(id) ? Math.max(0, c.n - (c.cn || 0)) : 0;
  if (!want) { delete u.mons[id]; return []; }
  const arr = (u.mons[id] ||= []);
  const buddyUid = u.buddy && u.buddy.id === id ? u.buddy.uid : null;
  const wantShiny = Math.min(c.s || 0, want);
  if (arr.length < want) {
    let need = wantShiny - arr.filter((m) => m.shiny).length;
    while (arr.length < want) { arr.push(make(id, need > 0)); need--; }
  }
  while (arr.length > want) {
    const rank = (m) => (m.drop ? -10 : 0) + (m.away ? 20 : 0) + (m.uid === buddyUid ? 4 : 0) + (m.fav ? 2 : 0);
    let worst = 0;
    for (let i = 1; i < arr.length; i++) {
      const d = rank(arr[i]) - rank(arr[worst]);
      if (d < 0 || (d === 0 && byValue(arr[i], arr[worst]) < 0)) worst = i;
    }
    arr.splice(worst, 1);
  }
  // Variocolores: se ajustan quitando/poniendo la marca a los menos valiosos (determinista).
  let have = arr.filter((m) => m.shiny).length;
  if (have !== wantShiny) {
    const asc = arr.slice().sort(byValue);
    if (have > wantShiny) for (const m of asc) { if (have > wantShiny && m.shiny) { m.shiny = false; have--; } }
    else for (const m of asc) { if (have < wantShiny && !m.shiny) { m.shiny = true; have++; } }
  }
  if (u.buddy && u.buddy.id === id && u.buddy.uid && !arr.some((m) => m.uid === u.buddy.uid)) delete u.buddy.uid;
  return arr;
}

function syncAll(u) {
  u.mons ||= {};
  for (const id of Object.keys(u.mons)) if (!u.collection[id]) delete u.mons[id];
  for (const id of Object.keys(u.collection)) sync(u, Number(id));
  return u.mons;
}

// Mejor ejemplar (por suma de IVs) con ese variocolor; el del compañero si lo es.
function bestFor(u, id, shiny) {
  const arr = sync(u, id);
  if (u.buddy && u.buddy.id === id && u.buddy.uid) {
    const b = arr.find((m) => m.uid === u.buddy.uid);
    if (b && b.shiny === !!shiny) return b;
  }
  return arr.filter((m) => m.shiny === !!shiny).sort((a, b) => ivTotal(b) - ivTotal(a))[0] || null;
}

// Naturaleza efectiva: la de la menta (si tiene) o la original, que sigue figurando (como en Espada/Escudo).
const natureOf = (m) => m.mint || m.nature;
function natureMult(natureName, i) {
  const n = NATURE_BY_NAME.get(natureName);
  if (!n) return 1;
  return n.up === i ? 1.1 : n.down === i ? 0.9 : 1;
}

// Estadísticas reales a nivel 50.
function computeStats(id, m, level = 50) {
  const b = BY_ID.get(id).stats;
  return b.map((base, i) => {
    const core = Math.floor(((2 * base + m.ivs[i]) * level) / 100);
    return i === 0 ? core + level + 10 : Math.floor((core + 5) * natureMult(natureOf(m), i));
  });
}

function boxView(u) {
  syncAll(u);
  const mons = [];
  for (const [id, arr] of Object.entries(u.mons)) {
    for (const m of arr) { movesMod.ensure(Number(id), m); abilities.resolve(Number(id), m); }
    for (const m of arr) mons.push({ id: Number(id), uid: m.uid, nature: m.nature, mint: m.mint || null, up: NATURE_BY_NAME.get(natureOf(m)).up, down: NATURE_BY_NAME.get(natureOf(m)).down, ivs: m.ivs, level: m.level, exp: m.exp, friendship: m.friendship, gender: m.gender, ability: abilities.name(m.sdAbility), ab: m.sdAbility, ha: !!m.ha, abOpts: abilities.optionsOf(Number(id)), item: m.item || null, eq: m.sdMoves, learned: m.learned, pending: m.pending, nick: m.nick, fav: m.fav, shiny: m.shiny, at: m.at, away: m.away || null, stats: computeStats(Number(id), m), buddy: !!(u.buddy && u.buddy.id === Number(id) && u.buddy.uid === m.uid) });
  }
  db.save();
  return { mons };
}

function find(u, { id, uid }) {
  id = Number(id);
  if (!Number.isInteger(id) || typeof uid !== 'string' || uid.length > 8) throw new Error('Pokémon no válido.');
  const m = sync(u, id).find((x) => x.uid === uid);
  if (!m) throw new Error('No tienes ese ejemplar.');
  return m;
}

function nick(u, p) {
  const m = find(u, p);
  m.nick = sanitizeNick(p.nick);
  db.save();
  return { nick: m.nick };
}

function fav(u, p) {
  const m = find(u, p);
  m.fav = !!p.fav;
  db.save();
  return { fav: m.fav };
}

// Ejemplares ocupados (expedición, criadero): `m.away = 'exp:<id>' | 'care'`. No se liberan, transfieren, venden,
// regalan, intercambian, evolucionan ni combaten mientras estén fuera.
const AWAY_MSG = 'está fuera (expedición o criadero): espera a que vuelva.';
function assertFree(m, name) { if (m && m.away) throw new Error(`${name || 'Ese Pokémon'} ${AWAY_MSG}`); }
// Cuántos ejemplares de la especie están ocupados (en total y variocolor).
function busyCount(u, id) {
  const arr = u.mons && u.mons[id];
  if (!arr) return { total: 0, shiny: 0 };
  let total = 0; let shiny = 0;
  for (const m of arr) if (m.away) { total++; if (m.shiny) shiny++; }
  return { total, shiny };
}

function release(u, p) {
  const gacha = require('./gacha');
  const m = find(u, p);
  assertFree(m, BY_ID.get(Number(p.id)).name);
  const id = Number(p.id);
  const c = u.collection[id];
  const sBefore = c.s || 0;
  m.drop = true;
  let res;
  try { res = gacha.release(u, { id, count: 1 }); } catch (e) { delete m.drop; throw e; }
  if (m.shiny) c.s = Math.max(0, sBefore - 1);
  const arr = sync(u, id);
  for (const x of arr) delete x.drop;
  if (u.buddy && u.buddy.id === id && u.buddy.shiny && !c.s) u.buddy.shiny = false;
  db.save();
  return res;
}

module.exports = { NATURES, STAT_KEYS, ABILITIES, GENERIC_ABILITY, isFixed, movesFor, make, sanitizeNick, sync, syncAll, bestFor, computeStats, natureMult, natureOf, ivTotal, boxView, find, nick, fav, release, assertFree, busyCount };
