'use strict';
// Aleatoriedad criptográfica para todo lo que mueve monedas.
const crypto = require('crypto');

const rand = () => crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
const randInt = (min, max) => crypto.randomInt(min, max + 1);
const pick = (arr) => arr[crypto.randomInt(0, arr.length)];

function weighted(items, weightOf) {
  const total = items.reduce((s, it) => s + weightOf(it), 0);
  let r = rand() * total;
  for (const it of items) {
    r -= weightOf(it);
    if (r < 0) return it;
  }
  return items[items.length - 1];
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { rand, randInt, pick, weighted, shuffle };
