'use strict';
const test = require('node:test');
const assert = require('node:assert');
const tr = require('../server/transfer');

const DAY = 864e5;
test('las cuentas nuevas no regalan y hay tope diario de regalos recibidos', () => {
  const now = Date.now();
  assert.throws(() => tr.canGift({ level: 10, createdAt: now - DAY }, now));
  assert.throws(() => tr.canGift({ level: 2, createdAt: now - 10 * DAY }, now));
  assert.doesNotThrow(() => tr.canGift({ level: 3, createdAt: now - 3 * DAY }, now));
  const t = {};
  assert.equal(tr.giftInLeft(t, now), tr.GIFT_IN_DAILY);
  tr.noteGiftIn(t, 4000, now);
  assert.equal(tr.giftInLeft(t, now), tr.GIFT_IN_DAILY - 4000);
  assert.equal(tr.giftInLeft(t, now + DAY), tr.GIFT_IN_DAILY);
});

test('las cuentas nuevas no pueden pagar precios inflados en el Mercado', () => {
  const now = Date.now();
  const a = { kind: 'poke', pokeId: 10, shiny: false };
  const max = tr.maxBuyPrice({ level: 1, createdAt: now }, a, now);
  assert.ok(Number.isFinite(max) && max < 5000, String(max));
  assert.equal(tr.maxBuyPrice({ level: 20, createdAt: now - 30 * DAY }, a, now), Infinity);
});
