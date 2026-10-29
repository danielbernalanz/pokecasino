'use strict';
// Fase B2 «Repetidos y reciclaje»: caramelos por familia evolutiva, subir nivel, evolucionar, entrenar IVs,
// Intercambio Milagroso y máquina de reciclaje. Nada de esto crea monedas: los caramelos no se pueden vender
// y el polvo que da cada acción es el mismo que ya daba liberar (o menos).
const db = require('./db');
const hub = require('./hub');
const gacha = require('./gacha');
const specimen = require('./specimen');
const moves = require('./moves');
const items = require('./items');
const { DEX, BY_ID, RARITY } = require('./pokedex');
const { weighted } = require('./rng');

// Caramelos que da transferir un ejemplar al Profesor Oak (además del polvo de liberar).
const TRANSFER_CANDY = { C: 3, U: 4, R: 6, E: 10, L: 20, M: 25 };
const PULL_CANDY = 2; // por tirada de gacha (de la familia del Pokémon obtenido)
const PULL_NEW_CANDY = 5; // si la especie es nueva
// Progresión casual: además hay «caramelos comodín» (WILD): sirven para cualquier familia (primero se gastan los de la
// familia y luego los comodín). Los da cada tirada y cada ejemplar transferido. Sin valor en monedas ni polvo.
const WILD = '*';
const WILD_PULL = 5;
const WILD_TRANSFER = { C: 2, U: 3, R: 4, E: 6, L: 12, M: 15 };
const CANDY_CAP = 99999;

const MIN_LEVEL = 5;
const MAX_LEVEL = 100;
const LEVEL_DIV = 50;
const levelCost = (level) => Math.ceil(level / LEVEL_DIV); // de `level` a `level + 1`: 5 → 100 = 144 caramelos

// Evolución: coste base por fase de destino. Sin nivel mínimo (casual). Si la evolución sube la rareza, el coste de una
// evolución «repetida» (el destino ya está en la colección y se puede liberar) crece para que el polvo extra al liberar
// el resultado nunca supere 0,5 por caramelo (transferir da ≥ 1,67 de polvo por caramelo).
// La PRIMERA evolución a una especie que aún no tienes («registro de Pokédex») cuesta solo el coste base y no gasta la
// copia de origen: el ejemplar evoluciona y la especie origen conserva su entrada. Esa copia nueva es la última de su
// especie (no se puede liberar ni vender), así que no crea valor en polvo ni monedas.
const EVO = { 2: { cost: 8, level: 0 }, 3: { cost: 18, level: 0 } };
const EVO_GAIN_PER_CANDY = 0.5;
const FIXED_MULT = 4; // legendarios y míticos: ×4

const TRAIN_COST = 1;
const TRAIN_DAILY = 60;
const WONDER_DAILY = 5;
const RECYCLE_RATE = 0.4; // del precio de tienda
const RECYCLE_DAILY_DUST = 300;

const chainOf = (id) => BY_ID.get(id).chain;
// Nombre de la familia: el de su forma más básica (chain es un id de cadena evolutiva de PokeAPI, no de especie).
const FAMILY_NAME = new Map();
for (const p of DEX) if (!p.evolvesFrom && !FAMILY_NAME.has(p.chain)) FAMILY_NAME.set(p.chain, p.name);
const familyName = (id) => FAMILY_NAME.get(chainOf(id)) || BY_ID.get(id).name;
const familyOf = (u, id) => (u.candy && u.candy[chainOf(id)]) || 0;
const wildOf = (u) => (u.candy && u.candy[WILD]) || 0;
// Caramelos disponibles para un Pokémon: los de su familia más los comodín.
const candyOf = (u, id) => familyOf(u, id) + wildOf(u);

function addCandy(u, id, n) {
  if (!(n > 0)) return 0;
  u.candy ||= {};
  const k = chainOf(id);
  u.candy[k] = Math.min(CANDY_CAP, (u.candy[k] || 0) + n);
  return n;
}
function addWild(u, n) {
  if (!(n > 0)) return 0;
  u.candy ||= {};
  u.candy[WILD] = Math.min(CANDY_CAP, (u.candy[WILD] || 0) + n);
  return n;
}
function takeCandy(u, id, n) {
  if (candyOf(u, id) < n) throw new Error(`Necesitas ${n} caramelos de ${familyName(id)} (tienes ${candyOf(u, id)}).`);
  const k = chainOf(id);
  const fam = Math.min(n, familyOf(u, id));
  if (fam) { u.candy[k] -= fam; if (!u.candy[k]) delete u.candy[k]; }
  if (n > fam) { u.candy[WILD] -= n - fam; if (!u.candy[WILD]) delete u.candy[WILD]; }
}

