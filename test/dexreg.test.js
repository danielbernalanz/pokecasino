'use strict';
// Registro permanente de la Pokédex (server/dexreg.js): tres estados (none → seen → caught), permanencia, candado, migración y contadores.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-dexreg-'));

const db = require('../server/db');
const hub = require('../server/hub');
const gacha = require('../server/gacha');
const sp = require('../server/specimen');
const candy = require('../server/candy');
const gts = require('../server/gts');
const dex = require('../server/dexreg');
const regions = require('../server/regions');
const progress = require('../server/progress');
const items = require('../server/items');
const fixes = require('../server/fixes');
const sdw = require('../server/showdown');
const trainers = require('../server/trainers');
const cap = require('../server/capture');
const { Brain } = require('../server/sdai');
const { DEX, BY_ID } = require('../server/pokedex');

let n = 0;
function user(extra = {}) {
  const name = 'dx' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 100000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection: {}, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, createdAt: Date.now() - 9 * 864e5, ...extra };
  db.addUser(u);
  return u;
}
const byName = (name) => DEX.find((p) => p.name === name);
const DEINO = byName('Deino').id; const ZWEI = byName('Zweilous').id; const HYDREIGON = byName('Hydreigon').id;

test('tres estados: none → seen → caught; obtener implica visto', () => {
  const u = user();
  assert.strictEqual(dex.status(u, 25), 'none');
  dex.markSeen(u, 25);
  assert.strictEqual(dex.status(u, 25), 'seen');
  assert.strictEqual(dex.caught(u, 25), false);
  gacha.grant(u, 25, false);
  assert.strictEqual(dex.status(u, 25), 'caught');
  gacha.grant(u, 133, false);
  assert.ok(u.dexSeen[133] && u.dexCaught[133], 'obtenido marca también visto');
  // Los PNJ no tienen Pokédex.
  const v = user({ npc: true });
  dex.markCaught(v, 25); gacha.grant(v, 25, false);
  assert.ok(!v.dexCaught && !v.dexSeen);
});

test('evolucionar el último ejemplar: se transforma, sin copia gratis, y la especie origen sigue obtenida', () => {
  const u = user({ collection: { [DEINO]: { n: 1, s: 0 }, [ZWEI]: { n: 1, s: 0 } } });
  sp.syncAll(u);
  dex.migrate(u);
  const m = u.mons[DEINO][0];
  m.level = candy.evoLevel(ZWEI);
  m.nick = 'Dino';
  const total = () => Object.values(u.collection).reduce((s, c) => s + c.n, 0);
  assert.strictEqual(total(), 2);
  candy.evolve(u, { id: DEINO, uid: m.uid, to: ZWEI });
  assert.ok(!u.collection[DEINO] && !u.mons[DEINO], 'ya no tienes Deino');
  assert.strictEqual(u.collection[ZWEI].n, 2);
  assert.strictEqual(total(), 2, 'la cantidad total de ejemplares no crece');
  assert.strictEqual(dex.status(u, DEINO), 'caught', 'Deino sigue registrado');
  assert.strictEqual(u.mons[ZWEI].find((x) => x.uid === m.uid).nick, 'Dino', 'conserva el mote');
  assert.ok(!u.evoReg, 'sin registro de primeras evoluciones');
});

test('el registro nunca baja: evolucionar, transferir, liberar, regalar/vender y GTS', () => {
  const u = user({ level: 5, collection: { 1: { n: 1, s: 0 }, 4: { n: 1, s: 0 }, 7: { n: 1, s: 0 }, 10: { n: 1, s: 0 }, 13: { n: 1, s: 0 } } });
  sp.syncAll(u); dex.migrate(u);
  const before = [...dex.caughtSet(u)].sort();
  candy.transfer(u, { id: 1, uid: u.mons[1][0].uid });
  sp.release(u, { id: 4, uid: u.mons[4][0].uid });
  gacha.takePoke(u, 7, false); // regalo / Mercado
  u.mons[10][0].level = 100; u.mons[10][0].exp = require('../server/exp').expAt(10, 100);
  const mv = u.mons[13][0];
  gts.deposit(u, { id: 13, uid: mv.uid, want: { id: 13, g: 'any', lv: 0 } }); // (el depósito saca el ejemplar de la Caja)
  for (const id of [1, 4, 7, 13]) assert.ok(!u.collection[id], 'ya no está en la Caja: ' + id);
  assert.deepStrictEqual([...dex.caughtSet(u)].sort(), before, 'los cinco siguen obtenidos');
  assert.strictEqual(dex.caughtCount(u), 5);
});

