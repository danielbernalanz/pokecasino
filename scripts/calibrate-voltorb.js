#!/usr/bin/env node
'use strict';
// Calibra los divisores de Voltorb Flip con la MEJOR estrategia conocida:
//  · inferencia exacta (se recorren todos los tableros compatibles con las pistas, scripts/strategies.js);
//  · se voltea siempre la casilla de menor riesgo y se prueban 90 reglas de PARADA sobre la misma trayectoria
//    (umbral de riesgo th × valor esperado mínimo de la siguiente carta lam): una retirada óptima de un paso incluida.
// Se queda con la regla que más puntos saca (sesgo a favor del jugador: es una cota superior) y propone el divisor
//   divisor = (E[min(puntos, tope)] + 2 errores estándar) / objetivo     (objetivo por defecto 93,5 %).
//   node scripts/calibrate-voltorb.js [--levels 1,2,3] [--games 2500] [--target 0.935] [--cap 12]
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'vf-cal-'));
const S = require('./strategies');
const vf = require('../server/games/voltorb');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const levels = String(opt('levels', '1,2,3,4,5,6,7,8')).split(',').map(Number);
const N = Number(opt('games', 2500));
const cap = Number(opt('cap', vf.SCORE_CAP));
const target = Number(opt('target', 0.935));
const ths = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.7, 1];
const lams = [0, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.5];

for (const lvl of levels) {
  const conf = vf.CONFIGS[lvl - 1];
  const rules = [];
  for (const th of ths) for (const lam of lams) rules.push({ th, lam, sum: 0, sq: 0 });
  for (let g = 0; g < N; g++) {
    const board = vf.makeBoard(lvl);
    const hints = vf.hints(board);
    const cells = Array(25).fill(null);
    let score = 0;
    let boom = false;
    const steps = [];
    for (;;) {
      if (!board.some((v, i) => v > 1 && cells[i] === null) || score >= cap) break;
      const post = S.voltorbPosterior(conf, hints, cells);
      let best = null;
      for (let k = 0; k < 25; k++) {
        if (cells[k] !== null) continue;
        const key = post.pVolt[k] - 0.01 * post.mean[k];
        if (!best || key < best.key) best = { key, p: post.pVolt[k], m: post.mean[k], idx: k };
      }
      steps.push({ s: score, p: best.p, m: best.m });
      cells[best.idx] = board[best.idx];
      if (board[best.idx] === 0) { boom = true; score = 0; break; }
      score = score === 0 ? board[best.idx] : score * board[best.idx];
    }
    const final = boom ? 0 : Math.min(score, cap);
    for (const r of rules) {
      let pts = final;
      for (const st of steps) if (st.s > 0 && !(st.p <= r.th && st.m > r.lam)) { pts = Math.min(st.s, cap); break; }
      r.sum += pts; r.sq += pts * pts;
    }
  }
  const out = rules.map((r) => ({ th: r.th, lam: r.lam, e: r.sum / N, se: Math.sqrt(r.sq / N - (r.sum / N) ** 2) / Math.sqrt(N) })).sort((a, b) => b.e - a.e);
  const b = out[0];
  console.log(`nivel ${lvl}: E[min(puntos,${cap})] = ${b.e.toFixed(2)} ± ${b.se.toFixed(2)} (th ${b.th}, lam ${b.lam}) → divisor ${((b.e + 2 * b.se) / target).toFixed(2)} para ${(target * 100).toFixed(1)} % · divisor actual ${vf.divisor(lvl)} → RTP ${(100 * b.e / vf.divisor(lvl)).toFixed(1)} % (+2 EE: ${(100 * (b.e + 2 * b.se) / vf.divisor(lvl)).toFixed(1)} %)`);
}
process.exit(0);
