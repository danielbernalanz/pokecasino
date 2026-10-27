'use strict';
// Crash "¡El Team Rocket despega de nuevo!": el multiplicador sube hasta que salen volando.
// Ronda compartida por todos; retírate antes de que exploten.
const db = require('../db');
const hub = require('../hub');
const { rand } = require('../rng');

const EDGE = 0.97;
const GROWTH = 0.09; // m(t) = e^(0.09·t)
const BETTING_MS = 9000;
const AFTER_MS = 4000;
const MAX_CRASH = 1000;

let round = null;
let roundNo = 0;
const history = [];

const multAt = (ms) => Math.floor(Math.exp(GROWTH * (ms / 1000)) * 100) / 100;
const msFor = (m) => (Math.log(m) / GROWTH) * 1000;

// P(crash ≥ x) = 0.97 / x  →  retirarse en cualquier x devuelve el 97 % de media.
function crashPoint() {
  const u = rand();
  const x = Math.floor((EDGE / (1 - u)) * 100) / 100;
  return Math.min(MAX_CRASH, Math.max(1, x));
}

function publicState() {
  if (!round) return null;
  return {
    round: round.no, phase: round.phase, now: Date.now(), startsAt: round.startsAt, flyAt: round.flyAt,
    crash: round.phase === 'crashed' ? round.crash : null,
    players: Object.values(round.bets).map((b) => ({ username: b.username, amount: b.amount, cashedAt: b.cashedAt, paid: b.paid, auto: b.auto })),
    history: history.slice(0, 15),
  };
}
const push = () => hub.broadcast('crash:state', publicState());

function newRound() {
  roundNo++;
  round = { no: roundNo, phase: 'betting', startsAt: Date.now() + BETTING_MS, crash: crashPoint(), bets: {} };
  push();
  setTimeout(fly, BETTING_MS);
}

let ticker = null;
function fly() {
  round.phase = 'flying';
  round.flyAt = Date.now();
  push();
  ticker = setInterval(tick, 50);
}

function tick() {
  const m = multAt(Date.now() - round.flyAt);
  // Retiradas automáticas que ya se alcanzaron (se pagan a su objetivo exacto).
  for (const b of Object.values(round.bets)) {
    if (!b.cashedAt && b.auto && b.auto <= Math.min(m, round.crash) && b.auto < round.crash) settleBet(b, b.auto);
  }
  if (m >= round.crash) {
    clearInterval(ticker);
    round.phase = 'crashed';
    history.unshift(round.crash);
    history.length = Math.min(history.length, 30);
    for (const b of Object.values(round.bets)) {
      if (!b.cashedAt) {
        const u = db.userById(b.userId);
        if (u) hub.emitUser(u.id, 'crash:result', { lost: b.amount, crash: round.crash });
      }
    }
    if (round.crash >= 50) hub.feed('win', `🚀 ¡El Team Rocket voló hasta ×${round.crash} en Crash!`);
    push();
    setTimeout(newRound, AFTER_MS);
  }
}

function settleBet(b, at) {
  const u = db.userById(b.userId);
  b.cashedAt = at;
  if (!u) return;
  b.paid = hub.pay(u, b.amount * at, b.amount, 'Crash').paid;
  hub.emitUser(u.id, 'crash:result', { paid: b.paid, at });
  hub.pushMe(u);
  push();
}

function bet(user, { amount, auto }) {
  if (!round || round.phase !== 'betting') throw new Error('Espera a la siguiente ronda.');
  if (round.bets[user.id]) throw new Error('Ya apostaste en esta ronda.');
  auto = auto ? Number(auto) : null;
  if (auto !== null && (!Number.isFinite(auto) || auto < 1.01 || auto > MAX_CRASH)) throw new Error('Retiro automático entre ×1.01 y ×1000.');
  const stake = hub.takeBet(user, amount);
  round.bets[user.id] = { userId: user.id, username: user.username, amount: stake, auto: auto ? Math.floor(auto * 100) / 100 : null, cashedAt: null, paid: 0 };
  push();
  return {};
}

function cashout(user) {
  if (!round || round.phase !== 'flying') throw new Error('No hay vuelo en curso.');
  const b = round.bets[user.id];
  if (!b || b.cashedAt) throw new Error('No tienes apuesta activa.');
  const m = multAt(Date.now() - round.flyAt);
  if (m >= round.crash) throw new Error('¡Demasiado tarde!');
  settleBet(b, m);
  return { at: m, paid: b.paid };
}

function refundAll() {
  if (!round || round.phase === 'crashed') return;
  for (const b of Object.values(round.bets)) {
    const u = db.userById(b.userId);
    if (u && !b.cashedAt) u.coins += b.amount;
  }
  round.bets = {};
}

module.exports = { start: newRound, bet, cashout, publicState, refundAll, crashPoint, multAt, msFor, GROWTH };
