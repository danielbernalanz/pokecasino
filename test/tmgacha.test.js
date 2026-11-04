'use strict';
// Gacha de MT: probabilidades, valor esperado menor que el precio (y que fabricar), tope diario, cobro y libro de cuentas,
// MT entregadas, error sin monedas y que los PNJ siguen sin comerciar MT.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-tmg-'));

const db = require('../server/db');
const hub = require('../server/hub');
const tmdata = require('../server/tmdata');
const tmg = require('../server/tmgacha');
const npc = require('../server/npc');

let n = 0;
function user(extra = {}) {
  const name = 'tmg' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 1e6, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection: {}, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, createdAt: Date.now() - 9 * 864e5, ...extra };
  db.addUser(u);
  return u;
}
const countTm = (u) => Object.entries(u.items).filter(([id]) => id.startsWith('tm-')).reduce((s, [, q]) => s + q, 0);

test('las probabilidades por nivel suman 1 y cada nivel tiene MT', () => {
  assert.ok(Math.abs(Object.values(tmg.ODDS).reduce((s, x) => s + x, 0) - 1) < 1e-12);
  for (const k of tmg.TIER_ORDER) assert.ok(tmg.BY_TIER[k].length > 0 && tmg.ODDS[k] > 0, k);
  // Cuanto más fuerte el nivel, menos probable.
  for (let i = 1; i < tmg.TIER_ORDER.length; i++) assert.ok(tmg.ODDS[tmg.TIER_ORDER[i]] < tmg.ODDS[tmg.TIER_ORDER[i - 1]]);
});

test('valor esperado: una tirada vale (en monedas de fabricación) claramente menos de lo que cuesta', () => {
  const ev = tmg.expectedCraftCoins();
  assert.ok(ev < tmg.COST[1] * 0.85, `EV ${ev} vs ${tmg.COST[1]}`);
  assert.ok(ev < (tmg.COST[10] / 10) * 0.9, `EV ${ev} vs ${tmg.COST[10] / 10} por tirada en ×10`);
  assert.ok(tmg.COST[10] < tmg.COST[1] * 10 && tmg.COST[10] >= tmg.COST[1] * 10 * 0.85, 'descuento ×10 pequeño');
  // El destacado cambia la MT dentro del nivel, no el nivel: el EV exacto (con pesos) sigue siendo el mismo por nivel.
  for (const ty of tmg.TYPES) {
    let ev2 = 0;
    for (const k of tmg.TIER_ORDER) {
      const pool = tmg.BY_TIER[k];
      const w = pool.reduce((s, t) => s + (t.type === ty ? tmg.FEATURED_BOOST : 1), 0);
      ev2 += tmg.ODDS[k] * pool.reduce((s, t) => s + t.coins * (t.type === ty ? tmg.FEATURED_BOOST : 1), 0) / w;
    }
    assert.ok(Math.abs(ev2 - ev) < 1e-6 || ev2 < tmg.COST[1] * 0.85, `tipo ${ty}: EV ${ev2}`);
  }
});

test('distribución simulada: niveles cercanos a las probabilidades y EV empírico < precio', () => {
  const N = 40000;
  const c = {};
  let coins = 0;
  for (let i = 0; i < N; i++) { const t = tmg.rollTm(tmg.featuredType()); c[t.tier] = (c[t.tier] || 0) + 1; coins += t.coins; }
  for (const k of tmg.TIER_ORDER) {
    const p = tmg.ODDS[k];
    const sd = Math.sqrt((p * (1 - p)) / N);
    assert.ok(Math.abs((c[k] || 0) / N - p) < 5 * sd + 0.001, `${k}: ${(c[k] || 0) / N} vs ${p}`);
  }
  assert.ok(coins / N < tmg.COST[1] * 0.9, `EV empírico ${coins / N}`);
});

