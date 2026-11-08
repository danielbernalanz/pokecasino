'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-protect-'));
const db = require('../server/db');
const market = require('../server/market');
const sp = require('../server/specimen');
const candy = require('../server/candy');
const protect = require('../server/protect');
const gts = require('../server/gts');
const ex = require('../server/exp');
{ const ev = require('../server/events'); const has = ev.has; ev.has = (id) => (id === 'market' ? false : has(id)); }

let n = 0;
function user(extra = {}) {
  const name = 'prot' + (++n);
  const u = { id: 'id-' + name, username: name, coins: 100000, dust: 0, buddy: null, items: {}, buffs: {}, games: {}, collection: {}, stats: {}, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 10, createdAt: 1, ...extra };
  db.addUser(u);
  return u;
}
const GARCHOMP = 445;
// Cuenta con `k` Garchomp; el primero (m0) queda como ejemplar de combate si se pide.
function withCopies(k) {
  const u = user({ collection: { [GARCHOMP]: { n: k, s: 0 } } });
  sp.syncAll(u);
  return { u, arr: u.mons[GARCHOMP] };
}
const plain = (m, lv) => { m.level = lv; m.exp = ex.expAt(GARCHOMP, lv); m.friendship = 70 + lv; m.evs = [0, 0, 0, 0, 0, 0]; };

test('protección: razones legibles de cada causa', () => {
  const { u, arr } = withCopies(1);
  const m = arr[0];
  plain(m, 20);
  assert.deepStrictEqual(protect.battleBuilt(u, m, GARCHOMP), { protected: false, reasons: [], teams: [] });
  u.btTeams = [{ name: 'Liga', members: [{ id: GARCHOMP, uid: m.uid, mega: 0 }] }];
  m.evs = [252, 0, 0, 0, 0, 6]; m.item = 'leftovers'; m.fav = true; m.level = 78; m.mint = 'Audaz'; m.hyper = [true, false, false, false, false, false]; m.abUsed = true; m.mvHand = true; m.teraSet = true;
  u.buddy = { id: GARCHOMP, uid: m.uid };
  const b = protect.battleBuilt(u, m, GARCHOMP);
  assert.ok(b.protected);
  for (const frag of ['En el equipo «Liga»', 'Es favorito', 'Es tu compañero', 'Tiene 258 EV', 'Chapas', 'Menta', 'Cápsula o Parche', 'Lleva ', 'Movimientos elegidos a mano', 'Teratipo elegido', 'Nivel 78']) {
    assert.ok(b.reasons.some((r) => r.includes(frag)), `falta la razón «${frag}»: ${b.reasons.join(' | ')}`);
  }
});

test('protección: nivel 50 es el umbral y 49 sin nada más no protege', () => {
  const { u, arr } = withCopies(1);
  plain(arr[0], 49);
  assert.strictEqual(protect.isProtected(u, arr[0], GARCHOMP), false);
  plain(arr[0], 50);
  assert.strictEqual(protect.isProtected(u, arr[0], GARCHOMP), true);
});

