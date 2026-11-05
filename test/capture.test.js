'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-capture-'));

const db = require('../server/db');
const sp = require('../server/specimen');
const items = require('../server/items');
const npc = require('../server/npc');
const care = require('../server/daycare');
const gacha = require('../server/gacha');
const balls = require('../server/balls');
const cap = require('../server/capture');
const Z = require('../server/capzones');
const { BY_ID, RARITY } = require('../server/pokedex');

let n = 0;
function user(collection = {}, extra = {}) {
  const name = 'cap' + ++n;
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
// Generador pseudoaleatorio determinista (mulberry32) para simulaciones reproducibles.
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const seq = (...v) => { let i = 0; return () => v[Math.min(i++, v.length - 1)]; };
const H = 3600 * 1000;
const NIGHT = Date.UTC(2026, 10, 5, 23, 30); // 00:30 en España: de noche
const DAYT = Date.UTC(2026, 10, 5, 11, 0); // 12:00 en España: de día

test('datos: ratio de captura real de PokeAPI y tablas de encuentros válidas', () => {
  const cd = require('../server/catchdata.json').sp;
  assert.strictEqual(Object.keys(cd).length, 1025);
  assert.strictEqual(cap.ratioOf(150), 3); // Mewtwo
  assert.strictEqual(cap.ratioOf(144), 3); // Articuno
  assert.strictEqual(cap.ratioOf(25), 190); // Pikachu
  assert.strictEqual(cap.ratioOf(129), 255); // Magikarp
  assert.strictEqual(cap.ratioOf(113), 30); // Chansey
  for (const z of Z.ZONES) {
    assert.ok(z.enc.length >= 2, z.id);
    for (const phase of ['day', 'night']) assert.ok(z.enc.some((e) => !e.t || e.t === phase), `${z.id} sin encuentros de ${phase}`);
    for (const e of z.enc) {
      assert.ok(BY_ID.has(e.id), `${z.id}: especie ${e.id}`);
      assert.ok(e.min >= 1 && e.max >= e.min && e.w > 0, `${z.id}: ${e.id}`);
      assert.ok(!e.t || e.t === 'day' || e.t === 'night');
      assert.ok(!['L', 'M'].includes(BY_ID.get(e.id).rarity), 'los legendarios solo salen como encuentro único');
    }
  }
  // Legendarios: ratio real 3 y nivel real.
  const lv = Object.fromEntries(Z.LEGENDS.map((l) => [l.id, l.level]));
  assert.deepStrictEqual(lv, { 144: 50, 145: 50, 146: 50, 150: 70 });
  for (const l of Z.LEGENDS) { assert.strictEqual(cap.ratioOf(l.id), 3); assert.ok(Z.ZONE_BY_ID.has(l.zone)); }
});

test('fórmula: a = ((3·PSmáx − 2·PSact)·ratio·ball·estado) / (3·PSmáx)', () => {
  const e = { hpMax: 100, hp: 100, rate: 45, level: 30, status: null };
  assert.strictEqual(cap.modifiedRate(e, 1), 15); // PS llenos: ratio / 3
  e.hp = 1;
  assert.ok(Math.abs(cap.modifiedRate(e, 1) - (298 * 45) / 300) < 1e-9);
  e.hp = 50;
  assert.ok(Math.abs(cap.modifiedRate(e, 1) - 30) < 1e-9); // mitad de PS: ratio × 2/3
  assert.ok(Math.abs(cap.modifiedRate(e, 2) - 60) < 1e-9); // Ultra Ball ×2
  assert.ok(Math.abs(cap.modifiedRate(e, 1, 'slp') - 75) < 1e-9); // dormido ×2,5
  assert.ok(Math.abs(cap.modifiedRate(e, 1, 'par') - 45) < 1e-9); // paralizado ×1,5
  assert.strictEqual(cap.STATUS_BONUS.slp, 2.5);
  assert.strictEqual(cap.STATUS_BONUS.frz, 2.5);
  for (const s of ['par', 'psn', 'brn', 'tox']) assert.strictEqual(cap.STATUS_BONUS[s], 1.5);
  // Bonus de nivel bajo de la 8.ª generación: ×(30 − nivel)/10 por debajo de 20.
  assert.strictEqual(cap.levelMod(5), 2.5);
  assert.strictEqual(cap.levelMod(20), 1);
  // b = 65536 / (255/a)^0,1875 y 4 comprobaciones de sacudida.
  assert.strictEqual(cap.shakeB(15), Math.floor(65536 / Math.pow(255 / 15, 0.1875)));
  assert.ok(Math.abs(cap.probability(15) - (cap.shakeB(15) / 65536) ** 4) < 1e-12);
  assert.strictEqual(cap.probability(255), 1);
  assert.strictEqual(cap.probability(400), 1);
  // Monotonía: más a, más probabilidad.
  let prev = 0;
  for (let a = 1; a < 255; a += 7) { const p = cap.probability(a); assert.ok(p > prev && p <= 1); prev = p; }
  // Valores de referencia de la fórmula (a = 15 → ≈ 12 %; a = 100 → ≈ 50 %).
  assert.ok(Math.abs(cap.probability(15) - 0.119) < 0.005, String(cap.probability(15)));
  assert.ok(Math.abs(cap.probability(100) - 0.4956) < 0.01, String(cap.probability(100)));
});

test('sacudidas: con a ≥ 255 captura segura; si no, 4 comprobaciones y 0–3 sacudidas visibles', () => {
  assert.deepStrictEqual(cap.roll(300, 0, () => 0.999), { crit: false, shakes: 3, caught: true });
  const b = cap.shakeB(15);
  const lo = (b - 1) / 65536;
  const hi = (b + 1) / 65536;
  assert.deepStrictEqual(cap.roll(15, 0, seq(lo, lo, lo, lo)), { crit: false, shakes: 3, caught: true });
  assert.deepStrictEqual(cap.roll(15, 0, seq(hi)), { crit: false, shakes: 0, caught: false });
  assert.deepStrictEqual(cap.roll(15, 0, seq(lo, hi)), { crit: false, shakes: 1, caught: false });
  assert.deepStrictEqual(cap.roll(15, 0, seq(lo, lo, hi)), { crit: false, shakes: 2, caught: false });
  assert.deepStrictEqual(cap.roll(15, 0, seq(lo, lo, lo, hi)), { crit: false, shakes: 3, caught: false });
  // Frecuencia real de captura = probability()
  const rng = seeded(7);
  let ok = 0;
  const N = 60000;
  for (let i = 0; i < N; i++) if (cap.roll(60, 0, rng).caught) ok++;
  assert.ok(Math.abs(ok / N - cap.probability(60)) < 0.01, `${ok / N} vs ${cap.probability(60)}`);
});

test('captura crítica: según especies registradas, una sola sacudida', () => {
  assert.strictEqual(cap.critMult(0), 0);
  assert.strictEqual(cap.critMult(30), 0);
  assert.strictEqual(cap.critMult(31), 0.5);
  assert.strictEqual(cap.critMult(150), 0.5);
  assert.strictEqual(cap.critMult(151), 1);
  assert.strictEqual(cap.critMult(301), 1.5);
  assert.strictEqual(cap.critMult(451), 2);
  assert.strictEqual(cap.critMult(601), 2.5);
  // Con 0 especies nunca hay críticas.
  const rng = seeded(3);
  for (let i = 0; i < 2000; i++) assert.strictEqual(cap.roll(40, 0, rng).crit, false);
  // Con el multiplicador máximo, C = ⌊a·2,5/6⌋ → ≈ a/2,4/256 de críticas; la crítica dura una sacudida y se resuelve con una sola comprobación.
  const b = cap.shakeB(60) / 65536;
  assert.deepStrictEqual(cap.roll(60, 2.5, seq(0, b - 0.001)), { crit: true, shakes: 1, caught: true });
  assert.deepStrictEqual(cap.roll(60, 2.5, seq(0, b + 0.001)), { crit: true, shakes: 1, caught: false });
  let crit = 0;
  const N = 40000;
  for (let i = 0; i < N; i++) if (cap.roll(60, 2.5, rng).crit) crit++;
  const expected = Math.floor((60 * 2.5) / 6) / 256;
  assert.ok(Math.abs(crit / N - expected) < 0.01, `${crit / N} vs ${expected}`);
  // La crítica nunca baja la probabilidad total de captura.
  assert.ok(cap.probability(60, 2.5) >= cap.probability(60, 0));
});

test('Poké Balls: efectos reales y precios coherentes', () => {
  const ctx = (o = {}) => ({ night: false, turn: 0, types: ['normal'], level: 30, owned: false, ...o });
  assert.strictEqual(balls.bonus('poke-ball', ctx()), 1);
  assert.strictEqual(balls.bonus('great-ball', ctx()), 1.5);
  assert.strictEqual(balls.bonus('ultra-ball', ctx()), 2);
  assert.strictEqual(balls.bonus('master-ball', ctx()), Infinity);
  // Ocaso: ×3 solo de noche.
  assert.strictEqual(balls.bonus('dusk-ball', ctx({ night: true })), 3);
  assert.strictEqual(balls.bonus('dusk-ball', ctx()), 1);
  // Rápida: ×5 solo en el turno 1.
  assert.strictEqual(balls.bonus('quick-ball', ctx({ turn: 0 })), 5);
  assert.strictEqual(balls.bonus('quick-ball', ctx({ turn: 1 })), 1);
  // Turno: de ×1 a ×4 (tope en el 10).
  assert.strictEqual(balls.bonus('timer-ball', ctx({ turn: 0 })), 1);
  assert.ok(Math.abs(balls.bonus('timer-ball', ctx({ turn: 5 })) - (1 + (5 * 1229) / 4096)) < 1e-9);
  assert.strictEqual(balls.bonus('timer-ball', ctx({ turn: 10 })), 4);
  assert.strictEqual(balls.bonus('timer-ball', ctx({ turn: 40 })), 4);
  // Red: Agua o Bicho ×3,5.
  assert.strictEqual(balls.bonus('net-ball', ctx({ types: ['water'] })), 3.5);
  assert.strictEqual(balls.bonus('net-ball', ctx({ types: ['grass', 'bug'] })), 3.5);
  assert.strictEqual(balls.bonus('net-ball', ctx({ types: ['fire'] })), 1);
  // Nido: (41 − nivel)/10 hasta el 29.
  assert.ok(Math.abs(balls.bonus('nest-ball', ctx({ level: 5 })) - 3.6) < 1e-9);
  assert.strictEqual(balls.bonus('nest-ball', ctx({ level: 29 })), 1.2);
  assert.strictEqual(balls.bonus('nest-ball', ctx({ level: 30 })), 1);
  // Acopio: ×3,5 si ya tienes la especie.
  assert.strictEqual(balls.bonus('repeat-ball', ctx({ owned: true })), 3.5);
  assert.strictEqual(balls.bonus('repeat-ball', ctx()), 1);
  for (const id of ['luxury-ball', 'friend-ball', 'heal-ball']) assert.strictEqual(balls.bonus(id, ctx()), 1);
  // Todas se compran con monedas, salvo la Master Ball, que sigue siendo el objeto de siempre.
  for (const id of balls.IDS) {
    assert.ok(items.ITEMS[id], id);
    if (id === 'master-ball') assert.strictEqual(items.ITEMS[id].price, null);
    else assert.ok(items.ITEMS[id].price > 0 && items.ITEMS[id].ball);
  }
  assert.ok(items.ITEMS['great-ball'].price > items.ITEMS['poke-ball'].price);
  assert.ok(items.ITEMS['ultra-ball'].price > items.ITEMS['great-ball'].price);
  // Comprar descuenta monedas.
  const u = user({ 1: { n: 1, s: 0 } });
  const r = items.buy(u, { itemId: 'poke-ball', qty: 3 });
  assert.strictEqual(r.cost, 360);
  assert.strictEqual(u.items['poke-ball'], 3);
  assert.strictEqual(u.coins, 10000 - 360);
  // Los PNJ no comercian con Balls (solo entre jugadores).
  assert.strictEqual(npc.inFocus({ focus: { items: 'shop', poke: [], cosmetics: true, dust: true, shiny: true } }, { kind: 'item', itemId: 'poke-ball' }), false);
});

test('encuentro: tope diario de 30, uno abierto a la vez, se reinicia al día siguiente', () => {
  const ck = clock(DAYT);
  try {
    const u = user({ 1: { n: 1, s: 0 } });
    const rng = seeded(11);
    assert.throws(() => cap.encounter(u, { zone: 'nada' }), /no existe/);
    assert.throws(() => cap.encounter(u, { zone: 'cueva' }, Date.now(), rng), /8 medallas/);
    cap.encounter(u, { zone: 'ruta1' }, Date.now(), rng);
    assert.throws(() => cap.encounter(u, { zone: 'ruta1' }), /encuentro en marcha/);
    for (let i = 1; i < cap.DAILY; i++) { cap.run(u); cap.encounter(u, { zone: 'ruta1' }, Date.now(), rng); }
    assert.strictEqual(cap.view(u).used, 30);
    assert.strictEqual(cap.view(u).left, 0);
    cap.run(u);
    assert.throws(() => cap.encounter(u, { zone: 'ruta1' }), /30 encuentros/);
    ck.advance(24 * H);
    assert.strictEqual(cap.view(u).used, 0);
    cap.encounter(u, { zone: 'ruta1' }, Date.now(), rng);
    assert.strictEqual(cap.view(u).used, 1);
    // Zonas por medallas
    u.progress.badges = ['a', 'b'];
    cap.run(u);
    assert.doesNotThrow(() => cap.encounter(u, { zone: 'ruta7' }, Date.now(), rng));
  } finally { ck.restore(); }
});

test('encuentro: especies y niveles de la tabla, por hora; los de noche no salen de día', () => {
  const rng = seeded(5);
  const z = Z.ZONE_BY_ID.get('ruta1');
  const seen = { day: new Set(), night: new Set() };
  for (let i = 0; i < 3000; i++) {
    for (const [ph, t] of [['day', DAYT], ['night', NIGHT]]) {
      const e = cap.makeEncounter({}, z, t, rng);
      const row = z.enc.find((x) => x.id === e.id && e.level >= x.min && e.level <= x.max && (!x.t || x.t === ph));
      assert.ok(row, `${BY_ID.get(e.id).name} nv. ${e.level} (${ph})`);
      assert.strictEqual(e.phase, ph);
      seen[ph].add(e.id);
    }
  }
  assert.ok(seen.night.has(163) && !seen.day.has(163)); // Hoothoot solo de noche
  assert.ok(seen.day.has(161) && !seen.night.has(161)); // Sentret solo de día
  assert.ok(seen.day.has(19) && seen.night.has(19)); // Rattata, a todas horas
  // Pesos como en la tabla: Rattata (50) sale ≈ 5 veces más que Sentret (10) de día.
  const cnt = {};
  for (let i = 0; i < 20000; i++) { const e = cap.makeEncounter({}, z, DAYT + (i % 2) * 0, rng); if (cap.outbreakAt(DAYT).zone !== 'ruta1') cnt[e.id] = (cnt[e.id] || 0) + 1; }
  if (cap.outbreakAt(DAYT).zone !== 'ruta1') assert.ok(cnt[19] / cnt[161] > 3.5 && cnt[19] / cnt[161] < 7, JSON.stringify(cnt));
});

test('apariciones masivas y clima: deterministas, una por tramo de 4 h, de una especie de la zona', () => {
  const t = Date.UTC(2026, 10, 5, 9, 17);
  const a = cap.outbreakAt(t);
  assert.deepStrictEqual(cap.outbreakAt(t + 60000), a); // mismo tramo, misma aparición
  assert.strictEqual(a.until - a.from, 4 * H);
  const z = Z.ZONE_BY_ID.get(a.zone);
  assert.ok(z.enc.some((e) => e.id === a.id && !e.t));
  const set = new Set();
  for (let d = 0; d < 6; d++) for (let s = 0; s < 6; s++) { const o = cap.outbreakAt(Date.UTC(2026, 10, 5 + d, s * 4, 1)); set.add(`${o.zone}:${o.id}`); assert.ok(Z.ZONE_BY_ID.get(o.zone).enc.some((e) => e.id === o.id)); }
  assert.ok(set.size >= 8, `rotación demasiado corta: ${set.size}`);
  // En la zona de la aparición, 4 de cada 10 encuentros son de esa especie.
  const rng = seeded(99);
  let hit = 0;
  const N = 6000;
  for (let i = 0; i < N; i++) if (cap.makeEncounter({}, z, t, rng).id === a.id) hit++;
  // (con el peso ×3 del tipo de la semana temática, ver themes.js)
  const wt = (e) => e.w * require('../server/themes').captureWeight(e.id, t);
  const base = z.enc.filter((e) => e.id === a.id && (!e.t || e.t === 'day')).reduce((s, e) => s + wt(e), 0) / z.enc.filter((e) => !e.t || e.t === 'day').reduce((s, e) => s + wt(e), 0);
  assert.ok(Math.abs(hit / N - (0.4 + 0.6 * base)) < 0.03, `${hit / N}`);
  // Clima: estable en cada tramo de 6 h; sin clima en cuevas.
  assert.strictEqual(cap.weatherOf('ruta1', t), cap.weatherOf('ruta1', t + 60000));
  assert.strictEqual(cap.weatherOf('moon', t), 'clear');
  const wx = new Set();
  for (let i = 0; i < 80; i++) wx.add(cap.weatherOf('ruta1', t + i * 6 * H));
  assert.deepStrictEqual([...wx].sort(), ['clear', 'fog', 'rain']);
});

test('marcas y tamaños: escala 0–255, Mini / Jumbo en los extremos, marca rara 1/1000', () => {
  assert.strictEqual(cap.sizeLabel(0), 'Minúsculo');
  assert.strictEqual(cap.sizeLabel(100), 'Normal');
  assert.strictEqual(cap.sizeLabel(255), 'Gigante');
  assert.strictEqual(cap.sizeTitle(0), 'Mini');
  assert.strictEqual(cap.sizeTitle(255), 'Jumbo');
  assert.strictEqual(cap.sizeTitle(128), null);
  const rng = seeded(21);
  let lo = 0; let hi = 0; let mid = 0;
  const N = 200000;
  for (let i = 0; i < N; i++) { const s = cap.rollSize(rng); assert.ok(s >= 0 && s <= 255 && Number.isInteger(s)); if (s === 0) lo++; else if (s === 255) hi++; else if (s >= 100 && s <= 155) mid++; }
  assert.ok(lo + hi < N / 1000, 'los extremos son rarísimos');
  assert.ok(mid / N > 0.3, 'campana centrada');
  // Marca rara: 1/1000 por encuentro.
  const z = Z.ZONE_BY_ID.get('ruta1');
  let rare = 0; let marks = 0;
  const M = 60000;
  const r2 = seeded(8);
  for (let i = 0; i < M; i++) { const e = cap.makeEncounter({}, z, DAYT, r2); if (e.mark === 'rare') rare++; if (e.mark) marks++; }
  assert.ok(rare >= 30 && rare <= 100, `marca rara ${rare}/${M}`);
  assert.ok(marks / M < 0.1);
  for (const k of Object.keys(cap.MARKS)) assert.ok(cap.MARKS[k].name && cap.MARKS[k].title);
});

// Prepara un encuentro a medida (para probar ataques y lanzamientos sin depender del azar).
function setup(u, { id = 19, level = 10, hp = 100, status = null, legend = false, zone = 'ruta1' } = {}) {
  const c = cap.stateOf(u);
  const e = cap.makeEncounter(u, Z.ZONE_BY_ID.get(zone), DAYT, seeded(1));
  Object.assign(e, { id, level, rate: cap.ratioOf(id), status, legend, shiny: false, mark: null, ha: false, size: 120 });
  e.stats = cap.wildStats(id, level, e.ivs, e.nature);
  e.hpMax = e.stats[0];
  e.hp = Math.max(1, Math.round((e.hpMax * hp) / 100));
  c.enc = e;
  return e;
}

test('atacar: daño real, Falso Tortazo deja 1 PS, estados dormir/paralizar, el salvaje puede debilitarse o huir', () => {
  const u = user({ 1: { n: 1, s: 0 }, 25: { n: 1, s: 0 } });
  const bulb = u.mons[1][0];
  const pika = u.mons[25][0];
  bulb.sdMoves = ['falseswipe', 'sleeppowder', 'vinewhip', 'toxic'];
  pika.sdMoves = ['thunderwave', 'thunderbolt', 'tackle'];
  const ref = (m, id) => ({ id, uid: m.uid });
  // Sin encuentro no se puede.
  assert.throws(() => cap.attack(u, { ...ref(bulb, 1), move: 'vinewhip' }), /encuentro/);
  assert.throws(() => cap.throwBall(u, { ball: 'poke-ball' }), /encuentro/);
  // Movimiento que no lleva
  setup(u, { id: 19, level: 12 });
  assert.throws(() => cap.attack(u, { ...ref(bulb, 1), move: 'earthquake' }), /no lleva/);
  // Daño: baja PS pero no debilita con un Rattata de nivel 12 y PS llenos.
  const r = cap.attack(u, { ...ref(bulb, 1), move: 'vinewhip' }, DAYT, seq(0.5, 0.0, 0.99));
  assert.ok(r.after < r.before && r.after > 0, JSON.stringify(r));
  assert.ok(u.cap.enc.hp < u.cap.enc.hpMax);
  // Falso Tortazo nunca lo debilita: se queda en 1 PS aunque pegue de sobra.
  u.cap.enc.hp = Math.min(u.cap.enc.hp, 9);
  for (let i = 0; i < 12 && u.cap.enc; i++) cap.attack(u, { ...ref(bulb, 1), move: 'falseswipe' }, DAYT, seq(0.5, 0.0, 0.99));
  assert.ok(u.cap.enc, 'Falso Tortazo no debilita');
  assert.strictEqual(u.cap.enc.hp, 1);
  // Dormir: ×2,5 y no huye mientras duerme.
  const e = u.cap.enc;
  const s = cap.attack(u, { ...ref(bulb, 1), move: 'sleeppowder' }, DAYT, seq(0.0, 0.0, 0.0)); // acierta y 3 turnos de sueño
  assert.strictEqual(e.status, 'slp');
  assert.ok(s.log.some((l) => /dormido/.test(l)));
  assert.strictEqual(cap.modifiedRate(e, 1), ((3 * e.hpMax - 2) * e.rate * cap.levelMod(e.level) * 2.5) / (3 * e.hpMax));
  const turn = e.turn;
  cap.attack(u, { ...ref(bulb, 1), move: 'falseswipe' }, DAYT, seq(0.5, 0.0, 0.0)); // rng=0 huiría, pero dormido no huye
  assert.ok(u.cap.enc && u.cap.enc.turn === turn + 1);
  // Un Pokémon dormido no recibe otro estado.
  const again = cap.attack(u, { ...ref(bulb, 1), move: 'toxic' }, DAYT, seq(0.9, 0.9, 0.9));
  assert.ok(again.log.some((l) => /ya tiene un problema/.test(l)));
  // Sin estado, el salvaje huye con probabilidad FLEE por turno.
  u.cap.enc.status = null;
  const f = cap.attack(u, { ...ref(bulb, 1), move: 'falseswipe' }, DAYT, seq(0.5, 0.0, 0.0, 0.0));
  assert.strictEqual(f.ended, 'fled');
  assert.strictEqual(u.cap.enc, null);
  assert.ok(u.cap.st.fled >= 1);
  // Paralizar con Onda Trueno; los Tierra son inmunes.
  setup(u, { id: 19, level: 12 });
  cap.attack(u, { ...ref(pika, 25), move: 'thunderwave' }, DAYT, seq(0.0, 0.99));
  assert.strictEqual(u.cap.enc.status, 'par');
  setup(u, { id: 74, level: 12 }); // Geodude (Roca/Tierra)
  const imm = cap.attack(u, { ...ref(pika, 25), move: 'thunderwave' }, DAYT, seq(0.99));
  assert.ok(imm.log.some((l) => /No afecta/.test(l)));
  assert.strictEqual(u.cap.enc.status, null);
  // Un ataque fuerte lo debilita: encuentro perdido.
  setup(u, { id: 19, level: 3, hp: 5 });
  const k = cap.attack(u, { ...ref(pika, 25), move: 'thunderbolt' }, DAYT, seq(0.0, 0.0));
  assert.strictEqual(k.ended, 'fainted');
  assert.strictEqual(u.cap.enc, null);
  assert.ok(u.cap.st.fainted >= 1);
  // Movimientos que no sirven (sin daño ni estado) no gastan turno.
  setup(u, { id: 19, level: 12 });
  bulb.sdMoves = ['growl', 'explosion'];
  assert.throws(() => cap.attack(u, { ...ref(bulb, 1), move: 'growl' }), /no sirve/);
  assert.throws(() => cap.attack(u, { ...ref(bulb, 1), move: 'explosion' }), /debilitaría/);
  // Un ejemplar fuera (expedición/criadero) no puede atacar.
  bulb.sdMoves = ['vinewhip'];
  bulb.away = 'care';
  assert.throws(() => cap.attack(u, { ...ref(bulb, 1), move: 'vinewhip' }), /fuera/);
  delete bulb.away;
});

test('lanzar: gasta la Ball, 1–3 sacudidas y escape, o captura con ejemplar real (Ball, IV, nivel, marca, tamaño)', () => {
  const u = user({ 1: { n: 1, s: 0 } });
  u.items['poke-ball'] = 2; u.items['ultra-ball'] = 1; u.items['master-ball'] = 1;
  assert.throws(() => cap.throwBall(u, { ball: 'poke-ball' }), /encuentro/);
  const e = setup(u, { id: 129, level: 6, hp: 100 });
  e.mark = 'rain'; e.size = 255; e.ivs = [31, 30, 29, 28, 27, 26]; e.nature = 'Audaz'; e.shiny = true;
  assert.throws(() => cap.throwBall(u, { ball: 'great-ball' }), /ninguna Super Ball/);
  assert.throws(() => cap.throwBall(u, { ball: 'bola' }), /no existe/);
  // Fallo: la Ball se gasta (y puede huir)
  const f = cap.throwBall(u, { ball: 'poke-ball' }, DAYT, seq(0.99, 0.99, 0.99, 0.99, 0.99, 0.99));
  assert.strictEqual(f.caught, false);
  assert.strictEqual(f.shakes, 0);
  assert.strictEqual(u.items['poke-ball'], 1);
  assert.ok(u.cap.enc.turn === 1);
  // Master Ball: captura segura.
  const before = u.collection[129];
  assert.strictEqual(before, undefined);
  const r = cap.throwBall(u, { ball: 'master-ball' }, DAYT, seq(0.99));
  assert.strictEqual(r.caught, true);
  assert.strictEqual(r.shakes, 3);
  assert.strictEqual(u.items['master-ball'], undefined);
  assert.strictEqual(u.cap.enc, null);
  assert.strictEqual(u.collection[129].n, 1);
  assert.strictEqual(u.collection[129].s, 1);
  const m = sp.sync(u, 129)[0];
  assert.strictEqual(m.ball, 'master-ball');
  assert.strictEqual(m.level, 6);
  assert.deepStrictEqual(m.ivs, [31, 30, 29, 28, 27, 26]);
  assert.strictEqual(m.nature, 'Audaz');
  assert.strictEqual(m.mark, 'rain');
  assert.strictEqual(m.size, 255);
  assert.strictEqual(m.shiny, true);
  assert.ok(m.learned.includes('splash') || m.learned.length >= 1);
  assert.strictEqual(m.exp, require('../server/exp').expAt(129, 6));
  assert.strictEqual(m.friendship, require('../server/catchdata.json').sp[129][1]);
  assert.strictEqual(r.got.ivTotal, 31 + 30 + 29 + 28 + 27 + 26);
  assert.strictEqual(r.got.sizeTitle, 'Jumbo');
  // Cuenta en la Pokédex como cualquier ejemplar y aparece en la Caja.
  assert.ok(sp.boxView(u).mons.some((x) => x.id === 129 && x.ball === 'master-ball' && x.mark === 'rain' && x.size === 255));
  // Amigo Ball: 150 de amistad; Lujo Ball: sube el cariño ×1,5.
  const e2 = setup(u, { id: 19, level: 3 });
  e2.rate = 255;
  u.items['friend-ball'] = 1;
  const r2 = cap.throwBall(u, { ball: 'friend-ball' }, DAYT, seq(0));
  assert.strictEqual(r2.caught, true); // ratio 255, nivel bajo, a ≥ 255
  assert.strictEqual(sp.sync(u, 19)[0].friendship, 150);
  const bond = require('../server/bond');
  const lux = { friendship: 70, ball: 'luxury-ball' };
  const plain = { friendship: 70 };
  bond.addFriend(lux, 10, 'feed');
  bond.addFriend(plain, 10, 'feed');
  assert.ok(lux.friendship > plain.friendship);
  // Con 5 estrellas la captura se convierte en polvo (como el Gacha).
  const u5 = user({ 19: { n: 5, s: 0 } });
  u5.items['poke-ball'] = 1;
  const e5 = setup(u5, { id: 19, level: 3 });
  e5.rate = 255;
  const r5 = cap.throwBall(u5, { ball: 'poke-ball' }, DAYT, seq(0));
  assert.strictEqual(r5.got.dust, RARITY[BY_ID.get(19).rarity].dust);
  assert.strictEqual(u5.collection[19].n, 5);
  assert.strictEqual(r5.got.uid, null);
});

test('legendarios: una sola captura por jugador; si escapan o se debilitan, otro día', () => {
  const ck = clock(DAYT);
  try {
    const u = user({ 1: { n: 1, s: 0 } });
    const L = Z.LEGENDS.find((l) => l.id === 144); // Articuno, en el Arroyo de Cabo Celeste
    const rng = seeded(4);
    u.items['master-ball'] = 2; u.items['ultra-ball'] = 30;
    assert.strictEqual(cap.legendStatus(u, L), 'locked');
    u.progress.badges = ['a', 'b', 'c', 'd', 'e'];
    assert.strictEqual(cap.legendStatus(u, L), 'ok');
    u.progress.badges = ['a'];
    assert.throws(() => cap.encounter(u, { zone: L.zone, legend: 144 }, Date.now(), rng), /5 medallas/);
    u.progress.badges = ['a', 'b', 'c', 'd', 'e'];
    assert.throws(() => cap.encounter(u, { zone: 'ruta1', legend: 144 }, Date.now(), rng), /no está en esta zona/);
    // Primer intento: se debilita (o escapa) → hoy no se puede repetir.
    cap.encounter(u, { zone: L.zone, legend: 144 }, Date.now(), rng);
    assert.strictEqual(u.cap.enc.id, 144);
    assert.strictEqual(u.cap.enc.level, 50);
    assert.strictEqual(u.cap.enc.rate, 3);
    assert.strictEqual(u.cap.enc.legend, true);
    cap.run(u);
    assert.strictEqual(cap.legendStatus(u, L), 'tried');
    assert.throws(() => cap.encounter(u, { zone: L.zone, legend: 144 }, Date.now(), rng), /hoy/);
    // Los legendarios no huyen: tras muchos turnos siguen ahí.
    ck.advance(24 * H);
    cap.encounter(u, { zone: L.zone, legend: 144 }, Date.now(), rng);
    for (let i = 0; i < 25; i++) { const r = cap.throwBall(u, { ball: 'ultra-ball' }, Date.now(), seq(0.999)); if (r.caught) break; assert.strictEqual(r.ended, null); }
    assert.ok(u.cap.enc, 'no ha huido');
    // Con la Master Ball se captura: ya no se puede volver a intentar nunca.
    const r = cap.throwBall(u, { ball: 'master-ball' });
    assert.strictEqual(r.caught, true);
    assert.strictEqual(u.collection[144].n, 1);
    assert.strictEqual(cap.legendStatus(u, L), 'got');
    ck.advance(24 * H);
    assert.throws(() => cap.encounter(u, { zone: L.zone, legend: 144 }, Date.now(), rng), /una vez/);
    assert.strictEqual(sp.sync(u, 144)[0].friendship, require('../server/catchdata.json').sp[144][1]);
    // Mewtwo exige 8 medallas y ser Campeón.
    const M = Z.LEGENDS.find((l) => l.id === 150);
    u.progress.badges = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    assert.strictEqual(cap.legendStatus(u, M), 'locked');
    u.elite = { clears: 1, hof: [{ at: 1 }], amulet: true, run: null };
    assert.strictEqual(cap.legendStatus(u, M), 'ok');
    // Se vuelve a poder intentar tras escapar o debilitarse (otro día).
    cap.encounter(u, { zone: M.zone, legend: 150 }, Date.now(), rng);
    const fe = u.cap.enc;
    assert.strictEqual(fe.level, 70);
    const mon = sp.sync(u, 1)[0];
    mon.sdMoves = ['earthquake'];
    u.cap.enc.hp = 1; u.cap.enc.status = null;
    mon.level = 100; mon.exp = require('../server/exp').expAt(1, 100);
    const k = cap.attack(u, { id: 1, uid: mon.uid, move: 'earthquake' }, Date.now(), seq(0, 0));
    assert.ok(['fainted'].includes(k.ended) || u.cap.enc, 'el debilitado se pierde');
    if (u.cap.enc) cap.run(u);
    assert.strictEqual(cap.legendStatus(u, M), 'tried');
    ck.advance(24 * H);
    assert.strictEqual(cap.legendStatus(u, M), 'ok');
  } finally { ck.restore(); }
});

test('Criadero: la Ball se hereda (madre, el que no es Ditto, o uno al azar si son iguales; Master → Poké)', () => {
  const B = balls;
  const mom = { ball: 'dusk-ball' };
  const dad = { ball: 'net-ball' };
  assert.strictEqual(B.inherit({ mother: mom, other: dad }, 0.1), 'dusk-ball');
  assert.strictEqual(B.inherit({ mother: mom, other: dad }, 0.9), 'dusk-ball'); // especies distintas: siempre la madre
  assert.strictEqual(B.inherit({ mother: mom, other: dad, sameSpecies: true }, 0.1), 'net-ball'); // misma especie: 50 %
  assert.strictEqual(B.inherit({ mother: mom, other: dad, sameSpecies: true }, 0.9), 'dusk-ball');
  assert.strictEqual(B.inherit({ mother: { ball: 'master-ball' }, other: dad }), 'poke-ball'); // la Master no se hereda
  assert.strictEqual(B.inherit({ mother: {}, other: dad }), 'poke-ball'); // sin Ball = Poké Ball
  // Flujo completo con el Criadero: Bulbasaur hembra en Ocaso Ball + Ditto (padre) → el bebé nace en Ocaso Ball.
  const ck = clock(Date.now());
  try {
    const u = user({ 1: { n: 1, s: 0 }, 132: { n: 1, s: 0 } });
    const bulb = u.mons[1][0];
    const ditto = u.mons[132][0];
    bulb.gender = 'F'; bulb.ball = 'dusk-ball';
    ditto.ball = 'ultra-ball'; // la del Ditto no cuenta
    care.deposit(u, { a: { id: 132, uid: ditto.uid }, b: { id: 1, uid: bulb.uid } });
    ck.advance(7 * H);
    u.coins = 10000;
    const v = care.collect(u, { slot: 0 });
    assert.strictEqual(v.eggs[0].ball, 'dusk-ball');
    const egg = u.daycare.eggs[0];
    egg.steps = egg.need; // listo para eclosionar
    const hv = care.hatch(u, { id: egg.id });
    assert.strictEqual(hv.hatched.ball, 'dusk-ball');
    const baby = sp.sync(u, 1).find((m) => m.uid === hv.hatched.uid);
    assert.strictEqual(baby.ball, 'dusk-ball');
    // Padre Ditto de otra manera: la madre es la del Ditto y el macho de la especie → la del que no es Ditto (el macho, aquí Bulbasaur ♂).
    const u2 = user({ 1: { n: 1, s: 0 }, 132: { n: 1, s: 0 } });
    const b2 = u2.mons[1][0]; const d2 = u2.mons[132][0];
    b2.gender = 'M'; b2.ball = 'friend-ball'; d2.ball = 'heal-ball';
    care.deposit(u2, { a: { id: 1, uid: b2.uid }, b: { id: 132, uid: d2.uid } });
    ck.advance(7 * H);
    care.collect(u2, { slot: 0 });
    assert.strictEqual(u2.daycare.eggs[0].ball, 'friend-ball');
    // Una Master Ball como Ball de la madre da un bebé en Poké Ball.
    const u3 = user({ 1: { n: 1, s: 0 }, 132: { n: 1, s: 0 } });
    const b3 = u3.mons[1][0]; const d3 = u3.mons[132][0];
    b3.gender = 'F'; b3.ball = 'master-ball';
    care.deposit(u3, { a: { id: 1, uid: b3.uid }, b: { id: 132, uid: d3.uid } });
    ck.advance(7 * H);
    care.collect(u3, { slot: 0 });
    assert.strictEqual(u3.daycare.eggs[0].ball, 'poke-ball');
  } finally { ck.restore(); }
});

// ---------------------------------------------------------------------------------------------------------------------------------
// ECONOMÍA: capturar nunca sale rentable. Capturar da un Pokémon (valor máximo = polvo de liberar × 4, o lo que dé un PNJ, que paga menos);
// cada captura cuesta, como mínimo, la Ball más barata que la consigue. El jugador ideal debilita gratis (los ataques no cuestan nada) hasta
// 1 PS y duerme al salvaje; aun así, el coste esperado por captura (precio de la Ball ÷ probabilidad) supera siempre el valor de reventa.
// ---------------------------------------------------------------------------------------------------------------------------------
// Probabilidad más favorable posible de capturar a `id` (nivel `level`) con cada Ball, para el jugador ideal.
function bestP(ballId, id, level, { owned = true } = {}) {
  const pk = BY_ID.get(id);
  const rate = cap.ratioOf(id);
  const hpMax = 300;
  const cm = 2.5; // 601+ especies registradas: el máximo de críticas
  const ctx = { night: true, turn: 10, types: pk.types, level, owned };
  const e = { hpMax, hp: 1, rate, level };
  if (ballId === 'quick-ball') {
    // Rápida: solo vale en el turno 1, o sea con los PS llenos y sin estado.
    return cap.probability(cap.modifiedRate({ ...e, hp: hpMax }, balls.bonus(ballId, { ...ctx, turn: 0 }), null), cm);
  }
  return cap.probability(cap.modifiedRate(e, balls.bonus(ballId, ctx), 'slp'), cm);
}
const cheapestCost = (id, level) => Math.min(...balls.IDS.filter((b) => b !== 'master-ball').map((b) => items.ITEMS[b].price / bestP(b, id, level)));

test('economía: valor de reventa < coste esperado de capturar, para cada especie y nivel de cada ruta', () => {
  let worst = { ratio: 0 };
  let checked = 0;
  for (const z of Z.ZONES) {
    for (const e of z.enc) {
      for (const level of [e.min, e.max]) {
        const value = cap.resaleValue(e.id, level);
        const cost = cheapestCost(e.id, level);
        assert.ok(value < cost, `${z.name}: ${BY_ID.get(e.id).name} nv. ${level} vale ${value.toFixed(1)} y cuesta ${cost.toFixed(1)}`);
        // Y sin las Balls caras, solo con Poké Balls (jugador sin Net/Nest/etc.).
        assert.ok(value < items.ITEMS['poke-ball'].price / bestP('poke-ball', e.id, level), `${BY_ID.get(e.id).name} con Poké Ball`);
        if (value / cost > worst.ratio) worst = { ratio: value / cost, name: BY_ID.get(e.id).name, level, value, cost };
        checked++;
      }
    }
  }
  assert.ok(checked > 100);
  assert.ok(worst.ratio < 0.9, `margen demasiado justo: ${JSON.stringify(worst)}`);
  // Legendarios: la reventa (polvo de un duplicado × 4) es una fracción de lo que cuestan las Balls necesarias.
  for (const l of Z.LEGENDS) {
    const value = cap.resaleValue(l.id, l.level);
    assert.ok(value < cheapestCost(l.id, l.level) / 2, `${BY_ID.get(l.id).name}: ${value} vs ${cheapestCost(l.id, l.level)}`);
  }
  // Chansey, Golbat y Primeape siguen en las tablas (valor directo del ejemplar; la evolución la acotan los topes diarios de EXP/amistad).
  const all = new Set(Z.ZONES.flatMap((z) => z.enc.map((e) => e.id)));
  for (const id of [113, 42, 57]) assert.ok(all.has(id), `falta ${id}`);
});

test('economía: simulación de 30 encuentros diarios con el jugador ideal pierde monedas en todas las zonas', () => {
  const rng = seeded(2026);
  const price = (b) => items.ITEMS[b].price;
  for (const z of Z.ZONES) {
    let spent = 0; let value = 0; let caught = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const e = cap.makeEncounter({}, z, i % 2 ? NIGHT : DAYT, rng);
      // Jugador ideal: PS a 1, dormido (se repite si despierta) y la Ball más barata que lo captura, con la cantidad que haga falta.
      e.hp = 1; e.status = 'slp';
      const ctxBest = ['poke-ball', 'net-ball', 'nest-ball', 'repeat-ball', 'dusk-ball']
        .map((b) => ({ b, a: cap.modifiedRate(e, balls.bonus(b, { night: i % 2 === 1, turn: 10, types: BY_ID.get(e.id).types, level: e.level, owned: true }), 'slp') }))
        .map((x) => ({ ...x, cost: price(x.b) / cap.probability(x.a, 2.5) })).sort((p, q) => p.cost - q.cost)[0];
      let done = false;
      while (!done) {
        spent += price(ctxBest.b);
        done = cap.roll(ctxBest.a, 2.5, rng).caught;
      }
      caught++;
      value += cap.resaleValue(e.id, e.level) * (e.shiny ? 3 : 1);
    }
    assert.ok(value < spent, `${z.name}: valor ${value} frente a ${spent} gastados`);
    assert.ok(value / spent < 0.9, `${z.name}: ${(value / spent).toFixed(2)}`);
    assert.strictEqual(caught, N);
  }
});

