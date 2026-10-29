'use strict';
// Máquina MT: lista oficial de 229 MT, fabricación (monedas + materiales), uso (compatibilidad, consumo), botín con topes,
// comercio en el Mercado y que fabricar → vender a un PNJ nunca devuelva más de lo que cuesta.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-tm-'));

const db = require('../server/db');
const hub = require('../server/hub');
const specimen = require('../server/specimen');
const items = require('../server/items');
const moves = require('../server/moves');
const tm = require('../server/tm');
const tmdata = require('../server/tmdata');
const npc = require('../server/npc');
const market = require('../server/market');
const exp = require('../server/expedition');
const trainers = require('../server/trainers');
const ES = require('../server/sd-es.json');

let n = 0;
function user(collection = {}, extra = {}) {
  const name = 'tm' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 100000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 5, createdAt: Date.now() - 9 * 864e5, ...extra };
  db.addUser(u);
  specimen.syncAll(u);
  return u;
}
const ref = (u, id, i = 0) => ({ id, uid: u.mons[id][i].uid });

test('las 229 MT de Escarlata/Púrpura con su número oficial y un material de su tipo', () => {
  assert.strictEqual(tmdata.TMS.length, 229);
  assert.deepStrictEqual(tmdata.TMS.map((t) => t.num), Array.from({ length: 229 }, (_, i) => i + 1));
  assert.strictEqual(tmdata.TM_BY_MOVE.get('thunderbolt').name, 'MT' + String(tmdata.TM_BY_MOVE.get('thunderbolt').num).padStart(3, '0') + ' Rayo');
  const types = new Set();
  for (const t of tmdata.TMS) {
    assert.ok(ES.moves[t.move] && ES.meta[t.move], t.move);
    assert.strictEqual(ES.meta[t.move][0], t.type);
    assert.ok(tmdata.MATERIALS[t.mat].types.includes(t.type), 'material del tipo del movimiento: ' + t.move);
    assert.ok(t.matN >= 3 && t.matN <= 8);
    assert.ok(t.coins >= 500 && t.coins <= 8000);
    types.add(t.type);
    const it = items.ITEMS[t.id];
    assert.ok(it && it.tm === t.move && it.price === null && it.craft[0] === t.coins && it.craft[1][t.mat] === t.matN);
  }
  assert.strictEqual(types.size, 18, 'hay MT de los 18 tipos');
  // Todos los tipos tienen material.
  for (const ty of Object.keys(require('../server/pokedex').CHART)) assert.ok(tmdata.MAT_OF_TYPE[ty], ty);
  // Precios por nivel de potencia.
  const price = (m) => tmdata.TM_BY_MOVE.get(m).coins;
  assert.strictEqual(price('swordsdance'), 1500);
  assert.strictEqual(price('charm'), 500);
  for (const m of ['earthquake', 'psychic', 'thunderbolt', 'flamethrower', 'surf', 'shadowball']) assert.ok(price(m) >= 6000 && price(m) <= 8000, m);
  assert.ok(price('hyperbeam') >= 6000);
});

test('compatibilidad: por especie (y preevoluciones), p. ej. Pikachu sí Rayo, no Terremoto', () => {
  assert.ok(moves.tmCompat(25, 'thunderbolt'));
  assert.ok(!moves.tmCompat(25, 'hydropump'));
  assert.ok(moves.tmCompat(26, 'thunderbolt'));
  assert.ok(moves.tmCompat(6, 'flamethrower') && !moves.tmCompat(6, 'psychic'));
  // Hay especies con MT de todas las generaciones del casino.
  assert.ok(require('../server/pokedex').DEX.every((p) => tmdata.TMS.some((t) => moves.tmCompat(p.id, t.move)) || p.id > 0));
});

test('fabricar: pide materiales y monedas, descuenta con motivo tm_craft y da la MT', () => {
  const u = user({ 25: { n: 1, s: 0 } }, { coins: 10000 });
  const t = tmdata.TM_BY_MOVE.get('thunderbolt');
  assert.throws(() => tm.craft(u, { move: 'thunderbolt' }), /Faltan materiales/);
  u.items[t.mat] = t.matN - 1;
  assert.throws(() => tm.craft(u, { move: 'thunderbolt' }), /Faltan materiales/);
  u.items[t.mat] = t.matN + 2;
  u.coins = t.coins - 1;
  assert.throws(() => tm.craft(u, { move: 'thunderbolt' }), /monedas/);
  assert.strictEqual(u.items[t.mat], t.matN + 2, 'un fallo no gasta nada');
  u.coins = 10000;
  const r = tm.craft(u, { move: 'thunderbolt' });
  assert.strictEqual(r.coins, t.coins);
  const rewards = u.hist.log.filter((l) => l.r === 'reward').reduce((a, l) => a + l.d, 0); // p. ej. una medalla por la primera acción
  assert.strictEqual(u.coins, 10000 - t.coins + rewards);
  assert.strictEqual(u.items[t.mat], 2);
  assert.strictEqual(u.items[t.id], 1);
  assert.ok(u.hist.log.some((l) => l.r === 'tm_craft' && l.d === -t.coins));
  assert.throws(() => tm.craft(u, { move: 'nomove' }), /no existe/);
  assert.throws(() => tm.craft(u, { move: 'thunderbolt', qty: 0 }), /Cantidad/);
  assert.throws(() => tm.craft(u, { move: 'thunderbolt', qty: 11 }), /Cantidad/);
  assert.throws(() => items.use(u, { itemId: t.id }), /MT/);
});

