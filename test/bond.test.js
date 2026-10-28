'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-bond-'));

const db = require('../server/db');
const hub = require('../server/hub');
const sp = require('../server/specimen');
const candy = require('../server/candy');
const items = require('../server/items');
const bond = require('../server/bond');
const battle = require('../server/games/battle');
const { DEX, BY_ID } = require('../server/pokedex');

let n = 0;
function user(extra = {}) {
  const name = 'bnd' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 100000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection: {}, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, ...extra };
  db.addUser(u);
  return u;
}
// Usuario con `pid` x copies y compañero fijado en la primera copia.
function withBuddy(pid, copies = 2) {
  const u = user({ collection: { [pid]: { n: copies, s: 0 } } });
  sp.syncAll(u);
  u.buddy = { id: pid, shiny: false, uid: u.mons[pid][0].uid };
  return u;
}
function clock(t0 = Date.now()) {
  const real = Date.now;
  let t = t0;
  Date.now = () => t;
  return { advance: (ms) => { t += ms; return t; }, restore: () => { Date.now = real; } };
}
const H = 3600 * 1000;

test('amistad: el compañero sube +1 por cada 1.000 apostadas, tope +20/día', () => {
  const u = withBuddy(25);
  const m = u.mons[25][0];
  assert.strictEqual(m.friendship, 70);
  bond.onBet(u, 999, 'slots');
  assert.strictEqual(m.friendship, 70);
  bond.onBet(u, 1, 'slots');
  assert.strictEqual(m.friendship, 71);
  bond.onBet(u, 3500, 'slots');
  assert.strictEqual(m.friendship, 74);
  bond.onBet(u, 100000, 'slots');
  assert.strictEqual(m.friendship, 90, 'tope diario +20');
  bond.onBet(u, 50000, 'slots');
  assert.strictEqual(m.friendship, 90);
  // Los duelos y las cuentas sin compañero no cuentan.
  const v = withBuddy(25);
  bond.onBet(v, 5000, 'duel');
  assert.strictEqual(v.mons[25][0].friendship, 70);
  const w = user();
  bond.onBet(w, 5000, 'slots');
  assert.ok(!w.bond);
});

test('amistad: takeBet engancha el gancho (O(1)) y solo toca al compañero', () => {
  const u = withBuddy(25, 3);
  hub.takeBet(u, 2000, 'slots');
  assert.strictEqual(u.mons[25][0].friendship, 72);
  assert.strictEqual(u.mons[25][1].friendship, 70);
});

test('amistad: ganar un duelo +3, máximo 5 victorias al día por ejemplar', () => {
  const u = user({ collection: { 25: { n: 1, s: 0 } } });
  sp.syncAll(u);
  const m = u.mons[25][0];
  for (let i = 0; i < 5; i++) assert.strictEqual(bond.onDuelWin(u, m.uid), 3);
  assert.strictEqual(bond.onDuelWin(u, m.uid), 0);
  assert.strictEqual(m.friendship, 85);
  assert.strictEqual(bond.onDuelWin(u, 'zzzz'), 0);
  // Otro día: vuelve a contar.
  m.fd.day = '2000-01-01';
  assert.strictEqual(bond.onDuelWin(u, m.uid), 3);
});

test('amistad: nunca pasa de 255 y se etiqueta/corazones', () => {
  const u = user({ collection: { 25: { n: 1, s: 0 } } });
  sp.syncAll(u);
  const m = u.mons[25][0];
  m.friendship = 254;
  u.berries = { 'berry-pinia': 3 };
  const r = bond.feed(u, { id: 25, uid: m.uid, berry: 'berry-pinia' });
  assert.strictEqual(r.gain, 1);
  assert.strictEqual(m.friendship, 255);
  assert.throws(() => bond.feed(u, { id: 25, uid: m.uid, berry: 'berry-pinia' }), /máximo/);
  assert.strictEqual(u.berries['berry-pinia'], 2, 'no se gasta la baya si no sirve');
  assert.deepStrictEqual([0, 49, 50, 100, 199, 219, 220, 255].map(bond.hearts), [0, 0, 1, 2, 3, 4, 5, 5]);
  assert.deepStrictEqual([70, 100, 160, 220].map(bond.stageName), ['Indiferente', 'Amistoso', 'Muy amistoso', 'Te adora']);
});

