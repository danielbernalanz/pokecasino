'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-candy-'));

const db = require('../server/db');
const gacha = require('../server/gacha');
const sp = require('../server/specimen');
const candy = require('../server/candy');
const items = require('../server/items');
const exp = require('../server/exp');
const battle = require('../server/games/battle');
const { DEX, BY_ID, RARITY } = require('../server/pokedex');

let n = 0;
function user(extra = {}) {
  const name = 'cdy' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 100000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection: {}, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, ...extra };
  db.addUser(u);
  return u;
}
const byName = (name) => DEX.find((p) => p.name === name);
const fam = (id) => BY_ID.get(id).chain;

test('transferir da el mismo polvo que liberar más Caramelos Exp. (sin caramelos de familia)', () => {
  const pid = DEX.find((p) => p.rarity === 'R' && p.stage === 1).id;
  const a = user({ collection: { [pid]: { n: 3, s: 0 } } });
  const b = user({ collection: { [pid]: { n: 3, s: 0 } } });
  sp.syncAll(a); sp.syncAll(b);
  const rel = sp.release(a, { id: pid, uid: a.mons[pid][0].uid });
  const tr = candy.transfer(b, { id: pid, uid: b.mons[pid][0].uid });
  assert.strictEqual(tr.dust, rel.dust);
  assert.strictEqual(b.dust, a.dust);
  assert.deepStrictEqual(tr.given, { 'exp-s': 1 });
  assert.strictEqual(tr.exp, 800);
  assert.strictEqual(b.items['exp-s'], 1);
  assert.ok(!b.candy, 'ya no hay caramelos de familia');
  assert.strictEqual(b.collection[pid].n, 2);
  assert.throws(() => candy.transfer(user({ collection: { [pid]: { n: 1, s: 0 } } }), { id: pid, uid: 'zzzz' }));
  const solo = user({ collection: { [pid]: { n: 1, s: 0 } } });
  sp.syncAll(solo);
  assert.throws(() => candy.transfer(solo, { id: pid, uid: solo.mons[pid][0].uid }), /conservar/);
  assert.ok(!solo.items['exp-s']);
});

test('Caramelos Exp. por transferir: XS para C/U, S para R/E, M para L/M', () => {
  assert.deepStrictEqual(candy.TRANSFER_EXP, { C: ['exp-xs', 1], U: ['exp-xs', 2], R: ['exp-s', 1], E: ['exp-s', 2], L: ['exp-m', 1], M: ['exp-m', 2] });
  assert.deepStrictEqual(Object.fromEntries(Object.keys(candy.TRANSFER_EXP).map((r) => [r, candy.transferExp(r)])), { C: 100, U: 200, R: 800, E: 1600, L: 3000, M: 6000 });
});

test('transferir repetidos conserva favorito, compañero, variocolor y el mejor', () => {
  const pid = 25;
  const u = user({ collection: { [pid]: { n: 5, s: 1 } } });
  sp.syncAll(u);
  const arr = u.mons[pid];
  const shiny = arr.find((m) => m.shiny);
  const others = arr.filter((m) => !m.shiny);
  others[0].fav = true;
  u.buddy = { id: pid, shiny: false, uid: others[1].uid };
  others[2].ivs = Array(6).fill(31); // el mejor de los que quedan
  others[3].ivs = Array(6).fill(0);
  const plan = candy.bulkPlan(u, pid);
  assert.strictEqual(plan.length, 2);
  const before = u.dust;
  const r = candy.transferBulk(u, { id: pid });
  assert.strictEqual(r.count, 2);
  assert.strictEqual(u.dust - before, RARITY[BY_ID.get(pid).rarity].dust * 2);
  assert.strictEqual(u.collection[pid].n, 3);
  const left = sp.sync(u, pid).map((m) => m.uid);
  assert.ok(left.includes(shiny.uid) && left.includes(others[0].uid) && left.includes(others[1].uid));
  const [it, per] = candy.TRANSFER_EXP[BY_ID.get(pid).rarity];
  assert.strictEqual(u.items[it], per * 2);
  assert.strictEqual(r.exp, per * 2 * exp.CANDY_EXP[it]);
  assert.throws(() => candy.transferBulk(u, { id: pid }), /No hay repetidos/);

  // Sin protegidos: se queda el mejor.
  const v = user({ collection: { [pid]: { n: 4, s: 0 } } });
  sp.syncAll(v);
  v.mons[pid][2].ivs = Array(6).fill(31);
  const best = v.mons[pid][2].uid;
  const rr = candy.transferBulk(v, { id: pid });
  assert.strictEqual(rr.count, 3);
  assert.deepStrictEqual(sp.sync(v, pid).map((m) => m.uid), [best]);
});

