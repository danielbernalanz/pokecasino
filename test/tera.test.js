'use strict';
// Teracristalización: Teratipo por ejemplar, Orbe Teracristal (objeto clave), Teralitos, reglas por modo y una teracristalización real en el simulador.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-tera-'));

const db = require('../server/db');
const hub = require('../server/hub');
const sp = require('../server/specimen');
const sd = require('../server/sdmap');
const sdw = require('../server/showdown');
const items = require('../server/items');
const market = require('../server/market');
const npc = require('../server/npc');
const tera = require('../server/tera');
const { BY_ID, TYPES } = require('../server/pokedex');

let n = 0;
function user(collection = { 25: { n: 1, s: 0 } }, extra = {}) {
  const name = 'tera' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 1000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, createdAt: Date.now() - 9 * 864e5, ...extra };
  db.addUser(u);
  sp.syncAll(u);
  return u;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('waitFor: tiempo agotado'); await wait(10); } }
const asking = (side) => !!(side.req && !side.req.wait && !side.chosen);

test('Teratipo por defecto: uno de los tipos de la especie, estable y repartido; el elegido manda', () => {
  const dual = [3, 6, 12, 130]; // Venusaur, Charizard, Butterfree, Gyarados (doble tipo)
  for (const id of dual) {
    const seen = new Set();
    for (let i = 0; i < 80; i++) {
      const m = sp.make(id);
      const t = tera.teraOf(id, m);
      assert.ok(BY_ID.get(id).types.includes(t), `${id}: ${t}`);
      assert.strictEqual(tera.teraOf(id, m), t, 'estable');
      seen.add(t);
    }
    assert.strictEqual(seen.size, BY_ID.get(id).types.length, `${id}: salen los dos tipos`);
  }
  // Un solo tipo: siempre ese.
  assert.strictEqual(tera.teraOf(25, sp.make(25)), 'electric');
  assert.strictEqual(tera.teraOf(4, sp.make(4)), 'fire');
  // Un Teratipo guardado (Teralitos o jefe capturado) se respeta; uno inválido se ignora.
  const m = sp.make(25);
  m.tera = 'ghost';
  assert.strictEqual(tera.teraOf(25, m), 'ghost');
  m.tera = 'cosa';
  assert.strictEqual(tera.teraOf(25, m), 'electric');
  // Los regalos conservan el Teratipo elegido.
  const g = sp.make(25); g.tera = 'fairy';
  assert.strictEqual(sp.traitsOf(g).tera, 'fairy');
  const r = sp.make(25); sp.applyTraits(25, r, sp.traitsOf(g));
  assert.strictEqual(r.tera, 'fairy');
  // La ficha del PC lleva el Teratipo.
  const u = user({ 6: { n: 1, s: 0 } });
  assert.ok(BY_ID.get(6).types.includes(sp.boxView(u).mons[0].tera));
});

test('objetos: Orbe Teracristal (clave) y 18 Teralitos; el Orbe no se comercia ni se usa; los PNJ no comercian con ellos', () => {
  assert.ok(items.ITEMS[tera.ORB] && items.ITEMS[tera.ORB].key);
  assert.strictEqual(items.ITEMS[tera.ORB].price, null);
  for (const t of TYPES) {
    const it = items.ITEMS[tera.shardId(t)];
    assert.ok(it && it.teraShard && it.price === null, t);
    assert.strictEqual(it.sprite, `${t}-tera-shard`);
  }
  assert.strictEqual(Object.values(items.ITEMS).filter((i) => i.teraShard).length, 18);
  const holder = user(); holder.items[tera.ORB] = 1;
  assert.throws(() => market.sell(holder, { kind: 'item', itemId: tera.ORB, qty: 1, price: 100 }), /clave/);
  assert.throws(() => market.buy(holder, { kind: 'item', itemId: tera.ORB, qty: 1, price: 100 }), /clave/);
  assert.doesNotThrow(() => market.parseRef({ kind: 'item', itemId: tera.shardId('fire') })); // los Teralitos sí, entre jugadores
  for (const id of [tera.shardId('fire'), tera.ORB]) {
    const b = npc.bounds({ kind: 'item', itemId: id });
    assert.ok(b && b.floor >= 2 * b.cap);
    assert.strictEqual(npc.inFocus({ focus: { items: 'noshop', poke: [], cosmetics: false } }, { kind: 'item', itemId: id }), false, 'los PNJ no los comercian');
  }
  const u = user();
  u.items[tera.ORB] = 1;
  assert.throws(() => items.use(u, { itemId: tera.ORB }), /combate/);
  assert.throws(() => items.use(u, { itemId: tera.shardId('fire') }), /Caja PC/);
  assert.ok(!require('../server/candy').recycleList().some(([id]) => id === tera.ORB || id === tera.shardId('fire')), 'no se reciclan');
});

