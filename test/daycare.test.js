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
  // Sexos deterministas: macho si id+copia es impar (las especies de sexo fijo mandan sobre esto).
  for (const [id, arr] of Object.entries(u.mons || {})) arr.forEach((m, i) => { m.gender = (Number(id) + i) % 2 ? 'M' : 'F'; });
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

// Pareja de prueba: ejemplares sueltos con el sexo indicado (las especies de sexo fijo o sin sexo mandan sobre él).
let uidN = 0;
const mon = (id, gender, learned) => ({ id, m: { uid: 'x' + ++uidN, gender, learned } });
const chk = (a, b) => care.checkPair(a, b);

test('compatibilidad: macho + hembra del mismo grupo huevo', () => {
  // Bulbasaur (Monstruo/Planta) ♂ + Charmander (Monstruo/Dragón) ♀ → comparten Monstruo; sale la forma base de la madre
  const r = chk(mon(1, 'M'), mon(4, 'F'));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.level, 'group');
  assert.strictEqual(r.baby, 4);
  assert.match(r.msg, /bastante bien/);
  // al revés: la madre es la de la segunda plaza
  assert.strictEqual(chk(mon(4, 'M'), mon(1, 'F')).baby, 1);
  // mismo tipo pero distinto grupo huevo: ya no basta (Pikachu = Campo/Hada)
  const no = chk(mon(1, 'M'), mon(25, 'F'));
  assert.strictEqual(no.ok, false);
  assert.match(no.msg, /^No parece que se lleven bien/);
  assert.match(no.msg, /grupo huevo/);
  // misma especie: «muy bien» y 4 h
  const same = chk(mon(25, 'M'), mon(25, 'F'));
  assert.strictEqual(same.ok, true);
  assert.strictEqual(same.level, 'same');
  assert.strictEqual(same.hours, care.HOURS_SAME);
  assert.match(same.msg, /muy bien/);
  assert.strictEqual(chk(mon(1, 'M'), mon(4, 'F')).hours, care.HOURS_MIXED);
});

test('compatibilidad: hace falta un macho y una hembra', () => {
  const mm = chk(mon(1, 'M'), mon(4, 'M'));
  assert.strictEqual(mm.ok, false);
  assert.match(mm.msg, /mismo sexo/);
  assert.strictEqual(chk(mon(1, 'F'), mon(4, 'F')).ok, false);
  assert.strictEqual(chk(mon(25, 'M'), mon(25, 'M')).ok, false);
});

test('compatibilidad: sexo fijo y sin sexo (Tauros ♂, Chansey ♀, Magnemite)', () => {
  // Tauros es siempre macho aunque el ejemplar diga otra cosa; Tauros + Tauros no cría
  const t = chk(mon(128, 'F'), mon(128, 'F'));
  assert.strictEqual(t.ok, false);
  assert.match(t.msg, /mismo sexo/);
  // Tauros (Campo) ♂ + Pikachu (Campo/Hada) ♀ sí; la madre es Pikachu → Pichu
  const tp = chk(mon(128, 'F'), mon(25, 'F'));
  assert.strictEqual(tp.ok, true);
  assert.strictEqual(tp.baby, care.baseOf(25).id);
  // Chansey siempre hembra: con Pikachu ♀ no; con un ♂ del grupo Hada sí
  assert.strictEqual(chk(mon(113, 'M'), mon(25, 'F')).ok, false);
  assert.strictEqual(chk(mon(113, 'M'), mon(25, 'M')).ok, true);
  // Sin sexo (Magnemite, Voltorb): solo con Ditto
  const mag = chk(mon(81, null), mon(81, null));
  assert.strictEqual(mag.ok, false);
  assert.match(mag.msg, /sin sexo|no tiene sexo/);
  assert.strictEqual(chk(mon(81, null), mon(100, null)).ok, false);
  assert.strictEqual(chk(mon(81, 'M'), mon(25, 'F')).ok, false);
  const md = chk(mon(81, null), mon(132, null));
  assert.strictEqual(md.ok, true);
  assert.strictEqual(md.baby, 81);
});

