'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-care-'));

const db = require('../server/db');
const hub = require('../server/hub');
const sp = require('../server/specimen');
const gacha = require('../server/gacha');
const candy = require('../server/candy');
const market = require('../server/market');
const npc = require('../server/npc');
const care = require('../server/daycare');
const exp = require('../server/expedition');
const { DEX, BY_ID, RARITY } = require('../server/pokedex');

let n = 0;
function user(collection = {}, extra = {}) {
  const name = 'care' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 10000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, ...extra };
  db.addUser(u);
  sp.syncAll(u);
  return u;
}
function clock(t0 = Date.now()) {
  const real = Date.now;
  let t = t0;
  Date.now = () => t;
  return { advance: (ms) => { t += ms; return t; }, restore: () => { Date.now = real; } };
}
const H = 3600 * 1000;
const ref = (m, id) => ({ id, uid: m.uid });
const pair = (u, a, b) => care.deposit(u, { a: ref(sp.sync(u, a)[0], a), b: ref(sp.sync(u, b)[b === a ? 1 : 0], b) });

test('compatibilidad: tipo compartido, Ditto, y sin legendarios/míticos/dos Ditto', () => {
  const u = user({ 1: { n: 1, s: 0 }, 4: { n: 1, s: 0 }, 2: { n: 1, s: 0 }, 132: { n: 2, s: 0 }, 150: { n: 1, s: 0 }, 151: { n: 1, s: 0 } });
  const m = (id) => ({ a: ref(u.mons[id][0], id) });
  assert.strictEqual(care.check(u, { a: ref(u.mons[1][0], 1), b: ref(u.mons[2][0], 2) }).ok, true); // planta/veneno ambos
  assert.strictEqual(care.check(u, { a: ref(u.mons[1][0], 1), b: ref(u.mons[4][0], 4) }).ok, false); // sin tipo común
  const dit = care.check(u, { a: ref(u.mons[132][0], 132), b: ref(u.mons[4][0], 4) });
  assert.strictEqual(dit.ok, true);
  assert.strictEqual(dit.baby, 4, 'sale la forma base del no-Ditto');
  assert.strictEqual(care.check(u, { a: ref(u.mons[132][0], 132), b: ref(u.mons[132][1], 132) }).ok, false);
  assert.strictEqual(care.check(u, { a: ref(u.mons[150][0], 150), b: ref(u.mons[132][0], 132) }).ok, false);
  assert.strictEqual(care.check(u, { a: ref(u.mons[151][0], 151), b: ref(u.mons[132][0], 132) }).ok, false);
  assert.ok(m(1));
  // El bebé siempre es la forma base de la madre
  const ven = DEX.find((p) => p.evolvesFrom && p.stage === 3 && p.rarity !== 'L' && p.rarity !== 'M');
  const base = care.baseOf(ven.id);
  assert.strictEqual(base.evolvesFrom, null);
  assert.strictEqual(base.chain, ven.chain);
});

test('depositar: ocupa a los padres, una pareja (2.ª a nivel 20), horas 6 y 4 si misma especie', () => {
  const ck = clock();
  try {
    const u = user({ 1: { n: 1, s: 0 }, 2: { n: 1, s: 0 }, 25: { n: 2, s: 0 }, 81: { n: 2, s: 0 } });
    const v = pair(u, 1, 2);
    assert.strictEqual(v.pairs[0].hours, 6);
    assert.strictEqual(v.pairs[0].readyAt - v.now, 6 * H);
    assert.strictEqual(u.mons[1][0].away, 'care');
    assert.throws(() => pair(u, 25, 25), /ocupada|pareja/);
    assert.throws(() => care.deposit(u, { a: ref(u.mons[1][0], 1), b: ref(u.mons[25][0], 25), slot: 1 }), /pareja/);
    u.level = 20;
    const v2 = care.deposit(u, { a: ref(u.mons[25][0], 25), b: ref(u.mons[25][1], 25) });
    assert.strictEqual(v2.pairs[1].hours, 4);
    // nadie ocupado se vuelve a usar
    assert.throws(() => care.deposit(u, { a: ref(u.mons[1][0], 1), b: ref(u.mons[2][0], 2) }), /fuera|ocupada/);
    // retirar libera
    care.withdraw(u, { slot: 0 });
    assert.strictEqual(u.mons[1][0].away, undefined);
    assert.strictEqual(u.mons[2][0].away, undefined);
    assert.throws(() => care.withdraw(u, { slot: 0 }), /nadie/);
  } finally { ck.restore(); }
});

