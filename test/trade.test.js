'use strict';
// Intercambio directo: sala por invitación, ofertas visibles, doble confirmación, atomicidad, cancelación, desconexión y topes compartidos con la GTS.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-trade-'));

const db = require('../server/db');
const sp = require('../server/specimen');
const gts = require('../server/gts');
const gacha = require('../server/gacha');
const trade = require('../server/trade');
const notify = require('../server/notify');
const evoreq = require('../server/evoreq');
const ex = require('../server/exp');
const { BY_ID } = require('../server/pokedex');

let n = 0;
function user(extra = {}) {
  const name = 'tr' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 5000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection: {}, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 5, createdAt: Date.now() - 9 * 864e5, ...extra };
  db.addUser(u);
  return u;
}
const COMMON = [...BY_ID.values()].filter((p) => p.rarity === 'C' && !sp.isFixed(p) && p.stats);
const A = COMMON[0].id; const B = COMMON[1].id; const C = COMMON[2].id;
const RARE = [...BY_ID.values()].filter((p) => p.rarity === 'L').slice(0, 3).map((p) => p.id);
const one = (u, id) => { sp.syncAll(u); return u.mons[id][0]; };
const count = (u) => Object.values(u.collection).reduce((s, c) => s + c.n, 0);
const total = (u) => Object.values(u.mons || {}).reduce((s, a) => s + a.length, 0);
function pair() {
  const a = user({ collection: { [A]: { n: 1, s: 0 }, [C]: { n: 1, s: 0 } } });
  const b = user({ collection: { [B]: { n: 1, s: 0 }, [C]: { n: 2, s: 0 } } });
  sp.syncAll(a); sp.syncAll(b);
  return { a, b };
}
// Sala abierta con las dos ofertas puestas.
function room(a, b, ma, mb) {
  trade.invite(a, { to: b.username });
  const id = trade.state(a).room.id;
  trade.accept(b, { id });
  trade.offer(a, { id: ma.id, uid: ma.uid, confirmUids: [ma.uid] });
  trade.offer(b, { id: mb.id, uid: mb.uid, confirmUids: [mb.uid] });
  return id;
}
const mon = (u, id) => ({ id, uid: one(u, id).uid });
test.beforeEach(() => { trade._reset(); trade.setOnline(() => true); });

