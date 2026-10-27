'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-progress-'));

const db = require('../server/db');
const progress = require('../server/progress');
const items = require('../server/items');
const market = require('../server/market');
const hub = require('../server/hub');

function user(name, extra = {}) {
  const u = { id: 'id-' + name, username: name, coins: 10000, dust: 0, buddy: null, items: {}, buffs: {}, games: {}, collection: {}, stats: { pulls: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, ...extra };
  db.addUser(u);
  return u;
}

test('la Ruta del Entrenador avanza en orden y da premios', () => {
  const u = user('novato');
  assert.strictEqual(progress.view(u).tutorial.index, 0);
  progress.track(u, 'pull'); // fuera de orden: no cuenta
  assert.strictEqual(u.progress.tutorial, 0);
  progress.track(u, 'daily');
  assert.strictEqual(u.progress.tutorial, 1);
  assert.strictEqual(u.coins, 10300);
  u.stats.pulls = 1;
  progress.track(u, 'pull');
  assert.strictEqual(u.progress.tutorial, 2);
  assert.strictEqual(u.items.ticket, 1);
});

test('un paso ya cumplido se salta solo', () => {
  const u = user('veterano', { buddy: { id: 25, shiny: false }, collection: { 25: { n: 1, s: 0 } } });
  progress.track(u, 'daily');
  u.stats.pulls = 3;
  progress.track(u, 'pull');
  assert.strictEqual(u.progress.tutorial, 3, 'el paso del compañero se completa automáticamente');
});

test('medallas: nivel 5 da la Medalla Roca y sube el límite de apuesta', () => {
  const u = user('brock');
  assert.strictEqual(hub.maxBetFor(u), 10000);
  u.level = 5;
  progress.track(u, 'level');
  assert.ok(u.progress.badges.includes('roca'));
  assert.strictEqual(hub.maxBetFor(u), 15000);
  assert.ok(u.progress.titles.includes('badge-roca'));
});

test('completar una colección da título y +1 % permanente', () => {
  const u = user('profe', { collection: { 1: { n: 1, s: 0 }, 4: { n: 1, s: 0 }, 7: { n: 1, s: 0 } } });
  progress.evaluate(u);
  assert.ok(u.progress.sets.includes('starters'));
  assert.strictEqual(progress.setBonus(u), 0.01);
  assert.ok(u.progress.badges.includes('arcoiris'), 'y con ella la Medalla Arcoíris');
  assert.strictEqual(u.items['mystery-egg'], 2, 'un huevo por la colección y otro por la medalla');
});

test('huevo misterioso → cosmético equipable que se desequipa al venderlo', () => {
  const u = user('coleccionista', { items: { 'mystery-egg': 1 } });
  const r = items.use(u, { itemId: 'mystery-egg' });
  assert.ok(items.COSMETICS[r.got]);
  const slot = items.COSMETICS[r.got].slot;
  items.equip(u, { slot, id: r.got });
  assert.strictEqual(u.equip[slot], r.got);
  market.create(u, { kind: 'item', itemId: r.got, qty: 1, price: 100 });
  assert.strictEqual(u.equip[slot], null, 'al poner a la venta el último, se desequipa');
  assert.throws(() => items.equip(u, { slot, id: r.got }));
});

test('las misiones diarias son 3 y se renuevan cada día', () => {
  const u = user('diario');
  const v = progress.view(u);
  assert.strictEqual(v.daily.missions.length, 3);
  u.progress.daily.date = '2000-01-01';
  progress.view(u);
  assert.notStrictEqual(u.progress.daily.date, '2000-01-01');
});