test('el huevo aparece tras N horas, cuesta la tarifa y no se acumula', () => {
  const ck = clock();
  try {
    const u = user({ 1: { n: 1, s: 0 }, 2: { n: 1, s: 0 } });
    pair(u, 1, 2);
    assert.throws(() => care.collect(u, { slot: 0 }), /Todavía/);
    ck.advance(6 * H);
    const c0 = u.coins;
    const baby = BY_ID.get(care.baseOf(1).id);
    const v = care.collect(u, { slot: 0 });
    assert.strictEqual(c0 - u.coins, care.feeFor(baby.rarity));
    assert.strictEqual(v.eggs.length, 1);
    assert.strictEqual(hub.history(u).log.filter((x) => x.r === 'daycare').length, 1);
    assert.throws(() => care.collect(u, { slot: 0 }), /Todavía/);
    ck.advance(6 * H);
    care.collect(u, { slot: 0 });
    ck.advance(6 * H);
    assert.throws(() => care.collect(u, { slot: 0 }), /huevos/); // máximo 2
    u.coins = 0;
    care.hatch; // (sin monedas no se recoge)
  } finally { ck.restore(); }
  const u2 = user({ 1: { n: 1, s: 0 }, 2: { n: 1, s: 0 } }, { coins: 5 });
  const ck2 = clock();
  try {
    pair(u2, 1, 2);
    ck2.advance(6 * H);
    assert.throws(() => care.collect(u2, { slot: 0 }), /tarifa/);
  } finally { ck2.restore(); }
});

test('pasos: 1 por cada 100 monedas apostadas, sin duelos; eclosión por pasos o a las 12 h', () => {
  const ck = clock();
  try {
    const u = user({ 1: { n: 1, s: 0 }, 2: { n: 1, s: 0 } });
    pair(u, 1, 2);
    ck.advance(6 * H);
    const v = care.collect(u, { slot: 0 });
    const egg = v.eggs[0];
    assert.strictEqual(egg.steps, 0);
    assert.throws(() => care.hatch(u, { id: egg.id }), /Todavía/);
    hub.takeBet(u, 90, 'slots');
    assert.strictEqual(u.daycare.eggs[0].steps, 0);
    hub.takeBet(u, 10, 'slots');
    assert.strictEqual(u.daycare.eggs[0].steps, 1);
    hub.takeBet(u, 300, 'duel');
    assert.strictEqual(u.daycare.eggs[0].steps, 1, 'los duelos no cuentan');
    u.coins = 1e9;
    hub.takeBet(u, 10000, 'slots');
    assert.strictEqual(u.daycare.eggs[0].steps, Math.min(egg.need, 101), 'tope en los pasos necesarios');
    for (let i = 0; i < 20 && u.daycare.eggs[0].steps < egg.need; i++) hub.takeBet(u, 10000, 'slots');
    assert.strictEqual(u.daycare.eggs[0].steps, egg.need);
    const r = care.hatch(u, { id: egg.id });
    assert.ok(r.hatched.id);
    assert.strictEqual(u.daycare.eggs.length, 0);
    // por tiempo
    const u2 = user({ 1: { n: 1, s: 0 }, 2: { n: 1, s: 0 } });
    pair(u2, 1, 2);
    ck.advance(6 * H);
    const e2 = care.collect(u2, { slot: 0 }).eggs[0];
    ck.advance(12 * H - 1);
    assert.throws(() => care.hatch(u2, { id: e2.id }), /Todavía/);
    ck.advance(1);
    assert.ok(care.hatch(u2, { id: e2.id }).hatched);
  } finally { ck.restore(); }
});

