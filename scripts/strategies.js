'use strict';
// Estrategias de juego para las simulaciones (scripts/simulate-economy.js y test/balance.test.js).
// Solo juegan con la API pública de los juegos del servidor: lo que miden es el código real.
const { rankOf, suitOf, eval5 } = require('../server/cards');

// ---- Video Póker (Jacks or Better): jerarquía clásica de «qué guardar» (≈99,3 % frente al 99,54 % óptimo) ----
const HIGH = (c) => rankOf(c) >= 11;
function vpPriority(held) {
  const n = held.length;
  const ranks = held.map(rankOf).sort((a, b) => a - b);
  const suited = n > 0 && held.every((c) => suitOf(c) === suitOf(held[0]));
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const mult = Object.values(counts).sort((a, b) => b - a);
  const span = ranks[n - 1] - ranks[0];
  const wheel = ranks.includes(14) && ranks.slice(0, -1).every((r) => r <= 5); // A-2-3-4-5
  const connected = n > 1 && new Set(ranks).size === n && (span <= 4 || (wheel && ranks.slice(0, -1)[n - 2] <= 5));
  const highs = held.filter(HIGH).length;
  if (n === 5) {
    const cat = eval5(held).cat;
    return cat >= 8 ? 1 : cat === 6 ? 3.1 : cat === 5 ? 3.2 : cat === 4 ? 3.5 : 30;
  }
  if (n === 4) {
    if (mult[0] === 4) return 1;
    if (suited && ranks.every((r) => r >= 10)) return 2;
    if (suited && connected) return 4;
    if (mult[0] === 2 && mult[1] === 2) return 5;
    if (suited) return 8;
    if (new Set(ranks).size === 4 && span === 3 && ranks[0] >= 2 && ranks[3] <= 13) return 10; // abierta
    if (new Set(ranks).size === 4 && (span === 4 || wheel)) return highs >= 3 ? 13 : highs === 2 ? 16 : highs === 1 ? 18.5 : 25; // «de ventana»
    return 30;
  }
  if (n === 3) {
    if (mult[0] === 3) return 3.3;
    if (suited && ranks.every((r) => r >= 10)) return 7;
    if (suited && connected) return 14;
    return 30;
  }
  if (n === 2) {
    if (mult[0] === 2) return ranks[0] >= 11 ? 6 : 9;
    if (suited && highs === 2) return 12;
    if (highs === 2) return 15;
    if (suited && ranks[0] === 10 && highs === 1) return 16;
    return 30;
  }
  if (n === 1) return highs ? 18 : 30;
  return 19; // descartar todo
}
function vpHold(hand) {
  let best = { p: 99, mask: 0 };
  for (let mask = 0; mask < 32; mask++) {
    const held = hand.filter((_, i) => mask & (1 << i));
    const p = vpPriority(held);
    if (p < best.p - 1e-9 || (Math.abs(p - best.p) < 1e-9 && held.length < best.n)) best = { p, mask, n: held.length };
  }
  return hand.map((_, i) => !!(best.mask & (1 << i)));
}

