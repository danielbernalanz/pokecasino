'use strict';
// Voltorb Flip, el clásico de la Esquina de Juegos de Johto, adaptado a apuestas.
const db = require('../db');
const hub = require('../hub');
const { pick, shuffle } = require('../rng');

// [x2, x3, voltorbs] por nivel (configuraciones originales de HG/SS).
const CONFIGS = [
  [[3, 1, 6], [0, 3, 6], [5, 0, 6], [2, 2, 6], [4, 1, 6]],
  [[1, 3, 7], [6, 0, 7], [3, 2, 7], [0, 4, 7], [5, 1, 7]],
  [[2, 3, 8], [7, 0, 8], [4, 2, 8], [1, 4, 8], [6, 1, 8]],
  [[3, 3, 8], [0, 5, 8], [8, 0, 10], [5, 2, 10], [2, 4, 10]],
  [[7, 1, 10], [4, 3, 10], [1, 5, 10], [9, 0, 10], [6, 2, 10]],
  [[3, 4, 10], [0, 6, 10], [8, 1, 10], [5, 3, 10], [2, 5, 10]],
  [[7, 2, 10], [4, 4, 10], [1, 6, 13], [9, 1, 13], [6, 3, 10]],
  [[0, 7, 10], [8, 2, 10], [5, 4, 10], [2, 6, 10], [7, 3, 10]],
];
// Divisores calibrados por simulación para que una estrategia razonable recupere ~95 % de lo apostado.
const DIVISORS = [16, 21, 21, 20, 16, 21, 19, 38];
const divisor = (level) => DIVISORS[level - 1];

function makeBoard(level) {
  const [x2, x3, v] = pick(CONFIGS[level - 1]);
  const cells = [...Array(x2).fill(2), ...Array(x3).fill(3), ...Array(v).fill(0)];
  while (cells.length < 25) cells.push(1);
  return shuffle(cells);
}

function hints(board) {
  const rows = [];
  const cols = [];
  for (let i = 0; i < 5; i++) {
    const r = { sum: 0, volt: 0 };
    const c = { sum: 0, volt: 0 };
    for (let j = 0; j < 5; j++) {
      const a = board[i * 5 + j];
      const b = board[j * 5 + i];
      r.sum += a; r.volt += a === 0 ? 1 : 0;
      c.sum += b; c.volt += b === 0 ? 1 : 0;
    }
    rows.push(r); cols.push(c);
  }
  return { rows, cols };
}

function view(user, reveal = false) {
  const g = user.voltorb.game;
  if (!g) return { level: user.voltorb.level, game: null };
  return {
    level: user.voltorb.level,
    game: {
      bet: g.bet,
      level: g.level,
      score: g.score,
      cashout: payout(g),
      cells: g.board.map((v, i) => (reveal || g.flipped[i] ? v : null)),
      hints: hints(g.board),
    },
  };
}

const payout = (g) => (g.score === 0 ? 0 : Math.floor((g.bet * g.score) / divisor(g.level)));

function start(user, { bet }) {
  if (user.voltorb.game) throw new Error('Ya tienes una partida en curso.');
  const stake = hub.takeBet(user, bet, 'voltorb');
  const level = user.voltorb.level;
  user.voltorb.game = { bet: stake, level, board: makeBoard(level), flipped: Array(25).fill(false), score: 0 };
  db.save();
  return view(user);
}

function finish(user, won) {
  const g = user.voltorb.game;
  const flips = g.flipped.filter(Boolean).length;
  let res;
  if (won) {
    const amount = payout(g);
    res = hub.pay(user, amount, g.bet, 'voltorb');
  } else {
    res = { paid: 0, bonus: 0 };
  }
  const final = view(user, true);
  user.voltorb.game = null;
  db.save();
  return { ...final, flips, ...res };
}

function flip(user, { index }) {
  const g = user.voltorb.game;
  if (!g) throw new Error('No hay partida en curso.');
  index = Number(index);
  if (!Number.isInteger(index) || index < 0 || index > 24) throw new Error('Casilla no válida.');
  if (g.flipped[index]) return view(user);
  g.flipped[index] = true;
  const v = g.board[index];
  if (v === 0) {
    const flips = g.flipped.filter(Boolean).length - 1;
    const res = finish(user, false);
    user.voltorb.level = Math.max(1, Math.min(user.voltorb.level, flips));
    db.save();
    return { ...res, outcome: 'boom', newLevel: user.voltorb.level };
  }
  g.score = g.score === 0 ? v : g.score * v;
  const remaining = g.board.some((val, i) => val > 1 && !g.flipped[i]);
  if (!remaining) {
    const res = finish(user, true);
    const before = user.voltorb.level;
    user.voltorb.level = Math.min(8, before + 1);
    if (before >= 6) hub.feed('win', `${user.username} superó el nivel ${before} de Voltorb Flip ⚡`);
    if (before >= 5) {
      user.items['amulet-coin'] = (user.items['amulet-coin'] || 0) + 1;
      hub.emitUser(user.id, 'toast', { kind: 'item', text: '🎒 Premio de Voltorb Flip: +1 Moneda Amuleto' });
    }
    db.save();
    return { ...res, outcome: 'clear', newLevel: user.voltorb.level };
  }
  db.save();
  return view(user);
}

function cashout(user) {
  const g = user.voltorb.game;
  if (!g) throw new Error('No hay partida en curso.');
  if (g.score === 0) throw new Error('Gira al menos una carta antes de retirarte.');
  const res = finish(user, true);
  return { ...res, outcome: 'cashout', newLevel: user.voltorb.level };
}

module.exports = { start, flip, cashout, view, hints, makeBoard, divisor, DIVISORS };
