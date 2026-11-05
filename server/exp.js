'use strict';
// Experiencia (EXP) como en los juegos de la serie principal. Cada ejemplar tiene `exp` y su nivel sale de su GRUPO de
// experiencia real (Rápido, Medio rápido, Medio lento, Lento, Errático, Fluctuante; ver scripts/build-exp.js y expdata.json).
//   · Combates contra la CPU: fórmula escalada de 5.ª generación (EXP base de la especie rival × nivel rival ÷ participantes ×
//     ((2N+10)/(N+n+10))^2,5 + 1, ×1,5 si es entrenador). Se aplica a todos los participantes al terminar el combate.
//   · Expediciones: EXP por hora y participante.
//   · Caramelos Exp. (XS 100 · S 800 · M 3.000 · L 10.000 · XL 30.000): objetos de botín, nunca a la venta por monedas.
//   · Huevo Suerte (objeto equipado): ×1,5 a la EXP de combates y expediciones (no a los caramelos, como en los juegos).
// Las fuentes de combate y expedición tienen un TOPE DIARIO por ejemplar (`dayCap`): así evolucionar no se convierte en una máquina
// de polvo (ver docs/BALANCE.md, «Progresión como en los juegos»). Los Caramelos Exp. no tienen tope propio: el tope está en
// cómo se consiguen (límites diarios en cada fuente) y no se pueden comprar con monedas.
const db = require('./db');
const hub = require('./hub');
const DATA = require('./expdata.json');

const MAX_LEVEL = 100;
const LEVELS_CAP = 5; // niveles que puede ganar un ejemplar al día con combates y expediciones (a niveles medios)
const CAP_MIN = 24000; // EXP mínima al día (los niveles bajos suben muy deprisa; ver dayCap)
const LUCKY_EGG = 1.5;
const GROUP_NAMES = { 1: 'Lento', 2: 'Medio rápido', 3: 'Rápido', 4: 'Medio lento', 5: 'Errático', 6: 'Fluctuante' };
// [id del objeto, etiqueta, EXP, sprite de PokeAPI]
const CANDIES = [
  ['exp-xs', 'XS', 100, 'exp-candy-xs'], ['exp-s', 'S', 800, 'exp-candy-s'], ['exp-m', 'M', 3000, 'exp-candy-m'],
  ['exp-l', 'L', 10000, 'exp-candy-l'], ['exp-xl', 'XL', 30000, 'exp-candy-xl'],
];
// Precio en Puntos de Batalla (Tienda de Combate): 100 EXP por PB, así que con el tope de 90 PB al día son ≤ 9.000 EXP al día. Nunca con monedas.
const CANDY_BP = { 'exp-s': 8, 'exp-m': 30, 'exp-l': 100 };
const CANDY_EXP = Object.assign(Object.create(null), Object.fromEntries(CANDIES.map(([id, , exp]) => [id, exp])));
const CANDY_IDS = CANDIES.map((x) => x[0]);

// Entradas de `items.ITEMS` (sin precio en monedas: no se compran ni se reciclan ni los compra ningún PNJ).
function buildItems() {
  const out = {};
  for (const [id, tag, exp, sprite] of CANDIES) {
    out[id] = { name: `Caramelo Exp. ${tag}`, sprite, price: null, bp: CANDY_BP[id], expCandy: exp, cat: 'expcandy',
      desc: `Da ${exp.toLocaleString('es-ES')} EXP a un Pokémon (sin tope diario). Se usa en Caja PC → Datos → Entrenar o desde la Mochila. Cae de combates, expediciones, Torre, Liga, tiradas y transferencias${CANDY_BP[id] ? `; también se compra con Puntos de Batalla (${CANDY_BP[id]} PB)` : ''}.` };
  }
  return out;
}

const entry = (id) => DATA.sp[Number(id)] || [2, 100];
const groupOf = (id) => entry(id)[0];
const baseExp = (id) => entry(id)[1];
const table = (id) => DATA.table[entry(id)[0]];
// EXP total necesaria para estar en el nivel `level` (1..100).
const expAt = (id, level) => table(id)[Math.max(1, Math.min(MAX_LEVEL, level)) - 1];
function levelAt(id, exp) {
  const t = table(id);
  let lo = 1;
  let hi = MAX_LEVEL;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (t[mid - 1] <= exp) lo = mid; else hi = mid - 1; }
  return lo;
}
// EXP que falta para el siguiente nivel (0 en el 100).
const toNext = (id, m) => (m.level >= MAX_LEVEL ? 0 : expAt(id, m.level + 1) - Math.max(m.exp || 0, expAt(id, m.level)));

// Los ejemplares anteriores a este sistema tienen `exp: 0`: su EXP es la de su nivel. Mantiene `exp` y `level` coherentes.
function ensure(id, m) {
  m.level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(m.level) || 5));
  const floor = expAt(id, m.level);
  if (!Number.isFinite(m.exp) || m.exp < floor) m.exp = floor;
  return m;
}