test('compatibilidad: Ditto, grupo Desconocido y legendarios', () => {
  const d = chk(mon(132, null), mon(4, 'M'));
  assert.strictEqual(d.ok, true);
  assert.strictEqual(d.level, 'ditto');
  assert.strictEqual(d.baby, 4, 'sale la forma base del no-Ditto');
  assert.match(d.msg, /^Se llevan bien\./);
  assert.strictEqual(chk(mon(4, 'F'), mon(132, null)).baby, 4);
  assert.strictEqual(chk(mon(132, null), mon(132, null)).ok, false); // dos Ditto
  assert.strictEqual(chk(mon(150, null), mon(132, null)).ok, false); // legendario
  assert.strictEqual(chk(mon(151, null), mon(132, null)).ok, false); // mítico
  // Pichu (bebé, grupo Desconocido) no cría ni con Ditto
  const pichu = chk(mon(172, 'M'), mon(132, null));
  assert.strictEqual(pichu.ok, false);
  assert.match(pichu.msg, /Desconocido/);
  assert.strictEqual(chk(mon(172, 'M'), mon(25, 'F')).ok, false);
  assert.strictEqual(chk(mon(1, 'M'), mon(1, 'M')).ok, false);
  // El bebé siempre es la forma base de la familia de la madre
  const ven = DEX.find((p) => p.evolvesFrom && p.stage === 3 && p.rarity !== 'L' && p.rarity !== 'M');
  const base = care.baseOf(ven.id);
  assert.strictEqual(base.evolvesFrom, null);
  assert.strictEqual(base.chain, ven.chain);
});

test('compatibilidad: Nidoran♀ da ♀ o ♂, e Illumise da Volbeat o Illumise', () => {
  const n = chk(mon(32, 'M'), mon(29, 'F')); // Nidoran♂ + Nidoran♀ (Nidorina y Nidoqueen no crían, como en los juegos)
  assert.strictEqual(chk(mon(32, 'M'), mon(30, 'F')).ok, false);
  assert.strictEqual(n.ok, true);
  assert.strictEqual(n.baby, 29);
  assert.strictEqual(n.alt, 32);
  // con Ditto, la cría de Nidoran♂ es Nidoran♂ (sin alternativa)
  const nd = chk(mon(32, 'M'), mon(132, null));
  assert.strictEqual(nd.baby, 32);
  assert.strictEqual(nd.alt, null);
  const il = chk(mon(313, 'M'), mon(314, 'F'));
  assert.strictEqual(il.ok, true);
  assert.strictEqual(il.baby, 314);
  assert.strictEqual(il.alt, 313);
  assert.strictEqual(chk(mon(4, 'M'), mon(1, 'F')).alt, null);
});

