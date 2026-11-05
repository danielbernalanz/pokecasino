'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-gts-'));

const db = require('../server/db');
const sp = require('../server/specimen');
const gts = require('../server/gts');
const tr = require('../server/transfer');
const { BY_ID } = require('../server/pokedex');

const DAY = 864e5;
let n = 0;
function user(extra = {}) {
  const name = 'gts' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 5000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection: {}, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 10, createdAt: Date.now() - 30 * DAY, ...extra };
  db.addUser(u);
  return u;
}
// Una especie sin sexo fijo, una común y una legendaria / mítica.
const COMMON = [...BY_ID.values()].filter((p) => p.rarity === 'C' && !sp.isFixed(p) && p.stats);
const A = COMMON[0].id; const B = COMMON[1].id; const C = COMMON[2].id;
const RARE = [...BY_ID.values()].filter((p) => p.rarity === 'L').slice(0, 3).map((p) => p.id);
const one = (u, id) => { sp.syncAll(u); return u.mons[id][0]; };
const total = (u) => Object.values(u.mons || {}).reduce((s, a) => s + a.length, 0);
const count = (u) => Object.values(u.collection).reduce((s, c) => s + c.n, 0);

function setup() {
  const a = user({ collection: { [A]: { n: 1, s: 0 }, [B]: { n: 1, s: 0 } } });
  const b = user({ collection: { [B]: { n: 2, s: 0 }, [A]: { n: 1, s: 0 } } });
  sp.syncAll(a); sp.syncAll(b);
  return { a, b };
}

test('depositar saca el ejemplar de la Caja, cobra la comisión y retirar lo devuelve intacto (la comisión no)', () => {
  const { a } = setup();
  const m = one(a, A);
  m.level = 37; m.exp = require('../server/exp').expAt(A, 37); m.nick = 'Pepe'; m.ivs = [1, 2, 3, 4, 5, 6]; m.ball = 'ultra'; m.friendship = 200;
  const copy = JSON.parse(JSON.stringify(m));
  const coins = a.coins;
  const r = gts.deposit(a, { id: A, uid: m.uid, want: { id: B, g: 'any', lv: 0 } });
  assert.strictEqual(a.coins, coins - gts.FEE);
  assert.strictEqual(a.collection[A], undefined, 'ya no es tuyo mientras está depositado');
  assert.ok(!(a.mons[A] || []).length);
  assert.strictEqual(r.mine.length, 1);
  gts.cancel(a, { dep: r.mine[0].id });
  assert.strictEqual(a.coins, coins - gts.FEE, 'comisión no reembolsable');
  assert.deepStrictEqual(a.mons[A][0], copy, 'vuelve intacto: nivel, mote, IV, amistad…');
  assert.strictEqual(a.collection[A].n, 1);
  assert.strictEqual(gts.G().deps.filter((d) => d.userId === a.id).length, 0);
});

test('máximo de depósitos, comisión insuficiente y especie no vista', () => {
  const a = user({ collection: { [A]: { n: 5, s: 0 }, [B]: { n: 1, s: 0 } }, coins: 1000 });
  sp.syncAll(a);
  const want = { id: B, g: 'any', lv: 0 };
  for (let i = 0; i < gts.MAX_ACTIVE; i++) gts.deposit(a, { id: A, uid: a.mons[A][0].uid, want });
  assert.throws(() => gts.deposit(a, { id: A, uid: a.mons[A][0].uid, want }), /depósitos/);
  const p = user({ collection: { [A]: { n: 1, s: 0 } }, coins: 10 });
  sp.syncAll(p);
  assert.throws(() => gts.deposit(p, { id: A, uid: p.mons[A][0].uid, want: { id: A, g: 'any', lv: 0 } }), /monedas/);
  const q = user({ collection: { [A]: { n: 1, s: 0 } } });
  sp.syncAll(q);
  assert.throws(() => gts.deposit(q, { id: A, uid: q.mons[A][0].uid, want: { id: C, g: 'any', lv: 0 } }), /has visto/);
  assert.strictEqual(q.collection[A].n, 1, 'si falla no se pierde nada');
  assert.strictEqual(q.coins, 5000);
});

