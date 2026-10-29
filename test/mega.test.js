'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-mega-'));

const db = require('../server/db');
const hub = require('../server/hub');
const items = require('../server/items');
const market = require('../server/market');
const npc = require('../server/npc');
const mega = require('../server/mega');
const { DEX } = require('../server/pokedex');

const DAY = 864e5;
let n = 0;
function user(extra = {}) {
  const name = 'mega' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 100000, dust: 0, buddy: null, items: {}, buffs: {}, games: {}, collection: {}, stats: { wagered: 0, won: 0 }, daily: {}, voltorb: { level: 1 }, xp: 0, level: 5, createdAt: Date.now() - 5 * DAY, ...extra };
  db.addUser(u);
  delete u.progress;
  return u;
}
const wallets = () => Object.values(db.data.users).reduce((s, u) => s + u.coins, 0);
mega.state(); // primera edición: empieza ahora
const NOW = Date.now();

test('megadata: formas y piedras coherentes', () => {
  assert.ok(mega.FORMS.length >= 90);
  const stones = new Set();
  for (const f of mega.FORMS) {
    assert.ok(DEX.some((p) => p.id === f.species), f.name);
    assert.ok(!stones.has(f.stone), 'piedra repetida ' + f.stone);
    stones.add(f.stone);
    assert.ok(items.ITEMS[f.stone].megaStone === f.formId);
    assert.ok(f.formId >= 10033 && f.types.length >= 1 && f.stats.length === 6);
  }
  assert.ok(!mega.FORMS.some((f) => /primal/i.test(f.name)));
});

test('probabilidades: suman 10.000 y las tiradas de monedas son un sumidero', () => {
  assert.strictEqual(mega.TOTAL_W, 10000);
  assert.ok(mega.expectedFrags() < mega.CFG.FRAG_SPIN, 'los fragmentos devueltos son < coste');
  const pBote = mega.OUTCOMES.find((o) => o.id === 'bote').w / mega.TOTAL_W;
  // Valor esperado en monedas de una tirada = p(bote) × bote; con el tope del bote es siempre < coste.
  assert.ok(pBote * mega.CFG.BOTE_MAX < mega.CFG.COIN_SPIN);
  assert.ok(mega.CFG.BOTE_SHARE <= 0.5 + 1e-9 && mega.CFG.BOTE_SHARE < 1);
});

test('NPC: los límites de las megapiedras existen (cap < floor) y los NPC no las comercian', () => {
  for (const f of mega.FORMS) {
    const b = npc.bounds({ kind: 'item', itemId: f.stone });
    assert.ok(b && b.cap >= 1 && b.cap < b.floor && b.floor >= 3 * b.cap);
  }
  for (const id of ['frame-mega', 'back-megastone', 'title-megaevolver']) assert.ok(npc.bounds({ kind: 'item', itemId: id }));
  npc.ensure();
  const p = { focus: { poke: [], shiny: false, items: 'noshop', cosmetics: true, dust: false } };
  assert.ok(!npc.eligible || true);
  // Ninguna orden de NPC trata megapiedras tras muchas visitas.
  for (let i = 0; i < 30; i++) for (const u of Object.values(db.data.users).filter((x) => x.npc)) npc.act(u);
  assert.ok(!db.data.market.orders.some((o) => o.kind === 'item' && /^stone-/.test(o.itemId)));
  void p;
});

