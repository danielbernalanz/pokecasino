'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-evs-'));

const db = require('../server/db');
const sp = require('../server/specimen');
const sd = require('../server/sdmap');
const items = require('../server/items');
const evs = require('../server/evs');
const exp = require('../server/expedition');
const { BY_ID } = require('../server/pokedex');

let n = 0;
function user(collection = {}, extra = {}) {
  const name = 'ev' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 100000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, ...extra };
  db.addUser(u);
  sp.syncAll(u);
  return u;
}
function clock(t0 = Date.now()) {
  const real = Date.now;
  let t = t0;
  Date.now = () => t;
  return { advance: (ms) => { t += ms; return t; }, restore: () => { Date.now = real; } };
}
const H = 3600 * 1000;

test('ejemplares nuevos empiezan con 0 EV y los antiguos (sin campo) reciben 84 en cada estadística', () => {
  const u = user({ 25: { n: 1, s: 0 } });
  const m = u.mons[25][0];
  assert.deepStrictEqual(m.evs, [0, 0, 0, 0, 0, 0]);
  const old = { ...m }; delete old.evs;
  assert.deepStrictEqual(evs.ensure(old), [84, 84, 84, 84, 84, 84]);
  assert.strictEqual(evs.total(old), 504);
});

test('topes: 252 por estadística y 510 en total', () => {
  const m = { evs: [0, 0, 0, 0, 0, 0] };
  assert.strictEqual(evs.add(m, 1, 300), 252);
  assert.strictEqual(evs.add(m, 1, 10), 0);
  assert.strictEqual(evs.add(m, 3, 252), 252);
  assert.strictEqual(evs.add(m, 5, 100), 6); // 510 - 504
  assert.strictEqual(evs.total(m), 510);
  assert.strictEqual(evs.add(m, 0, 4), 0);
  // datos corruptos se corrigen
  const bad = { evs: [999, 999, 999, -5, 1.5, 'x'] };
  evs.ensure(bad);
  assert.ok(bad.evs.every((v) => v >= 0 && v <= 252) && evs.total(bad) <= 510);
});