test('lo «visto» sigue contando aunque ya no tengas la especie', () => {
  const { a } = setup();
  const m = one(a, A);
  gts.deposit(a, { id: A, uid: m.uid, want: { id: B, g: 'any', lv: 0 } });
  assert.ok(gts.seenBy(a, A) && !a.collection[A]);
  assert.ok(gts.seenList(a).includes(A));
});

test('no se depositan el compañero, los de expedición/criadero ni cuentas nuevas o ayudadas por Joy', () => {
  const { a } = setup();
  const m = one(a, A);
  a.buddy = { id: A, shiny: false, uid: m.uid };
  assert.throws(() => gts.deposit(a, { id: A, uid: m.uid, want: { id: B, g: 'any', lv: 0 } }), /compañero/);
  a.buddy = null;
  m.away = 'exp:1';
  assert.throws(() => gts.deposit(a, { id: A, uid: m.uid, want: { id: B, g: 'any', lv: 0 } }), /expedición/);
  m.away = 'care';
  assert.throws(() => gts.deposit(a, { id: A, uid: m.uid, want: { id: B, g: 'any', lv: 0 } }), /Criadero/);
  delete m.away;
  const young = user({ level: 1, createdAt: Date.now(), collection: { [A]: { n: 1, s: 0 } } });
  sp.syncAll(young);
  assert.throws(() => gts.deposit(young, { id: A, uid: young.mons[A][0].uid, want: { id: A, g: 'any', lv: 0 } }), /GTS/);
  const healed = user({ lastHeal: Date.now() - 3600e3, collection: { [A]: { n: 1, s: 0 } } });
  sp.syncAll(healed);
  assert.throws(() => gts.deposit(healed, { id: A, uid: healed.mons[A][0].uid, want: { id: A, g: 'any', lv: 0 } }), /Joy/);
});

test('intercambio: se cambian los ejemplares exactos con sus rasgos, nivel, EXP y movimientos; sin EVs ni amistad', () => {
  const { a, b } = setup();
  const ex = require('../server/exp');
  const ma = one(a, A);
  ma.level = 44; ma.exp = ex.expAt(A, 44); ma.nature = 'Audaz'; ma.ivs = [31, 30, 29, 28, 27, 26]; ma.ball = 'master'; ma.mark = 'rare'; ma.size = 200; ma.tera = 'fire'; ma.evs = [252, 0, 0, 0, 0, 6]; ma.friendship = 250; ma.nick = 'Ala';
  const mb = b.mons[B][1];
  mb.level = 12; mb.exp = ex.expAt(B, 12); mb.ivs = [0, 1, 2, 3, 4, 5];
  const aCoins = a.coins; const bCoins = b.coins;
  const dep = gts.deposit(a, { id: A, uid: ma.uid, want: { id: B, g: 'any', lv: 2 } }).mine[0];
  const before = count(a) + count(b);
  const r = gts.offer(b, { dep: dep.id, uid: mb.uid });
  assert.deepStrictEqual(r.got, { id: A, shiny: false, level: 44 });
  // b recibe el ejemplar de a con sus rasgos.
  const got = b.mons[A].find((m) => m.nick === 'Ala');
  assert.ok(got);
  assert.deepStrictEqual(got.ivs, [31, 30, 29, 28, 27, 26]);
  assert.strictEqual(got.nature, 'Audaz'); assert.strictEqual(got.ball, 'master'); assert.strictEqual(got.mark, 'rare'); assert.strictEqual(got.size, 200); assert.strictEqual(got.tera, 'fire');
  assert.strictEqual(got.level, 44); assert.strictEqual(got.exp, ex.expAt(A, 44));
  assert.deepStrictEqual(got.learned, ma.learned); assert.deepStrictEqual(got.sdMoves, ma.sdMoves);
  assert.deepStrictEqual(got.evs, [0, 0, 0, 0, 0, 0]); assert.strictEqual(got.friendship, 70);
  assert.strictEqual(got.ot, require('../server/lottery').otOf(a, ma), 'el entrenador original se conserva');
  // a recibe (pasa directo a su Caja) el ejemplar de b.
  const back = a.mons[B].find((m) => m.level === 12);
  assert.ok(back);
  assert.strictEqual(back.level, 12); assert.deepStrictEqual(back.ivs, [0, 1, 2, 3, 4, 5]);
  assert.strictEqual(back.ot, require('../server/lottery').otOf(b, mb));
  // Nada se duplica ni se pierde y no hay monedas de por medio.
  assert.strictEqual(count(a) + count(b), before + 1, 'el depositado vuelve a contar: mismo número de ejemplares en total');
  assert.strictEqual(b.collection[B].n, 1);
  assert.strictEqual(a.collection[A], undefined);
  assert.strictEqual(a.coins, aCoins - gts.FEE); assert.strictEqual(b.coins, bCoins);
  assert.strictEqual(gts.G().deps.filter((d) => d.id === dep.id).length, 0);
  assert.strictEqual(sp.syncAll(a) && a.mons[B].length, 2, 'a tenía 1 B y gana otro');
});