test('economía: capturar nunca da monedas, ni el Pokémon capturado vale más que su coste al liberarlo o transferirlo', () => {
  const u = user({ 1: { n: 1, s: 0 } });
  u.items['master-ball'] = 3;
  const coins = u.coins;
  const e = setup(u, { id: 129, level: 10 });
  cap.throwBall(u, { ball: 'master-ball' }, DAYT, seq(0));
  assert.strictEqual(u.coins, coins);
  assert.strictEqual(u.dust, 0);
  // Liberar el duplicado capturado da el polvo normal de su rareza (≤ 5 ✦ = 20 monedas), menos que cualquier Ball de la tienda.
  const dust = RARITY[BY_ID.get(129).rarity].dust;
  assert.ok(dust * gacha.DUST_RATE < items.ITEMS['poke-ball'].price);
  // El máximo teórico de un día (30 encuentros de la especie más valiosa de las rutas con la mejor Ball) sigue siendo pérdida.
  let top = 0; let cost = Infinity;
  for (const z of Z.ZONES) for (const x of z.enc) { top = Math.max(top, cap.resaleValue(x.id, x.max)); cost = Math.min(cost, cheapestCost(x.id, x.max)); }
  assert.ok(top < items.ITEMS['poke-ball'].price * 1.01 && cost >= items.ITEMS['poke-ball'].price);
  assert.ok(e); // el encuentro de prueba existía
});