test('invitar, aceptar, ofrecer y confirmar: se intercambian los ejemplares exactos con sus rasgos, sin comisión', () => {
  const { a, b } = pair();
  const ma = one(a, A);
  ma.level = 42; ma.exp = ex.expAt(A, 42); ma.nick = 'Pepe'; ma.ivs = [31, 30, 29, 28, 27, 26]; ma.nature = 'Audaz'; ma.ball = 'ultra-ball'; ma.item = 'oran-berry'; ma.friendship = 250; ma.evs = [252, 0, 0, 0, 0, 0];
  const mb = one(b, B);
  mb.level = 17; mb.exp = ex.expAt(B, 17); mb.ivs = [1, 2, 3, 4, 5, 6]; mb.ball = 'great-ball';
  const coinsA = a.coins; const coinsB = b.coins;
  trade.invite(a, { to: b.username });
  assert.ok(notify.list(b).list.some((x) => x.kind === 'trade'), 'avisa al invitado');
  const id = trade.state(a).room.id;
  assert.throws(() => trade.offer(a, { id: A, uid: ma.uid, confirmUids: [ma.uid] }), /aún no está abierta/);
  assert.throws(() => trade.accept(a, { id }), /ya no existe/, 'solo el invitado acepta');
  trade.accept(b, { id });
  trade.offer(a, { id: A, uid: ma.uid, confirmUids: [ma.uid] });
  const seenByB = trade.state(b).room.theirs.offer;
  assert.strictEqual(seenByB.level, 42);
  assert.strictEqual(seenByB.nature, 'Audaz');
  assert.strictEqual(seenByB.ball, 'ultra-ball');
  assert.strictEqual(seenByB.item, 'oran-berry');
  assert.ok(seenByB.otn);
  assert.strictEqual(trade.state(a).room.theirs.offer, null);
  trade.offer(b, { id: B, uid: mb.uid, confirmUids: [mb.uid] });
  const r1 = trade.confirm(a, {});
  assert.strictEqual(r1.done, undefined, 'con una sola confirmación no se mueve nada');
  assert.ok(trade.state(b).room.theirs.confirmed);
  assert.strictEqual(a.collection[A].n, 1);
  const r2 = trade.confirm(b, {});
  assert.deepStrictEqual(r2.done, { gave: B, got: A });
  // Cada uno tiene lo del otro, con rasgos, nivel, EXP, objeto y mote… pero sin EVs ni amistad.
  assert.strictEqual(a.collection[A], undefined);
  assert.strictEqual(b.collection[A].n, 1);
  assert.strictEqual(a.collection[B].n, 1);
  const got = one(b, A);
  assert.strictEqual(got.level, 42); assert.strictEqual(got.nick, 'Pepe'); assert.strictEqual(got.item, 'oran-berry');
  assert.deepStrictEqual(got.ivs, [31, 30, 29, 28, 27, 26]); assert.strictEqual(got.nature, 'Audaz'); assert.strictEqual(got.ball, 'ultra-ball');
  assert.ok(got.friendship < 250 && got.evs.every((x) => x === 0), 'EVs y amistad no viajan');
  assert.strictEqual(got.otn, a.username, 'conserva al entrenador original');
  assert.strictEqual(one(a, B).level, 17);
  assert.strictEqual(a.coins, coinsA); assert.strictEqual(b.coins, coinsB, 'sin comisión ni monedas');
  assert.strictEqual(a.gts.n, 1); assert.strictEqual(b.gts.n, 1, 'cuenta para el tope diario compartido con la GTS');
  assert.strictEqual(trade.state(a).room, null);
  assert.strictEqual(trade.rooms.size, 0);
  assert.ok(notify.list(a).list.some((x) => /Intercambio completado/.test(x.text)));
  assert.ok(evoreq.tokensOf(a) >= 1 && evoreq.tokensOf(b) >= 1, 'vale como intercambio para las evoluciones');
  assert.ok(db.data.gts.log.some((x) => x.direct && x.a === a.username));
  assert.strictEqual(total(a), count(a)); assert.strictEqual(total(b), count(b));
});

test('cambiar la oferta anula las confirmaciones y un ejemplar que cambia a escondidas no se intercambia', () => {
  const { a, b } = pair();
  const ma = one(a, A); const mb = one(b, B);
  room(a, b, mon(a, A), mon(b, B));
  trade.confirm(a, {});
  trade.offer(b, { id: C, uid: one(b, C).uid }); // b cambia de Pokémon
  const v = trade.state(a).room;
  assert.strictEqual(v.mine.confirmed, false); assert.strictEqual(v.theirs.confirmed, false);
  trade.offer(b, { id: B, uid: mb.uid, confirmUids: [mb.uid] });
  trade.confirm(a, {});
  ma.level = 99; // a sube de nivel a su Pokémon (o le cambia el objeto) después de confirmar y antes de que b lo haga
  assert.throws(() => trade.confirm(b, {}), /ha cambiado/);
  assert.ok(a.collection[A] && b.collection[B], 'no se movió nada');
  assert.strictEqual(trade.state(a).room.mine.confirmed, false);
  assert.strictEqual(trade.state(b).room.theirs.offer.level, 99, 'ahora b ve el nivel nuevo');
  trade.confirm(a, {});
  const r = trade.confirm(b, {});
  assert.deepStrictEqual(r.done, { gave: B, got: A });
  assert.strictEqual(one(b, A).level, 99);
});

test('cancelar o rechazar: no se mueve nada y el otro lo sabe; una sala por jugador', () => {
  const { a, b } = pair();
  trade.invite(a, { to: b.username });
  const id = trade.state(a).room.id;
  assert.throws(() => trade.invite(a, { to: b.username }), /Ya estás en una sala/);
  assert.throws(() => trade.invite(user({ collection: { [A]: { n: 1, s: 0 } } }), { to: b.username }), /ya está en otra sala/);
  trade.leave(b, {}); // rechaza
  assert.strictEqual(trade.rooms.size, 0);
  assert.ok(notify.list(a).list.some((x) => /rechazado/.test(x.text)));
  const mb = one(b, B);
  room(a, b, mon(a, A), mon(b, B));
  trade.confirm(a, {});
  trade.leave(a, {});
  assert.strictEqual(trade.rooms.size, 0);
  assert.strictEqual(trade.state(b).room, null);
  assert.ok(notify.list(b).list.some((x) => /cancelado el intercambio/.test(x.text)));
  assert.ok(a.collection[A].n === 1 && b.collection[B].n === 1 && b.mons[B][0] === mb);
  assert.throws(() => trade.confirm(a, {}), /ninguna sala/);
  void id;
});

