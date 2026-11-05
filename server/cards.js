'use strict';
// Baraja francesa y evaluador de manos de póker.
const { shuffle } = require('./rng');

const SUITS = ['s', 'h', 'd', 'c'];
const RANK_CH = { 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

// Carta como cadena: rango + palo ("As", "Td", "7h").
const card = (r, s) => (RANK_CH[r] || String(r)) + s;
const rankOf = (c) => ({ T: 10, J: 11, Q: 12, K: 13, A: 14 }[c[0]] || Number(c[0]));
const suitOf = (c) => c[1];

function deck(n = 1) {
  const d = [];
  for (let k = 0; k < n; k++) for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push(card(r, s));
  return shuffle(d);
}

const HAND_NAMES = ['Carta alta', 'Pareja', 'Doble pareja', 'Trío', 'Escalera', 'Color', 'Full', 'Póker', 'Escalera de color', 'Escalera real'];

// Evalúa 5 cartas. Devuelve una puntuación comparable (mayor = mejor).
function eval5(cards) {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks[0] === 14 && ranks[1] === 5) straightHigh = 5; // A-2-3-4-5
  }
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const groups = Object.entries(counts).map(([r, n]) => [n, Number(r)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let cat;
  let kick;
  if (straightHigh && flush) { cat = straightHigh === 14 ? 9 : 8; kick = [straightHigh]; }
  else if (groups[0][0] === 4) { cat = 7; kick = groups.map((g) => g[1]); }
  else if (groups[0][0] === 3 && groups[1][0] === 2) { cat = 6; kick = groups.map((g) => g[1]); }
  else if (flush) { cat = 5; kick = ranks; }
  else if (straightHigh) { cat = 4; kick = [straightHigh]; }
  else if (groups[0][0] === 3) { cat = 3; kick = groups.map((g) => g[1]); }
  else if (groups[0][0] === 2 && groups[1][0] === 2) { cat = 2; kick = groups.map((g) => g[1]); }
  else if (groups[0][0] === 2) { cat = 1; kick = groups.map((g) => g[1]); }
  else { cat = 0; kick = ranks; }
  let score = cat;
  for (let i = 0; i < 5; i++) score = score * 15 + (kick[i] || 0);
  return { score, cat, name: HAND_NAMES[cat] };
}

// Mejor mano de 5 entre 5-7 cartas.
function best(cards) {
  let top = null;
  const n = cards.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
    const hand = [cards[a], cards[b], cards[c], cards[d], cards[e]];
    const v = eval5(hand);
    if (!top || v.score > top.score) top = { ...v, cards: hand };
  }
  return top;
}

module.exports = { deck, eval5, best, rankOf, suitOf, card, HAND_NAMES };
