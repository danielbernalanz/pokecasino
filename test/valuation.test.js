'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-val-'));

const db = require('../server/db');
const market = require('../server/market');
const npc = require('../server/npc');
const val = require('../server/valuation');
const transfer = require('../server/transfer');
const items = require('../server/items');

const DAY = 24 * 3600 * 1000;
function user(name, extra = {}) {
  const u = { id: 'id-' + name, username: name, coins: 5_000_000, dust: 0, buddy: null, items: {}, buffs: {}, games: {}, collection: {}, stats: {}, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 5, createdAt: Date.now() - 5 * DAY, ...extra };
  db.addUser(u);
  delete u.progress;
  return u;
}
npc.ensure();

test('valor estimado: nunca NaN ni negativo y cubre al menos el 90 % de los artículos comerciables', () => {
  const refs = val.allRefs();
  const nulls = [];
  let ok = 0;
  for (const ref of refs) {
    const e = val.estimate(ref);
    if (!e) { nulls.push(ref); continue; }
    assert.ok(e.value === null ? e.basis === 'PB' && e.pb > 0 : Number.isFinite(e.value) && e.value > 0, ref);
    assert.ok(typeof e.basis === 'string' && e.basis.length, ref);
    ok++;
  }
  for (const ref of refs) { const e = val.estimate(ref); if (e && e.value !== null) ok += 0; }
  const withValue = refs.filter((r) => { const e = val.estimate(r); return e && e.value !== null; }).length;
  assert.ok(withValue / refs.length >= 0.9, `cobertura ${(100 * withValue / refs.length).toFixed(1)} %`);
  // Los que dan null o solo PB son los de recompensas sin base en monedas.
  for (const ref of nulls) assert.match(ref, /^item:(tera-shard|shard-|exp-)/, ref);
  assert.strictEqual(val.estimate('item:tera-orb'), null);
  assert.strictEqual(val.estimate('basura'), null);
  assert.strictEqual(val.estimate({ kind: 'poke', pokeId: -5 }), null);
});

test('valor estimado: base coherente por tipo de artículo', () => {
  assert.deepStrictEqual(val.estimate('item:ticket'), { value: 150, basis: 'tienda' });
  assert.deepStrictEqual(val.estimate('item:poke-ball'), { value: 120, basis: 'tienda' });
  assert.deepStrictEqual(val.estimate('dust'), { value: 4, basis: 'polvo' });
  const tm = Object.entries(items.ITEMS).find(([, i]) => i.tm)[1];
  assert.strictEqual(val.estimate('item:' + Object.keys(items.ITEMS).find((k) => items.ITEMS[k] === tm)).basis, 'fabricación');
  assert.strictEqual(val.estimate('item:hi-lifeorb').basis, 'PB');
  assert.strictEqual(val.estimate('item:hi-lifeorb').pb, 48);
  const p = val.estimate('poke:150:0'), sh = val.estimate('poke:150:1');
  assert.strictEqual(p.basis, 'comerciantes');
  const b = npc.bounds(market.parseRef({ kind: 'poke', pokeId: 150, shiny: false }));
  assert.ok(p.value > b.cap && p.value < b.floor, 'punto medio');
  assert.ok(sh.value >= 3 * p.value * 0.9, 'el variocolor vale ≥ ~3 × (coherente con SHINY_ASK_DEFAULT)');
});

test('valor estimado: la escasez entre comerciantes lo acerca al suelo y la abundancia al tope', () => {
  for (const u of Object.values(db.data.users).filter((x) => x.npc)) u.collection = {};
  const scarce = val.estimate('poke:150:0').value;
  db.userById('npc-dorado').collection = { 150: { n: 5, s: 0 } };
  const plenty = val.estimate('poke:150:0').value;
  assert.ok(plenty < scarce);
  db.userById('npc-dorado').collection = {};
});

test('valor estimado: es informativo, no mueve los topes antiabuso ni los precios de los comerciantes', () => {
  const young = user('novato', { level: 1, createdAt: Date.now() });
  const a = market.parseRef({ kind: 'poke', pokeId: 150, shiny: false });
  const mb = transfer.maxBuyPrice(young, a);
  const bid = npc.bidPrice(a, npc.NPCS[1], undefined, { have: 1, r: 0.5 });
  const ask = npc.askPrice(a, npc.NPCS[1], undefined, { have: 1, r: 0.5 });
  val.all(); val.estimate('poke:150:0');
  assert.strictEqual(transfer.maxBuyPrice(young, a), mb);
  assert.strictEqual(npc.bidPrice(a, npc.NPCS[1], undefined, { have: 1, r: 0.5 }), bid);
  assert.strictEqual(npc.askPrice(a, npc.NPCS[1], undefined, { have: 1, r: 0.5 }), ask);
  // Ni el módulo de transfer ni el de precios de NPC lo importan.
  for (const f of ['transfer.js', 'npc.js']) assert.ok(!/valuation/.test(fs.readFileSync(path.join(__dirname, '../server', f), 'utf8')), f);
});

test('valor estimado: dos cuentas compinchadas no lo suben más de un 25 % sobre el suelo, y las cuentas nuevas no cuentan', () => {
  const a = { kind: 'poke', pokeId: 151, shiny: false };
  const ref = market.parseRef(a).ref;
  const bn = npc.bounds(market.parseRef(a));
  const s1 = user('colu1', { collection: { 151: { n: 5, s: 0 } } }), s2 = user('colu2', { collection: { 151: { n: 5, s: 0 } } });
  const b1 = user('colu3', { coins: 50_000_000 });
  const before = val.estimate(ref).value;
  for (const [s, price] of [[s1, 900_000], [s2, 950_000], [s1, 990_000]]) {
    try { market.sell(s, { ...a, qty: 1, price }); market.buy(b1, { ...a, qty: 1, price, instant: true }); } catch { /* sin cruce */ }
  }
  assert.ok(npc.reference(ref) > bn.floor * 10, 'la referencia de jugadores sí se dispara (dos vendedores, tres operaciones)');
  const e = val.estimate(ref);
  assert.strictEqual(e.basis, 'jugadores');
  assert.ok(e.value <= Math.ceil(val.BAND_UP * bn.floor), `valor ${e.value} ≤ ${val.BAND_UP} × suelo ${bn.floor}`);
  assert.ok(e.value >= before * 0 && Number.isFinite(e.value));
  // Cuentas nuevas: sus operaciones no son referencia.
  const n1 = user('nuevo1', { level: 1, createdAt: Date.now(), collection: { 149: { n: 5, s: 0 } } });
  const n2 = user('nuevo2', { level: 1, createdAt: Date.now(), collection: { 149: { n: 5, s: 0 } } });
  const nb = user('nuevo3', { level: 1, createdAt: Date.now() });
  for (const s of [n1, n2, n1, n2]) { try { market.sell(s, { kind: 'poke', pokeId: 149, shiny: false, qty: 1, price: 50 }); market.buy(nb, { kind: 'poke', pokeId: 149, shiny: false, qty: 1, price: 50, instant: true }); } catch { /* tope de cuenta nueva */ }
  }
  assert.strictEqual(npc.reference('poke:149:0'), null);
});
