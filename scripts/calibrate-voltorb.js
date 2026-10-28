#!/usr/bin/env node
'use strict';
// Calibra los divisores de Voltorb Flip: juega con INFERENCIA EXACTA (se recorren todos los tableros compatibles
// con las pistas, scripts/strategies.js) y mide E[min(puntos, tope)] de la mejor estrategia por nivel.
// El divisor que deja el RTP de esa estrategia en el objetivo (95 %) es  E / 0.95.
//   node scripts/calibrate-voltorb.js [--levels 1,2,3] [--games 1000] [--th 0.15,0.25] [--cap 12] [--target 0.95]
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'vf-cal-'));
const S = require('./strategies');
const vf = require('../server/games/voltorb');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const levels = String(opt('levels', '1,2,3,4,5,6,7,8')).split(',').map(Number);
const N = Number(opt('games', 500));
const ths = String(opt('th', '0.15,0.25')).split(',').map(Number);
const cap = Number(opt('cap', vf.SCORE_CAP));
const target = Number(opt('target', 0.95));

for (const lvl of levels) {
  const conf = vf.CONFIGS[lvl - 1];
  const res = ths.map((th) => ({ th, sum: 0, sq: 0, boom: 0 }));
  for (let g = 0; g < N; g++) {
    const board = vf.makeBoard(lvl);
    const hints = vf.hints(board);
    for (const r of res) {
      const cells = Array(25).fill(null);
      let score = 0;
      let boom = false;
      for (;;) {
        if (!board.some((v, i) => v > 1 && cells[i] === null) || score >= cap) break;
        const post = S.voltorbPosterior(conf, hints, cells);
        let best = null;
        for (let k = 0; k < 25; k++) {
          if (cells[k] !== null) continue;
          const key = post.pVolt[k] - 0.01 * post.mean[k];
          if (!best || key < best.key) best = { key, p: post.pVolt[k], idx: k };
        }
        if (score > 0 && best.p > r.th) break;
        cells[best.idx] = board[best.idx];
        if (board[best.idx] === 0) { boom = true; score = 0; break; }
        if (board[best.idx] > 1) score = score === 0 ? board[best.idx] : score * board[best.idx];
      }
      const pts = Math.min(score, cap);
      r.sum += pts; r.sq += pts * pts; if (boom) r.boom++;
    }
  }
  const best = res.map((r) => ({ ...r, e: r.sum / N, se: Math.sqrt(r.sq / N - (r.sum / N) ** 2) / Math.sqrt(N) })).sort((a, b) => b.e - a.e)[0];
  console.log(`nivel ${lvl}: E[min(puntos,${cap})] = ${best.e.toFixed(2)} ± ${best.se.toFixed(2)} (umbral ${best.th}, explota ${(100 * best.boom / N).toFixed(0)} %) → divisor para ${target * 100} %: ${(best.e / target).toFixed(1)}  · divisor actual ${vf.divisor(lvl)} → RTP ${(100 * best.e / vf.divisor(lvl)).toFixed(1)} %`);
}
process.exit(0);