test('el Orbe Teracristal llega con la 1.ª medalla (también a quien ya la tenía), una sola vez', () => {
  const u = user();
  assert.strictEqual(tera.ensureOrb(u), false);
  assert.ok(!tera.hasOrb(u));
  u.progress.badges.push('roca');
  assert.strictEqual(hub.privateUser(u).items[tera.ORB], 1);
  assert.ok(tera.hasOrb(u));
  assert.strictEqual(tera.ensureOrb(u), false);
  assert.strictEqual(u.items[tera.ORB], 1);
  assert.strictEqual(tera.view(u).orb, true);
  // No se vuelve a dar si ya se entregó (aunque no esté en la mochila).
  delete u.items[tera.ORB];
  assert.strictEqual(tera.ensureOrb(u), false);
  assert.ok(!tera.ensureOrb({ npc: true, items: {}, progress: { badges: ['roca'] } }));
});

test('Teralitos: 50 del tipo cambian el Teratipo; no basta con menos, ni con el mismo tipo', () => {
  const u = user({ 25: { n: 1, s: 0 } });
  const m = u.mons[25][0];
  const id = 25;
  u.items[tera.shardId('water')] = 49;
  assert.throws(() => tera.setType(u, { id, uid: m.uid, type: 'water' }), /50/);
  assert.strictEqual(tera.teraOf(id, m), 'electric');
  u.items[tera.shardId('water')] = 120;
  assert.throws(() => tera.setType(u, { id, uid: m.uid, type: 'electric' }), /ya es/);
  assert.throws(() => tera.setType(u, { id, uid: m.uid, type: 'nada' }), /no válido/);
  const r = tera.setType(u, { id, uid: m.uid, type: 'water' });
  assert.strictEqual(r.tera, 'water');
  assert.strictEqual(m.tera, 'water');
  assert.strictEqual(u.items[tera.shardId('water')], 70);
  // El simulador recibe el Teratipo del ejemplar.
  const { set, roster } = sd.toSet(id, m, {});
  assert.strictEqual(set.teraType, 'Water');
  assert.strictEqual(roster.tera, 'water');
  assert.strictEqual(sd.toSet(6, sp.make(6), {}).set.teraType.toLowerCase().length > 2, true);
  // Un ejemplar fuera (expedición) no se toca.
  m.away = 'exp:1';
  assert.throws(() => tera.setType(u, { id, uid: m.uid, type: 'fire' }), /fuera/);
});

test('modos: Combates libres y PvP sí; líderes, Alto Mando, Torre y Clasificatoria no', () => {
  assert.strictEqual(tera.modeAllows({ mode: 'cpu', fixed: false }), true);
  assert.strictEqual(tera.modeAllows({ mode: 'pvp' }), true);
  assert.strictEqual(tera.modeAllows({ mode: 'cpu', fixed: true }), false, 'líderes y Alto Mando');
  assert.strictEqual(tera.modeAllows({ mode: 'cpu', elite: true }), false);
  assert.strictEqual(tera.modeAllows({ mode: 'cpu', tower: true }), false);
  assert.strictEqual(tera.modeAllows({ mode: 'pvp', ranked: true }), false);
  assert.strictEqual(tera.modeAllows({ mode: 'sim' }), false);
  assert.ok(/terastallize/.test(sdw.validChoice('move 1 terastallize') ? 'move 1 terastallize' : ''));
  assert.ok(sdw.validChoice('move 2 1 terastallize'));
  assert.ok(!sdw.validChoice('move 1 terastallize mega'));
});

test('teracristalizar de verdad: con Orbe el simulador lo hace una vez y la CPU nunca; sin Orbe se rechaza', async () => {
  const ids = [25, 6, 9];
  const mk = (orb) => {
    const u = user(Object.fromEntries(ids.map((i) => [i, { n: 1, s: 0 }])));
    if (orb) { u.progress.badges.push('roca'); tera.ensureOrb(u); }
    return u;
  };
  const team = (u) => ids.map((id) => ({ id, uid: u.mons[id][0].uid }));
  // Sin Orbe: el servidor rechaza la elección y la petición no ofrece Tera.
  const poor = mk(false);
  const v0 = sdw.startCpu(poor, { trainer: 'ramon', format: 'singles', level: 'fair', team: team(poor) });
  const b0 = sdw.battles.get(v0.battle.id);
  await waitFor(() => asking(b0.sides[0]));
  sdw.choose(poor, { id: b0.id, choice: 'team 123' });
  await waitFor(() => asking(b0.sides[0]) && b0.sides[0].req.active);
  assert.ok(!b0.sides[0].req.active[0].canTerastallize, 'sin Orbe no hay botón');
  assert.throws(() => sdw.choose(poor, { id: b0.id, choice: 'move 1 terastallize' }), /Orbe/);
  b0.forfeit(b0.sides[0]); await b0.done;
  // Con Orbe.
  const u = mk(true);
  assert.ok(tera.hasOrb(u));
  const v = sdw.startCpu(u, { trainer: 'ramon', format: 'singles', level: 'fair', team: team(u) });
  assert.strictEqual(v.battle.tera, true);
  const b = sdw.battles.get(v.battle.id);
  assert.strictEqual(b.tera, true);
  assert.ok(!b.inputLog[0].includes('Terastal Clause'), 'sin la cláusula del simulador');
  await waitFor(() => asking(b.sides[0]));
  sdw.choose(u, { id: b.id, choice: 'team 123' });
  await waitFor(() => asking(b.sides[0]) && b.sides[0].req.active);
  const lead = b.sides[0].roster.find((r) => r.name === b.sides[0].req.side.pokemon[0].ident.replace(/^p1: /, ''));
  assert.strictEqual(typeof b.sides[0].req.active[0].canTerastallize, 'string', 'el simulador ofrece Tera');
  assert.strictEqual(b.sides[0].req.active[0].canTerastallize.toLowerCase(), lead.tera, 'el Teratipo es el del ejemplar');
  sdw.choose(u, { id: b.id, choice: 'move 1 terastallize' });
  await waitFor(() => b.sides[0].log.some((l) => l.startsWith('|-terastallize|p1')));
  assert.ok(b.sides[0].log.some((l) => l.toLowerCase().includes('|-terastallize|p1a: ' + lead.name.toLowerCase() + '|' + lead.tera)));
  // Solo una vez por combate.
  await waitFor(() => asking(b.sides[0]) || b.over);
  if (!b.over) {
    assert.ok(!b.sides[0].req.active || !b.sides[0].req.active[0].canTerastallize, 'ya no puede otra vez');
  }
  // El snapshot guardado recuerda que se podía teracristalizar (para restaurar tras un reinicio).
  assert.strictEqual(b.snapshot().tr, 1);
  assert.ok(!b.sides[1].log.some((l) => l.startsWith('|-terastallize|p2')), 'la CPU nunca teracristaliza');
  b.forfeit(b.sides[1]);
  await b.done;
});

