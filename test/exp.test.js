'use strict';
// Progresión como en los juegos: EXP, Caramelos Exp., Huevo Suerte, migración de caramelos, Entrenamiento Extremo (Chapas),
// Pokérus y evoluciones al azar «reales». Ver docs/BALANCE.md («Progresión como en los juegos»).
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-exp2-'));

const db = require('../server/db');
const hub = require('../server/hub');
const sp = require('../server/specimen');
const candy = require('../server/candy');
const exp = require('../server/exp');
const hyper = require('../server/hyper');
const pokerus = require('../server/pokerus');
const forms = require('../server/forms');
const evs = require('../server/evs');
const items = require('../server/items');
const sd = require('../server/sdmap');
const sdw = require('../server/showdown');
const fixes = require('../server/fixes');
const { DEX, BY_ID } = require('../server/pokedex');

let n = 0;
function user(extra = {}) {
  const name = 'xp' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 100000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection: {}, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, ...extra };
  db.addUser(u);
  return u;
}
const byName = (name) => DEX.find((p) => p.name === name);
const one = (id, extra = {}) => { const u = user({ collection: { [id]: { n: 2, s: 0 } }, ...extra }); sp.syncAll(u); return { u, m: u.mons[id][0], id }; };

// ---------- Datos y fórmula ----------
test('grupos de experiencia reales: tablas de PokeAPI para las 1.025 especies', () => {
  assert.strictEqual(Object.keys(exp.DATA.sp).length, 1025);
  // Nv. 100: Rápido 800.000 · Medio rápido 1.000.000 · Medio lento 1.059.860 · Lento 1.250.000 · Errático 600.000 · Fluctuante 1.640.000
  assert.deepStrictEqual([3, 2, 4, 1, 5, 6].map((g) => exp.DATA.table[g][99]), [800000, 1000000, 1059860, 1250000, 600000, 1640000]);
  assert.strictEqual(exp.groupOf(25), 2); // Pikachu: medio rápido
  assert.strictEqual(exp.groupOf(6), 4); // Charizard: medio lento
  assert.strictEqual(exp.groupOf(130), 1); // Gyarados: lento
  assert.strictEqual(exp.expAt(25, 50), 125000);
  assert.strictEqual(exp.levelAt(25, 124999), 49);
  assert.strictEqual(exp.levelAt(25, 125000), 50);
  assert.strictEqual(exp.levelAt(25, 9e9), 100);
  for (const p of DEX) { const t = exp.DATA.table[exp.groupOf(p.id)]; assert.ok(t && exp.baseExp(p.id) > 0, p.name); }
});

test('EXP de combate: fórmula escalada de 5.ª generación (×1,5 de entrenador, repartida entre participantes)', () => {
  const b = exp.baseExp(25); // Pikachu: 112
  const manual = (Lf, Lp, s, t) => Math.floor(((b * Lf) / (5 * s) * Math.pow((2 * Lf + 10) / (Lf + Lp + 10), 2.5) + 1) * t);
  assert.strictEqual(exp.foeExp(25, 50, 50, 1, true), manual(50, 50, 1, 1.5));
  assert.strictEqual(exp.foeExp(25, 50, 50, 1, false), manual(50, 50, 1, 1));
  assert.strictEqual(exp.foeExp(25, 30, 12, 3, true), manual(30, 12, 3, 1.5));
  // Ir por debajo del rival da más; ir por encima, menos; más participantes, menos cada uno.
  assert.ok(exp.foeExp(25, 50, 10, 1) > exp.foeExp(25, 50, 50, 1));
  assert.ok(exp.foeExp(25, 50, 90, 1) < exp.foeExp(25, 50, 50, 1));
  assert.ok(exp.foeExp(25, 50, 50, 3) < exp.foeExp(25, 50, 50, 1) / 2);
  assert.ok(exp.foeExp(25, 1, 100, 6) >= 1);
});