test('el gacha da 1 Caramelo Exp. XS por tirada (S si la especie es nueva)', () => {
  const u = user();
  assert.strictEqual(candy.onPull(u, 25, true), 'exp-s');
  assert.strictEqual(candy.onPull(u, 25, false), 'exp-xs');
  assert.deepStrictEqual(u.items, { 'exp-s': 1, 'exp-xs': 1 });
  const r = gacha.pull(u, { banner: 'kanto', count: 10, free: false });
  assert.ok(r.results.every((x) => x.expItem === 'exp-xs' || x.expItem === 'exp-s'));
  assert.strictEqual(r.results.filter((x) => x.expItem === 'exp-s').length + 1, u.items['exp-s']);
  assert.ok(!u.candy);
});

test('evolucionar no cuesta caramelos: requisitos de nivel, datos del ejemplar, variocolor y compañero', () => {
  const charm = byName('Charmander').id;
  const charme = byName('Charmeleon').id;
  const u = user({ collection: { [charm]: { n: 2, s: 1 } } });
  sp.syncAll(u);
  const shinyMon = u.mons[charm].find((m) => m.shiny);
  const plain = u.mons[charm].find((m) => !m.shiny);
  shinyMon.level = 20; shinyMon.nick = 'Brasas'; shinyMon.friendship = 120; shinyMon.fav = true; shinyMon.ivs = [1, 2, 3, 4, 5, 6]; shinyMon.nature = 'Audaz';
  u.buddy = { id: charm, shiny: true, uid: shinyMon.uid };
  assert.throws(() => candy.evolve(u, { id: charm, uid: shinyMon.uid, to: 1 }), /no puede/);
  assert.strictEqual(candy.evoLevel(charme), 16);
  assert.throws(() => candy.evolve(u, { id: charm, uid: plain.uid, to: charme }), /nivel 16/, 'un Nv. 5 no evoluciona');
  const coinsBefore = u.coins; const dustBefore = u.dust;
  const r = candy.evolve(u, { id: charm, uid: shinyMon.uid, to: charme });
  assert.strictEqual(r.cost, undefined, 'sin coste');
  assert.strictEqual(u.collection[charm].n, 2, 'la primera evolución a una especie nueva no gasta la copia de origen');
  assert.strictEqual(u.collection[charm].s, 0);
  assert.strictEqual(u.collection[charme].n, 1);
  assert.strictEqual(u.collection[charme].s, 1);
  const moved = u.mons[charme][0];
  assert.strictEqual(moved.uid, shinyMon.uid);
  assert.ok(moved.shiny && moved.fav && moved.level === 20 && moved.nick === 'Brasas' && moved.friendship === 120 && moved.nature === 'Audaz');
  assert.deepStrictEqual(moved.ivs, [1, 2, 3, 4, 5, 6]);
  assert.ok(moved.exp >= exp.expAt(charme, 20) && moved.exp < exp.expAt(charme, 21), 'la EXP se recoloca dentro de su nivel');
  assert.deepStrictEqual(u.buddy, { id: charme, shiny: true, uid: shinyMon.uid });
  assert.strictEqual(u.mons[charm].length, 2);
  assert.ok(u.mons[charm].some((m) => m.uid === plain.uid) && !u.mons[charm].some((m) => m.uid === shinyMon.uid));
  assert.ok(u.evoReg[charme], 'queda registrada: vender la copia no permite repetir el truco');
  assert.strictEqual(u.coins, coinsBefore);
  assert.strictEqual(u.dust, dustBefore);
  plain.level = 20;
  // Ya tienes el destino: evolucionar gasta una copia y la última no se puede gastar.
  u.collection[charm].n = 1; sp.syncAll(u);
  assert.throws(() => candy.evolve(u, { id: charm, uid: plain.uid, to: charme }), /otra copia/);
});