test('eclosión: bebé nuevo, +3 caramelos, Pokédex, herencia de 3 IV y naturaleza', () => {
  const ck = clock();
  try {
    const u = user({ 1: { n: 1, s: 0 }, 2: { n: 1, s: 0 } });
    const [a, b] = [u.mons[1][0], u.mons[2][0]];
    a.ivs = [31, 31, 31, 31, 31, 31];
    b.ivs = [31, 31, 31, 31, 31, 31];
    a.nature = 'Audaz';
    b.nature = 'Audaz';
    pair(u, 1, 2);
    ck.advance(6 * H);
    const egg0 = care.collect(u, { slot: 0 }).eggs[0];
    const stored = u.daycare.eggs[0];
    assert.strictEqual(Object.keys(stored.ivs).length, 3);
    stored.steps = stored.need;
    const sid = stored.species;
    const had = u.collection[sid] ? u.collection[sid].n : 0;
    const c0 = (u.candy || {})[BY_ID.get(sid).chain] || 0;
    const r = care.hatch(u, { id: egg0.id });
    assert.strictEqual(u.collection[sid].n, Math.min(5, had + 1));
    assert.strictEqual((u.candy[BY_ID.get(sid).chain] || 0) - c0, 3);
    const baby = u.mons[sid].find((m) => m.uid === r.hatched.uid);
    assert.ok(baby);
    assert.strictEqual(baby.level, 5);
    const inh = baby.ivs.filter((v) => v === 31).length;
    assert.ok(inh >= 3, `IV heredados ${inh}`);
    if (stored.nature) assert.strictEqual(baby.nature, 'Audaz');
  } finally { ck.restore(); }
  // Con padres con IV 0 y naturaleza fija, el 50 % hereda: en muchas pruebas ocurre y no ocurre
  let yes = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const a = { ivs: [0, 0, 0, 0, 0, 0], nature: 'Audaz' };
    const ck2 = clock();
    try {
      const u = user({ 1: { n: 1, s: 0 }, 2: { n: 1, s: 0 } });
      u.mons[1][0].nature = 'Audaz'; u.mons[2][0].nature = 'Audaz';
      pair(u, 1, 2);
      ck2.advance(6 * H);
      care.collect(u, { slot: 0 });
      if (u.daycare.eggs[0].nature === 'Audaz') yes++;
    } finally { ck2.restore(); }
    assert.ok(a);
  }
  assert.ok(yes > N * 0.38 && yes < N * 0.62, `herencia de naturaleza ${yes}/${N}`);
});

test('variocolor: probabilidad dentro de cotas (1/128 base, 1/64 con padre variocolor)', () => {
  const trials = 6000;
  const roll = (shinyParent) => {
    let k = 0;
    const u = user({ 1: { n: 1, s: shinyParent ? 1 : 0 }, 2: { n: 1, s: 0 } });
    const ck = clock();
    try {
      for (let i = 0; i < trials; i++) {
        u.coins = 100000;
        u.daycare = null;
        for (const m of [...u.mons[1], ...u.mons[2]]) delete m.away;
        pair(u, 1, 2);
        ck.advance(6 * H);
        care.collect(u, { slot: 0 });
        if (u.daycare.eggs[0].shiny) k++;
        care.withdraw(u, { slot: 0 });
        ck.advance(-6 * H);
      }
    } finally { ck.restore(); }
    return k / trials;
  };
  const base = roll(false);
  const masuda = roll(true);
  assert.ok(base > 0.002 && base < 0.02, `base ${base}`);
  assert.ok(masuda > 0.007 && masuda < 0.03, `con padre variocolor ${masuda}`);
  assert.ok(masuda > base * 1.1);
  assert.strictEqual(care.SHINY_BASE, 1 / 128);
  assert.strictEqual(care.SHINY_PARENT, 1 / 64);
});

