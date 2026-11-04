'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-evoreq-'));

const db = require('../server/db');
const sp = require('../server/specimen');
const candy = require('../server/candy');
const items = require('../server/items');
const evoreq = require('../server/evoreq');
const daytime = require('../server/daytime');
const moves = require('../server/moves');
const npc = require('../server/npc');
const market = require('../server/market');
const { DEX, BY_ID } = require('../server/pokedex');

const byName = (n) => DEX.find((p) => p.name === n);
let n = 0;
function user(extra = {}) {
  const name = 'evr' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 100000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection: {}, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, ...extra };
  db.addUser(u);
  return u;
}
// Un ejemplar de `name` con sexo y caramelos de sobra.
function mon(name, { gender, friendship } = {}) {
  const p = byName(name);
  const u = user({ collection: { [p.id]: { n: 1, s: 0 } } });
  sp.syncAll(u);
  const m = u.mons[p.id][0];
  if (gender) m.gender = gender;
  if (friendship !== undefined) m.friendship = friendship;
  candy.addCandy(u, p.id, 500);
  return { u, m, p };
}
const clock = (iso) => { const real = Date.now; Date.now = () => Date.parse(iso); return () => { Date.now = real; }; };
const NIGHT = '2026-11-04T22:30:00Z'; // 23:30 en Madrid
const DAY = '2026-11-04T11:00:00Z'; // 12:00 en Madrid

test('reloj de España: día 06–21 y noche 21–06 (con cambio de hora)', () => {
  assert.strictEqual(daytime.phase(Date.parse('2026-11-04T04:59:00Z')), 'night'); // 05:59 en Madrid
  assert.strictEqual(daytime.phase(Date.parse('2026-11-04T05:00:00Z')), 'day'); // 06:00
  assert.strictEqual(daytime.clock(Date.parse('2026-11-04T05:00:00Z')).hour, 6);
  assert.strictEqual(daytime.phase(Date.parse('2026-11-04T19:59:00Z')), 'day'); // 20:59
  assert.strictEqual(daytime.phase(Date.parse('2026-11-04T20:00:00Z')), 'night'); // 21:00
  assert.strictEqual(daytime.phase(Date.parse('2026-07-04T18:59:00Z')), 'day'); // verano (UTC+2): 20:59
  assert.strictEqual(daytime.phase(Date.parse('2026-07-04T19:00:00Z')), 'night'); // 21:00
  assert.ok(daytime.msToChange(Date.parse('2026-11-04T11:00:00Z')) <= 9 * 3600e3 + 60e3);
});

test('Kirlia ♀ no puede ser Gallade; Kirlia ♂ con Piedra Alba sí y la gasta', () => {
  const gallade = byName('Gallade').id;
  const f = mon('Kirlia', { gender: 'F' });
  items.give(f.u, 'dawn-stone', 1);
  assert.throws(() => candy.evolve(f.u, { id: f.p.id, uid: f.m.uid, to: gallade }), /ser macho/);
  assert.strictEqual(f.u.items['dawn-stone'], 1, 'no se gasta si falla');
  const m = mon('Kirlia', { gender: 'M' });
  assert.throws(() => candy.evolve(m.u, { id: m.p.id, uid: m.m.uid, to: gallade }), /Piedra Alba/);
  items.give(m.u, 'dawn-stone', 1);
  const before = candy.candyOf(m.u, m.p.id);
  const r = candy.evolve(m.u, { id: m.p.id, uid: m.m.uid, to: gallade });
  assert.strictEqual(r.to, gallade);
  assert.strictEqual(m.u.items['dawn-stone'], undefined, 'Piedra Alba consumida');
  assert.strictEqual(candy.candyOf(m.u, m.p.id), before - r.cost, 'el coste en caramelos sigue siendo el normal');
  assert.strictEqual(m.u.mons[gallade][0].uid, m.m.uid);
  // Gardevoir sigue siendo solo por caramelos
  const g = mon('Kirlia', { gender: 'F' });
  assert.strictEqual(candy.evolve(g.u, { id: g.p.id, uid: g.m.uid, to: byName('Gardevoir').id }).to, byName('Gardevoir').id);
});

