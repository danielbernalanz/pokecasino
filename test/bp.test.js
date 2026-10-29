'use strict';
// Puntos de Batalla, Tienda de Combate, objetos equipados, mentas, Cápsula/Parche de Habilidad y habilidad oculta heredada.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-bp-'));

const db = require('../server/db');
const specimen = require('../server/specimen');
const items = require('../server/items');
const bp = require('../server/bp');
const bpdata = require('../server/bpdata');
const abilities = require('../server/abilities');
const sd = require('../server/sdmap');
const sdw = require('../server/showdown');
const daycare = require('../server/daycare');
const npc = require('../server/npc');
const market = require('../server/market');
const trainers = require('../server/trainers');

let n = 0;
function user(collection = {}, extra = {}) {
  const name = 'bp' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 1000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 5, createdAt: Date.now() - 9 * 864e5, ...extra };
  db.addUser(u);
  specimen.syncAll(u);
  return u;
}
const ref = (u, id, i = 0) => ({ id, uid: u.mons[id][i].uid });

test('PB: topes diarios, PvP con turnos mínimos y límite por rival; no hay forma de convertirlos en monedas', () => {
  const u = user();
  let total = 0;
  for (let i = 0; i < 20; i++) total += bp.cpuWin(u, 6);
  assert.strictEqual(total, 30);
  assert.strictEqual(u.bp, 30);
  assert.strictEqual(bp.cpuWin(u, 6), 0);
  assert.strictEqual(bp.pvp(u, true, 'x', 2), 0, 'menos de 3 turnos');
  assert.strictEqual(bp.pvp(u, true, 'x', 10), 3);
  assert.strictEqual(bp.pvp(u, false, 'y', 10), 1);
  bp.pvp(u, true, 'x', 10); bp.pvp(u, true, 'x', 10);
  assert.strictEqual(bp.pvp(u, true, 'x', 10), 0, '3 combates con PB por rival');
  const v = user();
  let t = 0;
  for (let i = 0; i < 30; i++) t += bp.pvp(v, true, 'r' + i, 10);
  assert.strictEqual(t, 20);
  assert.strictEqual(u.coins, 1000);
  assert.strictEqual(bp.cpuWin(user(), 1), 1);
  // Mercado: los PB no son un artículo.
  assert.throws(() => market.sell(user({}, { bp: 99 }), { kind: 'bp', qty: 1, price: 10 }));
});

test('Tienda de Combate: precios en PB, compra y falta de saldo', () => {
  for (const [id, it] of Object.entries(items.ITEMS)) if (it.bp) assert.ok(it.price === null && ((it.held && it.bp >= 16 && it.bp <= 48) || (it.mint && it.bp === 50) || (it.capsule && it.bp === 50) || (it.patch && it.bp === 200)), id);
  assert.strictEqual(Object.values(items.ITEMS).filter((i) => i.held).length, 16);
  assert.strictEqual(Object.values(items.ITEMS).filter((i) => i.mint).length, 21);
  const u = user({}, { bp: 47 });
  assert.throws(() => bp.buy(u, { itemId: 'hi-leftovers' }), /48 PB/);
  u.bp = 100;
  const r = bp.buy(u, { itemId: 'hi-leftovers' });
  assert.strictEqual(r.bp, 52);
  assert.strictEqual(u.items['hi-leftovers'], 1);
  assert.throws(() => bp.buy(u, { itemId: 'ticket' }), /Tienda de Combate/);
  assert.throws(() => items.buy(u, { itemId: 'hi-leftovers' }), /a la venta/);
  assert.ok(!u.hist.log.some((l) => l.d < 0), 'los PB no gastan monedas');
});

