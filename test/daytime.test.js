'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-daytime-'));

const db = require('../server/db');
const daytime = require('../server/daytime');
const gacha = require('../server/gacha');
const sp = require('../server/specimen');
const exp = require('../server/expedition');
const { BY_ID, BY_RARITY } = require('../server/pokedex');

const DAY = Date.parse('2026-11-04T11:00:00Z'); // 12:00 en Madrid
const NIGHT = Date.parse('2026-11-04T22:30:00Z'); // 23:30
let n = 0;
function user(collection = {}, extra = {}) {
  const name = 'dt' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 100000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, ...extra };
  db.addUser(u);
  sp.syncAll(u);
  return u;
}

test('listas: solo especies comunes (ni legendarios ni místicos), sin repetir entre día y noche', () => {
  const all = [...daytime.NIGHT_SPECIES, ...daytime.DAY_SPECIES];
  assert.strictEqual(new Set(all).size, all.length);
  for (const id of all) { const p = BY_ID.get(id); assert.ok(p && p.rarity !== 'L' && p.rarity !== 'M', String(id)); }
  for (const name of ['Gastly', 'Hoothoot', 'Murkrow', 'Misdreavus', 'Sableye', 'Zubat']) assert.strictEqual(daytime.affinity([...BY_ID.values()].find((p) => p.name === name).id), 'night', name);
  for (const name of ['Ledyba', 'Sunkern', 'Cherubi']) assert.strictEqual(daytime.affinity([...BY_ID.values()].find((p) => p.name === name).id), 'day', name);
});

test('pesos: ×2 a su hora, ×0,5 fuera y ×1 para el resto (la rareza no cambia)', () => {
  const gastly = BY_ID.get(92); const ledyba = BY_ID.get(165); const pikachu = BY_ID.get(25);
  const w = (p, ph) => gacha.weightOf(p, ph) / gacha.stageWeight(p);
  assert.strictEqual(w(gastly, 'night'), 2);
  assert.strictEqual(w(gastly, 'day'), 0.5);
  assert.strictEqual(w(ledyba, 'day'), 2);
  assert.strictEqual(w(ledyba, 'night'), 0.5);
  assert.strictEqual(w(pikachu, 'night'), 1);
  assert.strictEqual(w(pikachu, 'day'), 1);
  assert.strictEqual(daytime.mult(92, 'night') / daytime.mult(92, 'day'), 4);
});

test('el sorteo respeta los pesos y nadie queda excluido', () => {
  const banner = gacha.BANNERS[0];
  const rar = BY_ID.get(92).rarity;
  const counts = { day: new Map(), night: new Map() };
  const N = 40000;
  for (const ph of ['day', 'night']) for (let i = 0; i < N; i++) { const p = gacha.rollPokemon(rar, banner, { phase: ph }); counts[ph].set(p.id, (counts[ph].get(p.id) || 0) + 1); }
  // Dentro de su rareza, Gastly sale ≈ 4 veces más de noche que de día
  const g = (ph) => counts[ph].get(92) || 0;
  assert.ok(g('night') > 0 && g('day') > 0, 'ninguno se excluye');
  const ratio = g('night') / g('day');
  assert.ok(ratio > 3 && ratio < 5.4, `ratio ${ratio}`);
  // Un Pokémon sin horario no cambia de peso relativo en conjunto
  const normal = BY_RARITY[rar].find((p) => !daytime.affinity(p.id) && p.stage <= 1);
  const c = (ph) => counts[ph].get(normal.id) || 0;
  assert.ok(c('night') > 0 && c('day') > 0);
});

test('pull inyecta la hora: tira a las 12:00 y a las 23:30 sin errores y sin cambiar la rareza', () => {
  const u = user();
  const a = gacha.pull(u, { banner: 'kanto', count: 10 }, DAY);
  const b = gacha.pull(u, { banner: 'kanto', count: 10 }, NIGHT);
  assert.strictEqual(a.results.length, 10);
  assert.strictEqual(b.results.length, 10);
});

test('expediciones: quien sale a su hora da un 25 % más de caramelos; el resto, igual', () => {
  const real = Date.now;
  let t = NIGHT;
  Date.now = () => t;
  try {
    const u = user({ 92: { n: 1, s: 0 }, 165: { n: 1, s: 0 } });
    const gastly = u.mons[92][0];
    const ledyba = u.mons[165][0];
    const send = (m, id) => exp.send(u, { zone: 'cueva', hours: 12, team: [{ id, uid: m.uid }] }).exps.find((e) => e.team[0].uid === m.uid);
    const e1 = send(gastly, 92);
    const e2 = send(ledyba, 165);
    t += 12 * 3600e3;
    const r1 = exp.claim(u, { id: e1.id }).reward.members[0];
    const r2 = exp.claim(u, { id: e2.id }).reward.members[0];
    assert.strictEqual(r1.time, true);
    assert.strictEqual(r2.time, false);
    // Gastly (fantasma) coincide con la Cueva Celeste además de la hora; Ledyba (bicho) no coincide con la zona
    assert.ok(r1.candy > r2.candy, `${r1.candy} vs ${r2.candy}`);
    // misma hora para un ejemplar sin afinidad: sin bonus
    const p = user({ 74: { n: 1, s: 0 } });
    const geo = p.mons[74][0];
    t = DAY;
    const e3 = exp.send(p, { zone: 'cueva', hours: 12, team: [{ id: 74, uid: geo.uid }] }).exps[0];
    t += 12 * 3600e3;
    assert.strictEqual(exp.claim(p, { id: e3.id }).reward.members[0].time, false);
  } finally { Date.now = real; }
});