test('Snorunt ♀ + Piedra Alba → Froslass; ♂ no. Combee ♀ → Vespiquen, Burmy según sexo', () => {
  const froslass = byName('Froslass').id;
  const a = mon('Snorunt', { gender: 'M' }); items.give(a.u, 'dawn-stone', 1);
  assert.throws(() => candy.evolve(a.u, { id: a.p.id, uid: a.m.uid, to: froslass }), /ser hembra/);
  const b = mon('Snorunt', { gender: 'F' }); items.give(b.u, 'dawn-stone', 1);
  assert.strictEqual(candy.evolve(b.u, { id: b.p.id, uid: b.m.uid, to: froslass }).to, froslass);
  const c = mon('Combee', { gender: 'M' });
  assert.throws(() => candy.evolve(c.u, { id: c.p.id, uid: c.m.uid, to: byName('Vespiquen').id }), /ser hembra/);
  const d = mon('Burmy', { gender: 'M' });
  assert.throws(() => candy.evolve(d.u, { id: d.p.id, uid: d.m.uid, to: byName('Wormadam').id }), /ser hembra/);
  assert.strictEqual(candy.evolve(d.u, { id: d.p.id, uid: d.m.uid, to: byName('Mothim').id }).to, byName('Mothim').id);
});

test('piedras: Eevee necesita la piedra de cada Eeveelution (Hoja → Leafeon, Hielo → Glaceon)', () => {
  const e = mon('Eevee');
  for (const [name, stone] of [['Vaporeon', 'water-stone'], ['Jolteon', 'thunder-stone'], ['Flareon', 'fire-stone'], ['Leafeon', 'leaf-stone'], ['Glaceon', 'ice-stone']]) {
    const to = byName(name).id;
    assert.deepStrictEqual(evoreq.reqOf(to), { item: stone });
    assert.throws(() => candy.evolve(e.u, { id: e.p.id, uid: e.m.uid, to }), new RegExp(items.ITEMS[stone].name));
  }
  items.give(e.u, 'leaf-stone', 1);
  assert.strictEqual(candy.evolve(e.u, { id: e.p.id, uid: e.m.uid, to: byName('Leafeon').id }).to, byName('Leafeon').id);
  assert.strictEqual(e.u.items['leaf-stone'], undefined);
});

test('intercambio: Kadabra → Alakazam con Cordón Unión (se gasta) o con un intercambio real pendiente', () => {
  const alakazam = byName('Alakazam').id;
  const a = mon('Kadabra');
  assert.throws(() => candy.evolve(a.u, { id: a.p.id, uid: a.m.uid, to: alakazam }), /Cordón Unión/);
  items.give(a.u, evoreq.LINK, 2);
  candy.evolve(a.u, { id: a.p.id, uid: a.m.uid, to: alakazam });
  assert.strictEqual(a.u.items[evoreq.LINK], 1);
  // intercambio real: recibir un Pokémon de otro jugador da un pendiente (máx. 2 al día, 3 guardados)
  const b = mon('Haunter');
  const other = user();
  assert.strictEqual(evoreq.noteTrade(b.u, other), 1);
  assert.strictEqual(evoreq.noteTrade(b.u, other), 1);
  assert.strictEqual(evoreq.noteTrade(b.u, other), 0, '2 al día');
  assert.strictEqual(evoreq.noteTrade(b.u, b.u), 0, 'no se intercambia con uno mismo');
  assert.strictEqual(evoreq.noteTrade({ id: 'x', npc: true }, other), 0, 'los NPC no cuentan');
  candy.evolve(b.u, { id: b.p.id, uid: b.m.uid, to: byName('Gengar').id });
  assert.strictEqual(b.u.tradeTokens, 1);
  assert.strictEqual(b.u.items[evoreq.LINK], undefined, 'primero se gasta el pendiente, no el cordón');
});

test('intercambio con objeto: Onix → Steelix necesita Revestimiento Metálico y Cordón Unión', () => {
  const o = mon('Onix');
  const steelix = byName('Steelix').id;
  assert.deepStrictEqual(evoreq.reqOf(steelix), { trade: 1, item: 'metal-coat' });
  items.give(o.u, evoreq.LINK, 1);
  assert.throws(() => candy.evolve(o.u, { id: o.p.id, uid: o.m.uid, to: steelix }), /Revestimiento Metálico/);
  assert.strictEqual(o.u.items[evoreq.LINK], 1);
  items.give(o.u, 'metal-coat', 1);
  candy.evolve(o.u, { id: o.p.id, uid: o.m.uid, to: steelix });
  assert.ok(!o.u.items['metal-coat'] && !o.u.items[evoreq.LINK]);
});

test('Eevee → Espeon de día y Umbreon de noche, con amistad', () => {
  const espeon = byName('Espeon').id; const umbreon = byName('Umbreon').id;
  let restore = clock(NIGHT);
  try {
    const a = mon('Eevee', { friendship: 255 });
    assert.throws(() => candy.evolve(a.u, { id: a.p.id, uid: a.m.uid, to: espeon }), /de día/);
    assert.strictEqual(candy.evolve(a.u, { id: a.p.id, uid: a.m.uid, to: umbreon }).to, umbreon);
  } finally { restore(); }
  restore = clock(DAY);
  try {
    const b = mon('Eevee', { friendship: 255 });
    assert.throws(() => candy.evolve(b.u, { id: b.p.id, uid: b.m.uid, to: umbreon }), /de noche/);
    assert.strictEqual(candy.evolve(b.u, { id: b.p.id, uid: b.m.uid, to: espeon }).to, espeon);
    // sin amistad no hay Espeon aunque sea de día
    const c = mon('Eevee', { friendship: 100 });
    assert.throws(() => candy.evolve(c.u, { id: c.p.id, uid: c.m.uid, to: espeon }), /amistad/);
  } finally { restore(); }
});