test('desconexión: la sala se cierra, nadie pierde nada; también caduca la invitación y la sala inactiva', () => {
  const { a, b } = pair();
  room(a, b, mon(a, A), mon(b, B));
  trade.confirm(a, {});
  trade.onDisconnect(b.id);
  assert.strictEqual(trade.rooms.size, 0);
  assert.ok(a.collection[A] && b.collection[B]);
  assert.ok(notify.list(a).list.some((x) => /desconectado/.test(x.text)));
  assert.strictEqual(trade.state(a).room, null);
  trade.invite(a, { to: b.username });
  trade.tick(Date.now() + trade.INVITE_MS + 1000);
  assert.strictEqual(trade.rooms.size, 0, 'invitación caducada');
  room(a, b, mon(a, A), mon(b, B));
  trade.tick(Date.now() + trade.IDLE_MS + 1000);
  assert.strictEqual(trade.rooms.size, 0, 'sala inactiva');
  // El invitado tiene que estar conectado
  trade.setOnline(() => false);
  assert.throws(() => trade.invite(a, { to: b.username }), /no está conectado/);
});

test('atómico: si algo falla a medias se restaura todo y la sala sigue abierta sin confirmaciones', () => {
  const { a, b } = pair();
  const ma = one(a, A); const mb = one(b, B);
  const id = room(a, b, mon(a, A), mon(b, B));
  trade.confirm(a, {});
  const copyA = JSON.stringify([a.collection, a.mons, a.dexSeen, a.dust]);
  const copyB = JSON.stringify([b.collection, b.mons, b.dexSeen, b.dust]);
  const real = gacha.grant;
  let calls = 0;
  gacha.grant = (...args) => { if (++calls === 2) throw new Error('fallo de prueba'); return real(...args); };
  try { assert.throws(() => trade.confirm(b, {}), /no se ha movido nada/); } finally { gacha.grant = real; }
  assert.strictEqual(JSON.stringify([a.collection, a.mons, a.dexSeen, a.dust]), copyA, 'a como estaba');
  assert.strictEqual(JSON.stringify([b.collection, b.mons, b.dexSeen, b.dust]), copyB, 'b como estaba');
  assert.ok(a.mons[A][0].uid === ma.uid && b.mons[B][0].uid === mb.uid);
  assert.ok(!a.gts || a.gts.n === 0);
  const v = trade.state(a).room;
  assert.strictEqual(v.id, id); assert.strictEqual(v.mine.confirmed, false); assert.strictEqual(v.theirs.confirmed, false);
  // …y se puede repetir y funciona
  trade.confirm(a, {});
  assert.deepStrictEqual(trade.confirm(b, {}).done, { gave: B, got: A });
});