test('cuentas nuevas: capturar no esquiva los topes de regalos ni de PNJ (los capturados son ejemplares normales)', () => {
  const transfer = require('../server/transfer');
  const u = user({ 1: { n: 1, s: 0 } });
  u.items['master-ball'] = 1;
  setup(u, { id: 19, level: 3 });
  cap.throwBall(u, { ball: 'master-ball' }, DAYT, seq(0));
  // Una cuenta nueva (nivel 1, creada hoy) sigue sin poder regalar lo capturado.
  u.createdAt = Date.now();
  assert.ok(transfer.young(u));
  assert.throws(() => transfer.canGift(u), /nivel/);
  // Y los PNJ solo compran a cuentas de más de 24 h y nivel 3: lo capturado no cambia nada.
  assert.ok(sp.sync(u, 19).length === 1);
});

test('vista y estáticos: el cliente recibe zonas, Balls y contadores sin revelar IV, naturaleza, tamaño ni marca del salvaje', () => {
  const u = user({ 1: { n: 1, s: 0 } });
  cap.encounter(u, { zone: 'ruta1' }, DAYT, seeded(3));
  const v = cap.view(u, DAYT);
  assert.strictEqual(v.max, 30);
  assert.strictEqual(v.used, 1);
  assert.ok(v.enc && !('ivs' in v.enc) && !('nature' in v.enc) && !('size' in v.enc) && !('mark' in v.enc));
  assert.strictEqual(v.zones.length, Z.ZONES.length);
  assert.strictEqual(v.zones.find((z) => z.id === 'cueva').locked, true);
  assert.strictEqual(v.zones.find((z) => z.id === 'ruta1').locked, false);
  assert.strictEqual(cap.STATIC.zones.length, Z.ZONES.length);
  assert.ok(cap.STATIC.legends.length === 4);
  assert.ok(balls.STATIC.order.includes('master-ball'));
  // Equipo para atacar: movimientos con datos, y los ejemplares fuera no aparecen.
  const t = cap.team(u);
  assert.ok(t.mons.length === 1 && t.mons[0].moves.length >= 1 && t.mons[0].moves.every((m) => m.name && m.type));
  u.mons[1][0].away = 'exp:x';
  assert.strictEqual(cap.team(u).mons.length, 0);
  // Los NPC no capturan.
  assert.throws(() => cap.encounter({ npc: true, cap: null }, { zone: 'ruta1' }), /NPC/);
});