// EXP de un rival derrotado (fórmula escalada de 5.ª generación en adelante). `foeLevel` y `myLevel` son niveles reales.
function foeExp(foeId, foeLevel, myLevel, participants = 1, trainer = true) {
  const Lf = Math.max(1, foeLevel);
  const Lp = Math.max(1, myLevel);
  const s = Math.max(1, participants);
  const ratio = Math.pow((2 * Lf + 10) / (Lf + Lp + 10), 2.5);
  return Math.max(1, Math.floor(((baseExp(foeId) * Lf) / (5 * s) * ratio + 1) * (trainer ? 1.5 : 1)));
}

// ---- Tope diario por ejemplar (combates + expediciones) ----
// Equivale a subir `LEVELS_CAP` niveles desde el nivel con el que empezó el día (mínimo `CAP_MIN`): a niveles bajos son muchos niveles
// (como subir a un Pokémon flojo en los juegos) y a niveles altos son ≈ 5 por día.
function dayState(id, m) {
  const k = hub.dayKey();
  if (!m.xc || m.xc.day !== k) m.xc = { day: k, lv: m.level, n: 0 };
  return m.xc;
}
function dayCap(id, m) {
  const x = dayState(id, m);
  return Math.max(CAP_MIN, expAt(id, Math.min(MAX_LEVEL, x.lv + LEVELS_CAP)) - expAt(id, x.lv));
}
const capLeft = (id, m) => { ensure(id, m); return Math.max(0, dayCap(id, m) - dayState(id, m).n); };
const hasLuckyEgg = (m) => m.item === 'luckyegg';

// Suma `amount` de EXP a un ejemplar. kind: 'battle' | 'exp' (expedición): con tope diario y Huevo Suerte · 'item': caramelos, sin tope.
// Devuelve { exp, from, to, learned, pending, evo } (evo: evoluciones disponibles tras subir de nivel; ver candy.evoOptions).
function award(u, id, m, amount, kind = 'battle') {
  id = Number(id);
  ensure(id, m);
  amount = Math.max(0, Math.floor(amount) || 0);
  if (kind !== 'item') {
    if (hasLuckyEgg(m)) amount = Math.floor(amount * LUCKY_EGG);
    amount = Math.min(amount, capLeft(id, m));
    dayState(id, m).n += amount;
  }
  const from = m.level;
  const max = expAt(id, MAX_LEVEL);
  const gained = Math.max(0, Math.min(amount, max - m.exp));
  m.exp += gained;
  m.level = levelAt(id, m.exp);
  const out = { exp: gained, from, to: m.level, learned: [], pending: [], evo: [] };
  if (m.level > from) {
    const mv = require('./moves').onLevel(id, m, from, m.level);
    out.learned = mv.auto; out.pending = mv.pending;
    out.evo = require('./candy').evoOptions(u, m, id);
  }
  return out;
}

// ---- Usar Caramelos Exp. ----
// Usa `qty` caramelos de `itemId` (o los necesarios hasta el nivel 100). El último puede pasarse un poco: no se pierde nada de lo que quede en la mochila.
function useCandy(u, p) {
  const items = require('./items');
  const specimen = require('./specimen');
  const itemId = String(p.itemId);
  const exp = CANDY_EXP[itemId];
  if (!exp) throw new Error('Ese objeto no da EXP.');
  const qty = p.qty === undefined ? 1 : Number(p.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 9999) throw new Error('Cantidad no válida.');
  if (!(u.items[itemId] > 0)) throw new Error(`No tienes ${items.ITEMS[itemId].name}.`);
  const id = Number(p.id);
  const m = specimen.find(u, p);
  specimen.assertFree(m, require('./pokedex').BY_ID.get(id).name);
  ensure(id, m);
  if (m.level >= MAX_LEVEL) throw new Error('Ya está al nivel máximo (100).');
  const max = expAt(id, MAX_LEVEL);
  const need = Math.ceil((max - m.exp) / exp);
  const used = Math.min(qty, need, u.items[itemId]);
  const r = award(u, id, m, used * exp, 'item');
  items.take(u, itemId, used);
  hub.track(u, 'item_use', { itemId });
  db.save();
  return { used, ...r, level: m.level, expNow: m.exp, next: toNext(id, m) };
}

// ---- Botín de Caramelos Exp. de los combates contra la CPU ----
// Una tirada por victoria según la fuerza del rival: [XS, S, M, L] en %. Tope diario de EXP en caramelos (`BATTLE_DROP_DAY`).
const BATTLE_DROP = { 1: [30, 5, 0, 0], 2: [30, 8, 1, 0], 3: [25, 12, 3, 0], 4: [20, 15, 5, 1], 5: [10, 25, 10, 2], 6: [0, 25, 15, 4] };
const BATTLE_DROP_DAY = 12000;
function battleDrop(d, tier, rand) {
  const t = BATTLE_DROP[tier] || BATTLE_DROP[1];
  const r = rand() * 100;
  let acc = 0;
  let it = null;
  for (let i = 0; i < 4; i++) { acc += t[i]; if (r < acc) { it = CANDY_IDS[i]; break; } }
  if (!it || (d.cexp || 0) + CANDY_EXP[it] > BATTLE_DROP_DAY) return null;
  d.cexp = (d.cexp || 0) + CANDY_EXP[it];
  return it;
}

