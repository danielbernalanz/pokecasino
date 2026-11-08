'use strict';
// «Pokémon con candado»: cuando a un jugador se le recorta la Pokédex, lo quitado no se pierde. Se mueve de
// `user.collection` a `user.locked` (misma forma: { n, s }), así que ranking, Pokédex, colecciones, mercado,
// duelos… lo ignoran solos. Se recupera con créditos (apostando o tirando en el gacha) o al salir en una tirada.
//   user.locked     = { [especie]: { n, s, cn? } }
//   user.lockedProg = { credits, wagerBase, pullBase, total }  (las «bases» son los contadores de la última recompensa)
const db = require('./db');
const { BY_ID, RARITY } = require('./pokedex');

const WAGER_STEP = 5000; // monedas apostadas por crédito
const PULL_STEP = 10; // tiradas de gacha por crédito
const RARITY_ORDER = { C: 0, U: 1, R: 2, E: 3 };

const lockedOf = (u) => u.locked || {};
const count = (u) => Object.keys(lockedOf(u)).length;
const progOf = (u) => (u.lockedProg ||= { credits: 0, wagerBase: u.stats.wagered || 0, pullBase: u.stats.pulls || 0, total: 0 });

// Mueve una especie de la colección al candado.
function lock(user, id) {
  const c = user.collection[id];
  if (!c) return false;
  (user.locked ||= {})[id] = c;
  delete user.collection[id];
  return true;
}

// Devuelve una especie del candado a la colección (si ya hay copias nuevas se suman, con tope de 5 y el resto en polvo).
// Devuelve el polvo sobrante.
function restore(user, id) {
  const l = user.locked && user.locked[id];
  if (!l) return 0;
  delete user.locked[id];
  const c = user.collection[id];
  if (!c) { user.collection[id] = l; return 0; }
  const total = c.n + l.n;
  const n = Math.min(5, total);
  const dust = (total - n) * RARITY[BY_ID.get(Number(id)).rarity].dust;
  c.cn = Math.min(n, (c.cn || 0) + (l.cn || 0)) || undefined;
  if (c.cn === undefined) delete c.cn;
  c.n = n;
  c.s = Math.min(n, c.s + l.s);
  user.dust += dust;
  return dust;
}

// Créditos nuevos por lo apostado y lo tirado desde el último crédito (solo mientras quede algo con candado).
function accrue(user) {
  if (user.npc || !count(user)) return 0;
  const p = progOf(user);
  const w = Math.floor(((user.stats.wagered || 0) - p.wagerBase) / WAGER_STEP);
  const t = Math.floor(((user.stats.pulls || 0) - p.pullBase) / PULL_STEP);
  const got = Math.max(0, w) + Math.max(0, t);
  if (w > 0) p.wagerBase += w * WAGER_STEP;
  if (t > 0) p.pullBase += t * PULL_STEP;
  if (got > 0) {
    p.credits += got;
    p.total += got;
    require('./hub').emitUser(user.id, 'toast', { kind: 'unlock', text: '🔓 Puedes recuperar un Pokémon de tu caja con candado' });
  }
  return got;
}

function view(user) {
  const l = lockedOf(user);
  const ids = Object.keys(l);
  if (!ids.length) return null;
  const p = progOf(user);
  return {
    box: Object.fromEntries(ids.map((id) => [id, { n: l[id].n, s: l[id].s }])),
    prog: {
      credits: p.credits, total: p.total, step: { wager: WAGER_STEP, pulls: PULL_STEP },
      wager: Math.max(0, Math.min(WAGER_STEP - 1, (user.stats.wagered || 0) - p.wagerBase)),
      pulls: Math.max(0, Math.min(PULL_STEP - 1, (user.stats.pulls || 0) - p.pullBase)),
    },
  };
}

// Gasta 1 crédito y recupera la especie.
function unlock(user, { id }) {
  id = Number(id);
  if (!user.locked || !user.locked[id]) throw new Error('Ese Pokémon no está con candado.');
  const p = progOf(user);
  if (p.credits < 1) throw new Error('No tienes recuperaciones disponibles: apuesta o tira en el gacha para conseguirlas.');
  p.credits--;
  const dust = restore(user, id);
  db.save();
  return { id, name: BY_ID.get(id).name, dust };
}

// Qué especies se bloquean (en orden) para dejar la colección en `target` especies.
function pickToLock(user, target) {
  const { SETS } = require('./progress');
  const { megasOf, BY_FORM } = require('./mega');
  const done = new Set();
  for (const s of SETS) if ((user.progress.sets || []).includes(s.id)) for (const id of s.ids) done.add(id);
  const megaBase = new Set(Object.keys(megasOf(user)).map((f) => BY_FORM.get(Number(f)) || BY_FORM.get(f)).filter(Boolean).map((f) => f.species));
  const cand = Object.entries(user.collection)
    .map(([id, c]) => ({ id: Number(id), c, p: BY_ID.get(Number(id)) }))
    .filter((x) => x.p && RARITY_ORDER[x.p.rarity] !== undefined && !(x.c.s > 0) && !(user.buddy && user.buddy.id === x.id) && !done.has(x.id) && !megaBase.has(x.id))
    .sort((a, b) => RARITY_ORDER[a.p.rarity] - RARITY_ORDER[b.p.rarity] || a.c.n - b.c.n || a.id - b.id);
  return cand.slice(0, Math.max(0, Object.keys(user.collection).length - target)).map((x) => x.id);
}

// Aplica el recorte: bloquea hasta dejar `target` especies y reinicia el progreso de créditos.
function lockDown(user, target) {
  const ids = pickToLock(user, target);
  for (const id of ids) lock(user, id);
  user.lockedProg = { credits: 0, wagerBase: user.stats.wagered || 0, pullBase: user.stats.pulls || 0, total: 0 };
  return ids;
}

module.exports = { WAGER_STEP, PULL_STEP, lock, restore, accrue, view, unlock, pickToLock, lockDown, count };