test('evolucionar: ya tienes 5 del destino y nivel', () => {
  const a = byName('Charmeleon').id; const b = byName('Charizard').id;
  const u = user({ collection: { [a]: { n: 2, s: 0 }, [b]: { n: 5, s: 0 } } });
  sp.syncAll(u);
  u.mons[a][0].level = 40;
  assert.throws(() => candy.evolve(u, { id: a, uid: u.mons[a][0].uid, to: b }), /5 estrellas/);
  u.collection[b].n = 1; sp.syncAll(u);
  u.mons[a][0].level = 35;
  assert.throws(() => candy.evolve(u, { id: a, uid: u.mons[a][0].uid, to: b }), /nivel 36/);
  u.mons[a][0].level = 36;
  candy.evolve(u, { id: a, uid: u.mons[a][0].uid, to: b });
  assert.strictEqual(u.collection[b].n, 2);
  assert.strictEqual(u.mons[b].length, 2);
});

test('al subir de nivel se ofrece evolucionar («¿Quieres que evolucione?»): cancelar no cambia nada y se puede después', () => {
  const a = byName('Charmander').id; const b = byName('Charmeleon').id;
  const u = user({ collection: { [a]: { n: 2, s: 0 } }, items: { 'exp-s': 1, 'exp-m': 3 } });
  sp.syncAll(u);
  const m = u.mons[a][0];
  const r1 = exp.useCandy(u, { id: a, uid: m.uid, itemId: 'exp-s', qty: 1 });
  assert.ok(r1.to < 16 && r1.evo.length === 0);
  const r2 = exp.useCandy(u, { id: a, uid: m.uid, itemId: 'exp-m', qty: 1 });
  assert.ok(m.level >= 16);
  assert.deepStrictEqual(r2.evo, [{ to: b, name: 'Charmeleon' }]);
  assert.strictEqual(sp.boxView(u).mons.find((x) => x.uid === m.uid).canEvo[0], b, 'la Caja PC lo sigue ofreciendo');
  assert.strictEqual(u.collection[a].n, 2, 'cancelar = no pasa nada');
  const ev = candy.evolve(u, { id: a, uid: m.uid, to: b });
  assert.strictEqual(ev.to, b);
  assert.ok(m.level >= 16 && u.mons[b][0].uid === m.uid);
});

test('las evoluciones ocurren en su nivel REAL de los juegos (sin suelos inventados)', () => {
  const real = require('../server/evoreq');
  for (const p of DEX) if (p.evolvesFrom) assert.strictEqual(candy.evoLevel(p.id), real.levelOf(p.id), p.name);
  assert.strictEqual(candy.evoLevel(byName('Gyarados').id), 20);
  assert.strictEqual(candy.evoLevel(byName('Charmeleon').id), 16);
  assert.strictEqual(candy.evoLevel(byName('Pikachu').id), 0, 'amistad, sin nivel');
});

test('los objetos de evolución (piedras, Cordón Unión) cuestan más monedas que el polvo que ganan', () => {
  const evoreq = require('../server/evoreq');
  for (const p of DEX) {
    if (!p.evolvesFrom || evoreq.isLevelUp(p.id)) continue;
    const r = evoreq.reqOf(p.id);
    if (!r) continue;
    const gain = Math.max(0, RARITY[p.rarity].dust - RARITY[BY_ID.get(p.evolvesFrom).rarity].dust) * gacha.DUST_RATE;
    const cost = (r.item ? items.ITEMS[r.item].price : 0) + (r.trade ? 0 : 0);
    if (r.item) assert.ok(cost >= gain, `${p.name}: objeto ${cost} < ${gain} monedas de polvo ganado`);
  }
});

