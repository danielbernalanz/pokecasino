'use strict';
// Repetidos y reciclaje: transferir al Profesor Oak, evolucionar (como en los juegos: por requisitos, sin coste en caramelos),
// Intercambio Milagroso y máquina de reciclaje. La EXP y los niveles están en exp.js; el Entrenamiento Extremo, en hyper.js.
// Nada de esto crea monedas: los Caramelos Exp. no se pueden vender y el polvo que da cada acción es el mismo que ya daba liberar (o menos).
// (El nombre del archivo viene de los antiguos «caramelos de familia», que se convirtieron en Caramelos Exp.: ver exp.migrate.)
const db = require('./db');
const hub = require('./hub');
const gacha = require('./gacha');
const specimen = require('./specimen');
const moves = require('./moves');
const items = require('./items');
const exp = require('./exp');
const forms = require('./forms');
const evoreq = require('./evoreq');
const { DEX, BY_ID, RARITY } = require('./pokedex');
const { weighted } = require('./rng');

// Caramelos Exp. que da transferir un ejemplar al Profesor Oak (además del polvo de liberar): [objeto, cantidad].
const TRANSFER_EXP = { C: ['exp-xs', 1], U: ['exp-xs', 2], R: ['exp-s', 1], E: ['exp-s', 2], L: ['exp-m', 1], M: ['exp-m', 2] };
const transferExp = (rarity) => TRANSFER_EXP[rarity][1] * exp.CANDY_EXP[TRANSFER_EXP[rarity][0]];
// Tiradas de gacha: 1 Caramelo Exp. XS por Pokémon obtenido y 1 S si la especie es nueva.
const PULL_ITEM = 'exp-xs';
const PULL_NEW_ITEM = 'exp-s';

const MIN_LEVEL = 5;
const MAX_LEVEL = exp.MAX_LEVEL;

// Evolucionar TRANSFORMA el ejemplar (como en los juegos): sale de la especie origen y entra en la nueva, sin copia gratis y sin gastar otra copia.
// También el último de su especie: la Pokédex es un registro permanente (dexreg.js), así que la especie origen sigue «obtenida» aunque ya no la tengas.
// (Hasta la v59 la PRIMERA evolución a una especie nueva dejaba una copia de nivel 5 de la especie origen para no perder su entrada: ya no hace falta
// ni se da; las cuentas que ya la recibieron la conservan y `u.evoReg` solo queda como historial.)
const WONDER_DAILY = 5;
const RECYCLE_RATE = 0.4; // del precio de tienda
const RECYCLE_DAILY_DUST = 300;

function day(u) {
  const k = hub.dayKey();
  if (!u.candyDay || u.candyDay.day !== k) u.candyDay = { day: k, wonder: 0, recycle: 0 };
  return u.candyDay;
}

// Da `n` Caramelos Exp. de un tipo (sin tope propio: el tope está en cada fuente).
function giveExp(u, itemId, n) {
  if (!(n > 0)) return 0;
  u.items[itemId] = (u.items[itemId] || 0) + n;
  return n;
}
// Se llama desde el gacha por cada Pokémon obtenido. Devuelve el objeto dado.
function onPull(u, id, isNew) {
  const it = isNew ? PULL_NEW_ITEM : PULL_ITEM;
  giveExp(u, it, 1);
  return it;
}

// ---- Evolución ----
const EVOS = new Map();
for (const p of DEX) if (p.evolvesFrom) (EVOS.get(p.evolvesFrom) || EVOS.set(p.evolvesFrom, []).get(p.evolvesFrom)).push(p);
const evolutionsOf = (id) => EVOS.get(Number(id)) || [];
// Nivel mínimo para evolucionar a `to`: el REAL de los juegos (evodata.json; 30 / 40 por fase si el dato es «pasos, críticos, lugares…»).
const evoLevel = (to) => evoreq.levelOf(to);