test('economía: criar → vender/liberar nunca da más monedas que la tarifa (valor esperado, todas las rarezas)', () => {
  for (const r of ['C', 'U', 'R', 'E']) {
    const fee = care.feeFor(r);
    const cap = npc.maxBid(r);
    assert.strictEqual(cap, RARITY[r].dust * gacha.DUST_RATE);
    assert.ok(fee >= care.FEE_MIN, r);
    assert.ok(fee >= 1.2 * care.expectedResale(r) - 1e-9, `${r}: tarifa ${fee} vs reventa esperada ${care.expectedResale(r)}`);
    assert.ok(fee > cap, `${r}: tarifa ${fee} > tope PNJ ${cap}`);
    // variocolor: 3 × tope con probabilidad 1/64 (esperanza ya incluida arriba)
    assert.ok(fee > (1 - care.SHINY_PARENT) * cap + care.SHINY_PARENT * 3 * cap);
  }
  // Todas las especies que pueden salir de un huevo (formas base criables)
  for (const p of DEX) {
    if (p.evolvesFrom || p.rarity === 'L' || p.rarity === 'M') continue;
    assert.ok(care.feeFor(p.rarity) > RARITY[p.rarity].dust * gacha.DUST_RATE, p.name);
  }
  // Bucle real: la tarifa se paga, el bebé se libera por polvo y se cambia a monedas
  const ck = clock();
  try {
    for (const [a, b] of [[1, 2], [4, 5]]) {
      const u = user({ [a]: { n: 1, s: 0 }, [b]: { n: 1, s: 0 } }, { coins: 50000 });
      u.dust = 0;
      const start = u.coins;
      pair(u, a, b);
      ck.advance(6 * H);
      care.collect(u, { slot: 0 });
      ck.advance(-6 * H);
      u.daycare.eggs[0].steps = u.daycare.eggs[0].need;
      u.daycare.eggs[0].shiny = false;
      const sid = u.daycare.eggs[0].species;
      // sin copia previa → la copia del bebé es única; fuerza una segunda para poder liberarla
      u.collection[sid] ||= { n: 0, s: 0 };
      u.collection[sid].n += 1;
      care.hatch(u, { id: u.daycare.eggs[0].id });
      sp.sync(u, sid);
      const baby = u.mons[sid][u.mons[sid].length - 1];
      sp.release(u, ref(baby, sid));
      gacha.exchangeDust(u, { amount: u.dust });
      assert.ok(u.coins < start, `pérdida neta ${u.coins - start}`);
    }
  } finally { ck.restore(); }
});

test('ocupados: los padres del criadero están protegidos como en las expediciones', () => {
  const ck = clock();
  try {
    const u = user({ 1: { n: 2, s: 0 }, 2: { n: 1, s: 0 } });
    pair(u, 1, 2);
    const [a] = u.mons[1];
    assert.throws(() => sp.release(u, ref(a, 1)), /fuera/);
    assert.throws(() => candy.transfer(u, ref(a, 1)), /fuera/);
    assert.throws(() => candy.wonder(u, ref(a, 1)), /fuera/);
    assert.strictEqual(market.owned(u, { kind: 'poke', pokeId: 2, shiny: false }), 0);
    assert.throws(() => gacha.takePoke(u, 2, false), /criadero|Debes|última/);
    assert.throws(() => exp.send(u, { zone: 'bosque', hours: 1, team: [ref(a, 1)] }), /fuera/);
    const box = sp.boxView(u).mons.find((m) => m.uid === a.uid);
    assert.strictEqual(box.away, 'care');
    // sin monedas creadas por depositar
    assert.strictEqual(u.coins, 10000);
  } finally { ck.restore(); }
});

test('especies L/M no crían y datos estáticos coherentes', () => {
  for (const p of DEX) if (p.rarity === 'L' || p.rarity === 'M') assert.ok(!care.checkPair({ id: p.id, m: { uid: 'a' } }, { id: 132, m: { uid: 'b' } }).ok, p.name);
  assert.ok(care.STATIC.fees.E >= care.STATIC.fees.C);
  assert.strictEqual(care.STATIC.wagerPerStep, 100);
});