test('el tipo destacado pesa más dentro de su nivel y rota cada semana', () => {
  const feat = tmg.featuredType();
  const N = 30000;
  let fire = 0;
  for (let i = 0; i < N; i++) if (tmg.rollTm(feat).type === feat) fire++;
  const base = tmdata.TMS.filter((t) => t.type === feat).length / tmdata.TMS.length;
  assert.ok(fire / N > base * 1.3, `${fire / N} vs base ${base}`);
  const t0 = Date.parse('2026-11-04T12:00:00Z');
  assert.strictEqual(tmg.featuredType(t0), tmg.featuredType(t0 + 864e5));
  assert.notStrictEqual(tmg.featuredType(t0), tmg.featuredType(t0 + 7 * 864e5));
  assert.ok(tmg.weekEnds(t0) > t0 && tmg.weekEnds(t0) - t0 <= 7 * 864e5);
});

test('tirar ×1 y ×10: cobra, anota en el libro de cuentas y entrega las MT', () => {
  const u = user();
  const r1 = tmg.pull(u, { count: 1 });
  assert.strictEqual(r1.results.length, 1);
  assert.strictEqual(u.coins, 1e6 - tmg.COST[1]);
  assert.strictEqual(countTm(u), 1);
  assert.strictEqual(u.items[r1.results[0].id], 1);
  const r10 = tmg.pull(u, { count: 10 });
  assert.strictEqual(r10.results.length, 10);
  assert.strictEqual(u.coins, 1e6 - tmg.COST[1] - tmg.COST[10]);
  assert.strictEqual(countTm(u), 11);
  for (const x of r10.results) assert.ok(tmdata.TM_BY_ID.has(x.id) && x.tier === tmdata.TM_BY_ID.get(x.id).tier);
  const log = hub.history(u).log.filter((e) => e.r === 'tm_gacha');
  assert.deepStrictEqual(log.map((e) => e.d), [-tmg.COST[1], -tmg.COST[10]]);
  assert.strictEqual(r10.left, tmg.DAILY_LIMIT - 11);
});

test('cantidad no válida y monedas insuficientes: error y nada cambia', () => {
  const u = user({ coins: tmg.COST[1] - 1 });
  for (const count of [0, 2, 5, -1, 'x', undefined]) assert.throws(() => tmg.pull(u, { count }), /Cantidad/);
  assert.throws(() => tmg.pull(u, { count: 1 }), /monedas/);
  assert.strictEqual(u.coins, tmg.COST[1] - 1);
  assert.strictEqual(countTm(u), 0);
  assert.strictEqual(tmg.info(u).used, 0);
});

test('límite diario de tiradas, que se reinicia al cambiar de día', () => {
  const u = user();
  for (let i = 0; i < tmg.DAILY_LIMIT / 10; i++) tmg.pull(u, { count: 10 });
  assert.strictEqual(countTm(u), tmg.DAILY_LIMIT);
  const coins = u.coins;
  assert.throws(() => tmg.pull(u, { count: 1 }), /Límite diario/);
  assert.strictEqual(u.coins, coins);
  assert.strictEqual(tmg.info(u).used, tmg.DAILY_LIMIT);
  u.tmDay.day = '2000-01-01';
  assert.strictEqual(tmg.info(u).used, 0);
  assert.doesNotThrow(() => tmg.pull(u, { count: 10 }));
  // Un ×10 que sobrepasaría el tope se rechaza entero.
  const v = user();
  for (let i = 0; i < 2; i++) tmg.pull(v, { count: 10 });
  for (let i = 0; i < 5; i++) tmg.pull(v, { count: 1 });
  assert.throws(() => tmg.pull(v, { count: 10 }), /te quedan 5/);
});

test('los PNJ no tiran ni comercian MT', () => {
  assert.throws(() => tmg.pull({ npc: true, coins: 1e6, items: {}, id: 'x' }, { count: 1 }), /NPC/);
  for (const t of tmdata.TMS) for (const p of npc.NPCS) assert.ok(!npc.inFocus(p, { kind: 'item', itemId: t.id }), `${p.name} ${t.id}`);
});
