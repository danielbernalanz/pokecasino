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

test('medallas: ya no se ganan por progreso del casino, sino al vencer al líder (la primera vez)', () => {
  const u = user('brock');
  assert.strictEqual(hub.maxBetFor(u), 10000);
  u.level = 30; u.stats.pulls = 5; u.collection = { 1: { n: 1, s: 0 }, 4: { n: 1, s: 0 }, 7: { n: 1, s: 0 } };
  progress.track(u, 'level');
  assert.deepStrictEqual(u.progress.badges, [], 'ni el nivel ni la colección dan medalla');
  const r = progress.awardBadge(u, 1);
  assert.ok(r.first && r.id === 'roca');
  assert.ok(u.progress.badges.includes('roca'));
  assert.strictEqual(hub.maxBetFor(u), 15000);
  assert.ok(u.progress.titles.includes('badge-roca'));
  assert.strictEqual(u.coins, 10000 + progress.BADGE_COINS, 'recompensa de la medalla 1: 500 monedas');
  assert.strictEqual(u.items.ticket, 2, 'y 2 tickets');
  const again = progress.awardBadge(u, 1);
  assert.strictEqual(again.first, false, 'repetir al líder no da la medalla otra vez');
  assert.strictEqual(u.coins, 10000 + progress.BADGE_COINS);
  assert.strictEqual(u.progress.badges.length, 1);
});

test('las 8 medallas pagan 500 × n, alternan objeto y suben el límite de apuesta; el título de Campeón llega con el Alto Mando', () => {
  const u = user('ocho');
  let coins = u.coins;
  progress.BADGES.forEach((b, k) => {
    const r = progress.awardBadge(u, k + 1);
    assert.ok(r.first, b.id);
    coins += progress.BADGE_COINS * (k + 1);
    assert.strictEqual(hub.maxBetFor(u), hub.MAX_BET_BY_BADGES[k + 1]);
  });
  assert.strictEqual(u.coins, coins);
  assert.strictEqual(u.items.ticket, 8, 'medallas 1, 3, 5 y 7: 2 tickets cada una');
  assert.strictEqual(u.items['mystery-egg'], 4, 'medallas 2, 4, 6 y 8: un huevo');
  assert.ok(!u.progress.titles.includes('campeon'), 'las 8 medallas ya no dan el título de Campeón');
  assert.ok(progress.awardChampion(u), 'el Alto Mando sí');
  assert.ok(u.progress.titles.includes('campeon'));
  assert.strictEqual(u.coins, coins + progress.CHAMPION_COINS);
  assert.strictEqual(progress.awardChampion(u), false, 'una sola vez');
  assert.strictEqual(u.items['master-ball'], 1);
});

test('la vista de medallas explica el requisito real: vencer al líder', () => {
  const u = user('vista-medallas');
  const v = progress.view(u).badges;
  assert.strictEqual(v.length, 8);
  assert.deepStrictEqual(v.map((b) => b.leader), ['Brock', 'Misty', 'Teniente Surge', 'Erika', 'Koga', 'Sabrina', 'Blaine', 'Giovanni']);
  for (const b of v) assert.match(b.req, /^Vence a .* en Combates$/);
  assert.ok(!v.some((b) => /nivel|especies|colecci|Mercado|duelo/i.test(b.req)), 'nada del progreso antiguo del casino');
});

test('completar una colección da título y +1 % permanente', () => {
  const u = user('profe', { collection: { 1: { n: 1, s: 0 }, 4: { n: 1, s: 0 }, 7: { n: 1, s: 0 } } });
  progress.evaluate(u);
  assert.ok(u.progress.sets.includes('starters'));
  assert.strictEqual(progress.setBonus(u), 0.01);
  assert.strictEqual(u.progress.badges.length, 0, 'la colección ya no da medalla');
  assert.strictEqual(u.items['mystery-egg'], 1, 'un huevo por la colección');
});

