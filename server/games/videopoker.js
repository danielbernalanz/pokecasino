'use strict';
// Video Póker "Jacks or Better" 9/6 (RTP teórico ≈ 99,5 % con juego óptimo).
const db = require('../db');
const hub = require('../hub');
const { deck, eval5, rankOf } = require('../cards');

const PAYTABLE = [
  ['Escalera real', 800], ['Escalera de color', 50], ['Póker', 25], ['Full', 9], ['Color', 6],
  ['Escalera', 4], ['Trío', 3], ['Doble pareja', 2], ['Jotas o mejor', 1],
];

function classify(cards) {
  const v = eval5(cards);
  if (v.cat === 9) return 'Escalera real';
  if (v.cat === 8) return 'Escalera de color';
  if (v.cat === 7) return 'Póker';
  if (v.cat === 6) return 'Full';
  if (v.cat === 5) return 'Color';
  if (v.cat === 4) return 'Escalera';
  if (v.cat === 3) return 'Trío';
  if (v.cat === 2) return 'Doble pareja';
  if (v.cat === 1) {
    const counts = {};
    for (const c of cards) counts[rankOf(c)] = (counts[rankOf(c)] || 0) + 1;
    const pair = Number(Object.keys(counts).find((r) => counts[r] === 2));
    if (pair >= 11) return 'Jotas o mejor';
  }
  return null;
}
const payFor = (name) => (PAYTABLE.find((p) => p[0] === name) || [null, 0])[1];

function deal(user, { bet }) {
  if (user.games.vpoker && !user.games.vpoker.done) throw new Error('Termina la mano actual.');
  const stake = hub.takeBet(user, bet, 'videopoker');
  const d = deck(1);
  const hand = d.splice(0, 5);
  user.games.vpoker = { bet: stake, hand, rest: d, done: false };
  db.save();
  return { hand, hint: classify(hand) };
}

function draw(user, { hold }) {
  const g = user.games.vpoker;
  if (!g || g.done) throw new Error('Reparte primero.');
  const keep = Array.isArray(hold) ? hold.map(Boolean) : [];
  g.hand = g.hand.map((c, i) => (keep[i] ? c : g.rest.shift()));
  g.done = true;
  delete g.rest;
  const name = classify(g.hand);
  const mult = payFor(name);
  const paid = mult ? hub.pay(user, g.bet * mult, g.bet, 'videopoker').paid : 0;
  db.save();
  return { hand: g.hand, result: name, mult, paid };
}

// Mano a medias (tras recargar o cambiar de pantalla): la apuesta ya está pagada, así que se puede retomar.
function state(user) {
  const g = user.games.vpoker;
  if (!g || g.done) return { hand: null };
  return { hand: g.hand, hint: classify(g.hand), bet: g.bet };
}

module.exports = { deal, draw, state, classify, PAYTABLE };
