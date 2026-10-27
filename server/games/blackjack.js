'use strict';
// Blackjack "Mesa de Snorlax": 6 barajas, el crupier se planta en 17, BJ paga 3:2,
// doblar con dos cartas y dividir parejas una vez.
const db = require('../db');
const hub = require('../hub');
const { deck, rankOf } = require('../cards');

const cardValue = (c) => { const r = rankOf(c); return r === 14 ? 11 : Math.min(10, r); };
function total(cards) {
  let t = 0;
  let aces = 0;
  for (const c of cards) { t += cardValue(c); if (rankOf(c) === 14) aces++; }
  while (t > 21 && aces) { t -= 10; aces--; }
  return { t, soft: aces > 0 };
}
const isBJ = (cards) => cards.length === 2 && total(cards).t === 21;

function view(user, reveal = false) {
  const g = user.games.blackjack;
  if (!g) return { game: null };
  const showDealer = reveal || g.done;
  return {
    game: {
      hands: g.hands.map((h) => ({ cards: h.cards, bet: h.bet, done: h.done, total: total(h.cards).t, result: h.result, split: h.split })),
      active: g.active,
      dealer: showDealer ? g.dealer : [g.dealer[0], '??'],
      dealerTotal: showDealer ? total(g.dealer).t : cardValue(g.dealer[0]),
      done: g.done,
      paid: g.paid,
      canDouble: !g.done && canDouble(user, g),
      canSplit: !g.done && canSplit(user, g),
    },
  };
}

const cur = (g) => g.hands[g.active];
function canDouble(user, g) { const h = cur(g); return h && h.cards.length === 2 && user.coins >= h.bet && !h.aceSplit; }
function canSplit(user, g) {
  const h = cur(g);
  return h && g.hands.length === 1 && h.cards.length === 2 && cardValue(h.cards[0]) === cardValue(h.cards[1]) && user.coins >= h.bet;
}

function deal(user, { bet }) {
  if (user.games.blackjack && !user.games.blackjack.done) throw new Error('Termina la mano actual.');
  const stake = hub.takeBet(user, bet, 'blackjack');
  const shoe = deck(6);
  const g = { shoe, hands: [{ cards: [shoe.pop(), shoe.pop()], bet: stake, done: false }], dealer: [shoe.pop(), shoe.pop()], active: 0, done: false, paid: 0 };
  user.games.blackjack = g;
  // Si alguien tiene blackjack la mano se resuelve al momento.
  if (isBJ(g.dealer) || isBJ(g.hands[0].cards)) return settle(user);
  db.save();
  return view(user);
}

function advance(user) {
  const g = user.games.blackjack;
  while (g.active < g.hands.length && g.hands[g.active].done) g.active++;
  if (g.active >= g.hands.length) return settle(user);
  db.save();
  return view(user);
}

function act(user, { action }) {
  const g = user.games.blackjack;
  if (!g || g.done) throw new Error('No hay mano en juego.');
  const h = cur(g);
  if (action === 'hit') {
    h.cards.push(g.shoe.pop());
    if (total(h.cards).t >= 21) h.done = true;
  } else if (action === 'stand') {
    h.done = true;
  } else if (action === 'double') {
    if (!canDouble(user, g)) throw new Error('No puedes doblar ahora.');
    hub.takeBet(user, h.bet, 'blackjack', { extra: true });
    h.bet *= 2;
    h.cards.push(g.shoe.pop());
    h.done = true;
  } else if (action === 'split') {
    if (!canSplit(user, g)) throw new Error('No puedes dividir ahora.');
    hub.takeBet(user, h.bet, 'blackjack', { extra: true });
    const aces = rankOf(h.cards[0]) === 14;
    const second = { cards: [h.cards.pop(), g.shoe.pop()], bet: h.bet, done: aces, split: true, aceSplit: aces };
    h.cards.push(g.shoe.pop());
    h.split = true;
    h.aceSplit = aces;
    h.done = aces; // con ases solo se recibe una carta
    g.hands.push(second);
  } else {
    throw new Error('Acción no válida.');
  }
  return advance(user);
}

function settle(user) {
  const g = user.games.blackjack;
  const live = g.hands.some((h) => total(h.cards).t <= 21);
  const dealerBJ = isBJ(g.dealer);
  if (live && !dealerBJ && !(g.hands.length === 1 && isBJ(g.hands[0].cards))) {
    while (total(g.dealer).t < 17) g.dealer.push(g.shoe.pop());
  }
  const d = total(g.dealer).t;
  let win = 0;
  let staked = 0;
  for (const h of g.hands) {
    const p = total(h.cards).t;
    const bj = isBJ(h.cards) && !h.split;
    staked += h.bet;
    let r;
    if (p > 21) r = 'bust';
    else if (bj && !dealerBJ) { r = 'blackjack'; win += h.bet * 2.5; }
    else if (dealerBJ) { r = bj ? 'push' : 'lose'; if (bj) win += h.bet; }
    else if (d > 21 || p > d) { r = 'win'; win += h.bet * 2; }
    else if (p === d) { r = 'push'; win += h.bet; }
    else r = 'lose';
    h.result = r;
    h.done = true;
  }
  g.done = true;
  g.paid = win > 0 ? hub.pay(user, win, staked, 'blackjack').paid : 0;
  delete g.shoe;
  db.save();
  return view(user, true);
}

module.exports = { deal, act, view, total };
