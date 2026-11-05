'use strict';
// Eventos temáticos: calendario determinista por semanas (hora de España), efectos en Captura y Teraincursiones y misión semanal.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-themes-'));

const db = require('../server/db');
const sp = require('../server/specimen');
const themes = require('../server/themes');
const events = require('../server/events');
const cap = require('../server/capture');
const raid = require('../server/raid');
const Z = require('../server/capzones');
const { TYPES, BY_ID } = require('../server/pokedex');

let n = 0;
function user(extra = {}) {
  const name = 'th' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 10000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection: {}, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 5, createdAt: Date.now() - 9 * 864e5, ...extra };
  db.addUser(u);
  return u;
}
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const MON = 86400e3 * 7;
// Un instante de la semana temática de ese tipo (a mediodía de un miércoles).
function weekOf(type, from = Date.parse('2026-11-04T12:00:00+01:00')) {
  for (let i = 0; i < 80; i++) { const t = from + i * MON; if (themes.typeNow(t) === type) return t; }
  throw new Error('sin semana ' + type);
}

test('calendario: de lunes a domingo en hora de España, estable y con los 18 tipos por ciclo', () => {
  const a = themes.state(Date.parse('2026-11-02T00:00:01+01:00'));
  const b = themes.state(Date.parse('2026-11-08T23:59:59+01:00'));
  assert.strictEqual(a.type, b.type, 'toda la semana, de lunes 00:00 a domingo 23:59');
  assert.strictEqual(a.starts, Date.parse('2026-11-02T00:00:00+01:00'));
  assert.strictEqual(a.ends, Date.parse('2026-11-09T00:00:00+01:00'));
  const c = themes.state(Date.parse('2026-11-09T00:00:00+01:00'));
  assert.notStrictEqual(c.type, a.type);
  assert.strictEqual(a.next.type, c.type, 'el siguiente anunciado es el de la semana que viene');
  assert.strictEqual(a.next.starts, a.ends);
  assert.deepStrictEqual(themes.state(Date.parse('2026-11-04T12:00:00Z')), themes.state(Date.parse('2026-11-04T12:00:00Z')), 'determinista');
  // El cambio de hora de primavera y otoño no mueve el límite del lunes 00:00 en España.
  for (const d of ['2026-03-30', '2026-10-26']) assert.strictEqual(themes.state(Date.parse(d + 'T00:00:00' + (d.startsWith('2026-03') ? '+02:00' : '+01:00'))).starts, Date.parse(d + 'T00:00:00' + (d.startsWith('2026-03') ? '+02:00' : '+01:00')));
  // Cada ciclo de 18 semanas recorre los 18 tipos exactamente una vez.
  for (let cycle = 100; cycle < 104; cycle++) assert.deepStrictEqual(new Set(Array.from({ length: 18 }, (_, i) => themes.typeOfWeek(cycle * 18 + i))), new Set(TYPES));
  assert.strictEqual(themes.state(weekOf('ghost')).name, 'Semana Fantasma');
  assert.strictEqual(themes.state(weekOf('electric')).name, 'Semana Eléctrica');
});

test('se suma a los eventos de fin de semana sin romperlos', () => {
  const sat = Date.parse('2026-11-07T12:00:00Z');
  assert.deepStrictEqual(events.active(sat).map((e) => e.id).sort(), ['buddy', 'shiny']);
  const st = events.publicState();
  assert.ok(st.theme && st.theme.type && st.theme.name && st.theme.ends > Date.now());
  assert.ok(Array.isArray(st.active) && st.all.length === Object.keys(events.EVENTS).length, 'la lista de eventos no cambia');
  assert.ok(!('theme' in events.EVENTS) && !events.all);
});