test('bayas: +5…+20 según la baya, tope +60/día por ejemplar y se gasta una baya', () => {
  const u = user({ collection: { 25: { n: 2, s: 0 } }, berries: { 'berry-aranja': 2, 'berry-pinia': 10 } });
  sp.syncAll(u);
  const [a, b] = u.mons[25];
  assert.strictEqual(bond.feed(u, { id: 25, uid: a.uid, berry: 'berry-aranja' }).gain, 5);
  for (let i = 0; i < 2; i++) assert.strictEqual(bond.feed(u, { id: 25, uid: a.uid, berry: 'berry-pinia' }).gain, 20);
  assert.strictEqual(a.friendship, 115);
  const last = bond.feed(u, { id: 25, uid: a.uid, berry: 'berry-pinia' });
  assert.strictEqual(last.gain, 15, 'solo cabe lo que queda del tope');
  assert.strictEqual(last.left, 0);
  assert.throws(() => bond.feed(u, { id: 25, uid: a.uid, berry: 'berry-pinia' }), /de sobra/);
  assert.strictEqual(u.berries['berry-pinia'], 7);
  assert.strictEqual(bond.feed(u, { id: 25, uid: b.uid, berry: 'berry-pinia' }).gain, 20, 'el tope es por ejemplar');
  assert.throws(() => bond.feed(u, { id: 25, uid: b.uid, berry: 'berry-zidra' }), /No tienes/);
  assert.throws(() => bond.feed(u, { id: 25, uid: b.uid, berry: 'nada' }), /no existe/);
  assert.throws(() => bond.feed(u, { id: 25, uid: 'zzzz', berry: 'berry-pinia' }));
});

test('duelos: +3 % a todas las estadísticas solo con amistad ≥ 220', () => {
  const base = { id: 25, shiny: false, stars: 1, owner: 'x', ivs: Array(6).fill(15), nature: 'Seria', level: 5 };
  const f0 = battle.fighter({ ...base, friendship: 70 });
  const f219 = battle.fighter({ ...base, friendship: 219 });
  const f220 = battle.fighter({ ...base, friendship: 220 });
  const fNone = battle.fighter(base);
  assert.deepStrictEqual(f219, f0);
  assert.deepStrictEqual(fNone, f0);
  assert.ok(f220.hp > f0.hp && f220.atk > f0.atk && f220.def > f0.def && f220.spe > f0.spe);
  assert.ok(Math.abs(f220.atk / f0.atk - 1.03) < 1e-9 && Math.abs(f220.spe / f0.spe - 1.03) < 1e-9 && Math.abs(f220.def / f0.def - 1.03) < 1e-9);
  assert.ok(Math.abs(f220.hp / f0.hp - 1.03) < 0.01);
  // Sin datos de ejemplar no hay bono.
  assert.deepStrictEqual(battle.fighter({ id: 25, shiny: false, stars: 1, owner: 'x', friendship: 255 }), battle.fighter({ id: 25, shiny: false, stars: 1, owner: 'x' }));
});

test('duelos: el ejemplar elegido lleva su amistad al combate', () => {
  const duel = require('../server/games/duel');
  const u = user({ collection: { 25: { n: 1, s: 0 } } });
  sp.syncAll(u);
  u.mons[25][0].friendship = 230;
  // create() usa ownedPick y deja el reto abierto con el ejemplar elegido.
  const r = duel.create(u, { pokeId: 25, shiny: false, wager: 0 });
  assert.strictEqual(r.duel.poke.friendship, 230);
  duel.cancel(u, { id: r.duel.id });
});

test('evolución por amistad: la tabla coincide con la Pokédex', () => {
  assert.ok(bond.FRIEND_EVO.size >= 17);
  for (const [to, from] of bond.FRIEND_EVO) assert.strictEqual(BY_ID.get(to).evolvesFrom, from, BY_ID.get(to).name);
  const name = (id) => BY_ID.get(id).name;
  for (const nm of ['Pikachu', 'Clefairy', 'Jigglypuff', 'Crobat', 'Blissey', 'Espeon', 'Umbreon', 'Togetic', 'Marill', 'Roselia', 'Lopunny', 'Chimecho', 'Lucario', 'Snorlax', 'Swoobat', 'Leavanny', 'Silvally', 'Frosmoth']) {
    assert.ok([...bond.FRIEND_EVO.keys()].some((id) => name(id) === nm), nm);
  }
});