test('objetos equipados: uno por Pokémon, el anterior vuelve, entran en el conjunto de Showdown y Cláusula de objetos en PvP', () => {
  const u = user({ 25: { n: 1, s: 0 }, 6: { n: 1, s: 0 } }, { items: { 'hi-leftovers': 1, 'hi-lifeorb': 1 }, berries: { 'berry-zidra': 2 } });
  assert.throws(() => bp.hold(u, { ...ref(u, 25), item: 'choiceband' }), /No tienes/);
  assert.throws(() => bp.hold(u, { ...ref(u, 25), item: 'mastersword' }), /no se puede/);
  bp.hold(u, { ...ref(u, 25), item: 'leftovers' });
  assert.ok(!u.items['hi-leftovers']);
  bp.hold(u, { ...ref(u, 25), item: 'lifeorb' });
  assert.strictEqual(u.items['hi-leftovers'], 1, 'vuelve a la mochila');
  assert.strictEqual(sd.toSet(25, u.mons[25][0], {}).set.item, 'lifeorb');
  bp.hold(u, { ...ref(u, 25), item: '' });
  assert.strictEqual(u.items['hi-lifeorb'], 1);
  assert.strictEqual(sd.toSet(25, u.mons[25][0], {}).set.item, '');
  // Bayas del Huerto.
  bp.hold(u, { ...ref(u, 25), item: 'sitrusberry' });
  assert.strictEqual(u.berries['berry-zidra'], 1);
  assert.strictEqual(sd.toSet(25, u.mons[25][0], {}).set.item, 'sitrusberry');
  // Cláusula de objetos solo en PvP.
  u.items['hi-leftovers'] = 2;
  bp.hold(u, { ...ref(u, 6), item: 'leftovers' });
  bp.hold(u, { ...ref(u, 25), item: 'leftovers' });
  const team = [ref(u, 6), ref(u, 25)];
  assert.doesNotThrow(() => sdw.resolveTeam(u, team, { format: 'singles', level: 'fair' }));
  assert.throws(() => sdw.resolveTeam(u, team, { format: 'singles', level: 'fair', itemClause: true }), /Cláusula de objetos/);
});

test('mentas: cambian la naturaleza efectiva (estadísticas y conjunto) sin borrar la original', () => {
  const u = user({ 25: { n: 1, s: 0 } }, { items: { 'mint-timid': 1, 'mint-serious': 1 } });
  const m = u.mons[25][0];
  m.nature = 'Firme';
  const before = specimen.computeStats(25, m);
  const r = bp.useOn(u, { itemId: 'mint-timid', ...ref(u, 25) });
  assert.strictEqual(r.mint, 'Miedosa');
  assert.strictEqual(m.nature, 'Firme');
  const after = specimen.computeStats(25, m);
  assert.ok(after[5] > before[5] && after[1] < before[1], 'Miedosa: + Velocidad, − Ataque');
  assert.strictEqual(sd.toSet(25, m, {}).set.nature, 'Timid');
  assert.throws(() => bp.useOn(u, { itemId: 'mint-timid', ...ref(u, 25) }), /No tienes/);
  u.items['mint-timid'] = 1;
  assert.throws(() => bp.useOn(u, { itemId: 'mint-timid', ...ref(u, 25) }), /ya tiene/);
  assert.strictEqual(u.items['mint-timid'], 1, 'no se gasta');
  assert.strictEqual(specimen.boxView(u).mons[0].mint, 'Miedosa');
});