test('Captura: el tipo de la semana pesa ×3 en las tablas de encuentros (y nada más cambia)', () => {
  const torre = Z.ZONE_BY_ID.get('torre');
  const share = (now) => {
    const rng = seeded(99);
    const u = user();
    let ghost = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) { const e = cap.makeEncounter(u, torre, now, rng); if (BY_ID.get(e.id).types.includes('ghost')) ghost++; }
    return ghost / N;
  };
  const day = (t) => { const d = new Date(t); d.setUTCHours(11, 0, 0, 0); return d.getTime(); }; // 12:00 en España: de día
  const gw = day(weekOf('ghost')); const nw = day(weekOf('normal'));
  assert.strictEqual(themes.captureWeight(92, gw), 3);
  assert.strictEqual(themes.captureWeight(92, nw), 1);
  const g = share(gw); const x = share(nw);
  assert.ok(g > x + 0.1, `Fantasma ${g.toFixed(2)} vs. normal ${x.toFixed(2)}`);
  assert.ok(Math.abs(g - 75 / 90) < 0.04, 'Gastly 25×3 contra Cubone 15 = 83 %');
  // los ratios, el límite diario de encuentros y los legendarios no cambian
  assert.strictEqual(cap.ratioOf(92), 190);
  assert.strictEqual(cap.DAILY, 30);
});

test('Teraincursiones: el segundo jefe de cada estrella es del tipo de la semana; el primero no cambia', () => {
  for (const type of ['ghost', 'fire', 'dragon', 'steel']) {
    const day = new Date(weekOf(type)).toISOString().slice(0, 10);
    const bs = raid.bossesOf(day);
    assert.strictEqual(bs.length, 10);
    for (const s of raid.STARS) {
      const [a, b] = bs.filter((x) => x.star === s);
      assert.strictEqual(b.tera, type, `${type} ${s}★: Teratipo temático`);
      assert.ok(BY_ID.get(b.id).types.includes(type) || raid.poolOf(s).filter((p) => p.types.includes(type)).length < 2, 'la especie es del tipo si el grupo lo permite');
      assert.ok(raid.poolOf(s).some((p) => p.id === b.id), 'sigue siendo de la rareza de la estrella');
      assert.notStrictEqual(a.id, b.id);
      assert.ok(!a.theme && b.theme);
      assert.ok(!['L', 'M'].includes(BY_ID.get(b.id).rarity));
    }
  }
  // determinista y estable dentro de la semana
  const d1 = new Date(weekOf('ghost')).toISOString().slice(0, 10);
  assert.deepStrictEqual(raid.bossesOf(d1), raid.bossesOf(d1));
});

test('misión semanal: 3 capturas del tipo → 2 Tickets Gacha una sola vez por semana, sin monedas', () => {
  const g = weekOf('ghost');
  const u = user({ collection: {} });
  const coins = u.coins;
  assert.deepStrictEqual(themes.mine(u, g), { n: 0, max: 3, done: false });
  assert.strictEqual(themes.onCapture(u, 25, g), false, 'Pikachu no es Fantasma');
  assert.strictEqual(themes.mine(u, g).n, 0);
  themes.onCapture(u, 92, g); themes.onCapture(u, 93, g);
  assert.strictEqual(themes.mine(u, g).n, 2);
  assert.strictEqual(themes.onCapture(u, 94, g), true);
  assert.strictEqual(u.items.ticket, 2);
  assert.strictEqual(u.coins, coins, 'sin monedas');
  assert.strictEqual(themes.onCapture(u, 92, g), false);
  assert.strictEqual(u.items.ticket, 2, 'una sola vez por semana');
  assert.ok(require('../server/notify').list(u).list.some((x) => x.kind === 'quest'));
  // semana siguiente: vuelve a empezar (con otro tipo)
  const next = g + MON;
  assert.deepStrictEqual(themes.mine(u, next), { n: 0, max: 3, done: false });
});

test('la captura real cuenta para la misión (finishCapture)', () => {
  const g = weekOf('ghost');
  const u = user();
  const e = (id) => ({ zone: 'torre', id, level: 15, ivs: [1, 2, 3, 4, 5, 6], nature: 'Seria', size: 128, shiny: false, ha: false, mark: null, legend: false, outbreak: false });
  const real = Date.now; Date.now = () => g;
  try { for (const id of [92, 92, 92]) cap.finishCapture(u, e(id), 'poke-ball', g); } finally { Date.now = real; }
  assert.strictEqual(u.items.ticket, 2);
});