// ---------- Subir de nivel, tope diario, Huevo Suerte ----------
test('award: sube niveles, aprende movimientos, tope diario por ejemplar y nunca pasa del 100', () => {
  const { u, m, id } = one(25);
  const r = exp.award(u, id, m, 5000, 'battle');
  assert.strictEqual(r.exp, 5000);
  assert.strictEqual(m.exp, exp.expAt(id, 5) + 5000);
  assert.strictEqual(m.level, exp.levelAt(id, m.exp));
  assert.ok(r.to > r.from && m.level > 5);
  // Tope diario: nunca más de dayCap, aunque se sumen muchas fuentes.
  const cap = exp.dayCap(id, m);
  const r2 = exp.award(u, id, m, 10 * cap, 'exp');
  assert.strictEqual(m.xc.n, cap, 'el día se queda en el tope');
  assert.strictEqual(r2.exp, cap - 5000);
  assert.strictEqual(exp.award(u, id, m, 100, 'battle').exp, 0);
  // Los Caramelos Exp. no tienen tope diario propio.
  assert.strictEqual(exp.award(u, id, m, 777, 'item').exp, 777);
  // Mañana, otro tope (calculado desde el nivel con el que se empieza el día).
  m.xc = { day: '2000-01-01', lv: 5, n: 99999 };
  assert.ok(exp.capLeft(id, m) > 0);
  // Tope máximo en Nv. 100.
  m.exp = exp.expAt(id, 100) - 10; m.level = 99; m.xc = undefined;
  assert.strictEqual(exp.award(u, id, m, 1e6, 'item').exp, 10);
  assert.strictEqual(m.level, 100);
  assert.strictEqual(exp.award(u, id, m, 1000, 'item').exp, 0);
});

test('tope diario: ≈ 5 niveles a niveles medios y 24.000 EXP como mínimo', () => {
  const m = { level: 5, exp: exp.expAt(25, 5), uid: 'aaaa0001' };
  m.xc = { day: hub.dayKey(), lv: 5, n: 0 };
  assert.strictEqual(exp.dayCap(25, m), exp.CAP_MIN);
  m.xc = { day: hub.dayKey(), lv: 50, n: 0 };
  assert.strictEqual(exp.dayCap(25, m), exp.expAt(25, 55) - exp.expAt(25, 50));
  assert.ok(exp.dayCap(25, m) > 30000 && exp.dayCap(25, m) < 80000);
  m.xc = { day: hub.dayKey(), lv: 100, n: 0 };
  assert.strictEqual(exp.dayCap(25, m), exp.CAP_MIN);
});

test('Huevo Suerte: +50 % de EXP de combate y expedición (no de caramelos)', () => {
  const a = one(25); const b = one(25);
  b.m.item = 'luckyegg';
  assert.strictEqual(exp.award(a.u, 25, a.m, 1000, 'battle').exp, 1000);
  assert.strictEqual(exp.award(b.u, 25, b.m, 1000, 'battle').exp, 1500);
  assert.strictEqual(exp.award(b.u, 25, b.m, 1000, 'exp').exp, 1500);
  assert.strictEqual(exp.award(b.u, 25, b.m, 1000, 'item').exp, 1000);
  // Es un objeto de la Tienda de Combate (64 PB) y se equipa como los demás.
  assert.strictEqual(items.ITEMS['hi-luckyegg'].bp, 64);
  assert.strictEqual(items.ITEMS['hi-luckyegg'].name, 'Huevo Suerte');
  assert.strictEqual(require('../server/bp').holdable('luckyegg'), true);
});

