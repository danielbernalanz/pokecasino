'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-locked-'));

const db = require('../server/db');
const hub = require('../server/hub');
const gacha = require('../server/gacha');
const locked = require('../server/locked');
const fixes = require('../server/fixes');
const susp = require('../server/suspicious');
const { BY_ID, DEX } = require('../server/pokedex');
const { SETS } = require('../server/progress');
const mega = require('../server/mega');

function user(name, extra = {}) {
  const u = { id: 'id-' + name, username: name, coins: 100000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection: {}, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, ...extra };
  db.addUser(u);
  return u;
}
const rar = (id) => BY_ID.get(id).rarity;

// Colección grande y variada: las 300 primeras especies con 1-3 copias.
function bigCollection() {
  const col = {};
  for (let id = 1; id <= 300; id++) col[id] = { n: 1 + (id % 3), s: 0 };
  return col;
}
const fix = fixes.FIXES.find((f) => f.id === 'candado-2026-10-28');

test('el arreglo deja 120 especies sin tocar compañero, variocolor, L/M, colecciones completas ni bases de Mega', () => {
  const col = bigCollection();
  col[10].s = 1; // variocolor
  const set = SETS[0];
  const piti = user('piti13579', { collection: col, buddy: { id: 11, shiny: false } });
  for (const id of set.ids) piti.collection[id] ||= { n: 1, s: 0 };
  piti.progress.sets = [set.id];
  const megaForm = [...mega.BY_FORM.values()].find((f) => piti.collection[f.species] && !set.ids.includes(f.species));
  piti.megas = { [megaForm.formId]: 1 };
  const tus = user('tusmuertos', { collection: bigCollection() });
  const protectedIds = new Set([11, 10, megaForm.species, ...set.ids]);
  const legendary = Object.keys(piti.collection).map(Number).filter((id) => ['L', 'M'].includes(rar(id)));
  const before = Object.keys(piti.collection).length;
  const out = fix.apply();
  assert.strictEqual(out.length, 2);
  assert.strictEqual(Object.keys(piti.collection).length, 120);
  assert.strictEqual(Object.keys(tus.collection).length, 120);
  assert.strictEqual(Object.keys(piti.locked).length, before - 120);
  for (const id of protectedIds) assert.ok(piti.collection[id], 'protegida ' + id);
  for (const id of legendary) assert.ok(piti.collection[id], 'legendaria ' + id);
  // Primero lo más común: nada de rareza E bloqueado si queda alguna C/U/R conservada que no estuviera protegida.
  const order = { C: 0, U: 1, R: 2, E: 3 };
  const maxLocked = Math.max(...Object.keys(piti.locked).map((id) => order[rar(Number(id))]));
  const minKept = Math.min(...Object.keys(piti.collection).map(Number).filter((id) => !protectedIds.has(id) && order[rar(id)] !== undefined).map((id) => order[rar(id)]));
  assert.ok(maxLocked <= minKept);
  // Se mueve la entrada entera.
  const [lid] = Object.keys(piti.locked);
  assert.ok(piti.locked[lid].n >= 1 && !piti.collection[lid]);
  assert.strictEqual(piti.lockedProg.credits, 0);
  assert.ok(db.data.adminLog.some((l) => l.action === 'fix' && /candado/.test(l.detail)));
  // Idempotente: el sistema de arreglos solo lo corre una vez; y si se repite no bloquea más.
  const n = Object.keys(piti.locked).length;
  fix.apply();
  assert.strictEqual(Object.keys(piti.locked).length, n);
});

test('los recuentos y rankings ignoran lo que tiene candado', () => {
  const u = user('conteo', { collection: bigCollection() });
  const before = hub.publicUser(u).dex;
  locked.lock(u, 5);
  locked.lock(u, 6);
  assert.strictEqual(hub.publicUser(u).dex, before - 2);
  const me = hub.privateUser(u);
  assert.deepStrictEqual(Object.keys(me.locked).sort(), ['5', '6']);
  assert.ok(me.lockedProg);
  assert.strictEqual(me.collection[5], undefined);
  assert.strictEqual(typeof me.lockedCoins, 'number');
  assert.deepStrictEqual(hub.privateUser(user('sin-candado')).locked, {});
});

test('el gacha recupera una especie con candado y suma las copias (tope 5, resto en polvo)', () => {
  const u = user('gachaunlock', { collection: { 25: { n: 1, s: 0 } } });
  u.locked = { 1: { n: 4, s: 1 }, 2: { n: 2, s: 0 } };
  u.lockedProg = { credits: 0, wagerBase: 0, pullBase: 0, total: 0 };
  const r = gacha.grant(u, 1, false, { unlock: true });
  assert.strictEqual(r.unlocked, true);
  assert.strictEqual(r.isNew, false);
  assert.deepStrictEqual(u.collection[1], { n: 5, s: 1 });
  assert.strictEqual(u.locked[1], undefined);
  assert.ok(u.locked[2]);
  // Con 5 copias guardadas, la nueva pasa a polvo.
  u.locked[2].n = 5;
  const r2 = gacha.grant(u, 2, false, { unlock: true });
  assert.strictEqual(u.collection[2].n, 5);
  assert.ok(r2.dust > 0);
  // Sin la opción (regalo, mercado, polvo) no se desbloquea.
  u.locked[3] = { n: 3, s: 0 };
  const r3 = gacha.grant(u, 3, false);
  assert.strictEqual(r3.unlocked, undefined);
  assert.ok(u.locked[3]);
  assert.strictEqual(u.collection[3].n, 1);
});