// Se llama desde el gacha por cada Pokémon obtenido. Devuelve el total de caramelos (familia + comodín).
function onPull(u, id, isNew) {
  return addCandy(u, id, isNew ? PULL_NEW_CANDY : PULL_CANDY) + addWild(u, WILD_PULL);
}

function day(u) {
  const k = hub.dayKey();
  if (!u.candyDay || u.candyDay.day !== k) u.candyDay = { day: k, wonder: 0, recycle: 0 };
  return u.candyDay;
}

// ---- Evolución ----
const evolutionsOf = (id) => DEX.filter((p) => p.evolvesFrom === id);
// `friend`: evolución por amistad (≥ 220): sin nivel mínimo y con la mitad del coste base. El suelo por subida de
// rareza se mantiene, así que el polvo ganado por caramelo nunca supera 1,5 (sin arbitraje).
// `first`: primera evolución a esa especie (sin suelo por subida de rareza: la copia resultante no se puede liberar).
function evoCost(fromId, toId, friend = false, first = false) {
  const from = BY_ID.get(fromId);
  const to = BY_ID.get(toId);
  const base = EVO[to.stage >= 3 ? 3 : 2];
  const gain = first ? 0 : Math.max(0, RARITY[to.rarity].dust - RARITY[from.rarity].dust);
  let cost = Math.max(friend ? Math.ceil(base.cost / 2) : base.cost, Math.ceil(gain / EVO_GAIN_PER_CANDY));
  if (to.rarity === 'L' || to.rarity === 'M') cost *= FIXED_MULT;
  return { cost, level: friend ? 0 : base.level };
}

// ---- Transferir ----
function transfer(u, p) {
  const m = specimen.find(u, p);
  const id = Number(p.id);
  const rarity = BY_ID.get(id).rarity;
  const res = specimen.release(u, p);
  const candy = addCandy(u, id, TRANSFER_CANDY[rarity]) + addWild(u, WILD_TRANSFER[rarity]);
  db.save();
  return { ...res, candy, name: m.nick || BY_ID.get(id).name };
}

// Copias sobrantes que se transferirían en bloque: ni favoritas, ni compañero, ni variocolor; se conserva la mejor.
function bulkPlan(u, id) {
  id = Number(id);
  if (!BY_ID.has(id) || !u.collection[id]) throw new Error('Pokémon no válido.');
  const arr = specimen.sync(u, id);
  const buddyUid = u.buddy && u.buddy.id === id ? u.buddy.uid : null;
  const cand = arr.filter((m) => !m.fav && !m.shiny && !m.away && m.uid !== buddyUid);
  const keepers = arr.length - cand.length;
  const best = (a, b) => b.level - a.level || specimen.ivTotal(b) - specimen.ivTotal(a) || a.at - b.at;
  cand.sort(best);
  return keepers ? cand : cand.slice(1);
}

function transferBulk(u, p) {
  const id = Number(p.id);
  const list = bulkPlan(u, id);
  if (!list.length) throw new Error('No hay repetidos que transferir (se conservan favoritos, compañero, variocolores y el mejor ejemplar).');
  for (const m of list) m.drop = true;
  let res;
  try { res = gacha.release(u, { id, count: list.length }); } catch (e) { for (const m of list) delete m.drop; throw e; }
  for (const x of specimen.sync(u, id)) delete x.drop;
  const rar = BY_ID.get(id).rarity;
  const candy = addCandy(u, id, TRANSFER_CANDY[rar] * list.length) + addWild(u, WILD_TRANSFER[rar] * list.length);
  db.save();
  return { ...res, candy, count: list.length };
}

