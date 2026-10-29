'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-events-'));

const db = require('../server/db');
const events = require('../server/events');
const market = require('../server/market');

const ids = (t) => events.active(Date.parse(t)).map((e) => e.id).sort().join(',');

test('el calendario sigue la hora de España', () => {
  assert.strictEqual(ids('2026-11-02T10:00:00Z'), 'duels'); // lunes
  assert.strictEqual(ids('2026-11-03T10:00:00Z'), ''); // martes
  assert.strictEqual(ids('2026-11-04T10:00:00Z'), 'missions');
  assert.strictEqual(ids('2026-11-06T10:00:00Z'), 'market');
  assert.strictEqual(ids('2026-11-06T23:30:00Z'), 'buddy,shiny'); // 00:30 del sábado en Madrid
  assert.strictEqual(ids('2026-11-08T22:59:00Z'), 'buddy,shiny'); // 23:59 del domingo
  assert.strictEqual(ids('2026-11-08T23:01:00Z'), 'duels');
  // El fin de semana se anuncia como un único evento que acaba el domingo a medianoche.
  const sat = events.active(Date.parse('2026-11-07T12:00:00Z')).find((e) => e.id === 'shiny');
  assert.strictEqual(new Date(sat.ends).toISOString(), '2026-11-08T23:00:00.000Z');
});

test('el anfitrión puede lanzar y cancelar eventos', () => {
  db.data.state.events = {};
  assert.throws(() => events.force('nada', 2));
  assert.throws(() => events.force('market', 100));
  events.force('market', 2);
  assert.ok(events.has('market'));
  assert.ok(events.active().find((e) => e.id === 'market').forced);
  events.force('market', 0);
  assert.ok(!events.active().some((e) => e.forced));
});

test('Viernes de Mercado: sin impuesto y comisión a la mitad', () => {
  market.init();
  const mk = (name) => { const u = { id: 'id-' + name, username: name, coins: 100000, dust: 0, buddy: null, items: {}, buffs: {}, games: {}, collection: {}, stats: {}, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1 }; db.addUser(u); return u; };
  const s = mk('vende');
  const b = mk('compra');
  s.items['master-ball'] = 2;
  events.force('market', 1);
  market.sell(s, { kind: 'item', itemId: 'master-ball', qty: 1, price: 10000 });
  assert.strictEqual(s.coins, 100000 - 75, 'comisión 0,75 %');
  market.buy(b, { kind: 'item', itemId: 'master-ball', qty: 1, price: 10000, instant: true });
  assert.strictEqual(s.coins, 100000 - 75 + 10000, 'sin impuesto');
  assert.strictEqual(market.state().salesTax, 0);
  events.force('market', 0);
  if (!events.has('market')) assert.strictEqual(market.state().salesTax, market.SALES_TAX);
});