test('requisitos de especie, sexo y nivel', () => {
  const { a, b } = setup();
  const ma = one(a, A);
  const id = gts.deposit(a, { id: A, uid: ma.uid, want: { id: B, g: 'F', lv: 3 } }).mine[0].id; // hembra de Nv. 21-30
  const [x, y] = b.mons[B];
  x.gender = 'M'; x.level = 25; x.exp = require('../server/exp').expAt(B, 25);
  y.gender = 'F'; y.level = 5; y.exp = require('../server/exp').expAt(B, 5);
  assert.throws(() => gts.offer(b, { dep: id, uid: x.uid }), /No cumple/);
  assert.throws(() => gts.offer(b, { dep: id, uid: y.uid }), /No cumple/);
  assert.throws(() => gts.offer(b, { dep: id, uid: b.mons[A][0].uid }), /No tienes|no válido/, 'otra especie no vale');
  assert.strictEqual(count(b), 3, 'los rechazos no tocan nada');
  y.level = 21; y.exp = require('../server/exp').expAt(B, 21);
  assert.strictEqual(gts.meets({ id: B, g: 'F', lv: 3 }, B, y), true);
  gts.offer(b, { dep: id, uid: y.uid });
  assert.strictEqual(gts.lvRange(0)[1], 100); assert.deepStrictEqual(gts.lvRange(10), [91, 100]); assert.deepStrictEqual(gts.lvRange(1), [1, 10]);
  assert.throws(() => gts.deposit(b, { id: B, uid: b.mons[B][0].uid, want: { id: A, g: 'F', lv: 11 } }), /Rango/);
});

test('carrera: dos ofertas al mismo depósito, solo gana una y el perdedor no pierde nada', () => {
  const { a, b } = setup();
  const c = user({ collection: { [B]: { n: 1, s: 0 } } });
  sp.syncAll(c);
  const dep = gts.deposit(a, { id: A, uid: one(a, A).uid, want: { id: B, g: 'any', lv: 0 } }).mine[0].id;
  const ub = b.mons[B][0].uid; const uc = c.mons[B][0].uid;
  gts.offer(b, { dep, uid: ub });
  assert.throws(() => gts.offer(c, { dep, uid: uc }), /ya no está disponible/);
  assert.strictEqual(c.collection[B].n, 1);
  assert.strictEqual(c.mons[B][0].uid, uc);
  assert.strictEqual(c.collection[A], undefined);
});

test('no se puede ofrecer el mismo ejemplar a dos depósitos ni intercambiar con uno mismo', () => {
  const { a, b } = setup();
  const d1 = gts.deposit(a, { id: A, uid: one(a, A).uid, want: { id: B, g: 'any', lv: 0 } }).mine[0].id;
  const c = user({ collection: { [C]: { n: 1, s: 0 }, [B]: { n: 1, s: 0 } } });
  sp.syncAll(c);
  const d2 = gts.deposit(c, { id: C, uid: c.mons[C][0].uid, want: { id: B, g: 'any', lv: 0 } }).mine[0].id;
  const ub = b.mons[B][0].uid;
  gts.offer(b, { dep: d1, uid: ub });
  assert.throws(() => gts.offer(b, { dep: d2, uid: ub }), /No tienes/);
  assert.throws(() => gts.offer(c, { dep: d2, uid: ub }), /propio|No tienes/);
});

