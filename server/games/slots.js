'use strict';
// Tragamonedas "Pika-Slots": 3x3, 5 líneas, Ditto comodín y bote progresivo compartido.
const db = require('../db');
const hub = require('../hub');
const { randInt } = require('../rng');

const SYMBOLS = {
  berry: { pay: 4, two: 1 },
  poke: { pay: 8 },
  great: { pay: 15 },
  ultra: { pay: 30 },
  pika: { pay: 60 },
  ditto: { pay: 120, wild: true },
  master: { pay: 250 },
};

// Cantidad de cada símbolo por rodillo.
const COUNTS = { berry: 12, poke: 9, great: 7, ultra: 4, pika: 3, ditto: 2, master: 1 };

// Construye una tira mezclada pero fija (determinista) para que el RTP sea calculable.
function buildStrip(seed) {
  const strip = [];
  for (const [s, n] of Object.entries(COUNTS)) for (let i = 0; i < n; i++) strip.push(s);
  let h = seed >>> 0;
  for (let i = strip.length - 1; i > 0; i--) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    const j = h % (i + 1);
    [strip[i], strip[j]] = [strip[j], strip[i]];
  }
  return strip;
}
const REELS = [buildStrip(7), buildStrip(42), buildStrip(1337)];

const LINES = [
  [[0, 0], [1, 0], [2, 0]],
  [[0, 1], [1, 1], [2, 1]],
  [[0, 2], [1, 2], [2, 2]],
  [[0, 0], [1, 1], [2, 2]],
  [[0, 2], [1, 1], [2, 0]],
];
const JACKPOT_CUT = 0.02;
const JACKPOT_SEED = 10000;

function grid(stops) {
  // grid[reel][row]
  return stops.map((stop, r) => {
    const s = REELS[r];
    const L = s.length;
    return [s[(stop - 1 + L) % L], s[stop], s[(stop + 1) % L]];
  });
}

function evalLine(syms) {
  if (syms.every((s) => s === 'master')) return { mult: SYMBOLS.master.pay, sym: 'master' };
  const target = syms.find((s) => s !== 'ditto');
  if (!target) return { mult: SYMBOLS.ditto.pay, sym: 'ditto' };
  const match = (s) => s === target || (s === 'ditto' && target !== 'master');
  if (syms.every(match)) return { mult: SYMBOLS[target].pay, sym: target };
  const berryish = (s) => s === 'berry' || s === 'ditto';
  if (berryish(syms[0]) && berryish(syms[1]) && (syms[0] === 'berry' || syms[1] === 'berry')) {
    return { mult: SYMBOLS.berry.two, sym: 'berry', two: true };
  }
  return null;
}

function evaluate(g) {
  const wins = [];
  let mult = 0;
  LINES.forEach((line, i) => {
    const syms = line.map(([r, row]) => g[r][row]);
    const w = evalLine(syms);
    if (w) { wins.push({ line: i, ...w }); mult += w.mult; }
  });
  // mult es por línea: cada línea vale apuesta/5
  return { wins, mult: mult / LINES.length, jackpot: g.every((reel) => reel[1] === 'master') };
}

// RTP exacto (sin bote) recorriendo todas las combinaciones.
function computeRTP() {
  let total = 0;
  let n = 0;
  const [a, b, c] = REELS.map((r) => r.length);
  for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) for (let k = 0; k < c; k++) {
    total += evaluate(grid([i, j, k])).mult;
    n++;
  }
  return total / n;
}

function spin(user, { bet }) {
  const stake = hub.takeBet(user, bet);
  const cut = Math.floor(stake * JACKPOT_CUT);
  db.data.state.jackpot += cut;
  const stops = REELS.map((r) => randInt(0, r.length - 1));
  const g = grid(stops);
  const res = evaluate(g);
  let win = Math.floor(stake * res.mult);
  let jackpotWon = 0;
  if (res.jackpot) {
    jackpotWon = db.data.state.jackpot;
    db.data.state.jackpot = JACKPOT_SEED;
    hub.feed('jackpot', `💥 ¡${user.username} se llevó el BOTE de ${jackpotWon.toLocaleString('es')} monedas en Pika-Slots!`);
  }
  const { paid, bonus } = win + jackpotWon > 0 ? hub.pay(user, win + jackpotWon, stake, 'Pika-Slots') : { paid: 0, bonus: 0 };
  hub.broadcast('jackpot', db.data.state.jackpot);
  db.save();
  return { grid: g, wins: res.wins, paid, bonus, jackpotWon, jackpot: db.data.state.jackpot };
}

module.exports = { spin, computeRTP, evaluate, grid, REELS, SYMBOLS, LINES };
