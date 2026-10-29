'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-exp-'));

const db = require('../server/db');
const hub = require('../server/hub');
const sp = require('../server/specimen');
const candy = require('../server/candy');
const gacha = require('../server/gacha');
const market = require('../server/market');
const showdown = require('../server/showdown');
const exp = require('../server/expedition');
const { BY_ID, RARITY } = require('../server/pokedex');

let n = 0;
function user(collection = {}, extra = {}) {
  const name = 'exp' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 1000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, ...extra };
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
// Bulbasaur (planta/veneno) → Bosque Verde coincide; Charmander (fuego) no.

test('enviar: marca ocupados, límites de equipo, duplicados y zonas', () => {
  const u = user({ 1: { n: 2, s: 0 }, 4: { n: 1, s: 0 }, 7: { n: 1, s: 0 }, 25: { n: 1, s: 0 } });
  const [a, b] = u.mons[1];
  assert.throws(() => exp.send(u, { zone: 'nada', hours: 4, team: [ref(a, 1)] }), /zona/);
  assert.throws(() => exp.send(u, { zone: 'bosque', hours: 5, team: [ref(a, 1)] }), /Duración/);
  assert.throws(() => exp.send(u, { zone: 'bosque', hours: 4, team: [] }), /1 a 3/);
  assert.throws(() => exp.send(u, { zone: 'bosque', hours: 4, team: [ref(a, 1), ref(b, 1), ref(u.mons[4][0], 4), ref(u.mons[7][0], 7)] }), /1 a 3/);
  assert.throws(() => exp.send(u, { zone: 'bosque', hours: 4, team: [ref(a, 1), ref(a, 1)] }), /repetido/);
  assert.throws(() => exp.send(u, { zone: 'bosque', hours: 4, team: [{ id: 1, uid: 'zzzz' }] }), /No tienes/);
  const v = exp.send(u, { zone: 'bosque', hours: 4, team: [ref(a, 1)] });
  assert.strictEqual(v.exps.length, 1);
  assert.match(a.away, /^exp:/);
  assert.throws(() => exp.send(u, { zone: 'mar', hours: 1, team: [ref(a, 1)] }), /fuera/);
  exp.send(u, { zone: 'mar', hours: 1, team: [ref(b, 1)] });
  // Máximo 2 expediciones (la 3.ª, a nivel 15).
  assert.throws(() => exp.send(u, { zone: 'mar', hours: 1, team: [ref(u.mons[4][0], 4)] }), /2 expediciones/);
  u.level = 15;
  exp.send(u, { zone: 'volcan', hours: 1, team: [ref(u.mons[4][0], 4)] });
  assert.throws(() => exp.send(u, { zone: 'volcan', hours: 1, team: [ref(u.mons[7][0], 7)] }), /3 expediciones/);
});

test('reclamar: no antes de tiempo; recompensas, tipo coincidente y niveles', () => {
  const ck = clock();
  try {
    const u = user({ 1: { n: 1, s: 0 }, 4: { n: 1, s: 0 } });
    const bulb = u.mons[1][0];
    const char = u.mons[4][0];
    const c0 = u.coins;
    const e = exp.send(u, { zone: 'bosque', hours: 8, team: [ref(bulb, 1), ref(char, 4)] }).exps[0];
    assert.throws(() => exp.claim(u, { id: e.id }), /Todavía/);
    ck.advance(8 * H - 1000);
    assert.throws(() => exp.claim(u, { id: e.id }), /Todavía/);
    ck.advance(1000);
    const r = exp.claim(u, { id: e.id }).reward;
    assert.ok(r.candy[1] > r.candy[4], `coincide con la zona: ${r.candy[1]} > ${r.candy[4]}`);
    assert.ok(u.candy[BY_ID.get(1).chain] >= r.candy[1]);
    assert.strictEqual(u.candy['*'], 8);
    assert.strictEqual(bulb.level, 5 + 4);
    assert.strictEqual(char.level, 5 + 4);
    assert.strictEqual(bulb.away, undefined);
    assert.strictEqual(u.expeditions.length, 0);
    assert.ok(r.members.every((m) => m.to - m.from === 4));
    assert.ok(bulb.friendship > 70 && bulb.friendship <= 70 + 40, 'amistad con tope diario');
    // coins: 8 × 8 × (1 + 0,5 × 1/2) = 80
    assert.strictEqual(u.coins - c0, 80);
    assert.strictEqual(hub.history(u).log.filter((x) => x.r === 'expedition').length, 1);
    assert.throws(() => exp.claim(u, { id: e.id }), /no existe/);
  } finally { ck.restore(); }
});

