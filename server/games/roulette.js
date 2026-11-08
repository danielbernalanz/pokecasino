'use strict';
// Ruleta de Tipos: 18 tipos + casilla Poké Ball (el "cero" de la casa).
const hub = require('../hub');
const { randInt } = require('../rng');

const WHEEL = ['pokeball', 'fire', 'water', 'grass', 'electric', 'psychic', 'fighting', 'ice', 'ghost', 'dragon',
  'normal', 'rock', 'flying', 'poison', 'bug', 'ground', 'dark', 'steel', 'fairy'];

const GROUPS = {
  ofensivo: ['fire', 'fighting', 'dragon', 'dark', 'ground', 'rock'],
  elemental: ['water', 'ice', 'electric', 'flying', 'steel', 'normal'],
  mistico: ['grass', 'bug', 'poison', 'psychic', 'ghost', 'fairy'],
};
// Pagos totales (incluyen la apuesta), en décimas para no arrastrar decimales: tipo ×18,2 · grupo ×3 · par/impar ×2.
// «La Partage» (como en la ruleta francesa): si sale la Poké Ball (el «cero»), las apuestas a grupo y a par/impar
// recuperan el 20 % de la ficha. Con 19 casillas el RTP es 18,2/19 = 95,79 % en TODAS las apuestas (antes 18/19 = 94,74 %).
const TENTHS = { type: 182, group: 30, parity: 20 };
const PAYOUT = Object.fromEntries(Object.entries(TENTHS).map(([k, v]) => [k, v / 10]));
const PARTAGE = 0.2;
const partageOf = (bet, slotIndex) => (WHEEL[slotIndex] === 'pokeball' && bet.kind !== 'type' ? Math.floor((bet.amount * 2) / 10) : 0);

function wins(bet, slotIndex) {
  const t = WHEEL[slotIndex];
  if (bet.kind === 'type') return bet.value === t;
  if (t === 'pokeball') return false;
  if (bet.kind === 'group') return (GROUPS[bet.value] || []).includes(t);
  if (bet.kind === 'parity') return bet.value === (slotIndex % 2 === 0 ? 'par' : 'impar');
  return false;
}

function validate(bet) {
  if (!bet || !PAYOUT[bet.kind]) return false;
  if (bet.kind === 'type') return WHEEL.includes(bet.value);
  if (bet.kind === 'group') return Object.hasOwn(GROUPS, bet.value);
  return bet.value === 'par' || bet.value === 'impar';
}

function spin(user, { bets }) {
  if (!Array.isArray(bets) || bets.length === 0 || bets.length > 25) throw new Error('Apuestas no válidas.');
  if (!bets.every((b) => b && typeof b === 'object')) throw new Error('Apuestas no válidas.');
  bets = bets.map((b) => ({ kind: b.kind, value: b.value, amount: Number(b.amount) }));
  if (!bets.every(validate)) throw new Error('Apuesta desconocida.');
  const total = bets.reduce((s, b) => s + b.amount, 0);
  if (!bets.every((b) => hub.validAmount(b.amount))) throw new Error('Cada ficha debe ser un importe válido.');
  const stake = hub.takeBet(user, total, 'roulette');
  const slot = randInt(0, WHEEL.length - 1);
  let win = 0;
  let partage = 0;
  const results = bets.map((b) => {
    const ok = wins(b, slot);
    if (ok) win += Math.floor((b.amount * TENTHS[b.kind]) / 10);
    const back = ok ? 0 : partageOf(b, slot);
    partage += back;
    return { ...b, won: ok, partage: back };
  });
  win += partage;
  const { paid, bonus } = win > 0 ? hub.pay(user, win, stake, 'roulette') : { paid: 0, bonus: 0 };
  return { slot, type: WHEEL[slot], results, paid, bonus, partage };
}

module.exports = { spin, WHEEL, GROUPS, PAYOUT, TENTHS, PARTAGE, partageOf, wins };