// Comprueba TODO lo que hace falta para que el ejemplar `m` (especie `id`) evolucione a `to` sin tocar nada; lanza un error en español si falta algo.
// Devuelve el plan de requisitos especiales (`consume()` gasta el objeto o intercambio) y si es la primera evolución a esa especie.
function evoCheck(u, m, id, to) {
  id = Number(id); to = Number(to);
  const target = evolutionsOf(id).find((x) => x.id === to);
  if (!target) throw new Error('Ese Pokémon no puede evolucionar a eso.');
  specimen.assertFree(m, BY_ID.get(id).name);
  const forced = forms.forcedTarget(id, m); // Wurmple: Silcoon o Cascoon según el propio ejemplar
  if (forced && forced !== to) throw new Error(`${m.nick || BY_ID.get(id).name} solo puede evolucionar a ${BY_ID.get(forced).name}.`);
  const bond = require('./bond');
  if (bond.isFriendEvo(id, to) && bond.friendOf(m) < bond.FRIEND_EVO_MIN) throw new Error(`${target.name} solo evoluciona con mucha amistad (≥ ${bond.FRIEND_EVO_MIN}).`);
  // Piedra Eterna (como en los juegos): el portador no evoluciona «de forma natural» (nivel, amistad, intercambio…); las piedras y objetos que se USAN sobre él sí funcionan.
  if (m.item === 'everstone') { const r = evoreq.reqOf(to); if (!(r && r.item && !r.trade)) throw new Error(`${m.nick || BY_ID.get(id).name} lleva una Piedra Eterna: no evoluciona (quítasela en la Caja PC).`); }
  exp.ensure(id, m);
  const need = evoLevel(to);
  if (m.level < need) throw new Error(`Necesita nivel ${need} (ahora ${m.level}).`);
  const tc = u.collection[to];
  const c = u.collection[id];
  // Las estrellas de Caramelo Raro (`cn`) necesitan una copia real que las respalde: el último ejemplar real no puede irse si las hay.
  if (c && (c.cn || 0) > 0 && gacha.realCopies(c) <= 1) throw new Error(`Las estrellas de Caramelo Raro de ${BY_ID.get(id).name} necesitan este ejemplar: no puede evolucionar mientras sea el único real.`);
  if (tc && tc.n >= 5) throw new Error(`Ya tienes 5 estrellas de ${target.name}.`);
  const special = evoreq.plan(u, m, id, to); // objeto, intercambio, sexo, hora… (lanza error sin gastar nada si falta algo)
  return { special, target };
}
// Evoluciones que el ejemplar puede hacer AHORA al subir de nivel (las «de nivel»: nivel, amistad, objeto equipado, movimiento…).
// Es el aviso «¿Quieres que evolucione?»: si se cancela, sigue igual y puede evolucionar después desde la Caja PC.
function evoOptions(u, m, id) {
  const out = [];
  if (!m || m.away) return out;
  for (const t of evolutionsOf(id)) {
    if (!evoreq.isLevelUp(t.id)) continue;
    try { evoCheck(u, m, id, t.id); out.push({ to: t.id, name: t.name }); } catch { /* aún le falta algo */ }
  }
  return out;
}
// Para la Caja PC: a qué puede evolucionar ahora mismo cada ejemplar (cualquier vía, también piedras e intercambio).
function canEvolveTo(u, m, id) {
  const out = [];
  if (!m || m.away) return out;
  for (const t of evolutionsOf(id)) { try { evoCheck(u, m, id, t.id); out.push(t.id); } catch { /* no */ } }
  return out;
}

// ---- Transferir ----
// Devuelve los Caramelos Exp. como { items: { 'exp-xs': 2 }, exp: <EXP total> }.
function addTransferExp(u, rarity, times) {
  const [it, n] = TRANSFER_EXP[rarity];
  giveExp(u, it, n * times);
  return { [it]: n * times };
}
const mergeItems = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = (a[k] || 0) + v; return a; };
const expOf = (given) => Object.entries(given).reduce((s, [k, v]) => s + exp.CANDY_EXP[k] * v, 0);
function transfer(u, p) {
  const m = specimen.find(u, p);
  const id = Number(p.id);
  const rarity = BY_ID.get(id).rarity;
  const res = specimen.release(u, p);
  const given = addTransferExp(u, rarity, 1);
  db.save();
  return { ...res, given, exp: expOf(given), name: m.nick || BY_ID.get(id).name };
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
  const given = addTransferExp(u, rar, list.length);
  db.save();
  return { ...res, given, exp: expOf(given), count: list.length };
}

// Transferir varios ejemplares elegidos de una vez (selección múltiple de la Caja PC). Nunca el compañero ni los
// que están de expedición o en el Criadero; cada uno sigue las mismas reglas que una transferencia suelta (se
// conserva siempre al menos una copia de la especie). Los que no se pueden se saltan y se cuentan.
const MANY_MAX = 300;
function transferMany(u, p) {
  const list = Array.isArray(p && p.list) ? p.list.slice(0, MANY_MAX) : [];
  if (!list.length) throw new Error('No has elegido ningún Pokémon.');
  const out = { count: 0, dust: 0, given: {}, exp: 0, skipped: 0, reason: '' };
  for (const x of list) {
    try {
      if (!x || typeof x.uid !== 'string') throw new Error('Pokémon no válido.');
      if (u.buddy && u.buddy.id === Number(x.id) && u.buddy.uid === x.uid) throw new Error('Tu compañero no se transfiere.');
      const r = transfer(u, { id: x.id, uid: x.uid });
      out.count++; out.dust += r.dust || 0; mergeItems(out.given, r.given); out.exp += r.exp;
    } catch (e) { out.skipped++; out.reason ||= e.message; }
  }
  db.save();
  return out;
}

