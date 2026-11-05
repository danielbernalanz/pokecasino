'use strict';
// Lotería ID: ID de entrenador estable, sorteo determinista por día, una comprobación al día, premios por cifras desde el final,
// ID del entrenador original (OT) en los ejemplares y su conservación al regalar.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-lot-'));

const db = require('../server/db');
const sp = require('../server/specimen');
const items = require('../server/items');
const gacha = require('../server/gacha');
const lot = require('../server/lottery');

let n = 0;
function user(collection = { 25: { n: 1, s: 0 } }, extra = {}) {
  const name = 'lot' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 1000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, ...extra };
  db.addUser(u);
  sp.syncAll(u);
  for (const arr of Object.values(u.mons)) for (const m of arr) m.at = 1; // «de antes de hoy»
  return u;
}
const D1 = Date.UTC(2026, 10, 5, 12, 0);
const D2 = D1 + 864e5;

test('ID de entrenador: 5 dígitos, estable, determinista por cuenta y sin repetirse', () => {
  const a = user();
  const id = lot.tidOf(a);
  assert.match(id, /^\d{5}$/);
  assert.strictEqual(lot.tidOf(a), id);
  assert.strictEqual(a.tid, id);
  // Determinista: la misma cuenta (mismo id de usuario) sin ID previo sale con el mismo número en otra base.
  const ghost = { id: a.id, username: 'x' };
  a.tid = undefined;
  assert.strictEqual(lot.tidOf(ghost), id);
  // Si ya hay un tid válido se respeta (también uno numérico antiguo).
  assert.strictEqual(lot.tidOf({ id: 'zz', tid: '00042' }), '00042');
  assert.strictEqual(lot.tidOf({ id: 'zz2', tid: 7 }), '00007');
  // Sin repetirse entre cuentas (aunque el hash coincida, se reserva el siguiente libre).
  const ids = new Set();
  for (let i = 0; i < 60; i++) ids.add(lot.tidOf(user()));
  assert.strictEqual(ids.size, 60);
  const b = { id: 'dup', username: 'dup' };
  const first = lot.tidOf(b);
  db.addUser({ ...user(), id: 'dup2', username: 'dup2', tid: first }); // otro con el mismo ID reservado
  const c = { id: 'dup', username: 'dup3' };
  assert.notStrictEqual(lot.tidOf(c), first);
});

test('sorteo: determinista por fecha con la semilla del servidor, distinto cada día y de 5 dígitos', () => {
  const a = lot.numberFor('2026-11-05');
  assert.match(a, /^\d{5}$/);
  assert.strictEqual(lot.numberFor('2026-11-05'), a);
  assert.strictEqual(lot.numberFor('2026-11-05', db.data.state.lotSeed), a);
  assert.notStrictEqual(lot.numberFor('2026-11-05', 'otra-semilla'), a);
  assert.strictEqual(typeof db.data.state.lotSeed, 'string');
  assert.ok(db.data.state.lotSeed.length >= 16);
  const seen = new Set();
  for (let d = 1; d <= 40; d++) seen.add(lot.numberFor('2026-12-' + String(d).padStart(2, '0')));
  assert.ok(seen.size > 35);
  // Reparto uniforme de la última cifra (la semilla es aleatoria, pero con 4000 días no puede sesgarse).
  const cnt = Array(10).fill(0);
  for (let d = 0; d < 4000; d++) cnt[Number(lot.numberFor('k' + d).slice(-1))]++;
  for (const c of cnt) assert.ok(c > 330 && c < 470, String(cnt));
});

test('cifras iguales desde el final y probabilidades', () => {
  assert.strictEqual(lot.matchDigits('12345', '12345'), 5);
  assert.strictEqual(lot.matchDigits('12345', '99345'), 3);
  assert.strictEqual(lot.matchDigits('12345', '12399'), 0);
  assert.strictEqual(lot.matchDigits('12345', '02345'), 4);
  assert.strictEqual(lot.matchDigits('12345', '54321'), 0);
  assert.strictEqual(lot.matchDigits('00000', '10000'), 4);
  // Exactamente k cifras: 9·10^-(k+1); las cuatro suman la probabilidad de ≥ 2 (1 %).
  assert.ok(Math.abs(lot.probExact(2) - 0.009) < 1e-12);
  assert.ok(Math.abs(lot.probExact(3) - 0.0009) < 1e-12);
  assert.ok(Math.abs(lot.probExact(4) - 0.00009) < 1e-12);
  assert.strictEqual(lot.probExact(5), 1e-5);
  assert.ok(Math.abs([2, 3, 4, 5].reduce((s, k) => s + lot.probExact(k), 0) - 0.01) < 1e-12);
  // Simulación Monte Carlo con IDs al azar: las frecuencias salen de la fórmula.
  let two = 0; const N = 200000;
  for (let i = 0; i < N; i++) if (lot.matchDigits(String(Math.floor(Math.random() * 1e5)).padStart(5, '0'), '31415') >= 2) two++;
  assert.ok(Math.abs(two / N - 0.01) < 0.002, String(two / N));
});

