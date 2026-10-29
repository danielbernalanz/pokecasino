'use strict';
// Máquina MT (como en Escarlata/Púrpura): las MT se fabrican con monedas y materiales, se gastan al usarlas y se pueden
// comerciar en el Mercado. Los materiales caen en Expediciones y combates contra la CPU, con topes diarios; algunas MT
// salen también como premio raro. Nada de esto crea monedas: fabricar cuesta monedas (motivo `tm_craft`) y los PNJ no
// compran MT ni materiales (ver npc.js), así que fabricar → vender nunca da más de lo que cuesta.
const db = require('./db');
const hub = require('./hub');
const items = require('./items');
const moves = require('./moves');
const tmdata = require('./tmdata');
const { BY_ID } = require('./pokedex');
const { rand, pick } = require('./rng');

const MAX_CRAFT_QTY = 10;
// Topes diarios de botín (por jugador y día).
const CAPS = { expMats: 12, batMats: 15, expTm: 1, batTm: 1 };
// MT como premio: probabilidad por reclamación / victoria y nivel máximo que puede tocar.
const EXP_TM_CHANCE = { 8: 0.04, 12: 0.08 };
const BATTLE_TM_CHANCE = { 5: 0.2, 6: 0.35 };
const TIER_RANK = { basic: 0, good: 1, strong: 2, top: 3, apex: 4 };
const EXP_TM_MAX = 'strong';
const BATTLE_TM_MAX = { 5: 'strong', 6: 'top' };
// Materiales por reclamación de expedición (horas → unidades) y por victoria (según fuerza del rival).
const EXP_MATS = { 1: 1, 4: 2, 8: 4, 12: 6 };
const BATTLE_MATS = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 2, 6: 3 };

const day = (u) => {
  const k = hub.dayKey();
  if (!u.tmDay || u.tmDay.day !== k) u.tmDay = { day: k, expMats: 0, batMats: 0, expTm: 0, batTm: 0 };
  return u.tmDay;
};

// ---- Fabricar ----
function craft(u, p) {
  const t = tmdata.TM_BY_MOVE.get(moves.toID(p.move));
  if (!t) throw new Error('Esa MT no existe.');
  const qty = p.qty === undefined ? 1 : Number(p.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_CRAFT_QTY) throw new Error('Cantidad no válida.');
  if (u.npc) throw new Error('Los comerciantes NPC no fabrican MT.');
  const coins = t.coins * qty;
  const need = t.matN * qty;
  const have = u.items[t.mat] || 0;
  if (have < need) throw new Error(`Faltan materiales: ${need} × ${tmdata.MATERIALS[t.mat].name} (tienes ${have}).`);
  if (u.coins < coins) throw new Error(`Necesitas ${coins} monedas.`);
  items.take(u, t.mat, need);
  u.coins -= coins;
  hub.ledger(u, -coins, 'tm_craft', `${qty} × ${t.name}`);
  items.give(u, t.id, qty);
  hub.track(u, 'tm_craft', { move: t.move, qty });
  db.save();
  return { id: t.id, move: t.move, qty, coins, mat: t.mat, matN: need };
}

// ---- Usar ----
function useTm(u, p) {
  const specimen = require('./specimen');
  const itemId = String(p.itemId);
  const it = items.ITEMS[itemId];
  if (!it || !it.tm) throw new Error('Eso no es una MT.');
  if (!(u.items[itemId] > 0)) throw new Error('No tienes esa MT.');
  const id = Number(p.id);
  const m = specimen.find(u, { id, uid: p.uid });
  moves.ensure(id, m);
  if (!moves.tmCompat(id, it.tm)) throw new Error(`${BY_ID.get(id).name} no puede aprender ${moves.name(it.tm)}.`);
  if (m.learned.includes(it.tm)) throw new Error(`${m.nick || BY_ID.get(id).name} ya conoce ${moves.name(it.tm)}.`);
  items.take(u, itemId, 1);
  const how = moves.teach(id, m, it.tm);
  hub.track(u, 'tm_use', { move: it.tm });
  db.save();
  return { move: it.tm, how, eq: m.sdMoves, learned: m.learned, left: u.items[itemId] || 0 };
}