test('caducidad: a los 7 días vuelve al PC intacto; si no cabe, espera a poder recogerlo', () => {
  const { a } = setup();
  const m = one(a, A);
  m.level = 20; m.exp = require('../server/exp').expAt(A, 20);
  const copy = JSON.parse(JSON.stringify(m));
  const t0 = Date.now();
  const id = gts.deposit(a, { id: A, uid: m.uid, want: { id: B, g: 'any', lv: 0 } }, t0).mine[0].id;
  gts.settle(t0 + 6 * DAY);
  assert.strictEqual(gts.G().deps.find((d) => d.id === id).state, 'open');
  // Mientras tanto consigue 5 de la especie: al caducar no cabe y se queda guardado.
  a.collection[A] = { n: 5, s: 0 }; sp.syncAll(a);
  gts.settle(t0 + 8 * DAY);
  assert.strictEqual(gts.G().deps.find((d) => d.id === id).state, 'expired');
  assert.throws(() => gts.search(a, { species: A }, t0 + 8 * DAY) && gts.offer(user(), { dep: id, uid: 'x' }, t0 + 8 * DAY), /disponible|No tienes/);
  a.collection[A].n = 3; sp.syncAll(a);
  gts.claim(a, {}, t0 + 8 * DAY);
  assert.strictEqual(gts.G().deps.find((d) => d.id === id), undefined);
  assert.deepStrictEqual(a.mons[A].find((x) => x.uid === copy.uid), copy);
  const { a: a2 } = setup();
  const m2 = one(a2, A);
  const id2 = gts.deposit(a2, { id: A, uid: m2.uid, want: { id: B, g: 'any', lv: 0 } }, t0).mine[0].id;
  gts.settle(t0 + 7 * DAY + 1);
  assert.strictEqual(gts.G().deps.find((d) => d.id === id2), undefined, 'caducado y devuelto solo');
  assert.strictEqual(a2.mons[A][0].uid, m2.uid);
});

test('lo recibido espera en la GTS si no cabe en la Caja y se recoge después', () => {
  const { a, b } = setup();
  const dep = gts.deposit(a, { id: A, uid: one(a, A).uid, want: { id: B, g: 'any', lv: 0 } }).mine[0].id;
  a.collection[B] = { n: 5, s: 0 }; sp.syncAll(a); // a ya tiene 5 de la especie que recibiría
  const r = gts.offer(b, { dep, uid: b.mons[B][0].uid });
  assert.strictEqual(gts.G().deps.find((d) => d.id === dep).state, 'done');
  assert.strictEqual(a.collection[B].n, 5);
  assert.strictEqual(r.got.id, A);
  assert.throws(() => gts.cancel(a, { dep }), /recoge/);
  a.collection[B].n = 4; sp.syncAll(a);
  const s = gts.state(a);
  assert.strictEqual(s.mine.length, 0);
  assert.strictEqual(a.collection[B].n, 5);
  assert.ok(s.log.length >= 1);
});