// ---------- Caramelos Exp. ----------
test('Caramelos Exp.: valores, uso con cantidad, sin tope diario, no se compran con monedas ni se reciclan', () => {
  assert.deepStrictEqual(exp.CANDIES.map((c) => c[2]), [100, 800, 3000, 10000, 30000]);
  for (const id of exp.CANDY_IDS) {
    assert.strictEqual(items.ITEMS[id].price, null);
    assert.strictEqual(candy.recycleValue(id), 0);
    assert.throws(() => items.buy(user({ coins: 1e6 }), { itemId: id }), /no está a la venta/);
  }
  const { u, m, id } = one(25, { items: { 'exp-xs': 10, 'exp-m': 4 } });
  const r = exp.useCandy(u, { id, uid: m.uid, itemId: 'exp-m', qty: 3 });
  assert.strictEqual(r.used, 3);
  assert.strictEqual(u.items['exp-m'], 1);
  assert.strictEqual(m.exp, exp.expAt(id, 5) + 9000);
  assert.strictEqual(r.level, m.level);
  assert.ok(r.next > 0);
  assert.throws(() => exp.useCandy(u, { id, uid: m.uid, itemId: 'exp-m', qty: 2 }) && exp.useCandy(u, { id, uid: m.uid, itemId: 'exp-l', qty: 1 }), /No tienes/);
  assert.throws(() => exp.useCandy(u, { id, uid: m.uid, itemId: 'exp-xs', qty: 0 }), /Cantidad/);
  assert.throws(() => exp.useCandy(u, { id, uid: m.uid, itemId: 'exp-xs', qty: 1.5 }), /Cantidad/);
  assert.throws(() => exp.useCandy(u, { id, uid: 'nope', itemId: 'exp-xs', qty: 1 }), /No tienes ese ejemplar|no válido/i);
  assert.throws(() => exp.useCandy(u, { id, uid: m.uid, itemId: 'ticket', qty: 1 }), /no da EXP/);
  // Con el tope diario lleno, los caramelos siguen funcionando.
  m.xc = { day: hub.dayKey(), lv: m.level, n: exp.dayCap(id, m) };
  const before = m.exp;
  exp.useCandy(u, { id, uid: m.uid, itemId: 'exp-xs', qty: 10 });
  assert.strictEqual(m.exp, before + 1000);
  // Se detiene en el Nv. 100: solo gasta los necesarios.
  const z = one(25, { items: { 'exp-xl': 99 } });
  const rz = exp.useCandy(z.u, { id: 25, uid: z.m.uid, itemId: 'exp-xl', qty: 99 });
  assert.strictEqual(z.m.level, 100);
  assert.strictEqual(rz.used, Math.ceil((exp.expAt(25, 100) - exp.expAt(25, 5)) / 30000));
  assert.strictEqual(z.u.items['exp-xl'], 99 - rz.used);
  assert.throws(() => exp.useCandy(z.u, { id: 25, uid: z.m.uid, itemId: 'exp-xl', qty: 1 }), /máximo/);
  // Un ejemplar fuera (expedición) no los recibe.
  const w = one(25, { items: { 'exp-xs': 1 } });
  w.m.away = 'exp:abc';
  assert.throws(() => exp.useCandy(w.u, { id: 25, uid: w.m.uid, itemId: 'exp-xs', qty: 1 }), /fuera/);
});

test('subir de nivel con caramelos: aprende movimientos y avisa de la evolución', () => {
  const { u, m, id } = one(4, { items: { 'exp-l': 1 } }); // Charmander
  const r = exp.useCandy(u, { id, uid: m.uid, itemId: 'exp-l', qty: 1 });
  assert.ok(m.level >= 16 && r.to === m.level);
  assert.ok(r.learned.length + r.pending.length > 0, 'movimientos nuevos');
  assert.deepStrictEqual(r.evo.map((x) => x.to), [byName('Charmeleon').id]);
});