test('Weavile: Garra Afilada y noche; Chansey: Piedra Oval y día', () => {
  const restore = clock(DAY);
  try {
    const s = mon('Sneasel'); items.give(s.u, 'razor-claw', 1);
    assert.throws(() => candy.evolve(s.u, { id: s.p.id, uid: s.m.uid, to: byName('Weavile').id }), /de noche/);
    const h = mon('Happiny'); items.give(h.u, 'oval-stone', 1);
    assert.strictEqual(candy.evolve(h.u, { id: h.p.id, uid: h.m.uid, to: byName('Chansey').id }).to, byName('Chansey').id);
  } finally { restore(); }
});

test('Tyrogue: Hitmonlee/Hitmonchan según Ataque y Defensa', () => {
  const t = mon('Tyrogue');
  const [lee, chan] = [byName('Hitmonlee').id, byName('Hitmonchan').id];
  const st = sp.computeStats(t.p.id, t.m);
  t.m.ivs[1] = 31; t.m.ivs[2] = 0; t.m.nature = 'Firme'; delete t.m.mint;
  assert.ok(sp.computeStats(t.p.id, t.m)[1] > sp.computeStats(t.p.id, t.m)[2], String(st));
  assert.throws(() => candy.evolve(t.u, { id: t.p.id, uid: t.m.uid, to: chan }), /menos Ataque/);
  assert.strictEqual(candy.evolve(t.u, { id: t.p.id, uid: t.m.uid, to: lee }).to, lee);
});

test('los costes en caramelos no cambian: las evoluciones sin requisito siguen igual', () => {
  const m = mon('Charmander');
  const before = candy.candyOf(m.u, m.p.id);
  const r = candy.evolve(m.u, { id: m.p.id, uid: m.m.uid, to: byName('Charmeleon').id });
  assert.strictEqual(r.cost, candy.evoCost(m.p.id, byName('Charmeleon').id, false, true).cost);
  assert.strictEqual(candy.candyOf(m.u, m.p.id), before - r.cost);
  assert.strictEqual(evoreq.reqOf(byName('Charmeleon').id), null);
});

test('datos: todos los objetos existen, cuestan 2.000/5.000, los movimientos se pueden aprender y los PNJ/reciclaje los ignoran', () => {
  const ids = new Set(Object.values(evoreq.DATA).map((r) => r.item).filter(Boolean));
  assert.ok(ids.size >= 30);
  for (const id of [...ids, evoreq.LINK]) {
    const it = items.ITEMS[id];
    assert.ok(it && it.evo && it.price > 0 && it.sprite, id);
    assert.ok([2000, 5000, 1500].includes(it.price), id);
  }
  for (const id of evoreq.STONES) assert.strictEqual(items.ITEMS[id].price, 2000);
  assert.strictEqual(items.ITEMS['dawn-stone'].name, 'Piedra Alba');
  assert.strictEqual(items.ITEMS['metal-coat'].name, 'Revestimiento Metálico');
  for (const [to, r] of Object.entries(evoreq.DATA)) {
    assert.ok(BY_ID.get(Number(to)).evolvesFrom, to);
    if (r.move) assert.ok(moves.levelMoves(BY_ID.get(Number(to)).evolvesFrom).some((x) => x.move === r.move) || moves.tmCompat(BY_ID.get(Number(to)).evolvesFrom, r.move) || moves.eggMoves(BY_ID.get(Number(to)).evolvesFrom).includes(r.move) || moves.tutorMoves(BY_ID.get(Number(to)).evolvesFrom).includes(r.move), `${to}: ${r.move}`);
  }
  for (const id of [...ids, evoreq.LINK]) {
    assert.strictEqual(candy.recycleValue(id), 0, 'no se reciclan');
    const a = market.parseRef({ kind: 'item', itemId: id });
    assert.ok(npc.bounds(a));
  }
});

test('Tienda: comprar una piedra cuesta 2.000 y sirve para evolucionar', () => {
  const m = mon('Vulpix');
  items.buy(m.u, { itemId: 'fire-stone', qty: 1 });
  assert.strictEqual(m.u.coins, 100000 - 2000);
  assert.strictEqual(candy.evolve(m.u, { id: m.p.id, uid: m.m.uid, to: byName('Ninetales').id }).to, byName('Ninetales').id);
});