// Todos los repetidos de todas las especies (mismas reglas que «Transferir repetidos»). `preview` solo calcula.
function transferAllDupes(u, p = {}) {
  const plan = [];
  for (const id of Object.keys(u.collection).map(Number)) {
    let list = [];
    try { list = bulkPlan(u, id); } catch { list = []; }
    if (list.length) plan.push({ id, n: list.length, rarity: BY_ID.get(id).rarity });
  }
  const sum = (f) => plan.reduce((s, x) => s + f(x), 0);
  const preview = { species: plan.length, count: sum((x) => x.n), dust: sum((x) => RARITY[x.rarity].dust * x.n), exp: sum((x) => transferExp(x.rarity) * x.n) };
  if (p.preview) return preview;
  if (!plan.length) throw new Error('No tienes repetidos que transferir (se conservan favoritos, compañero, variocolores y el mejor de cada especie).');
  const out = { species: 0, count: 0, dust: 0, given: {}, exp: 0 };
  for (const x of plan) {
    try { const r = transferBulk(u, { id: x.id }); out.species++; out.count += r.count; out.dust += r.dust || 0; mergeItems(out.given, r.given); out.exp += r.exp; } catch { /* esa especie ya no tenía repetidos */ }
  }
  return out;
}

// ---- Evolucionar ----
function evolve(u, p) {
  const m = specimen.find(u, p);
  const id = Number(p.id);
  const to = Number(p.to);
  const { special, target } = evoCheck(u, m, id, to);
  const c = u.collection[id];
  const tc = u.collection[to];
  const oldEntry = exp.ensure(id, m) && { exp: m.exp, lo: exp.expAt(id, m.level), hi: exp.expAt(id, m.level + 1) };
  special.consume();
  require('./dexreg').markCaught(u, id); // red de seguridad: lo que se tiene consta como obtenido antes de que el ejemplar salga
  // Sale el ejemplar concreto de la especie origen…
  moves.ensure(id, m); // si aún no estaba migrado, con los movimientos de la especie de origen
  const arr = specimen.sync(u, id);
  arr.splice(arr.indexOf(m), 1);
  c.n--;
  if (m.shiny) c.s = Math.max(0, (c.s || 0) - 1);
  if (c.s > gacha.realCopies(c)) c.s = gacha.realCopies(c);
  if (c.n <= 0) delete u.collection[id]; // era el último: la especie origen sigue en el registro de la Pokédex
  // …y entra, con sus datos, en la especie destino.
  if (tc) specimen.sync(u, to);
  const dest = (u.collection[to] ||= { n: 0, s: 0 });
  require('./dexreg').markCaught(u, to); // obtenido para siempre (y visto); si es nuevo, puede completar una Pokédex regional o una colección
  if (m.tera === undefined) m.tera = require('./tera').teraOf(id, m); // el Teratipo es del ejemplar: no cambia al evolucionar aunque cambien sus tipos
  (u.mons[to] ||= []).push(m);
  dest.n++;
  if (m.shiny) dest.s = (dest.s || 0) + 1;
  m.moves = specimen.movesFor(target);
  m.ability = specimen.ABILITIES[target.types[0]] || specimen.GENERIC_ABILITY;
  if (specimen.isFixed(target)) m.gender = null;
  // La EXP se conserva proporcionalmente dentro del nivel (el grupo de experiencia de la nueva especie puede ser otro).
  if (m.level < MAX_LEVEL) {
    const frac = oldEntry.hi > oldEntry.lo ? (oldEntry.exp - oldEntry.lo) / (oldEntry.hi - oldEntry.lo) : 0;
    const lo = exp.expAt(to, m.level);
    m.exp = Math.min(exp.expAt(to, m.level + 1) - 1, Math.floor(lo + frac * (exp.expAt(to, m.level + 1) - lo)));
  } else m.exp = exp.expAt(to, MAX_LEVEL);
  const form = forms.onEvolve(to, m); // Dudunsparce (tres segmentos) y Maushold (familia de tres/cuatro), por el propio ejemplar
  const learnt = moves.onEvolve(to, m); // sus movimientos propios (y los «al evolucionar»)
  if (u.buddy && u.buddy.id === id && u.buddy.uid === m.uid) u.buddy = { id: to, shiny: m.shiny, uid: m.uid };
  specimen.sync(u, id);
  specimen.sync(u, to);
  if (!u.npc) { require('./regions').onObtain(u, to); if (u.progress) require('./progress').evaluate(u); }
  if (target.rarity === 'L' || target.rarity === 'M') hub.feed('evolve', `🌟 ${u.username} hizo evolucionar a ${BY_ID.get(id).name} en ${target.name}`, { pokeId: to, shiny: m.shiny });
  db.save();
  return { from: id, to, uid: m.uid, name: target.name, used: special.uses, form, learned: learnt.auto, pending: learnt.pending, evo: evoOptions(u, m, to) };
}

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
  if (gacha.giveable(c) < 1) throw new Error('Tus estrellas de Caramelo Raro necesitan una copia real: no puedes intercambiarla.');
  const d = day(u);
  if (d.wonder >= WONDER_DAILY) throw new Error(`Solo ${WONDER_DAILY} intercambios milagrosos al día.`);
  const pool = wonderPool(u, src.rarity).filter((x) => x.id !== id);
  if (!pool.length) throw new Error('No hay nada que recibir a cambio ahora mismo.');
  // Las especies que ya tienes pesan menos (igual que en el gacha): el Milagroso sirve para completar la Pokédex.
  const got = weighted(pool, (x) => (src.rarity === 'L' ? 1 : gacha.stageWeight(x)) * (require('./dexreg').caught(u, x.id) ? gacha.TUNING.dupKeep : 1));
  // Sale el ejemplar entregado y entra una copia nueva y aleatoria.
  const arr = specimen.sync(u, id);
  arr.splice(arr.indexOf(m), 1);
  c.n--;
  if (c.s > gacha.realCopies(c)) c.s = gacha.realCopies(c);
  if (c.n <= 0) delete u.collection[id];
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
  const it = Object.hasOwn(items.ITEMS, itemId) ? items.ITEMS[itemId] : null;
  if (!it || !it.price || it.cosmetic || it.megaStone || it.evo) return 0; // los objetos de evolución caen gratis en expediciones: no se reciclan
  return Math.floor((it.price * RECYCLE_RATE) / gacha.DUST_RATE);
}
function recycleList() {
  return Object.keys(items.ITEMS).map((id) => [id, recycleValue(id)]).filter(([, v]) => v > 0);
}
function recycle(u, p) {
  const itemId = String(p.item);
  const qty = Number(p.qty === undefined ? 1 : p.qty);
  const isBerry = Object.hasOwn(items.BERRIES, itemId);
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
  const bond = require('./bond');
  return {
    tradeTokens: evoreq.tokensOf(u), phase: require('./daytime').phase(), wonderLeft: WONDER_DAILY - d.wonder, recycleLeft: RECYCLE_DAILY_DUST - d.recycle,
    rules: { transfer: Object.fromEntries(Object.keys(TRANSFER_EXP).map((r) => [r, { item: TRANSFER_EXP[r][0], n: TRANSFER_EXP[r][1], exp: transferExp(r) }])),
      evoLevel: Object.fromEntries(DEX.filter((x) => x.evolvesFrom && evoLevel(x.id)).map((x) => [x.id, evoLevel(x.id)])),
      feedCap: bond.CAP.feed, betStep: bond.BET_STEP, wonderDaily: WONDER_DAILY, maxLevel: MAX_LEVEL, recycleDaily: RECYCLE_DAILY_DUST, recycle: Object.fromEntries(recycleList()),
      loveMin: bond.LOVE_MIN, friendEvoMin: bond.FRIEND_EVO_MIN, friendEvo: [...bond.FRIEND_EVO.keys()], friendOnly: [...bond.FRIEND_ONLY], exp: exp.STATIC, hyper: require('./hyper').STATIC, forms: forms.STATIC },
  };
}

module.exports = {
  transferMany, transferAllDupes, MANY_MAX,
  TRANSFER_EXP, PULL_ITEM, PULL_NEW_ITEM, MIN_LEVEL, MAX_LEVEL, WONDER_DAILY, RECYCLE_RATE, RECYCLE_DAILY_DUST, RECYCLE_BERRY_DAILY, RECYCLE_BERRY_DUST,
  transferExp, giveExp, evoCheck, evoOptions, canEvolveTo, evoLevel, evolutionsOf, onPull, bulkPlan, recycleValue, recycleList, boxExtra,
  transfer, transferBulk, evolve, wonder, recycle,
};
