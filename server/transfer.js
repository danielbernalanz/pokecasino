'use strict';
// Límites a pasar monedas entre jugadores (regalos y Mercado) para que nadie pueda granjear cuentas
// secundarias y volcarlo todo en la principal. Es casual: entre amigos se puede regalar, con un tope diario.
const DAY = 864e5;
const GIFT_MIN_LEVEL = 3;
const GIFT_MIN_DAYS = 3;
const GIFT_IN_DAILY = 5000; // monedas que una cuenta puede RECIBIR en regalos al día
const YOUNG_PRICE_MULT = 3; // cuentas nuevas: en el Mercado no pagan más de 3 × el precio mínimo de referencia
const YOUNG_PRICE_MIN = 500;

const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const young = (u, now = Date.now()) => !u.isAdmin && !u.npc && ((u.level || 1) < GIFT_MIN_LEVEL || now - (u.createdAt || now) < GIFT_MIN_DAYS * DAY);
// Las monedas de la Enfermera Joy son una red de seguridad, no algo para pasar a otra cuenta: durante 24 h
// después de recibirlas no se puede regalar ni pagar de más en el Mercado.
const healed = (u, now = Date.now()) => !u.isAdmin && !u.npc && now - (u.lastHeal || 0) < DAY;

function canGift(u, now = Date.now()) {
  if (u.isAdmin) return;
  if (young(u, now)) throw new Error(`Para regalar necesitas nivel ${GIFT_MIN_LEVEL} y una cuenta de al menos ${GIFT_MIN_DAYS} días.`);
  if (healed(u, now)) throw new Error('La Enfermera Joy te ayudó hace menos de 24 h: hasta entonces no puedes regalar monedas.');
}
function giftInLeft(t, now = Date.now()) {
  const d = dayKey(now);
  if (!t.giftIn || t.giftIn.d !== d) t.giftIn = { d, n: 0 };
  return Math.max(0, GIFT_IN_DAILY - t.giftIn.n);
}
function noteGiftIn(t, amount, now = Date.now()) {
  giftInLeft(t, now);
  t.giftIn.n += amount;
}
// Pokémon regalados que una cuenta puede recibir al día (como mucho 2 legendarios o míticos).
const POKE_IN_DAILY = 10;
const POKE_IN_RARE = 2;
function pokeInCheck(t, rare, now = Date.now()) {
  const d = dayKey(now);
  if (!t.pokeIn || t.pokeIn.d !== d) t.pokeIn = { d, n: 0, r: 0 };
  if (t.pokeIn.n >= POKE_IN_DAILY) throw new Error(`${t.username} ya ha recibido ${POKE_IN_DAILY} Pokémon regalados hoy.`);
  if (rare && t.pokeIn.r >= POKE_IN_RARE) throw new Error(`${t.username} ya ha recibido ${POKE_IN_RARE} legendarios o míticos regalados hoy.`);
}
function notePokeIn(t, rare, now = Date.now()) {
  pokeInCheck(t, false, now);
  t.pokeIn.n++;
  if (rare) t.pokeIn.r++;
}

// ---- Apuestas entre jugadores (duelos y combates PvP con apuesta): otro canal posible para pasar monedas entre cuentas ----
// Las cuentas nuevas o ayudadas por la Enfermera Joy no pueden apostar (los amistosos sin apuesta sí), y entre dos cuentas la ganancia neta
// por apuestas no pasa del tope de regalos al día: una apuesta que podría pasarlo no se acepta (ver docs/ANTIABUSO.md).
const PAIR_BET_DAILY = GIFT_IN_DAILY;
function canBet(u, now = Date.now()) {
  if (u.isAdmin || u.npc) return;
  if (young(u, now)) throw new Error(`Las cuentas nuevas (menos de nivel ${GIFT_MIN_LEVEL} o de ${GIFT_MIN_DAYS} días) no pueden apostar en duelos ni combates PvP: puedes jugar amistosos sin apuesta.`);
  if (healed(u, now)) throw new Error('La Enfermera Joy te ayudó hace menos de 24 h: hasta entonces no puedes apostar en duelos ni combates PvP (los amistosos sí).');
}
const pairKey = (a, b) => (a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);
const pairs = (now) => {
  const db = require('./db');
  const d = dayKey(now);
  const p = (db.data.pairBets ||= {});
  for (const k of Object.keys(p)) if (p[k].d !== d) delete p[k]; // solo cuenta el día en curso
  return p;
};
// Ganancia neta de `a` sobre `b` hoy (negativa si va perdiendo).
function pairNet(a, b, now = Date.now()) {
  const r = pairs(now)[pairKey(a, b)];
  return r ? (a.id < b.id ? r.net : -r.net) : 0;
}
// Lanza un error si apostar `wager` entre estas dos cuentas podría pasar el tope diario de ganancia neta.
function pairCheck(a, b, wager, now = Date.now()) {
  if (!wager || a.isAdmin || b.isAdmin || a.npc || b.npc) return;
  const left = PAIR_BET_DAILY - Math.abs(pairNet(a, b, now));
  if (wager > left) throw new Error(left > 0 ? `Entre ${a.username} y ${b.username} ya se ha movido bastante hoy: solo se admiten apuestas de hasta ${left.toLocaleString('es')} monedas entre vosotros (o amistosos sin apuesta).` : `Entre ${a.username} y ${b.username} ya se ha llegado al tope diario de ganancia por apuestas (${PAIR_BET_DAILY.toLocaleString('es')}): hoy solo amistosos sin apuesta.`);
}
function notePair(winner, loser, wager, now = Date.now()) {
  if (!wager || winner.npc || loser.npc) return;
  const p = pairs(now);
  const k = pairKey(winner, loser);
  const r = (p[k] ||= { d: dayKey(now), net: 0 });
  r.net += winner.id < loser.id ? wager : -wager;
}

// Invitaciones (Teraincursiones y torneos): tope por usuario y día para que nadie acose a otro jugador a avisos.
const INVITES_DAILY = 30;
function noteInvite(u, now = Date.now()) {
  const d = dayKey(now);
  if (!u.invDay || u.invDay.d !== d) u.invDay = { d, n: 0 };
  if (u.invDay.n >= INVITES_DAILY) throw new Error(`Hoy ya has enviado ${INVITES_DAILY} invitaciones: vuelve mañana (o comparte el código).`);
  u.invDay.n++;
}

// Precio máximo por unidad que puede pagar una cuenta nueva en el Mercado (Infinity si no es nueva).
function maxBuyPrice(u, a, now = Date.now()) {
  if (!young(u, now) && !healed(u, now)) return Infinity;
  const b = a && require('./npc').bounds(a);
  return Math.max(YOUNG_PRICE_MIN, b ? YOUNG_PRICE_MULT * b.floor : 2000);
}

module.exports = { noteInvite, INVITES_DAILY, canBet, pairCheck, pairNet, notePair, PAIR_BET_DAILY, pokeInCheck, notePokeIn, POKE_IN_DAILY, POKE_IN_RARE, young, healed, canGift, giftInLeft, noteGiftIn, maxBuyPrice, GIFT_MIN_LEVEL, GIFT_MIN_DAYS, GIFT_IN_DAILY, YOUNG_PRICE_MULT, YOUNG_PRICE_MIN };
