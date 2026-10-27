'use strict';
// Minas "Campo de Geodude": 5×5 casillas con Geodude escondidos. Retírate cuando quieras.
const db = require('../db');
const hub = require('../hub');
const { shuffle } = require('../rng');

const EDGE = 0.97;
const CELLS = 25;

// Multiplicador justo tras `safe` aciertos con `mines` minas, menos el margen de la casa.
function multiplier(mines, safe) {
  let m = 1;
  for (let i = 0; i < safe; i++) m *= (CELLS - i) / (CELLS - mines - i);
  return safe === 0 ? 1 : Math.floor(m * EDGE * 100) / 100;
}

function view(g, reveal) {
  return {
    bet: g.bet, mines: g.mines, revealed: g.revealed, done: g.done,
    mult: multiplier(g.mines, g.revealed.length), next: multiplier(g.mines, g.revealed.length + 1),
    board: reveal ? g.board : null,
  };
}

function start(user, { bet, mines }) {
  const cur = user.games.mines;
  if (cur && !cur.done) throw new Error('Termina la partida actual.');
  mines = Number(mines);
  if (!Number.isInteger(mines) || mines < 1 || mines > 24) throw new Error('Elige entre 1 y 24 Geodude.');
  const stake = hub.takeBet(user, bet);
  const board = shuffle([...Array(mines).fill(1), ...Array(CELLS - mines).fill(0)]);
  user.games.mines = { bet: stake, mines, board, revealed: [], done: false };
  db.save();
  return { game: view(user.games.mines) };
}

function pick(user, { index }) {
  const g = user.games.mines;
  index = Number(index);
  if (!g || g.done) throw new Error('No hay partida en curso.');
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) throw new Error('Casilla no válida.');
  if (g.revealed.includes(index)) return { game: view(g) };
  if (g.board[index] === 1) {
    g.done = true;
    g.boom = index;
    db.save();
    return { game: view(g, true), boom: index };
  }
  g.revealed.push(index);
  if (g.revealed.length === CELLS - g.mines) return cashout(user);
  db.save();
  return { game: view(g) };
}

function cashout(user) {
  const g = user.games.mines;
  if (!g || g.done) throw new Error('No hay partida en curso.');
  if (!g.revealed.length) throw new Error('Descubre al menos una casilla.');
  g.done = true;
  const mult = multiplier(g.mines, g.revealed.length);
  const paid = hub.pay(user, g.bet * mult, g.bet, 'Minas Geodude').paid;
  db.save();
  return { game: view(g, true), paid, mult };
}

function state(user) {
  const g = user.games.mines;
  return { game: g && !g.done ? view(g) : null };
}

module.exports = { start, pick, cashout, state, multiplier };