test('PvP: hace falta el Orbe en los dos y la opción activada; la clasificatoria nunca', async () => {
  const ids = [25, 6, 9];
  const mk = (orb) => {
    const u = user(Object.fromEntries(ids.map((i) => [i, { n: 1, s: 0 }])));
    if (orb) { u.progress.badges.push('roca'); tera.ensureOrb(u); }
    return u;
  };
  const team = (u) => ids.map((id) => ({ id, uid: u.mons[id][0].uid }));
  const play = async (a, bUser, opts) => {
    const c = sdw.challenge(a, { format: 'singles', level: 'fair', team: team(a), ...opts });
    const r = sdw.accept(bUser, { id: c.challenge, team: team(bUser) });
    const b = sdw.battles.get(r.battle.id);
    const out = { tera: b.tera, sidesTera: b.sides.map((s) => s.tera), clause: b.inputLog[0].includes('Terastal Clause') };
    b.forfeit(b.sides[0]); await b.done;
    return out;
  };
  const both = await play(mk(true), mk(true), {});
  assert.deepStrictEqual([both.tera, both.sidesTera, both.clause], [true, [true, true], false]);
  const one = await play(mk(true), mk(false), {});
  assert.deepStrictEqual([one.tera, one.sidesTera, one.clause], [false, [false, false], true], 'si uno no tiene Orbe, ninguno');
  const off = await play(mk(true), mk(true), { tera: false });
  assert.deepStrictEqual([off.tera, off.clause], [false, true], 'el retador puede desactivarlo');
  assert.throws(() => sdw.challenge(mk(true), { format: 'singles', level: 'fair', team: team(mk(true)), tera: 'sí' }), /no válida/);
});

test('reinicio del servidor: un combate teracristalizado se restaura igual (misma semilla, mismo registro, regla de Tera)', async () => {
  const ids = [25, 6, 9];
  const u = user(Object.fromEntries(ids.map((i) => [i, { n: 1, s: 0 }])));
  u.progress.badges.push('roca'); tera.ensureOrb(u);
  const v = sdw.startCpu(u, { trainer: 'ramon', format: 'singles', level: 'fair', team: ids.map((id) => ({ id, uid: u.mons[id][0].uid })) });
  const b = sdw.battles.get(v.battle.id);
  await waitFor(() => asking(b.sides[0]));
  sdw.choose(u, { id: b.id, choice: 'team 123' });
  await waitFor(() => asking(b.sides[0]) && b.sides[0].req.active);
  sdw.choose(u, { id: b.id, choice: 'move 1 terastallize' });
  await waitFor(() => b.sides[0].log.some((l) => l.startsWith('|-terastallize|p1')));
  await waitFor(() => asking(b.sides[0]) || b.over);
  const before = b.sides[0].log.filter((l) => l.startsWith('|-terastallize|')).length;
  sdw.refundAll(); sdw._dropMemory();
  db.data.sdBattles = JSON.parse(JSON.stringify(db.data.sdBattles));
  assert.strictEqual(await sdw.restoreAll(), 1);
  const b2 = sdw.battles.get(b.id);
  assert.ok(b2 && b2.tera === true && b2.sides[0].tera === true);
  assert.strictEqual(b2.sides[0].log.filter((l) => l.startsWith('|-terastallize|')).length, before, 'el registro se reconstruye idéntico');
  b2.forfeit(b2.sides[1]);
  await b2.done;
});