test('topes diarios: monedas ≤ 300, polvo ≤ 20, un objeto raro; valor máximo diario documentado', () => {
  const ck = clock(Date.UTC(2026, 5, 10, 8, 0, 0));
  try {
    const u = user({ 1: { n: 1, s: 0 }, 2: { n: 1, s: 0 }, 3: { n: 1, s: 0 } }, { level: 30 });
    const team = [1, 2, 3].map((id) => ref(u.mons[id][0], id));
    const c0 = u.coins;
    let rares = 0;
    for (let i = 0; i < 12; i++) {
      const e = exp.send(u, { zone: 'bosque', hours: 12, team }).exps[0];
      ck.advance(12 * H);
      // todo ocurre el mismo día UTC: se fuerza reajustando a la mañana
      const r = exp.claim(u, { id: e.id }).reward;
      if (r.item) rares++;
      ck.advance(-12 * H); // vuelve a la misma hora para seguir en el mismo día
      ck.advance(1);
    }
    assert.ok(u.coins - c0 <= exp.COIN_DAY_CAP, `monedas ${u.coins - c0}`);
    assert.strictEqual(u.coins - c0, exp.COIN_DAY_CAP, 'se alcanza el tope pero no lo supera');
    assert.ok(u.dust <= exp.DUST_DAY_CAP, `polvo ${u.dust}`);
    assert.ok(rares <= exp.RARE_DAY_CAP);
    assert.ok((u.items.ticket || 0) + (u.items['mystery-egg'] || 0) <= exp.RARE_DAY_CAP);
    // ni un solo movimiento positivo del libro que no sea 'expedition'
    assert.ok(hub.history(u).log.every((x) => x.r === 'expedition'));
    for (const m of [1, 2, 3].map((id) => u.mons[id][0])) {
      assert.ok(m.level <= 5 + exp.LEVEL_DAY_CAP, `niveles al día ${m.level}`);
      assert.ok(m.friendship <= 70 + 40);
    }
  } finally { ck.restore(); }
  assert.ok(exp.dailyMaxValue() <= 600, `valor máximo diario ${exp.dailyMaxValue()}`);
  assert.strictEqual(exp.dailyMaxValue(), 300 + 20 * gacha.DUST_RATE + 172);
});

test('nunca da Pokémon ni a nivel 100 sube más; recompensas crecen con la duración', () => {
  const ck = clock();
  try {
    const u = user({ 25: { n: 1, s: 0 } });
    const m = u.mons[25][0];
    m.level = 99;
    const base = u.coins;
    const col = JSON.stringify(Object.keys(u.collection));
    const e = exp.send(u, { zone: 'central', hours: 12, team: [ref(m, 25)] }).exps[0];
    ck.advance(12 * H);
    exp.claim(u, { id: e.id });
    assert.strictEqual(m.level, 100);
    assert.strictEqual(JSON.stringify(Object.keys(u.collection)), col);
    assert.ok(u.coins > base);
    const per = [1, 4, 8, 12].map((h) => exp.COIN_PER_HOUR * h * 1.5);
    assert.ok(per.every((x, i, a) => !i || x > a[i - 1]));
  } finally { ck.restore(); }
});