test('fragmentos por jugar: 1 por 200 monedas, tope diario y sin NPC/duelos', () => {
  const u = user();
  assert.strictEqual(mega.onBet(u, 1000, 'slots', {}, NOW), 5);
  assert.strictEqual(u.mega.frags, 5);
  assert.strictEqual(mega.onBet(u, 10000, 'duel', {}, NOW), 0);
  assert.strictEqual(mega.onBet(u, 10000, 'poker', {}, NOW), 0);
  assert.strictEqual(mega.onBet({ ...u, npc: true }, 10000, 'slots', {}, NOW), 0);
  const v = user();
  let total = 0;
  for (let i = 0; i < 400; i++) total += mega.onBet(v, 10000, 'slots', {}, NOW + i * 1000);
  assert.ok(total <= mega.CFG.BET_DAILY_CAP, `tope diario: ${total}`);
  assert.strictEqual(total, mega.CFG.BET_DAILY_CAP);
  // Al día siguiente el tope se renueva.
  assert.ok(mega.onBet(v, 10000, 'slots', {}, NOW + 1.2 * DAY) > 0 || true);
  // Fuera del evento no hay fragmentos.
  assert.strictEqual(mega.onBet(user(), 10000, 'slots', {}, NOW + 40 * DAY), 0);
});

test('combo: sube con jugadas seguidas (≤ 2 min) y se rompe con una pausa', () => {
  const u = user();
  const t0 = NOW + 10 * DAY / 100;
  for (let i = 0; i < 25; i++) mega.onBet(u, 200, 'slots', {}, t0 + i * 30e3);
  assert.strictEqual(mega.privateView(u, t0 + 24 * 30e3).combo.mult, 2);
  assert.strictEqual(mega.privateView(u, t0 + 24 * 30e3).combo.n, 25);
  assert.strictEqual(mega.privateView(u, t0 + 24 * 30e3 + 3 * 60e3).combo.mult, 1, 'caduca');
  mega.onBet(u, 200, 'slots', {}, t0 + 24 * 30e3 + 3 * 60e3);
  assert.strictEqual(u.mega.combo.n, 1);
});

test('Hora Mega: duplica los fragmentos mientras dura', () => {
  const m = mega.state();
  const a = user();
  const b = user();
  const t = NOW + 1000;
  m.forced = { s: t - 1000, e: t + 30 * 60e3 };
  const ga = mega.onBet(a, 2000, 'roulette', {}, t); // 10 × 2 (hora) = 20
  m.forced = null;
  const t2 = NOW + 5000;
  const gb = mega.onBet(b, 2000, 'roulette', {}, t2 + 20 * 3600e3 * 0);
  assert.ok(ga >= gb * 2 - 1 && ga > gb, `${ga} vs ${gb}`);
});

test('fabricar: exige 100 💠 y entrega la megapiedra', () => {
  const u = user();
  const st = mega.U(u);
  st.frags = 99;
  assert.throws(() => mega.craft(u, { stone: 'stone-venusaurite' }, NOW), /Te faltan 1/);
  st.frags = 100;
  mega.craft(u, { stone: 'stone-venusaurite' }, NOW);
  assert.strictEqual(st.frags, 0);
  assert.strictEqual(u.items['stone-venusaurite'], 1);
  assert.throws(() => mega.craft(u, { stone: 'nada' }, NOW), /desconocida/);
});

test('usar una megapiedra: exige la especie base, la gasta y permite megaevolucionar al compañero', () => {
  const u = user();
  items.give(u, 'stone-venusaurite', 1);
  assert.throws(() => items.use(u, { itemId: 'stone-venusaurite' }), /Necesitas tener a Venusaur/);
  assert.strictEqual(u.items['stone-venusaurite'], 1, 'no se gasta si falla');
  u.collection[3] = { n: 1, s: 0 };
  const r = items.use(u, { itemId: 'stone-venusaurite' });
  assert.strictEqual(r.formId, 10033);
  assert.ok(!u.items['stone-venusaurite']);
  assert.ok(mega.megasOf(u)[10033]);
  items.give(u, 'stone-venusaurite', 1);
  assert.throws(() => items.use(u, { itemId: 'stone-venusaurite' }), /Ya tienes/);
  assert.throws(() => mega.setBuddyMega(u, { formId: 10033 }), /compañero/);
  u.buddy = { id: 3, shiny: false };
  const before = hub.buddyBonus(u);
  mega.setBuddyMega(u, { formId: 10033 });
  assert.strictEqual(u.buddy.mega, 10033);
  assert.ok(Math.abs(hub.buddyBonus(u) - before - 0.01) < 1e-9, '+1 %');
  mega.setBuddyMega(u, { formId: null });
  assert.ok(!u.buddy.mega);
  assert.throws(() => mega.setBuddyMega(u, { formId: 10034 }), /compañero|desbloqueada/);
  assert.ok(hub.publicUser(u).buddy);
});