test('una comprobación al día: mismo resultado guardado, y mañana otra vez', () => {
  const u = user();
  const v0 = lot.view(u, D1);
  assert.strictEqual(v0.checked, false);
  assert.strictEqual(v0.number, null); // el número no se ve hasta comprobarlo
  const r = lot.check(u, D1);
  assert.strictEqual(r.checked, true);
  assert.strictEqual(r.number, lot.numberFor('2026-11-05'));
  assert.throws(() => lot.check(u, D1 + 3600e3), /Ya has comprobado/);
  assert.strictEqual(lot.view(u, D1 + 3600e3).number, r.number);
  const r2 = lot.check(u, D2);
  assert.strictEqual(r2.number, lot.numberFor('2026-11-06'));
  assert.strictEqual(u.lot.st.checks, 2);
  assert.throws(() => lot.check({ npc: true }, D1), /NPC/);
});

test('premios por cifras: 2 → Caramelo Exp. XS, 3 → M, 4 → 5 Ultra Ball, 5 → Master Ball; sin monedas', () => {
  const num = lot.numberFor('2026-11-05');
  const withOt = (ot) => { const u = user(); u.mons[25][0].ot = ot; return u; };
  const near = (k) => { const d = (Number(num[4 - k]) + 1) % 10; return num.slice(0, 4 - k) + String(d) + num.slice(5 - k); }; // coincide en k cifras y falla la siguiente
  const cases = [[0, null], [1, null], [2, 'exp-xs'], [3, 'exp-m'], [4, 'ultra-ball'], [5, 'master-ball']];
  for (const [k, item] of cases) {
    const ot = k === 5 ? num : near(k);
    assert.strictEqual(lot.matchDigits(num, ot), k === 5 ? 5 : k, `ID de prueba ${k}`);
    const u = withOt(ot);
    const coins = u.coins;
    const r = lot.check(u, D1);
    assert.strictEqual(r.match, k);
    assert.strictEqual(u.coins, coins, 'la lotería nunca da monedas');
    if (!item) { assert.strictEqual(r.prize, null); assert.deepStrictEqual(u.items, {}); continue; }
    assert.strictEqual(r.prize.item, item);
    assert.strictEqual(u.items[item], lot.PRIZES[k].qty);
    assert.ok(items.ITEMS[item], 'el premio es un objeto que ya existe');
    assert.deepStrictEqual(Object.keys(u.items), [item]);
  }
  assert.strictEqual(lot.PRIZES[4].qty, 5);
});

test('cuenta el mejor ejemplar; los ID de varios entrenadores suman posibilidades', () => {
  const num = lot.numberFor('2026-11-05');
  const u = user({ 25: { n: 2, s: 0 }, 6: { n: 1, s: 0 } });
  const ms = [...u.mons[25], ...u.mons[6]];
  ms[0].ot = num.slice(0, 4) + String((Number(num[4]) + 5) % 10); // ninguna
  ms[1].ot = num.slice(0, 4) + String((Number(num[4]) + 1) % 10); // ninguna
  ms[2].ot = num.slice(0, 1) + String((Number(num[1]) + 1) % 10) + num.slice(2); // 3 cifras
  const r = lot.check(u, D1);
  assert.strictEqual(r.match, 3);
  assert.strictEqual(u.items['exp-m'], 1);
  assert.strictEqual(r.best.ot, ms[2].ot);
  // Solo UN premio al día, aunque varios ejemplares acierten.
  const w = user({ 25: { n: 2, s: 0 } });
  for (const m of w.mons[25]) m.ot = num;
  const r2 = lot.check(w, D1);
  assert.strictEqual(r2.match, 5);
  assert.strictEqual(w.items['master-ball'], 1);
  assert.strictEqual(Object.keys(w.items).length, 1);
});