// ---- Subir de nivel ----
function levelUp(u, p) {
  const times = p.times === undefined ? 1 : Number(p.times);
  if (!Number.isInteger(times) || times < 1 || times > 5) throw new Error('Cantidad no válida.');
  const m = specimen.find(u, p);
  const id = Number(p.id);
  const n = Math.min(times, MAX_LEVEL - m.level);
  if (n < 1) throw new Error('Ya está al nivel máximo (100).');
  let cost = 0;
  for (let i = 0; i < n; i++) cost += levelCost(m.level + i);
  takeCandy(u, id, cost);
  const from = m.level;
  m.level += n;
  const mv = moves.onLevel(id, m, from, m.level);
  db.save();
  return { level: m.level, cost, learned: mv.auto, pending: mv.pending };
}

// ---- Evolucionar ----
// Primera evolución a una especie: no la tienes y nunca la has registrado así (si vendes la copia, la próxima vez ya no es «primera»).
const isFirstEvo = (u, to) => !(u.collection[to] && u.collection[to].n > 0) && !(u.evoReg && u.evoReg[to]);
function evolve(u, p) {
  const m = specimen.find(u, p);
  specimen.assertFree(m, BY_ID.get(Number(p.id)).name);
  const id = Number(p.id);
  const to = Number(p.to);
  const target = evolutionsOf(id).find((x) => x.id === to);
  if (!target) throw new Error('Ese Pokémon no puede evolucionar a eso.');
  const bond = require('./bond');
  const friend = bond.isFriendEvo(id, to) && bond.loves(bond.friendOf(m));
  if (!friend && bond.isFriendEvo(id, to) && bond.FRIEND_ONLY.has(to)) throw new Error(`${target.name} solo evoluciona con mucha amistad (≥ ${bond.LOVE_MIN}).`);
  const tc = u.collection[to];
  const first = isFirstEvo(u, to); // la especie destino aún no está en la colección: se registra sin gastar la copia de origen
  const { cost, level } = evoCost(id, to, friend, first);
  if (m.level < level) throw new Error(`Necesita nivel ${level} (ahora ${m.level}).`);
  const c = u.collection[id];
  if (!first && gacha.spareCopies(c) < 1) throw new Error(`Necesitas otra copia de ${BY_ID.get(id).name}: ya tienes ${target.name} y evolucionar gasta una copia.`);
  if (tc && tc.n >= 5) throw new Error(`Ya tienes 5 estrellas de ${target.name}.`);
  takeCandy(u, id, cost);
  if (first) (u.evoReg ||= {})[to] = 1; // una sola vez por especie y cuenta (aunque luego vendas la copia)
  // Sale el ejemplar concreto de la especie origen (si es la primera vez, la especie origen conserva su entrada y
  // `sync` le crea un ejemplar nuevo de nivel 5)…
  moves.ensure(id, m); // si aún no estaba migrado, con los movimientos de la especie de origen
  const arr = specimen.sync(u, id);
  arr.splice(arr.indexOf(m), 1);
  if (!first) c.n--;
  if (m.shiny) c.s = Math.max(0, (c.s || 0) - 1);
  if (c.s > gacha.realCopies(c)) c.s = gacha.realCopies(c);
  // …y entra, con sus datos, en la especie destino.
  if (tc) specimen.sync(u, to);
  const dest = (u.collection[to] ||= { n: 0, s: 0 });
  (u.mons[to] ||= []).push(m);
  dest.n++;
  if (m.shiny) dest.s = (dest.s || 0) + 1;
  m.moves = specimen.movesFor(target);
  m.ability = specimen.ABILITIES[target.types[0]] || specimen.GENERIC_ABILITY;
  if (specimen.isFixed(target)) m.gender = null;
  const learnt = moves.onEvolve(to, m); // sus movimientos propios (y los «al evolucionar»)
  if (u.buddy && u.buddy.id === id && u.buddy.uid === m.uid) u.buddy = { id: to, shiny: m.shiny, uid: m.uid };
  specimen.sync(u, id);
  specimen.sync(u, to);
  if (target.rarity === 'L' || target.rarity === 'M') hub.feed('evolve', `🌟 ${u.username} hizo evolucionar a ${BY_ID.get(id).name} en ${target.name}`, { pokeId: to, shiny: m.shiny });
  db.save();
  return { from: id, to, uid: m.uid, name: target.name, cost, learned: learnt.auto, pending: learnt.pending };
}