// Especímenes del jugador que pueden aprender esa MT (con `known` si ya la conocen).
function targets(u, p) {
  const specimen = require('./specimen');
  const it = items.ITEMS[String(p.itemId)];
  if (!it || !it.tm) throw new Error('Eso no es una MT.');
  specimen.syncAll(u);
  const out = [];
  for (const [id, arr] of Object.entries(u.mons || {})) {
    if (!moves.tmCompat(Number(id), it.tm)) continue;
    for (const m of arr) { moves.ensure(Number(id), m); out.push({ id: Number(id), uid: m.uid, known: m.learned.includes(it.tm) }); }
  }
  return { move: it.tm, targets: out };
}
// MT (de las que tiene el jugador) que ese ejemplar puede aprender ahora.
function owned(u, p) {
  const specimen = require('./specimen');
  const id = Number(p.id);
  const m = specimen.find(u, { id, uid: p.uid });
  moves.ensure(id, m);
  const out = [];
  for (const [itemId, n] of Object.entries(u.items)) {
    const it = items.ITEMS[itemId];
    if (n > 0 && it && it.tm && moves.tmCompat(id, it.tm)) out.push({ itemId, qty: n, known: m.learned.includes(it.tm) });
  }
  return { tms: out };
}
// MT que una especie puede aprender (para el filtro «compatible con…» de la Máquina MT).
function compat(u, p) {
  const id = Number(p.id);
  if (!BY_ID.has(id)) throw new Error('Pokémon no válido.');
  return { moves: tmdata.TMS.filter((t) => moves.tmCompat(id, t.move)).map((t) => t.move) };
}

// ---- Botín: materiales y MT como premio ----
function dropMaterials(u, types, n, kind) {
  const d = day(u);
  const key = kind === 'exp' ? 'expMats' : 'batMats';
  const out = {};
  const pool = [...new Set(types.map((t) => tmdata.MAT_OF_TYPE[t]).filter(Boolean))];
  if (!pool.length) return out;
  for (let i = 0; i < n && d[key] < CAPS[key]; i++) {
    const mat = pick(pool);
    items.give(u, mat, 1);
    d[key]++;
    out[mat] = (out[mat] || 0) + 1;
  }
  return out;
}
// Con probabilidad `chance` (y tope diario) da una MT al azar del tipo de `types` y de nivel ≤ `maxTier`.
function dropTm(u, types, chance, maxTier, kind) {
  const d = day(u);
  const key = kind === 'exp' ? 'expTm' : 'batTm';
  if (d[key] >= CAPS[key] || !(rand() < chance)) return null;
  let pool = tmdata.TMS.filter((t) => TIER_RANK[t.tier] <= TIER_RANK[maxTier] && types.includes(t.type));
  if (!pool.length) pool = tmdata.TMS.filter((t) => TIER_RANK[t.tier] <= TIER_RANK[maxTier]);
  const t = pick(pool);
  items.give(u, t.id, 1);
  d[key]++;
  return t.id;
}

// Premio de una expedición.
function expeditionLoot(u, zone, hours) {
  const out = { mats: dropMaterials(u, zone.types, EXP_MATS[hours] || 1, 'exp'), tm: null };
  if (EXP_TM_CHANCE[hours]) out.tm = dropTm(u, zone.types, EXP_TM_CHANCE[hours], EXP_TM_MAX, 'exp');
  return out;
}
// Premio de una victoria contra la CPU: materiales de los tipos de los Pokémon rivales y, contra líderes, a veces una MT.
function battleLoot(u, trainer, foeIds) {
  const types = [...new Set(foeIds.flatMap((id) => (BY_ID.get(id) ? BY_ID.get(id).types : [])))];
  const out = { mats: {}, tm: null };
  if (types.length) {
    // Los materiales salen de los tipos de UNO o DOS de los rivales derrotados (no de todos a la vez).
    const n = BATTLE_MATS[trainer.tier] || 1;
    for (let i = 0; i < n; i++) for (const [k, v] of Object.entries(dropMaterials(u, [pick(types)], 1, 'bat'))) out.mats[k] = (out.mats[k] || 0) + v;
  }
  if (BATTLE_TM_CHANCE[trainer.tier]) out.tm = dropTm(u, trainer.types && trainer.types.length ? trainer.types : types, BATTLE_TM_CHANCE[trainer.tier], BATTLE_TM_MAX[trainer.tier], 'bat');
  return out;
}

module.exports = { MAX_CRAFT_QTY, CAPS, EXP_TM_CHANCE, BATTLE_TM_CHANCE, EXP_MATS, BATTLE_MATS, craft, useTm, targets, owned, compat, dropMaterials, dropTm, expeditionLoot, battleLoot, day };