test('Intercambio Milagroso: misma rareza, restricciones y límite diario', () => {
  const pid = DEX.find((p) => p.rarity === 'U' && p.stage === 1).id;
  const u = user({ collection: { [pid]: { n: 7, s: 0 } } });
  sp.syncAll(u);
  const coins = u.coins; const dust = u.dust;
  for (let i = 0; i < candy.WONDER_DAILY; i++) {
    const r = candy.wonder(u, { id: pid, uid: u.mons[pid][0].uid });
    assert.strictEqual(r.rarity, 'U');
    assert.strictEqual(BY_ID.get(r.id).rarity, 'U');
    assert.notStrictEqual(r.id, pid);
    assert.ok(u.collection[r.id].n >= 1 && u.mons[r.id].length === u.collection[r.id].n);
  }
  assert.strictEqual(u.collection[pid].n, 7 - candy.WONDER_DAILY);
  assert.throws(() => candy.wonder(u, { id: pid, uid: u.mons[pid][0].uid }), /al día/);
  assert.strictEqual(u.coins, coins);
  assert.strictEqual(u.dust, dust);
  // Restricciones.
  const v = user({ collection: { [pid]: { n: 3, s: 1 }, 150: { n: 2, s: 0 }, 151: { n: 2, s: 0 } } });
  sp.syncAll(v);
  const shiny = v.mons[pid].find((m) => m.shiny); const plain = v.mons[pid].filter((m) => !m.shiny);
  assert.throws(() => candy.wonder(v, { id: pid, uid: shiny.uid }), /variocolor/);
  plain[0].fav = true;
  assert.throws(() => candy.wonder(v, { id: pid, uid: plain[0].uid }), /favorito/);
  v.buddy = { id: pid, shiny: false, uid: plain[1].uid };
  assert.throws(() => candy.wonder(v, { id: pid, uid: plain[1].uid }), /compañero/);
  assert.throws(() => candy.wonder(v, { id: 151, uid: v.mons[151][0].uid }), /míticos/);
  const solo = user({ collection: { [pid]: { n: 1, s: 0 } } });
  sp.syncAll(solo);
  assert.throws(() => candy.wonder(solo, { id: pid, uid: solo.mons[pid][0].uid }), /conservar/);
  // Legendaria: otra legendaria, nunca una destacada de los banners activos.
  const act = gacha.activeBanners();
  const feat = new Set([...act.permanent.featuredL, ...act.promo.featuredL]);
  const lid = DEX.find((p) => p.rarity === 'L' && !feat.has(p.id)).id;
  const w = user({ collection: { [lid]: { n: 2, s: 0 } } });
  sp.syncAll(w);
  const r = candy.wonder(w, { id: lid, uid: w.mons[lid][0].uid });
  assert.strictEqual(BY_ID.get(r.id).rarity, 'L');
  assert.ok(!feat.has(r.id));
});

test('reciclaje: siempre vale menos que el precio de compra y tiene tope diario', () => {
  const list = candy.recycleList();
  assert.ok(list.length >= 4);
  for (const [id, dust] of list) {
    const it = items.ITEMS[id];
    assert.ok(it.price);
    assert.ok(dust * gacha.DUST_RATE < it.price, `${id}: ${dust * gacha.DUST_RATE} monedas ≥ ${it.price}`);
    assert.ok(dust * gacha.DUST_RATE <= it.price * candy.RECYCLE_RATE);
  }
  for (const id of Object.keys(items.ITEMS)) if (!items.ITEMS[id].price) assert.strictEqual(candy.recycleValue(id), 0);
  const u = user({ items: { ticket: 50, 'lucky-egg': 4, 'shiny-charm': 1 } });
  const coins = u.coins;
  const r = candy.recycle(u, { item: 'lucky-egg', qty: 2 });
  assert.strictEqual(r.dust, candy.recycleValue('lucky-egg') * 2);
  assert.strictEqual(u.items['lucky-egg'], 2);
  assert.strictEqual(u.dust, r.dust);
  assert.strictEqual(u.coins, coins);
  assert.throws(() => candy.recycle(u, { item: 'shiny-charm', qty: 1 }), /no se puede/);
  assert.throws(() => candy.recycle(u, { item: 'ticket', qty: 0 }));
  assert.throws(() => candy.recycle(u, { item: 'ticket', qty: 1.5 }));
  assert.throws(() => candy.recycle(u, { item: 'lucky-egg', qty: 3 }), /No tienes/);
  assert.throws(() => candy.recycle(u, { item: 'ticket', qty: 50 }), /Tope diario/);
  assert.strictEqual(u.items.ticket, 50);
});

test('ninguna acción de B2 crea monedas y el polvo de transferir ≤ el de liberar + nada más', () => {
  const pid = DEX.find((p) => p.rarity === 'E' && p.stage === 1).id;
  const u = user({ collection: { [pid]: { n: 5, s: 0 } }, items: { 'lucky-egg': 1, 'exp-m': 3, 'bottle-cap': 1 } });
  sp.syncAll(u);
  u.mons[pid][0].ivs = Array(6).fill(0);
  u.mons[pid][0].level = 50;
  exp.useCandy(u, { id: pid, uid: u.mons[pid][0].uid, itemId: 'exp-m', qty: 3 });
  require('../server/hyper').use(u, { id: pid, uid: u.mons[pid][0].uid, itemId: 'bottle-cap', stat: 0 });
  const coins = u.coins; // (usar un objeto cuenta para la misión «usa un objeto»: eso ya existía)
  candy.wonder(u, { id: pid, uid: u.mons[pid][1].uid });
  candy.transferBulk(u, { id: pid });
  candy.recycle(u, { item: 'lucky-egg', qty: 1 });
  assert.strictEqual(u.coins, coins);
});