// ---------- EXP de combate contra la CPU ----------
test('victoria contra la CPU: EXP para todos los participantes con la fórmula, tope diario y Pokérus', () => {
  const ids = [25, 6, 9];
  const u = user({ collection: Object.fromEntries(ids.map((id) => [id, { n: 1, s: 0 }])) });
  sp.syncAll(u);
  const roster = ids.map((id) => ({ id, uid: u.mons[id][0].uid, level: 50, name: BY_ID.get(id).name }));
  const foes = [{ id: 74, level: 50 }, { id: 95, level: 50 }, { id: 66, level: 50 }];
  const side = { roster, seen: new Set(roster.map((r) => r.name)) };
  const b = { trainer: { id: 'ramon', cls: 'Montañero', name: 'Ramón', tier: 1 }, sides: [side, { roster: foes }] };
  u.items['hi-luckyegg'] = 0;
  u.mons[6][0].item = 'luckyegg';
  const before = ids.map((id) => u.mons[id][0].exp);
  const out = sdw.cpuReward(b, u, side);
  assert.strictEqual(out.exp.length, 3);
  for (const x of out.exp) {
    let want = 0;
    for (const f of foes) want += exp.foeExp(f.id, f.level, 5, 3, true);
    const lucky = x.id === 6 ? 1.5 : 1;
    assert.strictEqual(x.exp, Math.floor(want * lucky), BY_ID.get(x.id).name);
    assert.ok(x.to > x.from, 'un Nv. 5 contra rivales de Nv. 50 sube muchos niveles');
    assert.strictEqual(u.mons[x.id][0].exp, before[ids.indexOf(x.id)] + x.exp);
  }
  assert.ok(Array.isArray(out.evolve) && out.evolve.every((e) => e.to.length));
  assert.ok(!u.candy);
  assert.deepStrictEqual(out.pokerus.filter((p) => !p.name), []);
  // El tope diario por ejemplar también vale para los combates.
  for (let i = 0; i < 4; i++) { u.btDay = { day: hub.dayKey(), wins: 0 }; sdw.cpuReward(b, u, side); }
  for (const id of ids) { const m = u.mons[id][0]; assert.ok(m.xc.n <= exp.dayCap(id, m)); }
});

// ---------- Migración ----------
test('migración: caramelos de familia y comodín → Caramelos Exp. (valor justo, redondeado hacia arriba, sin perder nada)', () => {
  // 1 caramelo ≈ EXP(5→100) del grupo de su familia ÷ 144 (lo que costaba subir de 5 a 100)
  assert.strictEqual(exp.OLD_CANDIES_5_100, 144);
  for (const g of [1, 2, 3, 4, 5, 6]) assert.strictEqual(exp.perCandy(g), Math.ceil((exp.DATA.table[g][99] - exp.DATA.table[g][4]) / 144), 'grupo ' + g);
  assert.strictEqual(exp.perCandy(2), 6944); // medio rápido
  assert.ok(exp.wildValue() >= 4166 && exp.wildValue() <= 11389, 'el comodín es la media de los grupos');
  const chainPika = BY_ID.get(25).chain; // medio rápido
  const chainChar = BY_ID.get(4).chain; // medio lento
  const u = user({ candy: { [chainPika]: 10, [chainChar]: 3, '*': 7 }, collection: { 25: { n: 1, s: 0 } }, items: { ticket: 2, 'exp-s': 1 } });
  sp.syncAll(u);
  const lvlBefore = u.mons[25][0].level; const ivsBefore = u.mons[25][0].ivs.slice();
  const total = 10 * exp.perCandy(2) + 3 * exp.perCandy(4) + 7 * exp.wildValue();
  const r = exp.migrate(u);
  assert.strictEqual(r.candies, 20);
  assert.strictEqual(r.exp, total);
  // Redondeado hacia arriba a un XS: nunca se pierde nada.
  const given = Object.entries(r.items).reduce((s, [k, q]) => s + exp.CANDY_EXP[k] * q, 0);
  assert.ok(given >= total && given < total + 100, `${given} ≥ ${total}`);
  assert.strictEqual(u.items.ticket, 2);
  assert.strictEqual(u.items['exp-s'], 1 + (r.items['exp-s'] || 0), 'se suman a lo que ya tenía');
  assert.ok(!u.candy);
  assert.ok(u.expMig);
  // Los niveles y los IV que ya tenía no se tocan.
  assert.strictEqual(u.mons[25][0].level, lvlBefore);
  assert.deepStrictEqual(u.mons[25][0].ivs, ivsBefore);
  // Idempotente.
  assert.strictEqual(exp.migrate(u), null);
  assert.strictEqual(Object.values(u.items).reduce((a, b) => a + b, 0), 2 + 1 + Object.values(r.items).reduce((a, b) => a + b, 0));
  // Cuentas sin caramelos: solo se marca.
  const v = user();
  assert.strictEqual(exp.migrate(v), null);
  assert.ok(v.expMig);
  // El IV entrenado con caramelos antes se conserva como IV real.
  const t = one(1); t.m.ivs = [31, 31, 31, 31, 31, 31];
  assert.deepStrictEqual(sp.boxView(t.u).mons.find((x) => x.uid === t.m.uid).ivs, [31, 31, 31, 31, 31, 31]);
});