test('topes de transfer.js: cuentas nuevas, legendarios al día y Pokémon recibidos al día', () => {
  const young = user({ level: 2, createdAt: Date.now(), collection: { [B]: { n: 1, s: 0 } } });
  sp.syncAll(young);
  const { a } = setup();
  const dep = gts.deposit(a, { id: A, uid: one(a, A).uid, want: { id: B, g: 'any', lv: 0 } }).mine[0].id;
  assert.throws(() => gts.offer(young, { dep, uid: young.mons[B][0].uid }), /GTS/);
  // Dos legendarios recibidos hoy por el oferente: el tercero no entra.
  const [R1, R2, R3] = RARE;
  const o = user({ collection: { [B]: { n: 4, s: 0 } } });
  sp.syncAll(o);
  tr.notePokeIn(o, true); tr.notePokeIn(o, true);
  const c = user({ collection: { [R3]: { n: 1, s: 0 }, [B]: { n: 1, s: 0 } } });
  sp.syncAll(c);
  const dr = gts.deposit(c, { id: R3, uid: c.mons[R3][0].uid, want: { id: B, g: 'any', lv: 0 } }).mine[0].id;
  assert.throws(() => gts.offer(o, { dep: dr, uid: o.mons[B][0].uid }), /legendarios/);
  assert.ok(o.collection[B].n === 4 && !o.collection[R3]);
  // Dueño con el tope de recibidos agotado.
  const full = user({ collection: { [A]: { n: 1, s: 0 }, [B]: { n: 1, s: 0 } } });
  sp.syncAll(full);
  const d3 = gts.deposit(full, { id: A, uid: full.mons[A][0].uid, want: { id: B, g: 'any', lv: 0 } }).mine[0].id;
  for (let i = 0; i < tr.POKE_IN_DAILY; i++) tr.notePokeIn(full, false);
  const x = user({ collection: { [B]: { n: 1, s: 0 } } });
  sp.syncAll(x);
  assert.throws(() => gts.offer(x, { dep: d3, uid: x.mons[B][0].uid }), /regalados hoy/);
  assert.ok(R1 && R2);
});

test('tope diario de intercambios por cuenta', () => {
  const { a } = setup();
  const x = user({ collection: { [B]: { n: 5, s: 0 } } });
  sp.syncAll(x);
  x.gts = { d: new Date().toISOString().slice(0, 10), n: gts.DAILY };
  const dep = gts.deposit(a, { id: A, uid: one(a, A).uid, want: { id: B, g: 'any', lv: 0 } }).mine[0].id;
  assert.throws(() => gts.offer(x, { dep, uid: x.mons[B][0].uid }), /intercambios/);
});

test('evolución por intercambio: ambos reciben un intercambio pendiente (vale como Cordón Unión)', () => {
  const evoreq = require('../server/evoreq');
  const KADABRA = 64; const MACHOKE = 67;
  const a = user({ collection: { [KADABRA]: { n: 1, s: 0 }, [MACHOKE]: { n: 1, s: 0 } } });
  const b = user({ collection: { [MACHOKE]: { n: 1, s: 0 }, [KADABRA]: { n: 1, s: 0 } } });
  sp.syncAll(a); sp.syncAll(b);
  const dep = gts.deposit(a, { id: KADABRA, uid: a.mons[KADABRA][0].uid, want: { id: MACHOKE, g: 'any', lv: 0 } }).mine[0].id;
  assert.strictEqual(evoreq.tokensOf(a), 0);
  gts.offer(b, { dep, uid: b.mons[MACHOKE][0].uid });
  assert.strictEqual(evoreq.tokensOf(a), 1);
  assert.strictEqual(evoreq.tokensOf(b), 1);
  // Con ese intercambio el Kadabra recibido por b puede evolucionar a Alakazam (si tiene el nivel): se gasta el intercambio.
  const cd = require('../server/candy');
  const kd = b.mons[KADABRA].find((m) => m.ot === require('../server/lottery').tidOf(a)); // el que vino de a
  assert.ok(kd);
  kd.level = 40; kd.exp = require('../server/exp').expAt(KADABRA, 40);
  assert.ok(cd.canEvolveTo(b, kd, KADABRA).includes(65), 'Kadabra → Alakazam con el intercambio de la GTS');
});

test('la búsqueda lista por especie con lo que piden y con qué ejemplares cumples', () => {
  const { a, b } = setup();
  const dep = gts.deposit(a, { id: A, uid: one(a, A).uid, want: { id: B, g: 'any', lv: 0 } }).mine[0].id;
  const r = gts.search(b, { species: A });
  const e = r.list.find((x) => x.id === dep);
  assert.ok(e); assert.strictEqual(e.want.id, B); assert.ok(e.can.length >= 1);
  assert.strictEqual(gts.search(a, { species: A }).list.find((x) => x.id === dep), undefined, 'tus propios depósitos no salen en Buscar');
  assert.throws(() => gts.search(b, { species: 99999 }), /no válida/);
});