test('migración: los conjuntos de Showdown de un ejemplar antiguo usan 84 (igual que antes) y los nuevos sus EVs reales', () => {
  const u = user({ 25: { n: 2, s: 0 } });
  const [a, b] = u.mons[25];
  delete a.evs; // ejemplar anterior al sistema
  const before = sd.toSet(25, a, { level: 'fair' }).set;
  assert.deepStrictEqual(before.evs, { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 });
  assert.deepStrictEqual(sd.toSet(25, b, { level: 'fair' }).set.evs, { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
  evs.add(b, 3, 252);
  evs.add(b, 5, 252);
  const s2 = sd.toSet(25, b, { level: 'real' }).set;
  assert.strictEqual(s2.evs.spa, 252);
  assert.strictEqual(s2.evs.spe, 252);
  // modo justo (nivel 50) también usa los EVs reales
  assert.strictEqual(sd.toSet(25, b, { level: 'fair' }).set.evs.spa, 252);
  // las estadísticas de Nv. 50 incluyen los EVs; las del antiguo valen lo mismo que con 84 EV (+21)
  const base = BY_ID.get(25).stats;
  assert.strictEqual(sp.computeStats(25, a)[0], Math.floor(((2 * base[0] + a.ivs[0] + 21) * 50) / 100) + 60);
});

test('vitaminas y bayas: +10/−10, topes, se consumen y no se usan sin tenerlas', () => {
  const u = user({ 25: { n: 1, s: 0 } });
  const m = u.mons[25][0];
  const ref = { id: 25, uid: m.uid };
  assert.throws(() => evs.use(u, { ...ref, itemId: 'vit-spa' }), /No tienes/);
  items.give(u, 'vit-spa', 30);
  const r = evs.use(u, { ...ref, itemId: 'vit-spa' });
  assert.strictEqual(r.delta, 10);
  assert.strictEqual(m.evs[3], 10);
  assert.strictEqual(u.items['vit-spa'], 29);
  const r2 = evs.use(u, { ...ref, itemId: 'vit-spa', qty: 26 }); // solo gasta las necesarias hasta 252
  assert.strictEqual(m.evs[3], 252);
  assert.strictEqual(r2.used, 25);
  assert.strictEqual(u.items['vit-spa'], 4);
  assert.throws(() => evs.use(u, { ...ref, itemId: 'vit-spa' }), /máximo/);
  // total 510
  items.give(u, 'vit-atk', 30); items.give(u, 'vit-spe', 30);
  evs.use(u, { ...ref, itemId: 'vit-atk', qty: 26 });
  assert.strictEqual(m.evs[1], 252);
  evs.use(u, { ...ref, itemId: 'vit-spe', qty: 3 });
  assert.strictEqual(evs.total(m), 510);
  assert.strictEqual(m.evs[5], 6);
  assert.throws(() => evs.use(u, { ...ref, itemId: 'vit-spe' }), /510/);
  // bayas
  items.give(u, 'evb-spa', 2);
  evs.use(u, { ...ref, itemId: 'evb-spa' });
  assert.strictEqual(m.evs[3], 242);
  assert.throws(() => evs.use(u, { ...ref, itemId: 'evb-hp' }), /No tienes/);
  items.give(u, 'evb-hp', 1);
  assert.throws(() => evs.use(u, { ...ref, itemId: 'evb-hp' }), /No tiene EV/);
  assert.strictEqual(u.items['evb-hp'], 1); // no se gasta si falla
  assert.throws(() => evs.use(u, { ...ref, itemId: 'ticket' }), /no se usa así/);
});

test('vitaminas se compran en la Tienda por 1.000 monedas y las bayas por 300', () => {
  const u = user({});
  items.buy(u, { itemId: 'vit-hp', qty: 2 });
  assert.strictEqual(u.coins, 100000 - 2000);
  assert.strictEqual(u.items['vit-hp'], 2);
  items.buy(u, { itemId: 'evb-spe', qty: 1 });
  assert.strictEqual(u.coins, 100000 - 2300);
  assert.strictEqual(items.ITEMS['vit-hp'].price, 1000);
  assert.strictEqual(items.ITEMS['evb-hp'].price, 300);
});

test('expedición: +4 EV por hora en la estadística de la zona, tope diario 60 por ejemplar', () => {
  const ck = clock();
  try {
    const u = user({ 4: { n: 1, s: 0 } });
    const m = u.mons[4][0];
    assert.strictEqual(exp.ZONE_BY_ID.get('volcan').ev, 3); // At. Esp.
    const e1 = exp.send(u, { zone: 'volcan', hours: 12, team: [{ id: 4, uid: m.uid }] }).exps[0];
    ck.advance(12 * H);
    const r = exp.claim(u, { id: e1.id }).reward;
    assert.strictEqual(r.ev, 48);
    assert.strictEqual(r.evStat, 3);
    assert.strictEqual(m.evs[3], 48);
    const e2 = exp.send(u, { zone: 'volcan', hours: 12, team: [{ id: 4, uid: m.uid }] }).exps[0];
    ck.advance(12 * H);
    const r2 = exp.claim(u, { id: e2.id }).reward;
    assert.strictEqual(r2.ev, 12); // 60 − 48
    assert.strictEqual(m.evs[3], 60);
    ck.advance(25 * H); // otro día
    const e3 = exp.send(u, { zone: 'volcan', hours: 4, team: [{ id: 4, uid: m.uid }] }).exps[0];
    ck.advance(4 * H);
    assert.strictEqual(exp.claim(u, { id: e3.id }).reward.ev, 16);
  } finally { ck.restore(); }
});

test('victoria contra la CPU: +4 EV por rival en su estadística base más alta, tope diario 48', () => {
  const u = user({ 25: { n: 1, s: 0 } });
  const m = u.mons[25][0];
  const foes = [BY_ID.get(94).stats, BY_ID.get(94).stats, BY_ID.get(143).stats]; // 2 Gengar (At. Esp.) y Snorlax (PS)
  assert.strictEqual(evs.topStat(BY_ID.get(94).stats), 3);
  assert.strictEqual(evs.topStat(BY_ID.get(143).stats), 0);
  assert.strictEqual(evs.onWin(m, foes), 12);
  assert.strictEqual(m.evs[3], 8);
  assert.strictEqual(m.evs[0], 4);
  let got = 0;
  for (let i = 0; i < 10; i++) got += evs.onWin(m, foes);
  assert.strictEqual(m.evd.bat, 48); // tope diario
  assert.strictEqual(evs.total(m), 48);
});