test('una tirada de verdad marca unlocked en el resultado', () => {
  const u = user('tirada', { coins: 1e6 });
  // Con candado todo el pool común: cualquier resultado será una especie bloqueada.
  u.locked = {};
  for (const p of DEX) u.locked[p.id] = { n: 2, s: 0 };
  u.lockedProg = { credits: 0, wagerBase: 0, pullBase: 0, total: 0 };
  const { results } = gacha.pull(u, { banner: gacha.BANNERS[0].id, count: 10 });
  assert.strictEqual(results[0].unlocked, true); // las repetidas dentro del mismo sobre ya están recuperadas
  assert.ok(Object.keys(u.locked).length < DEX.length);
});

test('los créditos se ganan cada 5.000 apostadas y cada 10 tiradas, solo con candado', () => {
  const u = user('creditos', { collection: bigCollection() });
  hub.setIO(null);
  u.stats.wagered = 100;
  u.stats.pulls = 3;
  assert.strictEqual(locked.accrue(u), 0); // sin candado no hay créditos
  locked.lockDown(u, 120);
  assert.strictEqual(u.lockedProg.credits, 0);
  u.coins = 1e6;
  hub.takeBet(u, 4900, 'slots');
  assert.strictEqual(u.lockedProg.credits, 0);
  hub.takeBet(u, 200, 'slots'); // 5.100 desde el candado
  assert.strictEqual(u.lockedProg.credits, 1);
  assert.strictEqual(hub.privateUser(u).lockedProg.wager, 100);
  gacha.pull(u, { banner: gacha.BANNERS[0].id, count: 10 });
  assert.strictEqual(u.lockedProg.credits, 2);
  assert.strictEqual(u.lockedProg.total, 2);
  for (let i = 0; i < 5; i++) hub.takeBet(u, 5000, 'slots');
  assert.strictEqual(u.lockedProg.credits, 7);
});

test('recuperar gasta un crédito y rechaza lo no válido', () => {
  const u = user('recupera', { collection: bigCollection() });
  locked.lockDown(u, 120);
  const id = Number(Object.keys(u.locked)[0]);
  assert.throws(() => locked.unlock(u, { id }), /recuperaciones/);
  assert.throws(() => locked.unlock(u, { id: 99999 }), /candado/);
  assert.throws(() => locked.unlock(u, { id: 'x' }), /candado/);
  u.lockedProg.credits = 1;
  const keep = u.locked[id];
  const r = locked.unlock(u, { id });
  assert.strictEqual(r.id, id);
  assert.strictEqual(u.lockedProg.credits, 0);
  assert.strictEqual(u.collection[id].n, keep.n);
  assert.strictEqual(u.locked[id], undefined);
  assert.throws(() => locked.unlock(u, { id }), /candado/);
  assert.deepStrictEqual(locked.view(user('vacio')), null);
  assert.ok(locked.view(u).box);
});

// ---- Saldos sospechosos ----
test('el seguimiento de ingresos explica el saldo y detecta lo que sobra', () => {
  const a = user('honesto', { coins: 5000 });
  a.coins += 700; hub.ledger(a, 700, 'daily', 'x');
  hub.takeBet(a, 1000, 'slots');
  hub.pay(a, 1500, 1000, 'slots');
  const explained = a.hist.incomeBase + Object.values(a.hist.income).reduce((s, v) => s + v, 0);
  assert.strictEqual(explained, a.coins);
  assert.deepStrictEqual(susp.flagPlayers([a]), []);
  // Monedas sin ledger: no se explican.
  a.coins += 30000;
  const f = susp.flagPlayers([a]);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].excess, 30000);
  // Lo apartado cuenta como suyo.
  const b = user('apartado', { coins: 5000 });
  b.coins += 100; hub.ledger(b, 100, 'daily');
  b.coins -= 3000; // 3.000 apartados: ni sube ni baja lo explicado + apartado
  assert.deepStrictEqual(susp.flagPlayers([b], () => 3000), []);
});

test('se marcan los regalos de anfitrión y las ganancias de un día', () => {
  const a = user('regalado', { coins: 5000 });
  for (let i = 0; i < 3; i++) { a.coins += 8000; hub.ledger(a, 8000, 'admin', 'host'); }
  const f = susp.flagPlayers([a]);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].admin7, 24000);
  assert.match(f[0].reasons.join(' '), /anfitriones/);
  const old = Date.now() + 30 * 864e5;
  assert.deepStrictEqual(susp.flagPlayers([a], () => 0, old).filter((x) => x.admin7 > 0), []); // fuera de los 7 días
  const g = user('afortunado', { coins: 5000 });
  g.coins += 60000; hub.ledger(g, 60000, 'level');
  const fg = susp.flagPlayers([g]);
  assert.match(fg[0].reasons.join(' '), /en un día/);
});

test('cuentas antiguas sin seguimiento y NPC no se marcan', () => {
  const old = user('antigua', { coins: 900000 });
  assert.deepStrictEqual(susp.flagPlayers([old]), []);
  const n = user('comerciante', { coins: 900000, npc: true });
  n.hist = { income: {}, incomeBase: 0, days: {}, games: {}, log: [] };
  assert.deepStrictEqual(susp.flagPlayers([n]), []);
  // Y el ledger de un jugador con coins altas antes del seguimiento parte de su saldo real.
  const v = user('veterana', { coins: 400000 });
  v.coins += 100; hub.ledger(v, 100, 'daily');
  assert.strictEqual(v.hist.incomeBase, 400000);
  assert.deepStrictEqual(susp.flagPlayers([v]), []);
});