test('candado: lo bloqueado no cuenta como obtenido mientras tenga candado y vuelve a contar al recuperarlo', () => {
  const u = user({ collection: { 25: { n: 1, s: 0 }, 150: { n: 1, s: 0 } } });
  sp.syncAll(u); dex.migrate(u);
  require('../server/locked').lock(u, 150);
  assert.strictEqual(dex.status(u, 150), 'seen', 'con candado: visto pero no obtenido');
  assert.strictEqual(dex.caughtCount(u), 1);
  assert.strictEqual(hub.publicUser(u).dex, 1, 'ranking/perfil público por obtenidos');
  // La migración no registra lo que está con candado, aunque conste en dexSeen o en una colección completada.
  const v = user({ collection: { 25: { n: 1, s: 0 } }, locked: { 150: { n: 1, s: 0 } }, dexSeen: { 150: 1, 151: 1 } });
  dex.migrate(v);
  assert.ok(!(v.dexCaught && v.dexCaught[150]), 'candado no se rellena');
  assert.ok(v.dexCaught[151] && v.dexCaught[25]);
  assert.strictEqual(dex.status(v, 150), 'seen');
  // Recuperar la especie (sale en el gacha): vuelve a contar.
  gacha.grant(v, 150, false, { unlock: true });
  assert.strictEqual(dex.status(v, 150), 'caught');
  assert.ok(v.collection[150] && !v.locked[150]);
});

test('migración: idempotente, rellena con lo que se tiene, evoReg, dexSeen y colecciones completadas', () => {
  const set = progress.SETS[0];
  const u = user({ collection: { 25: { n: 2, s: 0 } }, evoReg: { 26: 1 }, dexSeen: { 133: 1 }, progress: { ...require('../server/auth').newProgress?.() } });
  u.progress = u.progress && u.progress.sets ? u.progress : { badges: [], titles: [], sets: [set.id], tutorial: 0, tutProg: 0, counters: {}, daily: { missions: [] } };
  u.progress.sets = [set.id];
  const added = dex.migrate(u);
  assert.ok(added >= 3 + set.ids.length - 1);
  for (const id of [25, 26, 133, ...set.ids]) assert.ok(dex.caught(u, id), String(id));
  const snap = JSON.stringify([u.dexCaught, u.dexSeen]);
  assert.strictEqual(dex.migrate(u), 0);
  assert.strictEqual(JSON.stringify([u.dexCaught, u.dexSeen]), snap, 'idempotente');
  // La corrección de arranque se aplica una sola vez.
  const fix = fixes.FIXES.find((f) => f.id.startsWith('pokedex-registro'));
  assert.ok(fix);
  const w = user({ collection: { 1: { n: 1, s: 0 } } });
  fix.apply();
  assert.ok(w.dexCaught[1]);
  const again = fix.apply();
  assert.ok(/^0 /.test(again[0]), again[0]);
});