test('evolución por amistad: sin nivel mínimo y con la mitad de caramelos', () => {
  const from = DEX.find((p) => p.name === 'Pichu').id;
  const to = DEX.find((p) => p.name === 'Pikachu').id;
  const normal = candy.evoCost(from, to);
  const friend = candy.evoCost(from, to, true);
  assert.strictEqual(friend.level, 0);
  assert.ok(friend.cost < normal.cost);
  assert.ok(friend.cost >= Math.ceil(normal.cost / 2));
  // Nunca por debajo del suelo que evita el arbitraje de polvo, para todas las evoluciones por amistad.
  const { RARITY } = require('../server/pokedex');
  for (const [t, f] of bond.FRIEND_EVO) {
    const c = candy.evoCost(f, t, true);
    const gain = Math.max(0, RARITY[BY_ID.get(t).rarity].dust - RARITY[BY_ID.get(f).rarity].dust);
    assert.ok(gain / c.cost <= candy.EVO_GAIN_PER_CANDY + 1e-9, BY_ID.get(t).name);
    assert.ok(c.cost <= candy.evoCost(f, t).cost);
  }
  const u = user({ collection: { [from]: { n: 2, s: 0 } } });
  sp.syncAll(u);
  const m = u.mons[from][0];
  u.candy = { [BY_ID.get(from).chain]: friend.cost };
  // Con amistad baja pide el nivel normal.
  assert.throws(() => candy.evolve(u, { id: from, uid: m.uid, to }), /nivel/);
  m.friendship = 219;
  assert.throws(() => candy.evolve(u, { id: from, uid: m.uid, to }), /nivel/);
  m.friendship = 220;
  const r = candy.evolve(u, { id: from, uid: m.uid, to });
  assert.strictEqual(r.cost, friend.cost);
  assert.strictEqual(m.level, 5);
  assert.strictEqual(m.friendship, 220, 'conserva la amistad');
  assert.ok(!u.candy || !u.candy[BY_ID.get(from).chain]);
  assert.strictEqual(u.mons[to][0], m);
});

test('Eevee: Espeon y Umbreon solo con amistad ≥ 220; el resto de evoluciones, por la vía normal', () => {
  const eevee = DEX.find((p) => p.name === 'Eevee').id;
  const espeon = DEX.find((p) => p.name === 'Espeon').id;
  const vaporeon = DEX.find((p) => p.name === 'Vaporeon').id;
  const u = user({ collection: { [eevee]: { n: 3, s: 0 } }, candy: { [BY_ID.get(eevee).chain]: 500 } });
  sp.syncAll(u);
  const [a, b] = u.mons[eevee];
  a.level = 60;
  assert.throws(() => candy.evolve(u, { id: eevee, uid: a.uid, to: espeon }), /amistad/);
  a.friendship = 220;
  a.level = 5;
  assert.strictEqual(candy.evolve(u, { id: eevee, uid: a.uid, to: espeon }).to, espeon);
  b.level = 20;
  assert.strictEqual(candy.evolve(u, { id: eevee, uid: b.uid, to: vaporeon }).to, vaporeon);
});

test('hallazgos del compañero: tarda 4 h, acumula como máximo 3 y no necesita conexión', () => {
  const ck = clock();
  try {
    const u = withBuddy(25);
    assert.strictEqual(bond.findsView(u).n, 0);
    assert.throws(() => bond.collect(u), /aún no/);
    ck.advance(3.9 * H);
    assert.strictEqual(bond.findsView(u).n, 0);
    ck.advance(0.2 * H);
    assert.strictEqual(bond.findsView(u).n, 1);
    ck.advance(100 * H);
    const v = bond.findsView(u);
    assert.strictEqual(v.n, 3);
    assert.strictEqual(v.nextAt, null, 'lleno: el contador está parado');
    bond.collect(u);
    assert.strictEqual(bond.findsView(u).n, 2);
    assert.ok(bond.findsView(u).nextAt >= Date.now() + 3.9 * H, 'el contador vuelve a correr al hacer sitio');
    // Sin compañero no hay hallazgos.
    const w = user();
    assert.throws(() => bond.collect(w), /compañero/);
    assert.strictEqual(bond.findsView(w).n, 0);
  } finally { ck.restore(); }
});