test('migración: llega por la corrección de arranque (con copia de seguridad) y por lectura perezosa de la cuenta', async () => {
  const a = user({ candy: { 1: 5, '*': 3 } });
  const b = user({ candy: { 4: 2 } });
  const fix = fixes.FIXES.find((f) => f.id === 'caramelos-exp-2026-11-04');
  assert.ok(fix);
  const out = fix.apply();
  assert.ok(out.length >= 2);
  assert.ok(a.expMig && b.expMig && !a.candy && !b.candy);
  assert.ok(Object.keys(a.items).some((k) => k.startsWith('exp-')));
  assert.strictEqual(a.candyOld.n, 8);
  // Lectura perezosa (cuenta restaurada de una copia vieja).
  const c = user({ candy: { 7: 4 } });
  assert.ok(hub.privateUser(c).items);
  assert.ok(c.expMig && !c.candy && Object.keys(c.items).some((k) => k.startsWith('exp-')));
  // Valor en EXP convertido ≥ el de lo anterior para cada familia y para el comodín.
  const d = user({ candy: { '*': 100 } });
  const r = exp.migrate(d);
  assert.ok(r.exp === 100 * exp.wildValue());
  void a;
});

// ---------- Entrenamiento Extremo ----------
test('Chapas: Botella = una estadística, Dorada = las seis; Nv. 50+; IV efectivos 31 en combate y estadísticas; IV reales intactos', () => {
  const { u, m, id } = one(25, { items: { 'bottle-cap': 3, 'gold-bottle-cap': 2 } });
  m.ivs = [10, 31, 0, 5, 20, 31];
  m.level = 49;
  assert.throws(() => hyper.use(u, { id, uid: m.uid, itemId: 'bottle-cap', stat: 0 }), /nivel 50/);
  m.level = 50;
  const stats0 = sp.computeStats(id, m);
  assert.throws(() => hyper.use(u, { id, uid: m.uid, itemId: 'bottle-cap' }), /Elige/);
  assert.throws(() => hyper.use(u, { id, uid: m.uid, itemId: 'bottle-cap', stat: 1 }), /IV 31/, 'IV ya perfecto');
  const r = hyper.use(u, { id, uid: m.uid, itemId: 'bottle-cap', stat: 2 });
  assert.deepStrictEqual(r.hyper, [false, false, true, false, false, false]);
  assert.strictEqual(u.items['bottle-cap'], 2);
  assert.throws(() => hyper.use(u, { id, uid: m.uid, itemId: 'bottle-cap', stat: 2 }), /ya tiene/);
  assert.deepStrictEqual(m.ivs, [10, 31, 0, 5, 20, 31], 'los IV reales no cambian');
  assert.deepStrictEqual(hyper.effIvs(m), [10, 31, 31, 5, 20, 31]);
  // Estadísticas de la Caja y conjunto de Showdown usan los IV efectivos.
  assert.ok(sp.computeStats(id, m)[2] > stats0[2]);
  const { set } = sd.toSet(id, m);
  assert.deepStrictEqual(set.ivs, { hp: 10, atk: 31, def: 31, spa: 5, spd: 20, spe: 31 });
  const g = hyper.use(u, { id, uid: m.uid, itemId: 'gold-bottle-cap' });
  assert.deepStrictEqual(g.stats, [0, 3, 4], 'solo las que no estaban a 31 ni entrenadas');
  assert.deepStrictEqual(hyper.effIvs(m), Array(6).fill(31));
  assert.deepStrictEqual(sd.toSet(id, m).set.ivs, { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 });
  assert.deepStrictEqual(m.ivs, [10, 31, 0, 5, 20, 31]);
  assert.throws(() => hyper.use(u, { id, uid: m.uid, itemId: 'gold-bottle-cap' }), /ya están a 31/);
  assert.strictEqual(u.items['gold-bottle-cap'], 1);
  // La Caja PC lo muestra.
  const view = sp.boxView(u).mons.find((x) => x.uid === m.uid);
  assert.deepStrictEqual(view.hyper, [true, false, true, true, true, false], 'las de IV 31 no necesitan chapa');
  assert.deepStrictEqual(view.ivs, [10, 31, 0, 5, 20, 31]);
  // Sin chapas / objeto equivocado / ocupado.
  assert.throws(() => hyper.use(u, { id, uid: m.uid, itemId: 'exp-xs', stat: 0 }), /no se usa así/);
  const o = one(25, { items: { 'bottle-cap': 1 } }); o.m.level = 60; o.m.away = 'care';
  assert.throws(() => hyper.use(o.u, { id: 25, uid: o.m.uid, itemId: 'bottle-cap', stat: 0 }), /fuera/);
  assert.throws(() => hyper.use(user(), { id: 25, uid: 'zzzz', itemId: 'gold-bottle-cap' }), /No tienes/);
});

