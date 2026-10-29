'use strict';
// Plinko "Caída de Poké Balls": 12 filas de clavos, tres niveles de riesgo.
const hub = require('../hub');
const { randInt } = require('../rng');

const ROWS = 12;
const TABLES = {
  low: [8.6, 3, 1.5, 1.3, 1.1, 1, 0.5, 1, 1.1, 1.3, 1.5, 3, 8.6],
  medium: [31, 10, 4, 2, 1.1, 0.55, 0.3, 0.55, 1.1, 2, 4, 10, 31],
  high: [165, 23, 8, 2, 0.6, 0.2, 0.2, 0.2, 0.6, 2, 8, 23, 165],
};

function rtp(risk) {
  let c = 1;
  let s = 0;
  for (let k = 0; k <= ROWS; k++) {
    s += (c / 2 ** ROWS) * TABLES[risk][k];
    c = (c * (ROWS - k)) / (k + 1);
  }
  return s;
}

function drop(user, { bet, risk }) {
  if (!TABLES[risk]) throw new Error('Riesgo no válido.');
  const stake = hub.takeBet(user, bet, 'plinko');
  const path = Array.from({ length: ROWS }, () => randInt(0, 1));
  const bucket = path.reduce((a, b) => a + b, 0);
  const mult = TABLES[risk][bucket];
  const win = Math.floor(stake * mult);
  const paid = win > 0 ? hub.pay(user, win, stake, 'plinko').paid : 0;
  return { path, bucket, mult, paid };
}

module.exports = { drop, rtp, TABLES, ROWS };