test('hallazgos: monedas 20-80 por hallazgo, tope 200/día con motivo «buddy» y un ticket al día como mucho', () => {
  const ck = clock();
  try {
    const u = withBuddy(25);
    bond.findsView(u);
    u.mons[25][0].friendship = 255;
    const coins0 = u.coins;
    let tickets = 0;
    let got = 0;
    for (let i = 0; i < 40; i++) {
      ck.advance(13 * H); // siempre hay 3 hallazgos
      const day = hub.dayKey();
      let todayCoins = 0;
      let todayTickets = 0;
      let todayDust = 0;
      for (let k = 0; k < 3; k++) {
        if (hub.dayKey() !== day) break;
        const r = bond.collect(u).found;
        if (r.coins) { assert.ok(r.coins >= 1 && r.coins <= 80); todayCoins += r.coins; got += r.coins; }
        if (r.ticket) todayTickets += r.ticket;
        if (r.dust) { assert.ok(r.dust >= 1 && r.dust <= 40); todayDust += r.dust; }
        if (r.candy) assert.ok(r.candy >= 2 && r.candy <= 5);
        tickets += r.ticket || 0;
      }
      assert.ok(todayCoins <= bond.COIN_DAY_CAP);
      assert.ok(todayTickets <= 1);
      assert.ok(todayDust <= bond.DUST_DAY_CAP);
    }
    assert.strictEqual(u.coins - coins0, got, 'las monedas solo entran por el hallazgo');
    assert.strictEqual(u.items.ticket || 0, tickets);
    assert.ok(u.hist.log.every((l) => l.r === 'buddy'));
    assert.strictEqual(u.hist.income.buddy, got);
  } finally { ck.restore(); }
});

test('hallazgos: dentro de un mismo día no se supera 200 monedas aunque se recojan todos', () => {
  const ck = clock(Date.UTC(2030, 0, 1, 0, 0, 1));
  try {
    const u = withBuddy(25);
    bond.findsView(u);
    const c0 = u.coins;
    // 5 hallazgos en un día natural (media 50 monedas cada uno), recogiendo cada vez que hay.
    for (let i = 0; i < 5; i++) { ck.advance(4 * H + 10); bond.collect(u); }
    assert.strictEqual(hub.dayKey(), '2030-01-01');
    assert.ok(u.coins - c0 <= bond.COIN_DAY_CAP, `ganó ${u.coins - c0}`);
    assert.ok(u.coins - c0 >= 100); // 5 × 20 como mínimo
  } finally { ck.restore(); }
});

test('huerto: regalo inicial de 3 Bayas Aranja una sola vez', () => {
  const u = user();
  const v = bond.gardenView(u);
  assert.strictEqual(v.plots.length, 4);
  assert.ok(v.plots.every((p) => p === null));
  assert.strictEqual(v.berries['berry-aranja'], 3);
  bond.gardenView(u);
  assert.strictEqual(u.berries['berry-aranja'], 3);
});

