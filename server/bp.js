'use strict';
// Puntos de Batalla (PB) y Tienda de Combate, como la Torre Batalla de los juegos.
//  - Los PB (`u.bp`) solo se ganan COMBATIENDO: victorias contra la CPU (1–3 según el rival, tope 30/día) y combates PvP
//    (ganar 3, perder 1, tope 20/día, mínimo 3 turnos y ≤ 3 combates con PB contra el mismo rival al día).
//  - No se pueden regalar, vender ni cambiar por monedas: no hay ninguna operación que los lea fuera de esta tienda.
//  - Se gastan en objetos equipables (uno por Pokémon), mentas, Cápsula y Parche de Habilidad, que son objetos normales de la
//    mochila (comerciables entre jugadores, nunca con los PNJ: ver npc.js).
const db = require('./db');
const hub = require('./hub');
const items = require('./items');
const abilities = require('./abilities');
const bpdata = require('./bpdata');
const { BY_ID } = require('./pokedex');

const HELD_IDS = new Set([...bpdata.HELD.map((x) => x[0]), ...Object.values(bpdata.BERRY_HOLD)]);
const holdable = (id) => !!id && HELD_IDS.has(id);

const day = (u) => {
  const k = hub.dayKey();
  if (!u.bpDay || u.bpDay.day !== k) u.bpDay = { day: k, cpu: 0, pvp: 0, vs: {} };
  return u.bpDay;
};
const balance = (u) => Math.max(0, Math.floor(u.bp || 0));

// Da PB respetando el tope diario de su origen ('cpu' | 'pvp'). Devuelve los concedidos.
function award(u, kind, amount, opponentId) {
  if (!u || u.npc || !(amount > 0)) return 0;
  const d = day(u);
  if (kind === 'pvp' && opponentId) {
    d.vs[opponentId] = d.vs[opponentId] || 0;
    if (d.vs[opponentId] >= bpdata.PVP_PER_OPPONENT) return 0;
  }
  const room = bpdata.CAPS[kind] - d[kind];
  const got = Math.max(0, Math.min(amount, room));
  if (!got) return 0;
  d[kind] += got;
  if (kind === 'pvp' && opponentId) d.vs[opponentId]++;
  u.bp = balance(u) + got;
  db.save();
  return got;
}
const cpuWin = (u, tier) => award(u, 'cpu', bpdata.CPU_BP[tier] || 1);
function pvp(u, won, opponentId, turns) {
  if (turns < bpdata.PVP_MIN_TURNS) return 0;
  return award(u, 'pvp', won ? bpdata.PVP_WIN : bpdata.PVP_LOSS, opponentId);
}

function state(u) {
  const d = day(u);
  return { bp: balance(u), caps: bpdata.CAPS, today: { cpu: d.cpu, pvp: d.pvp } };
}

// ---- Tienda ----
function buy(u, p) {
  const id = String(p.itemId);
  const it = items.ITEMS[id];
  if (!it || !it.bp) throw new Error('Eso no se vende en la Tienda de Combate.');
  const qty = p.qty === undefined ? 1 : Number(p.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error('Cantidad no válida.');
  if (u.npc) throw new Error('Los comerciantes NPC no usan la Tienda de Combate.');
  const cost = it.bp * qty;
  if (balance(u) < cost) throw new Error(`Necesitas ${cost} PB (tienes ${balance(u)}).`);
  u.bp = balance(u) - cost;
  items.give(u, id, qty);
  hub.track(u, 'bp_buy', { itemId: id });
  db.save();
  return { itemId: id, qty, cost, bp: u.bp };
}

// ---- Objetos equipados ----
// Fuente de cada objeto equipable: la mochila (`hi-<id>`) o el almacén de bayas.
const HELD_SRC = {};
for (const [hold] of bpdata.HELD) HELD_SRC[hold] = { inv: 'items', key: 'hi-' + hold };
for (const [berry, hold] of Object.entries(bpdata.BERRY_HOLD)) HELD_SRC[hold] = { inv: 'berries', key: berry };
const nameOfHeld = (hold) => (HELD_SRC[hold] ? (HELD_SRC[hold].inv === 'items' ? items.ITEMS[HELD_SRC[hold].key] : items.BERRIES[HELD_SRC[hold].key]).name : hold);

function giveBack(u, hold) {
  const s = HELD_SRC[hold];
  if (!s) return;
  if (s.inv === 'items') items.give(u, s.key, 1); else require('./bond').giveBerry(u, s.key, 1);
}
function takeFrom(u, hold) {
  const s = HELD_SRC[hold];
  if (s.inv === 'items') items.take(u, s.key, 1); else require('./bond').takeBerry(u, s.key, 1);
}
// `pc:item`: equipa `item` (id de Showdown) o quita el objeto (vacío). El anterior vuelve a la mochila.
function hold(u, p) {
  const specimen = require('./specimen');
  const m = specimen.find(u, p);
  const want = p.item ? String(p.item) : '';
  if (want && !holdable(want)) throw new Error('Ese objeto no se puede llevar.');
  if (want === (m.item || '')) return { item: m.item || null };
  if (want) {
    const s = HELD_SRC[want];
    if (s.inv === 'items' ? !(u.items[s.key] > 0) : !((u.berries || {})[s.key] > 0)) throw new Error(`No tienes ${nameOfHeld(want)}.`);
  }
  const old = m.item || '';
  if (want) takeFrom(u, want);
  if (old) giveBack(u, old);
  if (want) m.item = want; else delete m.item;
  db.save();
  return { item: m.item || null };
}

// ---- Mentas, Cápsula y Parche ----
// `pc:use`: usa un objeto de la mochila sobre un ejemplar.
function useOn(u, p) {
  const specimen = require('./specimen');
  const itemId = String(p.itemId);
  const it = items.ITEMS[itemId];
  if (!it || !(it.mint || it.capsule || it.patch)) throw new Error('Ese objeto no se usa así.');
  if (!(u.items[itemId] > 0)) throw new Error('No tienes ese objeto.');
  const id = Number(p.id);
  const m = specimen.find(u, p);
  let result;
  if (it.mint) {
    if (specimen.natureOf(m) === it.mint) throw new Error(`${m.nick || BY_ID.get(id).name} ya tiene el efecto de la naturaleza ${it.mint}.`);
    items.take(u, itemId, 1);
    m.mint = it.mint === m.nature ? undefined : it.mint; // volver a la propia naturaleza quita la menta
    if (m.mint === undefined) delete m.mint;
    result = { nature: m.nature, mint: m.mint || null };
  } else if (it.capsule) {
    const before = m.sdAbility;
    const ab = abilities.applyCapsule(id, m); // lanza error sin gastar nada si no procede
    items.take(u, itemId, 1);
    result = { ability: ab, name: abilities.name(ab), was: before };
  } else {
    const ab = abilities.applyPatch(id, m);
    items.take(u, itemId, 1);
    result = { ability: ab, name: abilities.name(ab) };
  }
  hub.track(u, 'item_use', { itemId });
  db.save();
  return result;
}

module.exports = { HELD_IDS, holdable, HELD_SRC, nameOfHeld, day, award, cpuWin, pvp, state, buy, hold, useOn, balance };