test('sexo de los ejemplares: respeta las especies de sexo fijo y sin sexo', () => {
  const eg = require('../server/eggroups');
  for (let i = 0; i < 30; i++) {
    assert.strictEqual(sp.make(128).gender, 'M'); // Tauros
    assert.strictEqual(sp.make(113).gender, 'F'); // Chansey
    assert.strictEqual(sp.make(81).gender, null); // Magnemite
    assert.strictEqual(sp.make(132).gender, null); // Ditto
  }
  const genders = new Set(Array.from({ length: 60 }, () => sp.make(25).gender));
  assert.deepStrictEqual([...genders].sort(), ['F', 'M']);
  // ejemplares antiguos con sexo incorrecto: el sexo real lo manda la especie
  assert.strictEqual(eg.genderOf(128, { gender: 'F' }), 'M');
  assert.strictEqual(eg.genderOf(113, { gender: 'M' }), 'F');
  assert.strictEqual(eg.genderOf(81, { gender: 'M' }), null);
  assert.strictEqual(eg.genderOf(25, { gender: 'F' }), 'F');
  const u = user({ 128: { n: 1, s: 0 } });
  u.mons[128][0].gender = 'F';
  assert.strictEqual(sp.boxView(u).mons.find((x) => x.id === 128).gender, 'M');
  assert.deepStrictEqual(sp.boxView(u).mons.find((x) => x.id === 128).eg, ['Campo']);
  assert.deepStrictEqual(eg.groupsEs(25), ['Campo', 'Hada']);
  assert.deepStrictEqual(eg.groupsEs(172), ['Desconocido']);
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

test('eclosión: bebé nuevo, +1 Caramelo Exp. S, Pokédex, herencia de 3 IV y naturaleza', () => {
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
    const s0 = u.items['exp-s'] || 0;
    const r = care.hatch(u, { id: egg0.id });
    assert.strictEqual(u.collection[sid].n, Math.min(5, had + 1));
    assert.strictEqual((u.items['exp-s'] || 0) - s0, 1, '1 Caramelo Exp. S al eclosionar');
    assert.strictEqual(r.hatched.expItem, 'exp-s');
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

test('movimientos huevo en la comprobación de la pareja, el Criadero y el huevo', () => {
  const mv = require('../server/moves');
  const egg = mv.eggMoves(4); // Charmander
  assert.ok(egg.length > 0);
  const mk = (id, learned, gender = 'F') => ({ id, m: { uid: 'e' + id + Math.random(), gender, learned } });
  const none = care.checkPair(mk(4, ['scratch']), mk(5, ['tackle'], 'M'));
  assert.deepStrictEqual(none.eggMoves, []);
  assert.deepStrictEqual(none.eggMovesEs, []);
  const yes = care.checkPair(mk(4, ['scratch', egg[0]]), mk(5, ['tackle'], 'M'));
  assert.strictEqual(yes.ok, true);
  assert.deepStrictEqual(yes.eggMoves, [egg[0]]);
  assert.strictEqual(yes.eggMovesEs[0], mv.name(egg[0]));
  assert.ok(care.checkPair(mk(4, egg.slice(0, 6)), mk(5, [], 'M')).eggMoves.length <= 4, 'máximo 4');
  // la pareja depositada, el huevo y el recién nacido los mantienen, ya en español
  const u = user({ 4: { n: 2, s: 0 } });
  u.mons[4][0].learned = [...(u.mons[4][0].learned || []), egg[0]];
  const ck = clock();
  try {
    const v = care.deposit(u, { a: ref(u.mons[4][0], 4), b: ref(u.mons[4][1], 4) });
    assert.deepStrictEqual(v.pairs[0].eggMovesEs, [mv.name(egg[0])]);
    ck.advance(4 * H);
    const v2 = care.collect(u, { slot: 0 });
    assert.deepStrictEqual(v2.eggs[0].moves, [mv.name(egg[0])]);
    ck.advance(13 * H);
    const h = care.hatch(u, { id: v2.eggs[0].id });
    assert.deepStrictEqual(h.hatched.moves, [mv.name(egg[0])]);
  } finally { ck.restore(); }
});

test('Entrenamiento Extremo: el Criadero hereda los IV reales, no los efectivos (Chapas)', () => {
  const ck = clock();
  try {
    const u = user({ 1: { n: 1, s: 0 }, 2: { n: 1, s: 0 } });
    const [a, b] = [u.mons[1][0], u.mons[2][0]];
    a.ivs = [0, 0, 0, 0, 0, 0]; b.ivs = [0, 0, 0, 0, 0, 0];
    a.hyper = Array(6).fill(true); b.hyper = Array(6).fill(true);
    assert.deepStrictEqual(require('../server/hyper').effIvs(a), Array(6).fill(31));
    pair(u, 1, 2);
    ck.advance(6 * H);
    const egg0 = care.collect(u, { slot: 0 }).eggs[0];
    const stored = u.daycare.eggs[0];
    assert.ok(Object.values(stored.ivs).every((v) => v === 0), 'IV heredados: los reales');
    stored.steps = stored.need;
    const r = care.hatch(u, { id: egg0.id });
    const baby = u.mons[r.hatched.id].find((m) => m.uid === r.hatched.uid);
    for (const i of Object.keys(stored.ivs)) assert.strictEqual(baby.ivs[Number(i)], 0);
    assert.ok(!baby.hyper, 'el bebé no hereda las Chapas');
  } finally { ck.restore(); }
});
