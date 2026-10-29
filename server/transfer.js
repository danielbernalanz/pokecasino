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

// Precio máximo por unidad que puede pagar una cuenta nueva en el Mercado (Infinity si no es nueva).
function maxBuyPrice(u, a, now = Date.now()) {
  if (!young(u, now) && !healed(u, now)) return Infinity;
  const b = a && require('./npc').bounds(a);
  return Math.max(YOUNG_PRICE_MIN, b ? YOUNG_PRICE_MULT * b.floor : 2000);
}

module.exports = { pokeInCheck, notePokeIn, POKE_IN_DAILY, POKE_IN_RARE, young, healed, canGift, giftInLeft, noteGiftIn, maxBuyPrice, GIFT_MIN_LEVEL, GIFT_MIN_DAYS, GIFT_IN_DAILY, YOUNG_PRICE_MULT, YOUNG_PRICE_MIN };