test('mercado: al vender un repetido sale el libre aunque el de equipo sea el menos valioso; sin libres, error; con uid confirmado, vende', () => {
  const { u, arr } = withCopies(2);
  plain(arr[0], 5); plain(arr[1], 30);
  u.btTeams = [{ name: 'Liga', members: [{ id: GARCHOMP, uid: arr[0].uid, mega: 0 }] }]; // el de nivel 5 está en un equipo
  const r = market.sell(u, { kind: 'poke', pokeId: GARCHOMP, qty: 1, price: 5000 });
  assert.strictEqual(r.order.snaps[0].level, 30, 'se vende el libre, no el del equipo');
  assert.strictEqual(u.mons[GARCHOMP].length, 1);
  assert.strictEqual(u.mons[GARCHOMP][0].uid, arr[0].uid, 'el del equipo se queda');
  const keep = u.mons[GARCHOMP][0];
  assert.throws(() => market.sell(u, { kind: 'poke', pokeId: GARCHOMP, qty: 1, price: 5000 }), (e) => /Solo te quedan ejemplares preparados para combate/.test(e.message) && /Nv\. 5/.test(e.message) && /equipo «Liga»/.test(e.message));
  assert.strictEqual(u.mons[GARCHOMP].length, 1, 'sin confirmar no se toca nada');
  assert.throws(() => market.sell(u, { kind: 'poke', pokeId: GARCHOMP, qty: 1, price: 5000, confirmUids: ['otro'] }), /preparados para combate/);
  assert.throws(() => market.sell(u, { kind: 'poke', pokeId: GARCHOMP, qty: 1, price: 5000, uids: [keep.uid] }), /combate/);
  const r2 = market.sell(u, { kind: 'poke', pokeId: GARCHOMP, qty: 1, price: 5000, uids: [keep.uid], confirmUids: [keep.uid] });
  assert.strictEqual(r2.order.snaps.length, 1);
  assert.ok(!u.collection[GARCHOMP] || u.collection[GARCHOMP].n === 0);
});

test('mercado: se pueden elegir los ejemplares concretos a vender (uids)', () => {
  const { u, arr } = withCopies(3);
  arr.forEach((m, i) => plain(m, 10 + i));
  const pick = arr[2];
  const r = market.sell(u, { kind: 'poke', pokeId: GARCHOMP, qty: 1, price: 5000, uids: [pick.uid] });
  assert.strictEqual(r.order.snaps[0].level, 12);
  assert.throws(() => market.sell(u, { kind: 'poke', pokeId: GARCHOMP, qty: 2, price: 5000, uids: [arr[0].uid] }), /Has elegido 1/);
  assert.throws(() => market.sell(u, { kind: 'poke', pokeId: GARCHOMP, qty: 1, price: 5000, uids: ['zzzz'] }), /ya no está/);
});

test('venta a PNJ (instantánea): tampoco toma un protegido', () => {
  const { u, arr } = withCopies(2);
  plain(arr[0], 5); plain(arr[1], 40);
  arr[0].item = 'leftovers'; // el menos valioso lleva objeto
  const buyer = user({ coins: 1e6 });
  market.buy(buyer, { kind: 'poke', pokeId: GARCHOMP, qty: 2, price: 100 }); // pedido de compra
  const r = market.sell(u, { kind: 'poke', pokeId: GARCHOMP, qty: 1, price: 100, instant: true });
  assert.strictEqual(r.filled, 1);
  assert.strictEqual(u.mons[GARCHOMP][0].uid, arr[0].uid, 'se quedó el que lleva objeto');
  assert.strictEqual(buyer.mons[GARCHOMP][0].level, 40);
});

test('regalos: giftPoke elige el libre, no toma un protegido salvo confirmación del uid', () => {
  const { giftPoke } = require('../server/giftpoke');
  const { u, arr } = withCopies(2);
  plain(arr[0], 5); plain(arr[1], 60); // el de nivel 5 es el menos valioso pero va en un equipo
  u.btTeams = [{ name: 'Liga', members: [{ id: GARCHOMP, uid: arr[0].uid, mega: 0 }] }];
  arr[1].level = 20; arr[1].exp = ex.expAt(GARCHOMP, 20);
  const dest = user();
  giftPoke(u, { to: dest.username, id: GARCHOMP, shiny: false });
    assert.deepStrictEqual(u.mons[GARCHOMP].map((m) => m.uid), [arr[0].uid], 'se regaló el libre; el del equipo se queda');
  assert.throws(() => giftPoke(u, { to: dest.username, id: GARCHOMP, shiny: false }), /preparados para combate/);
  assert.throws(() => giftPoke(u, { to: dest.username, id: GARCHOMP, shiny: false, uid: arr[0].uid }), /combate/);
  giftPoke(u, { to: dest.username, id: GARCHOMP, shiny: false, uid: arr[0].uid, confirmUids: [arr[0].uid] });
  assert.ok(!u.collection[GARCHOMP]);
});