test('Chapas: solo con Puntos de Batalla (40 y 200), nunca con monedas ni con PNJ; no se pierden los IV entrenados antes', () => {
  assert.strictEqual(items.ITEMS['bottle-cap'].bp, 40);
  assert.strictEqual(items.ITEMS['gold-bottle-cap'].bp, 200);
  assert.strictEqual(items.ITEMS['bottle-cap'].price, null);
  const u = user({ items: {} });
  u.bp = 250;
  require('../server/bp').buy(u, { itemId: 'gold-bottle-cap' });
  assert.strictEqual(u.items['gold-bottle-cap'], 1);
  assert.strictEqual(u.bp, 50);
  assert.throws(() => items.buy(u, { itemId: 'gold-bottle-cap' }), /no está a la venta/);
  // El sistema de entrenar IV con caramelos ya no existe, pero lo conseguido se conserva como IV reales.
  assert.strictEqual(candy.train, undefined);
});

// ---------- Pokérus ----------
test('Pokérus: rarísimo, duplica los EVs, se contagia en el mismo equipo y se cura en 2-5 días', () => {
  assert.strictEqual(pokerus.CHANCE, 1 / 3000);
  const { u, m } = one(25);
  const { m: m2 } = one(25);
  const { m: m3 } = one(25);
  const mk = (...ms) => ms.map((x, i) => ({ id: 25, m: x, i }));
  // Sin suerte: nadie se infecta.
  assert.deepStrictEqual(pokerus.roll(u, mk(m, m2), { rand: () => 0.9 }), []);
  assert.strictEqual(pokerus.state(m), null);
  assert.strictEqual(pokerus.evMult(m), 1);
  // Con la suerte de 1/3000 uno se infecta («nuevo», se avisa).
  const nuevos = pokerus.roll(u, mk(m), { rand: () => 0.0001 });
  assert.strictEqual(nuevos.length, 1);
  assert.strictEqual(nuevos[0].spread, false);
  assert.strictEqual(pokerus.state(m), 'infected');
  assert.ok(m.prk.days >= 2 && m.prk.days <= 5, 'días hasta curarse');
  assert.strictEqual(pokerus.evMult(m), 2);
  // Contagio: con un portador infectado en el equipo, el resto se infecta con un 25 %.
  const spread = pokerus.roll(u, mk(m, m2, m3), { rand: (() => { const seq = [0.1, 0.9, 0.9, 0.9]; let i = 0; return () => seq[i++]; })() });
  assert.strictEqual(spread.length, 1);
  assert.strictEqual(spread[0].spread, true);
  assert.strictEqual(pokerus.state(m2), 'infected');
  assert.strictEqual(pokerus.state(m3), null);
  // Se cura (sigue duplicando, pero ya no contagia).
  const day0 = m.prk.day;
  const later = new Date(Date.parse(day0) + (m.prk.days + 1) * 86400000).toISOString().slice(0, 10);
  assert.strictEqual(pokerus.state(m, later), 'cured');
  assert.strictEqual(pokerus.state(m, day0), 'infected');
  m.prk = { day: '2000-01-01', days: 3 };
  m2.prk = undefined;
  assert.strictEqual(pokerus.state(m), 'cured');
  assert.strictEqual(pokerus.evMult(m), 2, 'curado: sigue duplicando');
  assert.deepStrictEqual(pokerus.roll(u, mk(m, m2), { rand: () => 0.1, chance: 0 }), [], 'un curado no contagia');
  // Duplica los EVs que gana (el tope diario cuenta lo «base»).
  const a = one(25); const b = one(25);
  b.m.prk = { day: hub.dayKey(), days: 3 };
  evs.gain(a.m, 1, 8, 'bat');
  evs.gain(b.m, 1, 8, 'bat');
  assert.ok(a.m.evs[1] > 0);
  assert.strictEqual(b.m.evs[1], 2 * a.m.evs[1]);
  assert.strictEqual(b.m.evd.bat, a.m.evd.bat, 'el tope diario cuenta el valor base');
  assert.ok(evs.total(b.m) <= evs.MAX_TOTAL);
  // Marca en la Caja PC.
  assert.strictEqual(sp.boxView(b.u).mons.find((x) => x.uid === b.m.uid).pkrs, 'infected');
  // Los NPC nunca lo cogen.
  assert.deepStrictEqual(pokerus.roll({ npc: true }, mk(m3), { rand: () => 0 }), []);
});