// ---- Migración: caramelos de familia y comodín → Caramelos Exp. ----
// Valor justo de un caramelo antes: con el coste de subir nivel ⌈N/50⌉ caramelos de N a N+1, 5 → 100 costaba 144 caramelos y daba toda la EXP de ese tramo
// en el grupo de la familia. Un caramelo = EXP(5→100) / 144, redondeado hacia arriba. El comodín usa la media de los seis grupos (ponderada por especies).
const OLD_LEVEL_DIV = 50;
const OLD_CANDIES_5_100 = (() => { let n = 0; for (let l = 5; l < MAX_LEVEL; l++) n += Math.ceil(l / OLD_LEVEL_DIV); return n; })(); // 144
const perCandy = (group) => Math.ceil((DATA.table[group][MAX_LEVEL - 1] - DATA.table[group][4]) / OLD_CANDIES_5_100);
let WILD_VALUE = null;
function wildValue() {
  if (WILD_VALUE) return WILD_VALUE;
  const cnt = {};
  for (const [g] of Object.values(DATA.sp)) cnt[g] = (cnt[g] || 0) + 1;
  const tot = Object.values(cnt).reduce((a, b) => a + b, 0);
  WILD_VALUE = Math.ceil(Object.entries(cnt).reduce((s, [g, n]) => s + (n / tot) * (DATA.table[g][MAX_LEVEL - 1] - DATA.table[g][4]) / OLD_CANDIES_5_100, 0));
  return WILD_VALUE;
}
// EXP total en Caramelos Exp. (voraz: XL, L, M, S y XS, el resto redondeado hacia arriba al XS).
function candiesFor(totalExp) {
  let left = Math.ceil(totalExp / CANDIES[0][2]) * CANDIES[0][2];
  const out = {};
  for (const [id, , exp] of CANDIES.slice().reverse()) { const n = Math.floor(left / exp); if (n) { out[id] = n; left -= n * exp; } }
  return out;
}
// Una sola vez por cuenta (`u.expMig`). Devuelve un resumen o null si no había nada que convertir / ya estaba hecha.
function migrate(u) {
  if (!u || u.expMig) return null;
  u.expMig = Date.now();
  const candy = u.candy;
  if (!candy || !Object.keys(candy).length) { delete u.candy; return null; }
  const { BY_CHAIN } = chainGroups();
  let total = 0;
  let n = 0;
  for (const [k, v] of Object.entries(candy)) {
    if (!(v > 0)) continue;
    n += v;
    total += v * (k === '*' ? wildValue() : perCandy(BY_CHAIN.get(Number(k)) || 2));
  }
  const give = candiesFor(total);
  u.items ||= {};
  for (const [id, q] of Object.entries(give)) u.items[id] = (u.items[id] || 0) + q;
  u.candyOld = { n, exp: total, at: u.expMig, map: candy }; // constancia de lo convertido (por si hubiera que revertir): los caramelos viejos desaparecen del jugador
  delete u.candy;
  return { candies: n, exp: total, items: give };
}
let CHAINS = null;
function chainGroups() {
  if (CHAINS) return CHAINS;
  const { DEX } = require('./pokedex');
  const BY_CHAIN = new Map();
  for (const p of DEX) if (!p.evolvesFrom && !BY_CHAIN.has(p.chain)) BY_CHAIN.set(p.chain, groupOf(p.id));
  CHAINS = { BY_CHAIN };
  return CHAINS;
}
function migrateAll() {
  let users = 0;
  let candies = 0;
  for (const u of Object.values(db.data.users)) { const r = migrate(u); if (r) { users++; candies += r.candies; } }
  return { users, candies };
}

const STATIC = { levelsCap: LEVELS_CAP, capMin: CAP_MIN, lucky: LUCKY_EGG, candies: CANDIES.map(([id, tag, exp]) => ({ id, tag, exp })), maxLevel: MAX_LEVEL };

module.exports = {
  MAX_LEVEL, LEVELS_CAP, CAP_MIN, LUCKY_EGG, GROUP_NAMES, CANDIES, CANDY_BP, CANDY_EXP, CANDY_IDS, STATIC, DATA, buildItems, groupOf, baseExp, expAt, levelAt, toNext, ensure, foeExp,
  dayCap, capLeft, hasLuckyEgg, award, BATTLE_DROP, BATTLE_DROP_DAY, battleDrop, useCandy, perCandy, wildValue, candiesFor, migrate, migrateAll, OLD_CANDIES_5_100,
};