// ---- Entrenar IVs ----
function train(u, p) {
  const stat = Number(p.stat);
  if (!Number.isInteger(stat) || stat < 0 || stat > 5) throw new Error('Estadística no válida.');
  const m = specimen.find(u, p);
  const k = hub.dayKey();
  if (!m.train || m.train.day !== k) m.train = { day: k, n: 0 };
  if (m.train.n >= TRAIN_DAILY) throw new Error(`Este ejemplar ya hizo ${TRAIN_DAILY} entrenamientos hoy. ¡Vuelve mañana!`);
  if (m.ivs[stat] >= 31) throw new Error('Esa estadística ya tiene el IV máximo (31).');
  takeCandy(u, Number(p.id), TRAIN_COST);
  m.ivs[stat]++;
  m.train.n++;
  db.save();
  return { iv: m.ivs[stat], left: TRAIN_DAILY - m.train.n };
}
const trainLeft = (m) => (m.train && m.train.day === hub.dayKey() ? TRAIN_DAILY - m.train.n : TRAIN_DAILY);

// ---- Intercambio Milagroso ----
function wonderPool(u, rarity) {
  const act = gacha.activeBanners();
  const featured = new Set([...act.permanent.featuredL, ...act.promo.featuredL]);
  return (require('./pokedex').BY_RARITY[rarity] || []).filter((x) => {
    if (rarity === 'L' && featured.has(x.id)) return false;
    const c = u.collection[x.id];
    return !c || c.n < 5;
  });
}
function wonder(u, p) {
  const m = specimen.find(u, p);
  const id = Number(p.id);
  const src = BY_ID.get(id);
  if (src.rarity === 'M') throw new Error('Los Pokémon míticos no se pueden intercambiar.');
  specimen.assertFree(m, src.name);
  if (m.fav) throw new Error('No puedes intercambiar un favorito.');
  if (m.shiny) throw new Error('No puedes intercambiar un variocolor.');
  if (u.buddy && u.buddy.id === id && u.buddy.uid === m.uid) throw new Error('No puedes intercambiar a tu compañero.');
  const c = u.collection[id];
  if (gacha.spareCopies(c) < 1) throw new Error('Debes conservar al menos una copia de cada Pokémon.');
  const d = day(u);
  if (d.wonder >= WONDER_DAILY) throw new Error(`Solo ${WONDER_DAILY} intercambios milagrosos al día.`);
  const pool = wonderPool(u, src.rarity).filter((x) => x.id !== id);
  if (!pool.length) throw new Error('No hay nada que recibir a cambio ahora mismo.');
  // Las especies que ya tienes pesan menos (igual que en el gacha): el Milagroso sirve para completar la Pokédex.
  const got = weighted(pool, (x) => (src.rarity === 'L' ? 1 : gacha.stageWeight(x)) * (u.collection[x.id] && u.collection[x.id].n > 0 ? gacha.TUNING.dupKeep : 1));
  // Sale el ejemplar entregado y entra una copia nueva y aleatoria.
  const arr = specimen.sync(u, id);
  arr.splice(arr.indexOf(m), 1);
  c.n--;
  if (c.s > gacha.realCopies(c)) c.s = gacha.realCopies(c);
  const g = gacha.grant(u, got.id, false);
  specimen.sync(u, id);
  specimen.sync(u, got.id);
  d.wonder++;
  db.save();
  return { id: got.id, name: got.name, rarity: got.rarity, isNew: g.isNew, left: WONDER_DAILY - d.wonder };
}