// ---------- Evoluciones al azar «reales» ----------
test('Wurmple: Silcoon o Cascoon según el propio ejemplar (determinista, ≈ 50 / 50)', () => {
  const wurmple = byName('Wurmple').id;
  const silcoon = byName('Silcoon').id; const cascoon = byName('Cascoon').id;
  assert.deepStrictEqual([silcoon, cascoon], [forms.SILCOON, forms.CASCOON]);
  const seen = { [silcoon]: 0, [cascoon]: 0 };
  for (let i = 0; i < 2000; i++) {
    const uid = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
    const t = forms.forcedTarget(wurmple, { uid });
    assert.strictEqual(t, forms.forcedTarget(wurmple, { uid }), 'mismo ejemplar, mismo resultado');
    seen[t]++;
  }
  assert.ok(seen[silcoon] > 850 && seen[cascoon] > 850, JSON.stringify(seen));
  // Se aplica en el servidor: solo se puede evolucionar al que toca.
  const { u, m, id } = one(wurmple);
  m.level = 20;
  const want = forms.forcedTarget(wurmple, m);
  const other = want === silcoon ? cascoon : silcoon;
  assert.throws(() => candy.evolve(u, { id, uid: m.uid, to: other }), /solo puede evolucionar a/);
  assert.strictEqual(candy.evolve(u, { id, uid: m.uid, to: want }).to, want);
  assert.deepStrictEqual(candy.evoOptions(u, u.mons[want][0], want).map((x) => x.to), [want === silcoon ? byName('Beautifly').id : byName('Dustox').id], 'y luego, la suya');
  // El aviso del nivel 7 solo ofrece la rama correcta.
  const w = one(wurmple); w.m.level = 7;
  assert.deepStrictEqual(candy.evoOptions(w.u, w.m, wurmple).map((x) => x.to), [forms.forcedTarget(wurmple, w.m)]);
});

