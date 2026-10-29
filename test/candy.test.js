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

test('transferir da el mismo polvo que liberar más caramelos de la familia', () => {
  const pid = DEX.find((p) => p.rarity === 'R' && p.stage === 1).id;
  const a = user({ collection: { [pid]: { n: 3, s: 0 } } });
  const b = user({ collection: { [pid]: { n: 3, s: 0 } } });
  sp.syncAll(a); sp.syncAll(b);
  const rel = sp.release(a, { id: pid, uid: a.mons[pid][0].uid });
  const tr = candy.transfer(b, { id: pid, uid: b.mons[pid][0].uid });
  assert.strictEqual(tr.dust, rel.dust);
  assert.strictEqual(b.dust, a.dust);
  assert.strictEqual(tr.candy, 6 + candy.WILD_TRANSFER.R, 'familia + comodín');
  assert.strictEqual(b.candy[fam(pid)], 6);
  assert.strictEqual(b.candy[candy.WILD], candy.WILD_TRANSFER.R);
  assert.strictEqual(b.collection[pid].n, 2);
  assert.throws(() => candy.transfer(user({ collection: { [pid]: { n: 1, s: 0 } } }), { id: pid, uid: 'zzzz' }));
  const solo = user({ collection: { [pid]: { n: 1, s: 0 } } });
  sp.syncAll(solo);
  assert.throws(() => candy.transfer(solo, { id: pid, uid: solo.mons[pid][0].uid }), /conservar/);
  assert.ok(!solo.candy);
});