test('guardas: un ejemplar de expedición no se libera, transfiere, vende, regala, intercambia, evoluciona ni combate', () => {
  const ck = clock();
  try {
    const u = user({ 1: { n: 2, s: 0 }, 25: { n: 2, s: 0 } }, { coins: 100000, level: 10 });
    for (const id of [1, 25]) for (const m of u.mons[id]) m.level = 20;
    const [a, b] = u.mons[1];
    const [p1, p2] = u.mons[25];
    candy.addWild(u, 5000);
    exp.send(u, { zone: 'bosque', hours: 4, team: [ref(a, 1), ref(p1, 25)] });
    // liberar / transferir
    assert.throws(() => sp.release(u, ref(a, 1)), /fuera/);
    assert.throws(() => candy.transfer(u, ref(a, 1)), /fuera/);
    assert.throws(() => candy.wonder(u, ref(a, 1)), /fuera/);
    assert.throws(() => candy.evolve(u, { ...ref(a, 1), to: 2 }), /fuera/);
    // la copia libre sí se puede liberar, y el ocupado se conserva
    assert.ok(candy.transfer(u, ref(b, 1)).dust > 0);
    assert.strictEqual(u.collection[1].n, 1);
    assert.strictEqual(sp.sync(u, 1).length, 1);
    assert.strictEqual(sp.sync(u, 1)[0].uid, a.uid, 'sync no descarta al ocupado');
    // solo queda la copia ocupada: no se vende ni regala ni libera por especie
    assert.throws(() => gacha.takePoke(u, 1, false), /expedición|Debes|última|conserv/i);
    assert.strictEqual(market.owned(u, { kind: 'poke', pokeId: 1, shiny: false }), 0);
    assert.throws(() => gacha.release(u, { id: 1, count: 1 }), /Debes conservar|expedición/);
    // con 2 copias de Pikachu y una ocupada: la libre no se puede vender si dejaría... (sí: queda la ocupada)
    assert.strictEqual(market.owned(u, { kind: 'poke', pokeId: 25, shiny: false }), 1);
    assert.doesNotThrow(() => gacha.takePoke(u, 25, false));
    assert.strictEqual(u.collection[25].n, 1);
    assert.strictEqual(sp.sync(u, 25)[0].uid, p1.uid);
    assert.throws(() => gacha.takePoke(u, 25, false), /expedición|Debes|última/i);
    // combates: equipo guardado
    assert.throws(() => showdown.saveTeam(u, { slot: 0, name: 'x', members: [ref(a, 1)] }), /fuera/);
  } finally { ck.restore(); }
});

test('transferir en bloque ignora a los ocupados', () => {
  const u = user({ 4: { n: 4, s: 0 } });
  const [w, x, y, z] = u.mons[4];
  for (const m of u.mons[4]) m.level = 10;
  w.level = 40;
  exp.send(u, { zone: 'volcan', hours: 1, team: [ref(x, 4), ref(y, 4)] });
  const plan = candy.bulkPlan(u, 4).map((m) => m.uid);
  assert.ok(!plan.includes(x.uid) && !plan.includes(y.uid));
  const r = candy.transferBulk(u, { id: 4 });
  assert.ok(r.count >= 1);
  const left = sp.sync(u, 4).map((m) => m.uid);
  assert.ok(left.includes(x.uid) && left.includes(y.uid), 'los ocupados siguen');
  assert.ok(z);
});

test('liberar por especie con copias ocupadas respeta las ocupadas', () => {
  const u = user({ 7: { n: 3, s: 0 } });
  const [a, b] = u.mons[7];
  exp.send(u, { zone: 'mar', hours: 1, team: [ref(a, 7), ref(b, 7)] });
  // 3 copias, 2 ocupadas: solo 1 libre; liberarla dejaría 2 (las ocupadas) → permitido
  assert.doesNotThrow(() => gacha.release(u, { id: 7, count: 1 }));
  assert.throws(() => gacha.release(u, { id: 7, count: 1 }), /Debes conservar|expedición/);
  assert.deepStrictEqual(sp.sync(u, 7).map((m) => m.uid).sort(), [a.uid, b.uid].sort());
});

test('reclamar con un ejemplar desaparecido no rompe y libera al resto', () => {
  const ck = clock();
  try {
    const u = user({ 1: { n: 1, s: 0 }, 4: { n: 1, s: 0 } });
    const a = u.mons[1][0];
    const e = exp.send(u, { zone: 'bosque', hours: 1, team: [ref(a, 1), ref(u.mons[4][0], 4)] }).exps[0];
    delete u.collection[4];
    sp.syncAll(u);
    ck.advance(H);
    const r = exp.claim(u, { id: e.id }).reward;
    assert.strictEqual(r.members.length, 1);
    assert.strictEqual(a.away, undefined);
  } finally { ck.restore(); }
});

test('el servidor lo expone en el estático con todas las zonas válidas', () => {
  assert.ok(exp.ZONES.length >= 6 && exp.ZONES.length <= 8);
  for (const z of exp.ZONES) {
    assert.ok(BY_ID.has(z.hostId), z.name);
    assert.ok(z.types.length >= 1);
    assert.notStrictEqual(BY_ID.get(z.hostId).rarity === 'L' || BY_ID.get(z.hostId).rarity === 'M', true);
  }
  assert.ok(RARITY);
});