test('colecciones, regionales y ranking cuentan el registro, no las copias actuales', () => {
  const s = progress.SETS[0];
  const u = user();
  u.progress = { badges: [], titles: [], sets: [], tutorial: 0, tutProg: 0, counters: {}, daily: { missions: [] } };
  for (const id of s.ids) gacha.grant(u, id, false);
  progress.evaluate(u);
  sp.syncAll(u);
  assert.ok(u.progress.sets.includes(s.id), 'colección completada');
  // Se transfieren todos: la colección sigue completa y el progreso sigue en n/n.
  for (const id of s.ids) candy.transfer(u, { id, uid: u.mons[id][0].uid });
  assert.strictEqual(Object.keys(u.collection).length, 0);
  assert.strictEqual(progress.view(u).sets.find((x) => x.id === s.id).have, s.ids.length);
  assert.strictEqual(dex.caughtCount(u), s.ids.length);
  assert.strictEqual(hub.publicUser(u).dex, s.ids.length);
  const reg = regions.view(u).find((r) => r.id === 'kanto');
  assert.strictEqual(reg.have, s.ids.filter((id) => BY_ID.get(id).gen === 1).length);
});

test('contadores coherentes: vistos ≥ obtenidos y vistos + no vistos = total; «faltan» = total − obtenidos', () => {
  const u = user({ collection: { 25: { n: 1, s: 0 } }, locked: { 150: { n: 1, s: 0 } } });
  dex.migrate(u);
  dex.markSeen(u, 1); dex.markSeen(u, 4); gacha.grant(u, 7, false);
  const v = dex.view(u);
  const total = DEX.length;
  assert.ok(v.seen.length >= v.caught.length);
  assert.ok(v.caught.every((id) => v.seen.includes(id)), 'obtenido implica visto');
  const none = DEX.filter((p) => dex.status(u, p.id) === 'none').length;
  assert.strictEqual(v.seen.length + none, total);
  const missing = DEX.filter((p) => dex.status(u, p.id) !== 'caught').length;
  assert.strictEqual(missing, total - v.caught.length);
  assert.deepStrictEqual(hub.privateUser(u).dex, v);
});

test('GTS: solo se puede pedir lo visto (ver un depósito no lo registra); lo visto en combate vale', () => {
  const u = user({ level: 5, collection: { 25: { n: 1, s: 0 } } });
  sp.syncAll(u); dex.migrate(u);
  assert.throws(() => gts.deposit(u, { id: 25, uid: u.mons[25][0].uid, want: { id: 151, g: 'any', lv: 0 } }), /has visto/);
  assert.strictEqual(dex.status(u, 151), 'none', 'pedirlo no lo registra');
  dex.markSeen(u, 151);
  const r = gts.deposit(u, { id: 25, uid: u.mons[25][0].uid, want: { id: 151, g: 'any', lv: 0 } });
  assert.ok(r.dep);
  assert.strictEqual(dex.status(u, 151), 'seen');
});

test('visto: encuentro salvaje y rival en combate; obtenido: captura', async () => {
  const u = user({ collection: { 25: { n: 1, s: 0 } } });
  sp.syncAll(u); dex.migrate(u);
  const seen0 = dex.seenSet(u).size;
  cap.encounter(u, { zone: 'ruta1' });
  assert.strictEqual(dex.seenSet(u).size, seen0 + (dex.seenSet(u).has(25) && cap.view(u).enc.id === 25 ? 0 : 1), 'el salvaje que aparece queda visto');
  const wild = cap.view(u).enc.id;
  assert.strictEqual(dex.status(u, wild), wild === 25 ? 'caught' : 'seen', 'visto, no obtenido');
  // Combate contra un líder: los Pokémon del rival que salen al campo quedan vistos.
  const STRONG = [150, 149, 248, 373, 445, 474];
  const p = user({ collection: Object.fromEntries(STRONG.map((i) => [i, { n: 1, s: 0 }])) });
  sp.syncAll(p);
  for (const i of STRONG) { const m = p.mons[i][0]; m.level = 100; m.exp = 0; require('../server/exp').ensure(i, m); }
  const brock = trainers.BY_TRAINER.get('brock').team.map(([i]) => i);
  assert.ok(brock.every((i) => dex.status(p, i) === 'none'));
  const v = sdw.startCpu(p, { trainer: 'brock', format: 'singles', level: 'real', team: STRONG.map((i) => ({ id: i, uid: p.mons[i][0].uid })) });
  const b = sdw.battles.get((v.battle || v).id);
  const br = new Brain('p1');
  let seen = 0; const t0 = Date.now();
  while (!b.finished && Date.now() - t0 < 60000) {
    const side = b.sides[0];
    if (side.log.length > seen) { br.feed(side.log.slice(seen)); seen = side.log.length; }
    if (side.req && !side.req.wait && !side.chosen && !b.over) { try { sdw.choose(p, { id: b.id, choice: br.decide(side.req) || 'default' }); } catch { /* ya elegido */ } }
    await new Promise((r) => setTimeout(r, 10));
  }
  await b.done;
  assert.ok(brock.some((i) => dex.status(p, i) === 'seen'), 'el rival visto en combate');
  assert.ok(brock.every((i) => dex.status(p, i) !== 'caught'), 'verlo no es obtenerlo');
});