test('traspaso: los rasgos del ejemplar (Ball, marca, tamaño, IV, naturaleza) viajan; nivel y EXP no', () => {
  const a = user({ 129: { n: 2, s: 0 } });
  const b = user({});
  const m = sp.sync(a, 129).find((x) => x) ;
  Object.assign(m, { ball: 'dusk-ball', mark: 'rare', size: 255, ivs: [31, 31, 31, 0, 0, 0], nature: 'Audaz', level: 40, caught: { zone: 'arroyo', level: 6, at: 1 } });
  m.fav = true; // el favorito se conserva: el que sale es el menos valioso, así que marcamos al otro
  const other = sp.sync(a, 129).find((x) => x !== m);
  other.level = 90; other.fav = true; other.ivs = [31, 31, 31, 31, 31, 31];
  const traits = sp.traitsOf(m);
  sp.syncAll(b);
  const before = new Set(sp.sync(b, 129).map((x) => x.uid));
  gacha.grant(b, 129, false);
  const got = sp.sync(b, 129).find((x) => !before.has(x.uid));
  sp.applyTraits(129, got, traits);
  assert.strictEqual(got.ball, 'dusk-ball');
  assert.strictEqual(got.mark, 'rare');
  assert.strictEqual(got.size, 255);
  assert.deepStrictEqual(got.ivs, [31, 31, 31, 0, 0, 0]);
  assert.strictEqual(got.nature, 'Audaz');
  assert.strictEqual(got.caught.zone, 'arroyo');
  assert.strictEqual(got.level, 5); // el nivel y la EXP no se transfieren
});