// ---- Blackjack: estrategia básica (6 barajas, el crupier se planta en 17, doblar con 2 cartas, dividir una vez) ----
const bjVal = (c) => { const r = rankOf(c); return r === 14 ? 11 : Math.min(10, r); };
function bjTotal(cards) {
  let t = 0;
  let aces = 0;
  for (const c of cards) { t += bjVal(c); if (rankOf(c) === 14) aces++; }
  while (t > 21 && aces) { t -= 10; aces--; }
  return { t, soft: aces > 0 };
}
function bjAction(cards, up, { canDouble, canSplit }) {
  const u = bjVal(up);
  const { t, soft } = bjTotal(cards);
  if (canSplit) {
    const v = bjVal(cards[0]);
    if (v === 11 || v === 8) return 'split';
    if (v === 9 && ![7, 10, 11].includes(u)) return 'split';
    if (v === 7 && u <= 7) return 'split';
    if (v === 6 && u >= 2 && u <= 6) return 'split';
    if ((v === 3 || v === 2) && u >= 4 && u <= 7) return 'split';
    if (v === 4 && (u === 5 || u === 6)) return 'split';
  }
  if (soft && cards.length >= 2) {
    if (t >= 19) return t === 19 && u === 6 && canDouble ? 'double' : 'stand';
    if (t === 18) return u >= 2 && u <= 6 && canDouble ? 'double' : u >= 9 ? 'hit' : 'stand';
    if (t === 17) return u >= 3 && u <= 6 && canDouble ? 'double' : 'hit';
    if (t === 15 || t === 16) return u >= 4 && u <= 6 && canDouble ? 'double' : 'hit';
    return u >= 5 && u <= 6 && canDouble ? 'double' : 'hit';
  }
  if (t >= 17) return 'stand';
  if (t >= 13) return u <= 6 ? 'stand' : 'hit';
  if (t === 12) return u >= 4 && u <= 6 ? 'stand' : 'hit';
  if (t === 11) return canDouble ? 'double' : 'hit';
  if (t === 10) return u <= 9 && canDouble ? 'double' : 'hit';
  if (t === 9) return u >= 3 && u <= 6 && canDouble ? 'double' : 'hit';
  return 'hit';
}

// ---- Voltorb Flip: voltea la casilla con menos probabilidad estimada de Voltorb y se retira cuando ya no compensa ----
function voltorbPlay(hubGame, user, bet, threshold = 0.3) {
  const vf = hubGame;
  let view = vf.start(user, { bet });
  for (let guard = 0; guard < 40; guard++) {
    const g = view.game;
    if (!g) return view;
    const { rows, cols } = g.hints;
    const cells = g.cells;
    // Estimación independiente por fila y columna (se actualiza con lo volteado).
    const rowLeft = rows.map((r, i) => ({ volt: r.volt, free: 0, sum: r.sum - [0, 1, 2, 3, 4].reduce((s, j) => s + (cells[i * 5 + j] || 0), 0), n: 0 }));
    const colLeft = cols.map((c, j) => ({ volt: c.volt, free: 0, sum: c.sum - [0, 1, 2, 3, 4].reduce((s, i) => s + (cells[i * 5 + j] || 0), 0), n: 0 }));
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if (cells[i * 5 + j] === null) { rowLeft[i].n++; colLeft[j].n++; }
    let best = null;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      if (cells[i * 5 + j] !== null) continue;
      const pr = Math.min(1, rowLeft[i].volt / rowLeft[i].n);
      const pc = Math.min(1, colLeft[j].volt / colLeft[j].n);
      const odds = (pr / (1 - pr || 1e-9)) * (pc / (1 - pc || 1e-9));
      const p = pr >= 1 || pc >= 1 ? 1 : odds / (1 + odds) || 0;
      // Una casilla segura (hay 0 Voltorb en su fila o columna) sirve aunque valga 1 (da pistas).
      const sure = rowLeft[i].volt === 0 || colLeft[j].volt === 0;
      const key = sure ? -1 + (0.001 * (rowLeft[i].sum + colLeft[j].sum)) * -1 : p;
      if (!best || key < best.key) best = { key, p: sure ? 0 : p, idx: i * 5 + j };
    }
    if (!best) return vf.cashout(user);
    if (g.cashout > 0 && best.p > threshold) return vf.cashout(user);
    const r = vf.flip(user, { index: best.idx });
    if (r.outcome) return r;
    view = r;
  }
  return view.game && view.game.cashout ? vf.cashout(user) : view;
}

module.exports = { vpHold, bjAction, bjTotal, voltorbPlay };