test('transferir varios de una vez: suma polvo y caramelos, salta al compañero y conserva una copia', () => {
  const u = user({ collection: { 1: { n: 4, s: 0 }, 4: { n: 2, s: 0 } } });
  const a = sp.sync(u, 1);
  const b = sp.sync(u, 4);
  u.buddy = { id: 1, shiny: false, uid: a[0].uid };
  const dust0 = u.dust;
  // Elige todos los Bulbasaur (incluido el compañero) y los dos Charmander.
  const r = candy.transferMany(u, { list: [...a, ...b].map((m) => ({ id: m === a[0] || a.includes(m) ? 1 : 4, uid: m.uid })) });
  assert.strictEqual(r.count, 3 + 1, 'tres Bulbasaur (no el compañero) y un Charmander (se conserva uno)');
  assert.strictEqual(r.skipped, 2);
  assert.strictEqual(u.collection[1].n, 1);
  assert.strictEqual(u.collection[4].n, 1);
  assert.strictEqual(u.dust - dust0, r.dust);
  assert.ok(r.exp > 0 && Object.keys(r.given).length);
});

test('transferir todos los repetidos: la vista previa coincide con lo que se hace', () => {
  const u = user({ collection: { 1: { n: 3, s: 0 }, 7: { n: 2, s: 0 }, 25: { n: 1, s: 0 } } });
  const pre = candy.transferAllDupes(u, { preview: true });
  assert.deepStrictEqual([pre.species, pre.count], [2, 3]);
  const dust0 = u.dust;
  const r = candy.transferAllDupes(u);
  assert.strictEqual(r.count, pre.count);
  assert.strictEqual(u.dust - dust0, pre.dust);
  assert.strictEqual(r.dust, pre.dust);
  assert.deepStrictEqual([u.collection[1].n, u.collection[7].n, u.collection[25].n], [1, 1, 1]);
  assert.throws(() => candy.transferAllDupes(u), /No tienes repetidos/);
});

// ---- Auditoría: claves de prototipo y objetos equipados ----
test('reciclar: las claves de prototipo no son objetos ni bayas', () => {
  const u = user({ collection: { 25: { n: 1, s: 0 } } });
  for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.throws(() => candy.recycle(u, { item: k, qty: 20 }), /no se puede reciclar/, k);
    assert.throws(() => items.take(u, k, 1), /desconocido/, k);
    assert.throws(() => items.buy(u, { itemId: k, qty: 1 }), /no está a la venta/, k);
    assert.throws(() => items.use(u, { itemId: k }), /desconocido/, k);
  }
  assert.strictEqual(u.dust, 0);
  assert.deepStrictEqual(u.items, {});
});

test('transferir, liberar o el objeto equipado vuelve a la mochila', () => {
  const u = user({ collection: { 25: { n: 2, s: 0 } }, items: { 'hi-leftovers': 1 } });
  sp.syncAll(u);
  const m = u.mons[25][0];
  require('../server/bp').hold(u, { id: 25, uid: m.uid, item: 'leftovers' });
  assert.strictEqual(u.items['hi-leftovers'], undefined);
  candy.transfer(u, { id: 25, uid: m.uid });
  assert.strictEqual(u.items['hi-leftovers'], 1, 'transferir un ejemplar con objeto lo devuelve');
  // Liberar un ejemplar concreto.
  const w = user({ collection: { 25: { n: 2, s: 0 } }, items: { 'hi-leftovers': 1 } });
  sp.syncAll(w);
  require('../server/bp').hold(w, { id: 25, uid: w.mons[25][0].uid, item: 'leftovers' });
  sp.release(w, { id: 25, uid: w.mons[25][0].uid });
  sp.syncAll(w);
  assert.strictEqual(w.items['hi-leftovers'], 1, 'liberar también lo devuelve');
});