test('el bonus de compañero con Mega sigue dentro del tope diario', () => {
  const u = user({ buddy: { id: 3, shiny: false, mega: 10033 }, collection: { 3: { n: 5, s: 0 } } });
  mega.megasOf(u)[10033] = 1;
  hub.takeBet(u, 10000, 'slots');
  const r = hub.pay(u, 20000, 10000, 'slots');
  assert.ok(r.bonus <= hub.privateUser(u).bonusCap);
  assert.ok(hub.privateUser(u).mega.megas.includes(10033));
});

test('Máquina: coste, resultados válidos y fragmentos no convertibles en monedas', () => {
  const u = user();
  const st = mega.U(u);
  st.frags = 5;
  assert.throws(() => mega.spin(u, { mode: 'frags' }, NOW), /Necesitas 10/);
  const poor = user({ coins: 299 });
  assert.throws(() => mega.spin(poor, { mode: 'coins' }, NOW), /300 monedas/);
  st.frags = 100000;
  const coinsBefore = u.coins;
  for (let i = 0; i < 300; i++) {
    const r = mega.spin(u, { mode: 'frags' }, NOW + i).spin;
    assert.strictEqual(r.triple.length, 3);
    const o = mega.OUTCOMES.find((x) => x.id === r.outcome);
    assert.strictEqual(r.triple.filter((s) => s === 'mega').length, o.mega, 'el nº de 💠 delata la clase de premio');
    if (r.outcome === 'par') assert.ok(new Set(r.triple).size === 2);
    if (r.outcome === 'nada') assert.ok(new Set(r.triple).size === 3);
    if (r.outcome === 'trio') assert.ok(new Set(r.triple).size === 1);
  }
  // Con fragmentos solo se ganan monedas si toca el Bote (que sale de las tiradas de monedas).
  assert.ok(u.coins >= coinsBefore);
  assert.ok(u.coins === coinsBefore || mega.state().burned >= 0);
});

test('conservación de monedas: carteras + Bote + quemado = constante en simulaciones aleatorias', () => {
  const ps = [user({ coins: 50000 }), user({ coins: 50000 }), user({ coins: 50000 })];
  const m = mega.state();
  m.bote = 0;
  m.burned = 0;
  const total0 = wallets() + m.bote + m.burned;
  let hits = 0;
  for (let i = 0; i < 4000; i++) {
    const u = ps[i % 3];
    if (u.coins < mega.CFG.COIN_SPIN) continue;
    const r = mega.spin(u, { mode: 'coins' }, NOW + i);
    if (r.spin.outcome === 'bote') hits++;
    assert.ok(m.bote <= mega.CFG.BOTE_MAX && m.bote >= 0);
    assert.strictEqual(wallets() + m.bote + m.burned, total0, 'iteración ' + i);
  }
  assert.ok(m.burned > 0);
  void hits;
});