test('ejemplares: los nuevos nacen con el ID de su dueño; los antiguos cuentan como del propio jugador', () => {
  const u = { id: 'id-old', username: 'old', coins: 0, dust: 0, items: {}, buffs: {}, games: {}, collection: { 25: { n: 1, s: 0 } }, stats: {}, level: 1 };
  db.addUser(u);
  sp.syncAll(u);
  assert.strictEqual(u.mons[25][0].ot, lot.tidOf(u));
  // Antiguo: sin `ot`.
  delete u.mons[25][0].ot;
  assert.strictEqual(lot.otOf(u, u.mons[25][0]), u.tid);
  assert.strictEqual(lot.otNameOf(u, u.mons[25][0]), null);
  // La ficha del PC lleva el ID original.
  const box = sp.boxView(u).mons[0];
  assert.strictEqual(box.ot, u.tid);
  assert.strictEqual(box.otn, null);
  // Los ejemplares nuevos que llegan por el Gacha también.
  gacha.grant(u, 25, false);
  const arr = sp.sync(u, 25);
  assert.strictEqual(arr.length, 2);
  assert.ok(arr.every((m) => lot.otOf(u, m) === u.tid));
});

test('regalos: el ejemplar conserva el ID (y el nombre) del entrenador original, aunque pase por varias manos', () => {
  const a = user({ 129: { n: 2, s: 0 } });
  const b = user({});
  const c = user({});
  const give = (from, to) => { // mismo flujo que `giftPoke` de index.js
    const before = sp.sync(from, 129).slice();
    gacha.takePoke(from, 129, false);
    const left = new Set(sp.sync(from, 129).map((m) => m.uid));
    const gone = before.find((m) => !left.has(m.uid));
    const seen = new Set(sp.sync(to, 129).map((m) => m.uid));
    gacha.grant(to, 129, false);
    const got = sp.sync(to, 129).find((m) => !seen.has(m.uid));
    sp.applyTraits(129, got, sp.traitsOf(gone, from));
    return got;
  };
  const x = give(a, b);
  assert.strictEqual(x.ot, lot.tidOf(a));
  assert.strictEqual(x.otn, a.username);
  assert.notStrictEqual(lot.tidOf(a), lot.tidOf(b));
  assert.strictEqual(lot.otOf(b, x), lot.tidOf(a));
  assert.strictEqual(lot.otNameOf(b, x), a.username);
  const y = give(b, c); // sigue siendo de a
  assert.strictEqual(lot.otOf(c, y), lot.tidOf(a));
  assert.strictEqual(lot.otNameOf(c, y), a.username);
  // El que se queda el donante conserva el suyo.
  assert.ok(sp.sync(a, 129).every((m) => lot.otOf(a, m) === lot.tidOf(a)));
  // Y sirve para la lotería: el receptor tiene ahora dos ID distintos.
  for (const m of c.mons[129]) m.at = 1; // (el ejemplar recién regalado cuenta desde mañana)
  const ids = lot.otList(c, '2026-11-05').map((o) => o.ot);
  assert.ok(ids.includes(lot.tidOf(a)));
});

test('anti-abuso: los Pokémon obtenidos hoy no cuentan para el sorteo de hoy', () => {
  const num = lot.numberFor('2026-11-05');
  const u = user();
  u.mons[25][0].ot = num;
  u.mons[25][0].at = Date.UTC(2026, 10, 5, 8, 0); // obtenido hoy a las 8:00 UTC
  const r = lot.check(u, D1);
  assert.strictEqual(r.match < 5, true);
  assert.deepStrictEqual(u.items, {});
  // Mañana sí cuenta (ya es de «antes de hoy»), contra el número de mañana.
  const num2 = lot.numberFor('2026-11-06');
  u.mons[25][0].ot = num2;
  assert.strictEqual(lot.check(u, D2).match, 5);
});

test('valor esperado documentado: despreciable frente a cualquier otra fuente', () => {
  // EV por día con k ID distintos, en monedas de tienda equivalentes (Ultra Ball 480; EXP: 100 EXP ≈ 1 PB ≈ 3 monedas de Ball… cota alta: 30 monedas por 1.000 EXP).
  const val = { 2: 100 * 0.03, 3: 3000 * 0.03, 4: 5 * items.ITEMS['ultra-ball'].price, 5: 3 * 25000 };
  const ev = (k) => k * [2, 3, 4, 5].reduce((s, j) => s + lot.probExact(j) * val[j], 0);
  assert.ok(ev(1) < 10, `EV con 1 ID: ${ev(1)}`);
  assert.ok(ev(12) < 120, `EV con 12 ID: ${ev(12)}`);
});