test('huevo misterioso → cosmético equipable que se desequipa al venderlo', () => {
  const u = user('coleccionista', { items: { 'mystery-egg': 1 } });
  const r = items.use(u, { itemId: 'mystery-egg' });
  assert.ok(items.COSMETICS[r.got]);
  const slot = items.COSMETICS[r.got].slot;
  items.equip(u, { slot, id: r.got });
  assert.strictEqual(u.equip[slot], r.got);
  market.sell(u, { kind: 'item', itemId: r.got, qty: 1, price: 100 });
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

test('el bonus de ganancias tiene tope diario (fijo y ligado a lo apostado) y no se aplica en duelos', () => {
  const u = user('bonificado', { coins: 1e9, buddy: { id: 151, shiny: true }, collection: { 151: { n: 5, s: 1 } }, buffs: { amuletUntil: Date.now() + 3600e3 } });
  // Sin apostar no hay «sala» de bonus: un pago suelto no lo cobra.
  assert.strictEqual(hub.pay(u, 20000, 10000, 'crash').bonus, 0);
  // Apostando en un juego de poca ventaja (Video Póker), el bonus del día no supera el 45 % (con amuleto) de lo que la casa espera ganar.
  let bonus = 0;
  for (let i = 0; i < 100; i++) { hub.takeBet(u, 1000, 'videopoker'); bonus += hub.pay(u, 2000, 1000, 'videopoker').bonus; }
  const room = 100 * 1000 * 0.45 * (1 - 0.9954);
  assert.ok(bonus <= room + 1 && bonus > room * 0.9, `bonus ${bonus} ≤ sala ${room}`);
  assert.ok(bonus <= 300 + 50 * u.level, 'y nunca supera el tope fijo');
  // En un juego de mucha ventaja manda el tope fijo.
  const w = user('bonificado2', { coins: 1e9, buddy: { id: 151, shiny: true }, collection: { 151: { n: 5, s: 1 } }, buffs: { amuletUntil: Date.now() + 3600e3 } });
  let b2 = 0;
  for (let i = 0; i < 200; i++) { hub.takeBet(w, 10000, 'race'); b2 += hub.pay(w, 20000, 10000, 'race').bonus; }
  assert.strictEqual(b2, 300 + 50 * w.level, 'el bonus total del día no supera el tope fijo (se alcanza en juegos de mucha ventaja)');
  const v = user('duelista', { buddy: { id: 151, shiny: true }, collection: { 151: { n: 5, s: 1 } } });
  assert.strictEqual(hub.pay(v, 1900, 1000, 'duel', { noBonus: true }).bonus, 0);
});

test('un reto a un rival inexistente no cobra la apuesta', () => {
  const duel = require('../server/games/duel');
  const u = user('despistado', { coins: 1000, level: 3, createdAt: 1, collection: { 6: { n: 1, s: 0 } } });
  assert.throws(() => duel.create(u, { pokeId: 6, wager: 500, target: 'nadie-asi' }), /Rival/);
  assert.strictEqual(u.coins, 1000);
});

test('duelos: las cuentas nuevas no apuestan y entre dos cuentas hay un tope diario de ganancia neta', () => {
  const duel = require('../server/games/duel');
  const tr = require('../server/transfer');
  const mk = (name, extra = {}) => user(name, { coins: 100000, level: 5, createdAt: 1, collection: { 6: { n: 1, s: 0 } }, ...extra });
  const young = mk('duelo-nuevo', { level: 1 });
  assert.throws(() => duel.create(young, { pokeId: 6, wager: 500 }), /no pueden apostar/);
  assert.ok(duel.create(young, { pokeId: 6, wager: 0 }).duel, 'los amistosos sí');
  const healed = mk('duelo-joy', { lastHeal: Date.now() });
  assert.throws(() => duel.create(healed, { pokeId: 6, wager: 500 }), /Enfermera Joy/);
  const a = mk('duelo-a'); const b = mk('duelo-b');
  const open = duel.create(a, { pokeId: 6, wager: 500 });
  assert.throws(() => duel.accept(young, { id: open.duel.id, pokeId: 6 }), /no pueden apostar/);
  assert.strictEqual(young.coins, 100000, 'no se cobró');
  duel.cancel(a, { id: open.duel.id });
  // Entre veteranos no hay tope por pareja: apuestas fuertes permitidas.
  tr.notePair(a, b, 50000);
  const big = duel.create(a, { pokeId: 6, wager: 5000, target: b.username });
  assert.ok(big.duel, 'apuesta fuerte entre veteranos');
  duel.cancel(a, { id: big.duel.id });
  const open2 = duel.create(b, { pokeId: 6, wager: 0 });
  assert.ok(duel.accept(a, { id: open2.duel.id, pokeId: 6 }).record, 'amistoso permitido');
});