// ---- Reciclaje ----
const RECYCLE_BERRY_DUST = 1; // cada baya
const RECYCLE_BERRY_DAILY = 20; // ✦ al día (dentro del tope general): ≈ 80 monedas como mucho
function recycleValue(itemId) {
  const it = items.ITEMS[itemId];
  if (!it || !it.price || it.cosmetic || it.megaStone) return 0;
  return Math.floor((it.price * RECYCLE_RATE) / gacha.DUST_RATE);
}
function recycleList() {
  return Object.keys(items.ITEMS).map((id) => [id, recycleValue(id)]).filter(([, v]) => v > 0);
}
function recycle(u, p) {
  const itemId = String(p.item);
  const qty = Number(p.qty === undefined ? 1 : p.qty);
  const isBerry = !!items.BERRIES[itemId];
  const v = isBerry ? RECYCLE_BERRY_DUST : recycleValue(itemId);
  if (!v) throw new Error('Ese objeto no se puede reciclar.');
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new Error('Cantidad no válida.');
  const d = day(u);
  const dust = v * qty;
  if (d.recycle + dust > RECYCLE_DAILY_DUST) throw new Error(`Tope diario de reciclaje: ${RECYCLE_DAILY_DUST} ✦ (te quedan ${Math.max(0, RECYCLE_DAILY_DUST - d.recycle)}).`);
  if (isBerry && (d.berry || 0) + dust > RECYCLE_BERRY_DAILY) throw new Error(`Las bayas solo dan ${RECYCLE_BERRY_DAILY} ✦ de reciclaje al día (te quedan ${Math.max(0, RECYCLE_BERRY_DAILY - (d.berry || 0))}). Mejor dáselas a tus Pokémon.`);
  if (isBerry) require('./bond').takeBerry(u, itemId, qty); else items.take(u, itemId, qty);
  if (isBerry) d.berry = (d.berry || 0) + dust;
  d.recycle += dust;
  u.dust += dust;
  db.save();
  return { dust, left: RECYCLE_DAILY_DUST - d.recycle };
}

// Datos extra de la Caja PC.
function boxExtra(u) {
  const d = day(u);
  const train = {};
  for (const arr of Object.values(u.mons || {})) for (const m of arr) if (m.train) train[m.uid] = trainLeft(m);
  // Para el cliente cada familia muestra sus caramelos más los comodín (es lo que se puede gastar en ella).
  const candyView = {};
  const wild = wildOf(u);
  for (const [k, v] of Object.entries(u.candy || {})) if (k !== WILD) candyView[k] = v;
  if (wild) for (const k of FAMILY_NAME.keys()) candyView[k] = (candyView[k] || 0) + wild;
  return {
    candy: candyView, wild, train, wonderLeft: WONDER_DAILY - d.wonder, recycleLeft: RECYCLE_DAILY_DUST - d.recycle,
    rules: { transfer: Object.fromEntries(Object.keys(TRANSFER_CANDY).map((r) => [r, TRANSFER_CANDY[r] + WILD_TRANSFER[r]])), evoFirst: DEX.filter((x) => x.evolvesFrom && isFirstEvo(u, x.id)).map((x) => x.id), levelDiv: LEVEL_DIV, feedCap: require('./bond').CAP.feed, betStep: require('./bond').BET_STEP, trainCost: TRAIN_COST, trainDaily: TRAIN_DAILY, wonderDaily: WONDER_DAILY, maxLevel: MAX_LEVEL, recycleDaily: RECYCLE_DAILY_DUST, recycle: Object.fromEntries(recycleList()),
      evo: Object.fromEntries(DEX.filter((x) => x.evolvesFrom).map((x) => [x.id, evoCost(x.evolvesFrom, x.id, false, isFirstEvo(u, x.id))])),
      evoFriend: Object.fromEntries([...require('./bond').FRIEND_EVO].map(([to, from]) => [to, evoCost(from, to, true, isFirstEvo(u, to))])), loveMin: require('./bond').LOVE_MIN,
      friendOnly: [...require('./bond').FRIEND_ONLY] },
  };
}

module.exports = {
  TRANSFER_CANDY, WILD, WILD_PULL, WILD_TRANSFER, LEVEL_DIV, PULL_CANDY, PULL_NEW_CANDY, MIN_LEVEL, MAX_LEVEL, EVO, EVO_GAIN_PER_CANDY, TRAIN_COST, TRAIN_DAILY, WONDER_DAILY, RECYCLE_RATE, RECYCLE_DAILY_DUST, RECYCLE_BERRY_DAILY, RECYCLE_BERRY_DUST,
  levelCost, evoCost, isFirstEvo, evolutionsOf, candyOf, familyOf, wildOf, addCandy, addWild, onPull, bulkPlan, recycleValue, recycleList, boxExtra,
  transfer, transferBulk, levelUp, evolve, train, wonder, recycle,
};