test('Piedra Eterna: bloquea la evolución natural (nivel, intercambio), no las piedras', () => {
  const charm = byName('Charmander').id; const charme = byName('Charmeleon').id;
  const u = user({ collection: { [charm]: { n: 1, s: 0 }, 25: { n: 1, s: 0 } }, items: { 'hi-everstone': 1, 'thunder-stone': 1 } });
  sp.syncAll(u);
  const m = u.mons[charm][0];
  m.level = 20;
  require('../server/bp').hold(u, { id: charm, uid: m.uid, item: 'everstone' });
  assert.strictEqual(m.item, 'everstone');
  assert.throws(() => candy.evolve(u, { id: charm, uid: m.uid, to: charme }), /Piedra Eterna/);
  assert.deepStrictEqual(candy.canEvolveTo(u, m, charm), []);
  require('../server/bp').hold(u, { id: charm, uid: m.uid, item: '' });
  candy.evolve(u, { id: charm, uid: m.uid, to: charme });
  assert.ok(u.collection[charme]);
  // Piedra evolutiva con Piedra Eterna equipada: sí evoluciona (se usa sobre el Pokémon).
  u.items['hi-everstone'] = 1;
  const pika = u.mons[25][0];
  require('../server/bp').hold(u, { id: 25, uid: pika.uid, item: 'everstone' });
  candy.evolve(u, { id: 25, uid: pika.uid, to: 26 });
  assert.ok(u.collection[26]);
  assert.ok(items.ITEMS['hi-everstone'].price === 1800 && items.ITEMS['hi-everstone'].held === 'everstone');
});

test('al evolucionar el Teratipo del ejemplar no cambia aunque cambien sus tipos', () => {
  const tera = require('../server/tera');
  const charm = byName('Charmander').id; const charme = byName('Charmeleon').id;
  const bulb = byName('Bulbasaur').id; const ivy = byName('Ivysaur').id;
  for (const [a, b] of [[bulb, ivy], [charm, charme]]) {
    const u = user({ collection: { [a]: { n: 1, s: 0 } } });
    sp.syncAll(u);
    const m = u.mons[a][0]; m.level = 40;
    const t0 = tera.teraOf(a, m);
    candy.evolve(u, { id: a, uid: m.uid, to: b });
    assert.strictEqual(tera.teraOf(b, u.mons[b][0]), t0);
  }
});

test('las estrellas de Caramelo Raro siguen necesitando una copia real (no se transfiere ni evoluciona la última)', () => {
  const charm = byName('Charmander').id; const charme = byName('Charmeleon').id;
  const u = user({ collection: { [charm]: { n: 3, s: 0, cn: 2 } } });
  sp.syncAll(u);
  u.mons[charm][0].level = 30;
  assert.throws(() => candy.evolve(u, { id: charm, uid: u.mons[charm][0].uid, to: charme }), /Caramelo Raro/);
  assert.throws(() => candy.transfer(u, { id: charm, uid: u.mons[charm][0].uid }), /Caramelo Raro/);
});