test('mismos bloqueos y topes que la GTS: cuentas nuevas, compañero, combate, 5 al día compartidos, legendarios y Caja llena', () => {
  const { a, b } = pair();
  // cuentas nuevas o ayudadas por la Enfermera Joy
  const young = user({ createdAt: Date.now() - 3600e3, collection: { [A]: { n: 1, s: 0 } } });
  assert.throws(() => trade.invite(young, { to: b.username }), /nivel 3/);
  assert.throws(() => trade.invite(a, { to: young.username }), /nivel 3/);
  const healed = user({ lastHeal: Date.now() - 3600e3 });
  assert.throws(() => trade.invite(healed, { to: b.username }), /Enfermera Joy/);
  // compañero
  a.buddy = { id: A, shiny: false, uid: one(a, A).uid };
  trade.invite(a, { to: b.username }); trade.accept(b, { id: trade.state(a).room.id });
  assert.throws(() => trade.offer(a, { id: A, uid: one(a, A).uid }), /compañero/);
  a.buddy = null;
  // tope diario compartido con la GTS (5 al día)
  trade.offer(a, { id: A, uid: one(a, A).uid }); trade.offer(b, { id: B, uid: one(b, B).uid });
  a.gts = { d: new Date().toISOString().slice(0, 10), n: gts.STATIC.daily };
  trade.confirm(a, {});
  assert.throws(() => trade.confirm(b, {}), /5 intercambios/);
  assert.ok(a.collection[A] && b.collection[B]);
  trade.leave(a, {});
  // legendarios: como mucho 2 recibidos al día por cuenta
  const x = user({ collection: { [RARE[0]]: { n: 1, s: 0 } } });
  const y = user({ collection: { [A]: { n: 1, s: 0 } } });
  sp.syncAll(x); sp.syncAll(y);
  y.pokeIn = { d: new Date().toISOString().slice(0, 10), n: 2, r: 2 };
  const id = room(x, y, mon(x, RARE[0]), mon(y, A));
  trade.confirm(x, {});
  assert.throws(() => trade.confirm(y, {}), /legendarios o míticos/);
  assert.ok(x.collection[RARE[0]] && y.collection[A]);
  trade.leave(x, {});
  // Caja llena: 5 copias de la especie
  const f = user({ collection: { [A]: { n: 1, s: 0 } } });
  const g = user({ collection: { [B]: { n: 1, s: 0 }, [A]: { n: 5, s: 0 } } });
  sp.syncAll(f); sp.syncAll(g);
  room(f, g, mon(f, A), mon(g, B)); // f recibe B (cabe) y g recibe A: g ya tiene 5 → no cabe
  trade.confirm(f, {});
  assert.throws(() => trade.confirm(g, {}), /ya tiene 5/);
  trade.leave(f, {});
  // misma especie: se puede (Pikachu por Pikachu) aunque tengas 5
  const h = user({ collection: { [A]: { n: 5, s: 0 } } });
  const i = user({ collection: { [A]: { n: 5, s: 0 } } });
  sp.syncAll(h); sp.syncAll(i);
  room(h, i, mon(h, A), mon(i, A));
  trade.confirm(h, {});
  assert.deepStrictEqual(trade.confirm(i, {}).done, { gave: A, got: A });
  assert.strictEqual(h.collection[A].n, 5);
  void id;
});

test('un ejemplar ofrecido queda bloqueado para la GTS y para otra oferta; no se puede ofrecer lo ya ido', () => {
  const { a, b } = pair();
  const ma = one(a, A);
  gts.noteSeen(a, B);
  room(a, b, mon(a, A), mon(b, B));
  assert.throws(() => gts.deposit(a, { id: A, uid: ma.uid, want: { id: B, g: 'any', lv: 0 } }), /sala de intercambio/);
  // lo no ofrecido sí se puede depositar
  const c0 = one(a, C);
  assert.doesNotThrow(() => gts.deposit(a, { id: C, uid: c0.uid, want: { id: B, g: 'any', lv: 0 } }));
  // el ejemplar se libera/desaparece tras ofrecerlo: al confirmar se avisa y no se mueve nada
  delete a.collection[A]; delete a.mons[A];
  assert.throws(() => trade.confirm(a, {}), /ha cambiado|ya no está/);
  assert.strictEqual(trade.state(a).room.mine.offer, null);
  assert.throws(() => trade.offer(a, { id: A, uid: 'nope' }), /No tienes/);
  assert.throws(() => trade.offer(a, { id: 999999, uid: 'x' }), /no válido/);
});

test('el resumen del otro es de solo lectura y no filtra datos privados', () => {
  const { a, b } = pair();
  room(a, b, mon(a, A), mon(b, B));
  const v = trade.state(b).room;
  assert.deepStrictEqual(Object.keys(v.theirs.offer).sort(), ['ability', 'ball', 'gender', 'id', 'item', 'ivSum', 'level', 'mark', 'moves', 'nature', 'nick', 'ot', 'otn', 'shiny', 'size', 'tera', 'uid'].sort());
  assert.ok(!JSON.stringify(v).includes(a.id) && !JSON.stringify(v).includes('coins'));
  assert.strictEqual(v.with, a.username);
});