test('rendimiento de caramelos por rareza', () => {
  assert.deepStrictEqual(candy.TRANSFER_CANDY, { C: 3, U: 4, R: 6, E: 10, L: 20, M: 25 });
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
  assert.strictEqual(plan.length, 2); // dos candidatos (mejor y peor), se conservan fav, compañero y shiny -> keepers>0 -> ambos se transfieren
  const before = u.dust;
  const r = candy.transferBulk(u, { id: pid });
  assert.strictEqual(r.count, 2);
  assert.strictEqual(u.dust - before, RARITY[BY_ID.get(pid).rarity].dust * 2);
  assert.strictEqual(u.collection[pid].n, 3);
  const left = sp.sync(u, pid).map((m) => m.uid);
  assert.ok(left.includes(shiny.uid) && left.includes(others[0].uid) && left.includes(others[1].uid));
  assert.strictEqual(u.candy[fam(pid)], candy.TRANSFER_CANDY[BY_ID.get(pid).rarity] * 2);
  assert.strictEqual(u.candy[candy.WILD], candy.WILD_TRANSFER[BY_ID.get(pid).rarity] * 2);
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

test('el gacha da caramelos de la familia (2, o 5 si la especie es nueva) más comodín por tirada', () => {
  const u = user();
  const pid = 25;
  assert.strictEqual(candy.onPull(u, pid, true), candy.PULL_NEW_CANDY + candy.WILD_PULL);
  assert.strictEqual(candy.onPull(u, pid, false), candy.PULL_CANDY + candy.WILD_PULL);
  assert.strictEqual(u.candy[fam(pid)], candy.PULL_NEW_CANDY + candy.PULL_CANDY);
  assert.strictEqual(u.candy[candy.WILD], 2 * candy.WILD_PULL);
  assert.strictEqual(candy.candyOf(u, pid), u.candy[fam(pid)] + u.candy[candy.WILD]);
  const r = gacha.pull(u, { banner: 'kanto', count: 10, free: false });
  assert.ok(r.results.every((x) => x.candy === candy.PULL_CANDY + candy.WILD_PULL || x.candy === candy.PULL_NEW_CANDY + candy.WILD_PULL));
  assert.strictEqual(u.candy[candy.WILD], 12 * candy.WILD_PULL);
});

test('los caramelos comodín se gastan después de los de la familia y valen para cualquier familia', () => {
  const pid = 4;
  const u = user({ collection: { [pid]: { n: 1, s: 0 } }, candy: { [fam(pid)]: 3, [candy.WILD]: 10 } });
  sp.syncAll(u);
  assert.strictEqual(candy.levelUp(u, { id: pid, uid: u.mons[pid][0].uid, times: 5 }).cost, 5);
  assert.strictEqual(u.candy[fam(pid)], undefined);
  assert.strictEqual(u.candy[candy.WILD], 8);
  assert.strictEqual(candy.boxExtra(u).candy[fam(1)], 8, 'el cliente ve familia + comodín en cada familia');
});

test('subir de nivel: coste por nivel, tope 100 y validación', () => {
  assert.strictEqual(candy.levelCost(5), 1);
  assert.strictEqual(candy.levelCost(50), 1);
  assert.strictEqual(candy.levelCost(51), 2);
  assert.strictEqual(candy.levelCost(99), 2);
  let to50 = 0; for (let l = 5; l < 50; l++) to50 += candy.levelCost(l);
  assert.strictEqual(to50, 45);
  let to100 = 0; for (let l = 5; l < 100; l++) to100 += candy.levelCost(l);
  assert.ok(to100 >= 140 && to100 <= 200, 'Nv5→100 ≈ 144 caramelos: ' + to100);
  const pid = 4;
  const u = user({ collection: { [pid]: { n: 1, s: 0 } }, candy: { [fam(pid)]: 1000 } });
  sp.syncAll(u);
  const uid = u.mons[pid][0].uid;
  assert.strictEqual(candy.levelUp(u, { id: pid, uid, times: 1 }).cost, 1);
  assert.strictEqual(u.mons[pid][0].level, 6);
  assert.strictEqual(candy.levelUp(u, { id: pid, uid, times: 5 }).level, 11);
  assert.throws(() => candy.levelUp(u, { id: pid, uid, times: 0 }));
  assert.throws(() => candy.levelUp(u, { id: pid, uid, times: 1.5 }));
  assert.throws(() => candy.levelUp(u, { id: pid, uid: 'nope', times: 1 }));
  u.mons[pid][0].level = 98;
  assert.strictEqual(candy.levelUp(u, { id: pid, uid, times: 5 }).level, 100);
  assert.throws(() => candy.levelUp(u, { id: pid, uid, times: 1 }), /máximo/);
  const poor = user({ collection: { [pid]: { n: 1, s: 0 } }, candy: { [fam(pid)]: 2 } });
  sp.syncAll(poor);
  assert.throws(() => candy.levelUp(poor, { id: pid, uid: poor.mons[pid][0].uid, times: 5 }), /Necesitas/);
  assert.strictEqual(poor.candy[fam(pid)], 2);
});

test('el nivel mejora ligeramente los duelos y el nivel 5 no cambia nada', () => {
  const base = { id: 6, shiny: false, stars: 1, owner: 'x', ivs: Array(6).fill(15), nature: 'Seria' };
  const f5 = battle.fighter({ ...base, level: 5 });
  const f100 = battle.fighter({ ...base, level: 100 });
  const fNone = battle.fighter({ ...base });
  assert.strictEqual(f5.hp, fNone.hp);
  assert.ok(Math.abs(f100.atk / f5.atk - 1.095) < 1e-9);
  assert.strictEqual(battle.fighter({ id: 6, shiny: false, stars: 1, owner: 'x' }).hp, battle.fighter({ id: 6, shiny: false, stars: 1, owner: 'x', level: 100 }).hp);
});

test('evolucionar: requisitos, datos del ejemplar, variocolor y compañero', () => {
  const charm = byName('Charmander').id;
  const charme = byName('Charmeleon').id;
  const u = user({ collection: { [charm]: { n: 2, s: 1 } }, candy: { [fam(charm)]: 500 } });
  sp.syncAll(u);
  const shinyMon = u.mons[charm].find((m) => m.shiny);
  const plain = u.mons[charm].find((m) => !m.shiny);
  shinyMon.level = 20; shinyMon.nick = 'Brasas'; shinyMon.friendship = 120; shinyMon.fav = true; shinyMon.ivs = [1, 2, 3, 4, 5, 6]; shinyMon.nature = 'Audaz';
  u.buddy = { id: charm, shiny: true, uid: shinyMon.uid };
  assert.throws(() => candy.evolve(u, { id: charm, uid: shinyMon.uid, to: 1 }), /no puede/);
  const { cost } = candy.evoCost(charm, charme, false, true);
  assert.strictEqual(cost, candy.EVO[2].cost, 'primera evolución: solo el coste base');
  const coinsBefore = u.coins; const dustBefore = u.dust;
  const r = candy.evolve(u, { id: charm, uid: shinyMon.uid, to: charme });
  assert.strictEqual(r.cost, cost);
  assert.strictEqual(u.candy[fam(charm)], 500 - cost);
  assert.strictEqual(u.collection[charm].n, 2, 'la primera evolución a una especie nueva no gasta la copia de origen');
  assert.strictEqual(u.collection[charm].s, 0);
  assert.strictEqual(u.collection[charme].n, 1);
  assert.strictEqual(u.collection[charme].s, 1);
  const moved = u.mons[charme][0];
  assert.strictEqual(moved.uid, shinyMon.uid);
  assert.ok(moved.shiny && moved.fav && moved.level === 20 && moved.nick === 'Brasas' && moved.friendship === 120 && moved.nature === 'Audaz');
  assert.deepStrictEqual(moved.ivs, [1, 2, 3, 4, 5, 6]);
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

test('evolucionar: ya tienes 5 del destino y sin caramelos', () => {
  const a = byName('Charmeleon').id; const b = byName('Charizard').id;
  const u = user({ collection: { [a]: { n: 2, s: 0 }, [b]: { n: 5, s: 0 } }, candy: { [fam(a)]: 1000 } });
  sp.syncAll(u);
  u.mons[a][0].level = 40;
  assert.throws(() => candy.evolve(u, { id: a, uid: u.mons[a][0].uid, to: b }), /5 estrellas/);
  u.collection[b].n = 1; sp.syncAll(u);
  u.candy[fam(a)] = 5;
  assert.throws(() => candy.evolve(u, { id: a, uid: u.mons[a][0].uid, to: b }), /Necesitas/);
  u.candy[fam(a)] = 1000;
  candy.evolve(u, { id: a, uid: u.mons[a][0].uid, to: b });
  assert.strictEqual(u.collection[b].n, 2);
  assert.strictEqual(u.mons[b].length, 2);
  assert.ok(candy.evoCost(a, b).cost >= 100);
});

test('evolucionar nunca da más polvo por caramelo gastado que transferir las copias que los dan', () => {
  // Transferir da ≥ 5/3 ≈ 1,67 de polvo por caramelo (el peor caso son los Comunes).
  const minDustPerCandy = Math.min(...Object.keys(candy.TRANSFER_CANDY).map((r) => RARITY[r].dust / candy.TRANSFER_CANDY[r]));
  assert.ok(minDustPerCandy > candy.EVO_GAIN_PER_CANDY);
  let edges = 0;
  for (const p of DEX) {
    if (!p.evolvesFrom) continue;
    edges++;
    const from = BY_ID.get(p.evolvesFrom);
    const { cost } = candy.evoCost(from.id, p.id);
    const gain = Math.max(0, RARITY[p.rarity].dust - RARITY[from.rarity].dust);
    assert.ok(gain <= cost * candy.EVO_GAIN_PER_CANDY, `${from.name}→${p.name}: +${gain} polvo por ${cost} caramelos`);
    assert.ok(gain <= cost * minDustPerCandy, `${from.name}→${p.name}`);
  }
  assert.ok(edges > 400);
});

test('entrenar IVs: coste, máximo 31 y tope diario por ejemplar', () => {
  const pid = 1;
  const u = user({ collection: { [pid]: { n: 1, s: 0 } }, candy: { [fam(pid)]: 100 } });
  sp.syncAll(u);
  const m = u.mons[pid][0];
  m.ivs = Array(6).fill(0);
  for (let i = 0; i < candy.TRAIN_DAILY; i++) candy.train(u, { id: pid, uid: m.uid, stat: i % 6 });
  assert.deepStrictEqual(m.ivs, Array(6).fill(candy.TRAIN_DAILY / 6));
  assert.strictEqual(u.candy[fam(pid)], 100 - candy.TRAIN_COST * candy.TRAIN_DAILY);
  assert.throws(() => candy.train(u, { id: pid, uid: m.uid, stat: 3 }), /entrenamientos/);
  m.train.day = '2000-01-01';
  assert.strictEqual(candy.train(u, { id: pid, uid: m.uid, stat: 3 }).left, candy.TRAIN_DAILY - 1);
  m.ivs[4] = 31; m.train.n = 0;
  assert.throws(() => candy.train(u, { id: pid, uid: m.uid, stat: 4 }), /máximo/);
  assert.throws(() => candy.train(u, { id: pid, uid: m.uid, stat: 6 }));
  assert.throws(() => candy.train(u, { id: pid, uid: m.uid, stat: 'x' }));
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
  const u = user({ collection: { [pid]: { n: 5, s: 0 } }, candy: { [fam(pid)]: 200 }, items: { 'lucky-egg': 1 } });
  sp.syncAll(u);
  u.mons[pid][0].ivs = Array(6).fill(0);
  const coins = u.coins;
  candy.levelUp(u, { id: pid, uid: u.mons[pid][0].uid, times: 5 });
  candy.train(u, { id: pid, uid: u.mons[pid][0].uid, stat: 0 });
  candy.wonder(u, { id: pid, uid: u.mons[pid][1].uid });
  candy.transferBulk(u, { id: pid });
  candy.recycle(u, { item: 'lucky-egg', qty: 1 });
  assert.strictEqual(u.coins, coins);
});