test('Dunsparce → Dudunsparce de tres segmentos (1 de cada 100) y Tandemaus → Maushold familia de tres (1 de cada 100)', () => {
  const dud = byName('Dudunsparce').id; const maus = byName('Maushold').id;
  let three = 0; let mthree = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const uid = (i * 2654435761 % 0xffffffff).toString(16).padStart(8, '0');
    if (forms.formOf(dud, { uid }) === 'three') three++;
    if (forms.formOf(maus, { uid }) === 'three') mthree++;
    assert.strictEqual(forms.formOf(dud, { uid }), forms.formOf(dud, { uid }));
  }
  assert.ok(three > 0.006 * N && three < 0.016 * N, `tres segmentos: ${three / N}`);
  assert.ok(mthree > 0.006 * N && mthree < 0.016 * N, `familia de tres: ${mthree / N}`);
  assert.strictEqual(forms.label(dud, { uid: 'ffffffff' }) === null, false);
  // Nombre de Showdown de cada forma.
  const find = (id, want) => { for (let i = 0; i < 100000; i++) { const uid = i.toString(16).padStart(8, '0'); if (forms.formOf(id, { uid }) === want) return uid; } };
  assert.strictEqual(forms.showdownName(dud, { uid: find(dud, 'three') }), 'Dudunsparce-Three-Segment');
  assert.strictEqual(forms.showdownName(dud, { uid: find(dud, 'two') }), null);
  assert.strictEqual(forms.showdownName(maus, { uid: find(maus, 'four') }), 'Maushold-Four');
  assert.strictEqual(forms.showdownName(maus, { uid: find(maus, 'three') }), null);
  // Al evolucionar el ejemplar fija su forma y el conjunto de Showdown la usa.
  const t = one(byName('Tandemaus').id); t.m.level = 25;
  candy.evolve(t.u, { id: byName('Tandemaus').id, uid: t.m.uid, to: maus });
  const mm = t.u.mons[maus][0];
  assert.strictEqual(mm.form, forms.formOf(maus, mm));
  const species = sd.toSet(maus, mm).set.species;
  assert.strictEqual(species, mm.form === 'four' ? 'Maushold-Four' : 'Maushold');
  assert.strictEqual(sp.boxView(t.u).mons.find((x) => x.uid === mm.uid).form, forms.label(maus, mm));
  // Dunsparce necesita conocer Taladro Giratorio (Hyper Drill) y el nivel.
  const d = one(byName('Dunsparce').id); d.m.level = 40;
  assert.throws(() => candy.evolve(d.u, { id: byName('Dunsparce').id, uid: d.m.uid, to: dud }), /Taladro|Hyper|conocer/i);
});

// ---------- Evoluciones: datos ----------
test('requisitos de nivel de las evoluciones salen de los juegos y las «de nivel» se ofrecen al subir', () => {
  const evoreq = require('../server/evoreq');
  assert.strictEqual(evoreq.levelOf(byName('Ivysaur').id), 16);
  assert.strictEqual(evoreq.levelOf(byName('Venusaur').id), 32);
  assert.strictEqual(evoreq.levelOf(byName('Charizard').id), 36);
  assert.strictEqual(evoreq.levelOf(byName('Alakazam').id), 0);
  assert.ok(evoreq.isLevelUp(byName('Charmeleon').id) && !evoreq.isLevelUp(byName('Alakazam').id) && !evoreq.isLevelUp(byName('Vaporeon').id));
  assert.ok(evoreq.isLevelUp(byName('Pikachu').id), 'amistad al subir');
  // Una especie con evolución por piedra no ofrece el aviso al subir.
  const { u, m, id } = one(byName('Growlithe').id); m.level = 60;
  assert.deepStrictEqual(candy.evoOptions(u, m, id), []);
  assert.deepStrictEqual(sp.boxView(u).mons.find((x) => x.uid === m.uid).canEvo, []);
  items.give(u, 'fire-stone', 1);
  assert.deepStrictEqual(sp.boxView(u).mons.find((x) => x.uid === m.uid).canEvo, [byName('Arcanine').id], 'desde la Caja PC sí');
});
