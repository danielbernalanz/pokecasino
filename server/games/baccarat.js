'use strict';
// Baccarat "Punto y Banca" con 8 barajas y reglas estándar de tercera carta.
const hub = require('../hub');
const { deck, rankOf } = require('../cards');

const PAYOUT = { player: 2, banker: 1.95, tie: 9 };
const val = (c) => { const r = rankOf(c); return r === 14 ? 1 : r >= 10 ? 0 : r; };
const score = (cards) => cards.reduce((s, c) => s + val(c), 0) % 10;

function coup() {
  const shoe = deck(8);
  const P = [shoe.pop(), shoe.pop()];
  const B = [shoe.pop(), shoe.pop()];
  const p = score(P);
  const b = score(B);
  if (p < 8 && b < 8) {
    let p3 = null;
    if (p <= 5) { P.push(shoe.pop()); p3 = val(P[2]); }
    const bs = score(B);
    let bankerDraws;
    if (p3 === null) bankerDraws = bs <= 5;
    else if (bs <= 2) bankerDraws = true;
    else if (bs === 3) bankerDraws = p3 !== 8;
    else if (bs === 4) bankerDraws = p3 >= 2 && p3 <= 7;
    else if (bs === 5) bankerDraws = p3 >= 4 && p3 <= 7;
    else if (bs === 6) bankerDraws = p3 === 6 || p3 === 7;
    else bankerDraws = false;
    if (bankerDraws) B.push(shoe.pop());
  }
  const ps = score(P);
  const bsF = score(B);
  return { player: P, banker: B, ps, bs: bsF, winner: ps > bsF ? 'player' : bsF > ps ? 'banker' : 'tie' };
}

function play(user, { bets }) {
  bets = bets || {};
  const list = Object.entries(bets).filter(([k, v]) => PAYOUT[k] && Number(v) > 0).map(([k, v]) => [k, Number(v)]);
  if (!list.length) throw new Error('Apuesta a Punto, Banca o Empate.');
  if (!list.every(([, v]) => hub.validAmount(v))) throw new Error('Importe no válido.');
  const stake = hub.takeBet(user, list.reduce((s, [, v]) => s + v, 0));
  const r = coup();
  let win = 0;
  for (const [k, v] of list) {
    if (k === r.winner) win += v * PAYOUT[k];
    else if (r.winner === 'tie' && k !== 'tie') win += v; // en empate se devuelven Punto y Banca
  }
  const paid = win > 0 ? hub.pay(user, win, stake, 'Baccarat').paid : 0;
  return { ...r, paid };
}

module.exports = { play, coup, score, PAYOUT };