test('Transferir repetidos conserva los de combate', () => {
  const { u, arr } = withCopies(4);
  arr.forEach((m, i) => plain(m, 5 + i));
  arr[0].evs = [10, 0, 0, 0, 0, 0];
  arr[1].item = 'leftovers';
  u.btTeams = [{ name: 'Uno', members: [{ id: GARCHOMP, uid: arr[2].uid, mega: 0 }] }];
  const plan = candy.bulkPlan(u, GARCHOMP);
  assert.deepStrictEqual(plan.map((m) => m.uid), [arr[3].uid], 'solo el libre entra en el lote');
  candy.transferAllDupes(u, {});
  const left = u.mons[GARCHOMP].map((m) => m.uid).sort();
  assert.deepStrictEqual(left, [arr[0].uid, arr[1].uid, arr[2].uid].sort());
});

test('transferir un ejemplar concreto o varios: el protegido exige confirmUids', () => {
  const { u, arr } = withCopies(3);
  arr.forEach((m, i) => plain(m, 5 + i));
  const [p, f] = [arr[0].uid, arr[1].uid]; // `arr` es la lista viva de la Caja: se guardan los uid
  arr[0].evs = [4, 0, 0, 0, 0, 0];
  assert.throws(() => candy.transfer(u, { id: GARCHOMP, uid: p }), /combate/);
  const many = candy.transferMany(u, { list: [{ id: GARCHOMP, uid: p }, { id: GARCHOMP, uid: f }] });
  assert.strictEqual(many.count, 1);
  assert.strictEqual(many.skipped, 1);
  assert.ok(u.mons[GARCHOMP].some((m) => m.uid === p));
  candy.transfer(u, { id: GARCHOMP, uid: p, confirmUids: [p] });
  assert.ok(!u.mons[GARCHOMP].some((m) => m.uid === p));
});

test('liberar copias (Pokédex): nunca toma un protegido; con confirmación sí', () => {
  const { u, arr } = withCopies(2);
  plain(arr[0], 5); plain(arr[1], 6);
  arr[0].fav = true;
  protect.releaseCopies(u, { id: GARCHOMP, count: 1 });
  assert.deepStrictEqual(u.mons[GARCHOMP].map((m) => m.uid), [arr[0].uid]);
  assert.throws(() => protect.releaseCopies(u, { id: GARCHOMP, count: 1 }), /combate/);
  protect.releaseCopies(u, { id: GARCHOMP, count: 1, uids: [arr[0].uid], confirmUids: [arr[0].uid] });
  assert.ok(!u.collection[GARCHOMP]);
});

test('Intercambio Milagroso, GTS e intercambio directo: el protegido exige confirmación', () => {
  const { u, arr } = withCopies(2);
  plain(arr[0], 8); plain(arr[1], 9);
  arr[0].evs = [1, 0, 0, 0, 0, 0];
  assert.throws(() => candy.wonder(u, { id: GARCHOMP, uid: arr[0].uid }), /combate/);
  assert.throws(() => gts.deposit(u, { id: GARCHOMP, uid: arr[0].uid, want: { id: 25, g: 'any', lv: 0 } }), /combate/);
  assert.throws(() => require('../server/trade').offer(u, { id: GARCHOMP, uid: arr[0].uid }), /sala|combate/);
});

test('listView: ejemplares con sus datos y los protegidos al final', () => {
  const { u, arr } = withCopies(3);
  arr.forEach((m, i) => plain(m, 5 + i));
  arr[0].item = 'leftovers';
  const list = protect.listView(u, GARCHOMP, false);
  assert.strictEqual(list.length, 3);
  assert.strictEqual(list[2].uid, arr[0].uid);
  assert.ok(list[2].protected && list[2].reasons.some((r) => /Lleva/.test(r)) && list[2].itemBack);
  assert.ok(!list[0].protected);
  assert.ok(Array.isArray(list[0].moves) && list[0].moves.length > 0 && list[0].moves[0].name && list[0].moves[0].type);
  assert.strictEqual(list[0].evs.length, 6);
});