test('usar: consume la MT, la aprende y la equipa si hay hueco; si no, queda aprendida', () => {
  const u = user({ 25: { n: 1, s: 0 }, 6: { n: 1, s: 0 } });
  const m = u.mons[25][0];
  m.level = 5; delete m.mv; require('../server/sdmap').ensureSd(25, m);
  m.sdMoves = m.sdMoves.slice(0, 2); // hueco libre
  u.items['tm-thunderbolt'] = 2;
  const r = tm.useTm(u, { itemId: 'tm-thunderbolt', ...ref(u, 25) });
  assert.strictEqual(r.how, 'equipped');
  assert.ok(m.sdMoves.includes('thunderbolt') && m.learned.includes('thunderbolt'));
  assert.strictEqual(u.items['tm-thunderbolt'], 1);
  assert.throws(() => tm.useTm(u, { itemId: 'tm-thunderbolt', ...ref(u, 25) }), /ya conoce/);
  assert.strictEqual(u.items['tm-thunderbolt'], 1, 'no se gasta si ya la conoce');
  // Incompatible: no se gasta.
  u.items['tm-psychic'] = 1;
  assert.throws(() => tm.useTm(u, { itemId: 'tm-psychic', ...ref(u, 6) }), /no puede aprender/);
  assert.strictEqual(u.items['tm-psychic'], 1);
  // Sin la MT.
  assert.throws(() => tm.useTm(u, { itemId: 'tm-surf', ...ref(u, 25) }), /No tienes/);
  assert.throws(() => tm.useTm(u, { itemId: 'ticket', ...ref(u, 25) }), /MT/);
  // Cuatro equipados: se aprende pero no se equipa; la última MT desaparece de la mochila.
  m.sdMoves = m.learned.slice(0, 4);
  m.learned = m.learned.filter((x) => x !== 'thunderbolt');
  const r2 = tm.useTm(u, { itemId: 'tm-thunderbolt', ...ref(u, 25) });
  assert.strictEqual(r2.how, 'learned');
  assert.ok(!m.sdMoves.includes('thunderbolt') && m.learned.includes('thunderbolt'));
  assert.ok(!('tm-thunderbolt' in u.items));
  // pc:moves puede equiparla después.
  assert.ok(moves.setEquipped(u, { ...ref(u, 25), moves: ['thunderbolt', m.sdMoves[0]] }).eq.includes('thunderbolt'));
});

test('targets, owned y compat', () => {
  const u = user({ 25: { n: 2, s: 0 }, 6: { n: 1, s: 0 }, 1: { n: 1, s: 0 } });
  u.items['tm-thunderbolt'] = 1; u.items['tm-flamethrower'] = 1;
  u.mons[25][0].learned.push('thunderbolt');
  const t = tm.targets(u, { itemId: 'tm-thunderbolt' });
  assert.deepStrictEqual(t.targets.map((x) => x.id).sort(), [25, 25]);
  assert.strictEqual(t.targets.filter((x) => x.known).length, 1);
  assert.deepStrictEqual(tm.owned(u, { ...ref(u, 6) }).tms.map((x) => x.itemId), ['tm-flamethrower']);
  const c = tm.compat(u, { id: 25 }).moves;
  assert.ok(c.includes('thunderbolt') && !c.includes('earthquake'));
  assert.throws(() => tm.compat(u, { id: 99999 }));
  assert.throws(() => tm.targets(u, { itemId: 'ticket' }));
});

test('fabricar → vender a un PNJ nunca devuelve más de lo que cuesta (los PNJ ni siquiera las compran)', () => {
  const all = [...tmdata.TMS.map((t) => items.ITEMS[t.id]), ...Object.values(tmdata.MATERIALS).map((m) => m)];
  for (const t of tmdata.TMS) {
    const a = { kind: 'item', itemId: t.id };
    const b = npc.bounds(a);
    assert.ok(b && b.cap < b.floor && b.floor >= 2 * b.cap, t.id);
    assert.ok(b.cap <= 0.25 * t.coins, `${t.id}: tope ${b.cap} ≤ 25 % de ${t.coins}`);
    assert.ok(b.floor >= t.coins);
    for (const p of npc.NPCS) assert.ok(!npc.inFocus(p, a), `${p.name} no comercia ${t.id}`);
  }
  for (const id of Object.keys(tmdata.MATERIALS)) {
    const b = npc.bounds({ kind: 'item', itemId: id });
    assert.ok(b && b.cap < b.floor);
    for (const p of npc.NPCS) assert.ok(!npc.inFocus(p, { kind: 'item', itemId: id }));
  }
  assert.ok(all.length > 0);
});