// ---- Voltorb Flip con inferencia exacta: se recorren todos los tableros compatibles con las pistas ----
// Devuelve, para cada casilla sin voltear, P(Voltorb) y el valor esperado de la carta si es segura.
function voltorbPosterior(configs, hints, cells) {
  const { rows, cols } = hints;
  const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800, 39916800, 479001600, 6227020800, 87178291200, 1307674368000, 20922789888000, 355687428096000, 6402373705728000, 121645100408832000, 2432902008176640000, 5.109094217170944e19, 1.1240007277776077e21, 2.585201673888498e22, 6.204484017332394e23, 1.5511210043330986e25];
  const patterns = [];
  for (let i = 0; i < 5; i++) {
    const list = [];
    const rec = (j, vals, sum, volt) => {
      if (j === 5) { if (sum === rows[i].sum && volt === rows[i].volt) list.push(vals.slice()); return; }
      const known = cells[i * 5 + j];
      for (const v of known === null ? [0, 1, 2, 3] : [known]) {
        if (sum + v > rows[i].sum || volt + (v === 0 ? 1 : 0) > rows[i].volt) continue;
        vals.push(v); rec(j + 1, vals, sum + v, volt + (v === 0 ? 1 : 0)); vals.pop();
      }
    };
    rec(0, [], 0, 0);
    patterns.push(list);
  }
  const volt = Array.from({ length: 25 }, () => 0);
  const val = Array.from({ length: 25 }, () => 0);
  let total = 0;
  const colSum = [0, 0, 0, 0, 0];
  const colVolt = [0, 0, 0, 0, 0];
  const board = [];
  const dfs = (i) => {
    if (i === 5) {
      for (let j = 0; j < 5; j++) if (colSum[j] !== cols[j].sum || colVolt[j] !== cols[j].volt) return;
      let x2 = 0, x3 = 0, v = 0;
      for (const b of board) { if (b === 2) x2++; else if (b === 3) x3++; else if (b === 0) v++; }
      if (!configs.some((c) => c[0] === x2 && c[1] === x3 && c[2] === v)) return;
      const w = (FACT[x2] * FACT[x3] * FACT[v] * FACT[25 - x2 - x3 - v]) / FACT[25];
      total += w;
      for (let k = 0; k < 25; k++) { if (board[k] === 0) volt[k] += w; val[k] += w * board[k]; }
      return;
    }
    for (const p of patterns[i]) {
      let ok = true;
      for (let j = 0; j < 5; j++) { colSum[j] += p[j]; colVolt[j] += p[j] === 0 ? 1 : 0; if (colSum[j] > cols[j].sum || colVolt[j] > cols[j].volt) ok = false; }
      if (ok) { board.push(...p); dfs(i + 1); board.length -= 5; }
      for (let j = 0; j < 5; j++) { colSum[j] -= p[j]; colVolt[j] -= p[j] === 0 ? 1 : 0; }
    }
  };
  dfs(0);
  return { total, pVolt: volt.map((x) => (total ? x / total : 0)), mean: val.map((x) => (total ? x / total : 0)) };
}

// Juega una partida de Voltorb con inferencia exacta: voltea la casilla de menor riesgo mientras el riesgo sea ≤ `threshold`.
function voltorbSmart(vf, user, bet, configs, threshold = 0.25) {
  let view = vf.start(user, { bet });
  for (let guard = 0; guard < 30; guard++) {
    const g = view.game;
    if (!g) return view;
    const post = voltorbPosterior(configs, g.hints, g.cells);
    let best = null;
    for (let k = 0; k < 25; k++) {
      if (g.cells[k] !== null) continue;
      // Entre las seguras, primero las que valen más (x2/x3 acercan el premio; las de valor 1 solo dan información).
      const key = post.pVolt[k] - 0.01 * post.mean[k];
      if (!best || key < best.key) best = { key, p: post.pVolt[k], idx: k };
    }
    if (!best) return vf.cashout(user);
    if (g.cashout > 0 && best.p > threshold) return vf.cashout(user);
    const r = vf.flip(user, { index: best.idx });
    if (r.outcome) return r;
    view = r;
  }
  return view.game && view.game.cashout ? vf.cashout(user) : view;
}

module.exports.voltorbPosterior = voltorbPosterior;
module.exports.voltorbSmart = voltorbSmart;