test('huerto: plantar, regar (−25 % del tiempo, una vez) y cosechar 2-4', () => {
  const ck = clock();
  try {
    const u = user();
    bond.gardenView(u);
    assert.throws(() => bond.plant(u, { plot: 4, berry: 'berry-aranja' }), /Parcela/);
    assert.throws(() => bond.plant(u, { plot: 0, berry: 'berry-nope' }), /no se puede/);
    assert.throws(() => bond.plant(u, { plot: 0, berry: 'berry-zidra' }), /No tienes/);
    bond.plant(u, { plot: 0, berry: 'berry-aranja' });
    assert.strictEqual(u.berries['berry-aranja'], 2);
    assert.throws(() => bond.plant(u, { plot: 0, berry: 'berry-aranja' }), /ocupada/);
    assert.throws(() => bond.harvest(u, { plot: 0 }), /Todavía/);
    assert.throws(() => bond.harvest(u, { plot: 1 }), /nada plantado/);
    assert.strictEqual(u.garden.plots[0].readyAt - Date.now(), 4 * H);
    ck.advance(1 * H);
    bond.water(u, { plot: 0 });
    assert.strictEqual(u.garden.plots[0].readyAt - Date.now(), 2.25 * H, '25 % menos de lo que faltaba');
    assert.throws(() => bond.water(u, { plot: 0 }), /una vez/);
    ck.advance(2.2 * H);
    assert.throws(() => bond.harvest(u, { plot: 0 }), /Todavía/);
    ck.advance(0.1 * H);
    assert.throws(() => bond.water(u, { plot: 0 }), /lista/);
    const r = bond.harvest(u, { plot: 0 });
    assert.ok(r.got.n >= 2 && r.got.n <= 4);
    assert.strictEqual(r.got.berry, 'berry-aranja');
    assert.strictEqual(u.berries['berry-aranja'], 2 + r.got.n);
    assert.strictEqual(u.garden.plots[0], null);
    // Tiempos de cada baya.
    const hours = Object.fromEntries(Object.entries(items.BERRIES).map(([k, b]) => [k, b.grow]));
    assert.strictEqual(hours['berry-aranja'], 4);
    assert.strictEqual(hours['berry-zidra'], 8);
    // Rendimiento siempre 2-4 en muchas cosechas.
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
      u.berries['berry-aranja'] = 1;
      bond.plant(u, { plot: 2, berry: 'berry-aranja' });
      ck.advance(4 * H);
      seen.add(bond.harvest(u, { plot: 2 }).got.n);
    }
    assert.deepStrictEqual([...seen].sort(), [2, 3, 4]);
  } finally { ck.restore(); }
});

test('bayas: sin precio, fuera del catálogo de objetos (ni Mercado ni NPC) y reciclaje simbólico con tope', () => {
  assert.strictEqual(Object.keys(items.BERRIES).length, 5);
  for (const [id, b] of Object.entries(items.BERRIES)) {
    assert.ok(!(id in items.ITEMS), id);
    assert.ok(!b.price);
    assert.ok(b.friend >= 5 && b.friend <= 20);
  }
  assert.deepStrictEqual(Object.values(items.BERRIES).map((b) => b.friend).sort((a, b) => a - b), [5, 10, 10, 15, 20]);
  assert.throws(() => items.buy(user(), { itemId: 'berry-aranja', qty: 1 }), /no está a la venta/);
  assert.ok(candy.recycleList().every(([id]) => !items.BERRIES[id]));
  assert.ok(candy.RECYCLE_BERRY_DUST <= 2);
  const u = user({ berries: { 'berry-pinia': 50 } });
  const coins = u.coins;
  const r = candy.recycle(u, { item: 'berry-pinia', qty: 20 });
  assert.strictEqual(r.dust, 20);
  assert.strictEqual(u.dust, 20);
  assert.strictEqual(u.coins, coins);
  assert.throws(() => candy.recycle(u, { item: 'berry-pinia', qty: 1 }), /al día/);
  assert.strictEqual(u.berries['berry-pinia'], 30);
  // Máximo teórico en monedas por reciclar bayas: 20 ✦ × 4 = 80 al día.
  assert.ok(candy.RECYCLE_BERRY_DAILY * require('../server/gacha').DUST_RATE <= 80);
});

test('B3 no crea monedas fuera del hallazgo del compañero (tope 200/día)', () => {
  const ck = clock();
  try {
    const u = withBuddy(25, 3);
    u.berries = { 'berry-aranja': 5, 'berry-pinia': 5 };
    const c0 = u.coins;
    bond.onBet(u, 50000, 'slots');
    bond.onDuelWin(u, u.mons[25][0].uid);
    bond.feed(u, { id: 25, uid: u.mons[25][0].uid, berry: 'berry-pinia' });
    bond.gardenView(u);
    bond.plant(u, { plot: 0, berry: 'berry-aranja' });
    ck.advance(4 * H);
    bond.harvest(u, { plot: 0 });
    candy.recycle(u, { item: 'berry-aranja', qty: 3 });
    assert.strictEqual(u.coins, c0);
  } finally { ck.restore(); }
});

test('el estado público trae los hallazgos y las bayas', () => {
  const u = withBuddy(25);
  u.berries = { 'berry-zidra': 2 };
  const me = hub.privateUser(u);
  assert.strictEqual(me.buddyFinds.max, 3);
  assert.deepStrictEqual(me.berries, { 'berry-zidra': 2 });
});