test('Cápsula y Parche de Habilidad', () => {
  const u = user({ 1: { n: 1, s: 0 }, 25: { n: 1, s: 0 }, 6: { n: 1, s: 0 } }, { items: { 'ability-capsule': 3, 'ability-patch': 3 } });
  // Pikachu: 1 sola habilidad normal (Elec. Estática) y oculta Pararrayos.
  assert.throws(() => bp.useOn(u, { itemId: 'ability-capsule', ...ref(u, 25) }), /una habilidad normal/);
  assert.strictEqual(u.items['ability-capsule'], 3, 'no se gasta si no procede');
  const { normal, hidden } = abilities.optionsOf(25);
  assert.strictEqual(abilities.resolve(25, u.mons[25][0]), normal[0]);
  const r = bp.useOn(u, { itemId: 'ability-patch', ...ref(u, 25) });
  assert.strictEqual(r.ability, hidden);
  assert.strictEqual(sd.toSet(25, u.mons[25][0], {}).set.ability, hidden);
  assert.throws(() => bp.useOn(u, { itemId: 'ability-patch', ...ref(u, 25) }), /Ya tiene/);
  assert.throws(() => bp.useOn(u, { itemId: 'ability-capsule', ...ref(u, 25) }), /oculta|normal/);
  // Una especie con dos normales: Cápsula alterna.
  const id = require('../server/pokedex').DEX.find((p) => abilities.optionsOf(p.id).normal.length === 2 && p.rarity === 'C').id;
  const w = user({ [id]: { n: 1, s: 0 } }, { items: { 'ability-capsule': 2 } });
  const m = w.mons[id][0];
  const a0 = abilities.resolve(id, m);
  const x = bp.useOn(u.items ? w : w, { itemId: 'ability-capsule', ...ref(w, id) });
  assert.notStrictEqual(x.ability, a0);
  assert.strictEqual(sd.toSet(id, m, {}).set.ability, x.ability);
  bp.useOn(w, { itemId: 'ability-capsule', ...ref(w, id) });
  assert.strictEqual(m.sdAbility, a0);
  // Ya no se elige gratis en el constructor de equipos.
  assert.throws(() => sd.validateSd(id, m, { ability: 'wonderguard' }), /Cápsula/);
});

test('habilidad oculta heredada: 60 % si la madre la tiene y la especie del bebé tiene una', () => {
  const mother = { ha: true, gender: 'F' };
  let hit = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) if (daycare.inheritsHa(mother, 25, Math.random())) hit++;
  assert.ok(Math.abs(hit / N - 0.6) < 0.04, 'proporción ' + hit / N);
  assert.ok(!daycare.inheritsHa({ ha: false }, 25, 0));
  assert.ok(!daycare.inheritsHa(mother, 25, 0.61));
  assert.ok(daycare.inheritsHa(mother, 25, 0.59));
  const a = { ha: true, gender: 'M' }, b = { ha: false, gender: 'F' };
  assert.strictEqual(daycare.motherOf(a, b, 25, 25), b);
  assert.strictEqual(daycare.motherOf(a, b, 25, daycare.DITTO), a, 'con Ditto, el otro es la madre');
});

test('los PB, los objetos de combate y las MT no los compran los PNJ', () => {
  for (const [id, it] of Object.entries(items.ITEMS)) {
    if (!it.bp) continue;
    const a = { kind: 'item', itemId: id };
    const b = npc.bounds(a);
    assert.ok(b && b.cap < b.floor, id);
    for (const p of npc.NPCS) assert.ok(!npc.inFocus(p, a), id);
  }
});

test('la CPU lleva objetos sin repetir y el combate con objetos y habilidades termina', async () => {
  const u = user({ 25: { n: 1, s: 0 }, 6: { n: 1, s: 0 }, 9: { n: 1, s: 0 } }, { items: { 'hi-leftovers': 1, 'hi-lifeorb': 1, 'ability-patch': 1 } });
  bp.hold(u, { ...ref(u, 25), item: 'leftovers' });
  bp.hold(u, { ...ref(u, 6), item: 'lifeorb' });
  bp.useOn(u, { itemId: 'ability-patch', ...ref(u, 25) });
  const mine = sdw.resolveTeam(u, [ref(u, 25), ref(u, 6), ref(u, 9)], { format: 'singles', level: 'fair' });
  const gym = trainers.TRAINERS.find((t) => t.tier === 5);
  const foe = trainers.buildTeam(gym, 3, { level: 'fair', avgLevel: 20 });
  const items2 = foe.sets.map((s) => s.item).filter(Boolean);
  assert.strictEqual(new Set(items2).size, items2.length);
  const r = await sdw.runAiBattle({ teamA: mine, teamB: foe, level: 'fair' });
  assert.ok(r.turns > 0 && !r.aborted);
});