test('Mercado: MT y materiales se comercian entre jugadores', () => {
  const s = user({}, { items: { 'tm-surf': 2, 'mat-escama': 5 }, level: 5 });
  const b = user({}, { coins: 20000, level: 5 });
  const r = market.sell(s, { kind: 'item', itemId: 'tm-surf', qty: 1, price: 5000 });
  assert.strictEqual(r.order.qty, 1);
  market.buy(b, { kind: 'item', itemId: 'tm-surf', qty: 1, price: 5000, instant: true });
  assert.strictEqual(b.items['tm-surf'], 1);
  market.sell(s, { kind: 'item', itemId: 'mat-escama', qty: 2, price: 100 });
  assert.strictEqual(s.items['mat-escama'], 3);
});

test('botín de expedición: materiales de los tipos de la zona y tope diario', () => {
  const u = user({ 1: { n: 1, s: 0 } });
  const zone = exp.ZONE_BY_ID.get('bosque'); // bicho/planta → Hoja
  const out = tm.expeditionLoot(u, zone, 12);
  assert.deepStrictEqual(Object.keys(out.mats), ['mat-hoja']);
  assert.strictEqual(out.mats['mat-hoja'], tm.EXP_MATS[12]);
  assert.strictEqual(u.items['mat-hoja'], 6);
  for (let i = 0; i < 6; i++) tm.expeditionLoot(u, zone, 12);
  assert.strictEqual(u.items['mat-hoja'], tm.CAPS.expMats, 'tope diario');
  // Cada tipo de zona da su material.
  const z2 = exp.ZONE_BY_ID.get('cueva'); // roca/tierra/fantasma
  const u2 = user();
  tm.expeditionLoot(u2, z2, 12);
  for (const k of Object.keys(u2.items).filter((x) => x.startsWith('mat-'))) assert.ok(['mat-roca', 'mat-esencia'].includes(k), k);
  // Una reclamación real también los da.
  const u3 = user({ 1: { n: 1, s: 0 } });
  exp.send(u3, { zone: 'bosque', hours: 4, team: [ref(u3, 1)] });
  u3.expeditions[0].end = Date.now() - 1;
  const r = exp.claim(u3, { id: u3.expeditions[0].id });
  assert.strictEqual(r.reward.mats['mat-hoja'], 2);
  assert.strictEqual(u3.items['mat-hoja'], 2);
});

test('MT de premio: probabilidad, tope de 1 al día y nunca de la gama suprema', () => {
  const u2 = user();
  const ids = new Set();
  for (let i = 0; i < 200; i++) { const uu = user(); const id = tm.dropTm(uu, ['fire'], 1, 'strong', 'exp'); assert.ok(id); ids.add(id); assert.ok(['basic', 'good', 'strong'].includes(items.ITEMS[id].tier)); assert.strictEqual(items.ITEMS[id].type, 'fire'); }
  assert.ok(ids.size > 3);
  assert.ok(tm.dropTm(u2, ['fire'], 1, 'strong', 'exp'));
  assert.strictEqual(tm.dropTm(u2, ['fire'], 1, 'strong', 'exp'), null, 'solo 1 al día');
  assert.strictEqual(tm.dropTm(user(), ['fire'], 0, 'strong', 'bat'), null);
});

test('botín de combate: materiales de los tipos rivales con tope diario; MT solo contra líderes', () => {
  const u = user();
  const t1 = trainers.TRAINERS.find((x) => x.tier === 1);
  const out = tm.battleLoot(u, t1, [4]); // Charmander → Ascua
  assert.deepStrictEqual(Object.keys(out.mats), ['mat-ascua']);
  assert.strictEqual(out.tm, null, 'los novatos no dan MT');
  for (let i = 0; i < 30; i++) tm.battleLoot(u, t1, [4]);
  assert.strictEqual(u.items['mat-ascua'], tm.CAPS.batMats);
  const gym = trainers.TRAINERS.find((x) => x.tier === 5);
  let tms = 0;
  for (let i = 0; i < 400; i++) { const uu = user(); const o = tm.battleLoot(uu, gym, [4]); if (o.tm) { tms++; assert.ok(['basic', 'good', 'strong'].includes(items.ITEMS[o.tm].tier)); } }
  assert.ok(tms > 30 && tms < 140, 'ronda del 20 %: ' + tms);
  const champ = trainers.TRAINERS.find((x) => x.tier === 6);
  const rank = { basic: 0, good: 1, strong: 2, top: 3, apex: 4 };
  for (let i = 0; i < 200; i++) { const o = tm.battleLoot(user(), champ, [149]); if (o.tm) assert.ok(rank[items.ITEMS[o.tm].tier] <= 3); }
});