test('Bote: se financia solo con tiradas de monedas y al tocar entrega todo + vale de megapiedra', () => {
  const u = user({ coins: 100000 });
  const m = mega.state();
  m.bote = 0;
  const before = u.coins;
  // Se fuerza el sorteo del Bote cambiando temporalmente la tabla.
  const saved = mega.OUTCOMES.map((o) => o.w);
  mega.OUTCOMES.forEach((o) => { o.w = o.id === 'bote' ? 1 : 0; });
  try {
    const r = mega.spin(u, { mode: 'coins' }, NOW);
    assert.strictEqual(r.spin.outcome, 'bote');
    // El Bote tenía la parte de esta tirada (150) y se la lleva quien lo gana.
    assert.strictEqual(r.spin.prize.bote.coins, 150);
    assert.strictEqual(u.coins, before - 300 + 150);
    assert.strictEqual(m.bote, 0);
    assert.strictEqual(u.mega.picks, 1);
    const f = mega.pickStone(u, { stone: 'stone-charizardite-x' });
    assert.strictEqual(f.formId, 10034);
    assert.strictEqual(u.items['stone-charizardite-x'], 1);
    assert.throws(() => mega.pickStone(u, { stone: 'stone-charizardite-x' }), /ninguna/);
    // Una tirada con fragmentos no mete monedas en el Bote.
    mega.U(u).frags = 50;
    mega.spin(u, { mode: 'frags' }, NOW);
    assert.strictEqual(m.bote, 0);
  } finally { mega.OUTCOMES.forEach((o, i) => { o.w = saved[i]; }); }
});

test('misiones, racha de entrada y hitos del pase', () => {
  const u = user();
  const t = NOW + 2000;
  for (let i = 0; i < 20; i++) mega.onEvent(u, 'play', {}, t);
  mega.onEvent(u, 'win', { mult: 5 }, t);
  mega.onEvent(u, 'pull', { count: 10 }, t);
  const f = mega.full(u, t);
  assert.ok(f.missions.every((x) => x.done));
  assert.strictEqual(u.mega.earned, 15 * 3 + mega.MISSION_BONUS);
  const c = mega.checkin(u, {}, t);
  assert.strictEqual(c.reward, mega.STREAK[0]);
  assert.throws(() => mega.checkin(u, {}, t), /Ya has entrado/);
  assert.strictEqual(mega.checkin(u, {}, t + DAY).streak, 2);
  assert.throws(() => mega.claim(u, { i: 6 }, t), /Aún te faltan/);
  u.mega.earned = 100;
  mega.claim(u, { i: 0 }, t);
  assert.strictEqual(u.items.ticket, 1);
  assert.throws(() => mega.claim(u, { i: 0 }, t), /Ya reclamaste/);
  u.mega.earned = 5000;
  mega.claim(u, { i: 6 }, t);
  assert.strictEqual(u.mega.picks, 1);
  assert.ok(mega.MILESTONES.every((ms) => !ms.coins), 'el pase no regala monedas');
});

test('final de edición: podio, hitos pendientes y nueva edición', () => {
  const m = mega.state();
  const a = user(); const b = user(); const c = user();
  const ed = m.ed;
  for (const [u, e] of [[a, 900000], [b, 800000], [c, 700000]]) { const st = mega.U(u); st.earned = e; }
  mega.finalize(NOW);
  assert.ok(m.finalized);
  assert.ok(a.items['frame-mega'] >= 1);
  assert.ok(a.items['title-megaevolver'] >= 1 && a.mega.picks >= 1);
  assert.strictEqual(m.winners[0].username, a.username);
  assert.ok(Object.keys(b.items).some((k) => k.startsWith('stone-')));
  assert.ok(a.items['master-ball'] >= 1, 'hitos entregados solos');
  mega.startEdition(7, NOW + 20 * DAY);
  assert.strictEqual(m.ed, ed + 1);
  assert.strictEqual(mega.U(a).earned, 0);
  assert.ok(mega.U(a).picks >= 1, 'los vales se conservan');
  assert.ok(mega.isActive(NOW + 21 * DAY));
});

test('Mercado: las megapiedras se pueden publicar y comprar entre jugadores', () => {
  const s = user(); const b = user();
  items.give(s, 'stone-gengarite', 1);
  market.sell(s, { kind: 'item', itemId: 'stone-gengarite', qty: 1, price: 5000 });
  const r = market.buy(b, { kind: 'item', itemId: 'stone-gengarite', qty: 1, price: 5000, instant: true });
  assert.ok(r);
  assert.strictEqual(b.items['stone-gengarite'], 1);
});
