'use strict';
// Pokédex regionales y Diploma del Game Freak: una sola vez por región, sin monedas, con lo obtenido alguna vez.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-regions-'));

const db = require('../server/db');
const gacha = require('../server/gacha');
const items = require('../server/items');
const progress = require('../server/progress');
const regions = require('../server/regions');
const notify = require('../server/notify');
const { DEX } = require('../server/pokedex');

let n = 0;
function user(extra = {}) {
  const name = 'rg' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 10000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection: {}, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 5, createdAt: Date.now() - 9 * 864e5, ...extra };
  db.addUser(u);
  return u;
}
const idsOf = (name) => regions.BY_ID.get(name).ids;

test('las 9 regiones suman la Pokédex y tienen el tamaño de los juegos', () => {
  const sizes = Object.fromEntries(regions.REGIONS.map((r) => [r.id, r.ids.length]));
  assert.deepStrictEqual(sizes, { kanto: 151, johto: 100, hoenn: 135, sinnoh: 107, teselia: 156, kalos: 72, alola: 88, galar: 96, paldea: 120 });
  const all = regions.REGIONS.flatMap((r) => r.ids);
  assert.strictEqual(all.length, DEX.length);
  assert.strictEqual(new Set(all).size, DEX.length, 'ningún Pokémon en dos regiones');
  assert.deepStrictEqual([Math.min(...idsOf('kanto')), Math.max(...idsOf('kanto'))], [1, 151]);
  assert.deepStrictEqual([Math.min(...idsOf('johto')), Math.max(...idsOf('johto'))], [152, 251]);
  assert.strictEqual(Math.max(...idsOf('paldea')), 1025);
  for (const r of regions.REGIONS) { assert.ok(progress.TITLES[r.title], 'título ' + r.id); assert.ok(items.COSMETICS[r.frame], 'marco ' + r.id); }
});

test('completar Kanto da el diploma (título + marco) una sola vez, sin monedas, y no se pierde al liberar', () => {
  const u = user();
  const kanto = idsOf('kanto');
  for (const id of kanto.slice(0, 150)) gacha.grant(u, id, false);
  assert.strictEqual(regions.view(u)[0].have, 150);
  assert.ok(!u.dexDip.kanto && !u.progress.titles.includes('dex-kanto'), '150/151 no basta');
  const coins = u.coins;
  gacha.grant(u, kanto[150], false);
  assert.ok(u.dexDip.kanto > 0);
  assert.ok(u.progress.titles.includes('dex-kanto'));
  assert.strictEqual(progress.titleText('dex-kanto'), 'Diploma de Kanto');
  assert.strictEqual(u.items['frame-dex-kanto'], 1);
  assert.strictEqual(u.coins, coins, 'sin monedas');
  assert.ok(notify.list(u).list.some((x) => x.kind === 'dex' && /Kanto/.test(x.text)));
  // Una sola vez: liberar, volver a obtener o evaluar no lo repite.
  delete u.collection[kanto[0]];
  gacha.grant(u, kanto[0], false);
  progress.evaluate(u);
  regions.check(u);
  assert.strictEqual(u.items['frame-dex-kanto'], 1);
  assert.strictEqual(u.progress.titles.filter((t) => t === 'dex-kanto').length, 1);
  // Lo ya obtenido sigue contando aunque se haya liberado o regalado (dexSeen) y lo equipable se equipa.
  u.collection = {};
  assert.strictEqual(regions.view(u)[0].have, 151);
  items.equip(u, { slot: 'title', id: 'dex-kanto' });
  items.equip(u, { slot: 'frame', id: 'frame-dex-kanto' });
  assert.strictEqual(u.equip.title, 'dex-kanto');
  assert.strictEqual(u.equip.frame, 'frame-dex-kanto');
  assert.strictEqual(regions.view(u)[1].diploma, 0, 'las demás regiones no se tocan');
});

test('cuentas antiguas: una Pokédex ya completa recibe el diploma al evaluar; lo con candado y lo visto también cuentan', () => {
  const ids = idsOf('kalos');
  const u = user({ collection: Object.fromEntries(ids.slice(0, 40).map((id) => [id, { n: 1, s: 0 }])), locked: Object.fromEntries(ids.slice(40, 60).map((id) => [id, { n: 1, s: 0 }])), dexSeen: Object.fromEntries(ids.slice(60).map((id) => [id, 1])) });
  assert.strictEqual(regions.view(u)[5].have, 72);
  assert.strictEqual(u.items['frame-dex-kalos'], undefined);
  progress.evaluate(u);
  assert.strictEqual(u.items['frame-dex-kalos'], 1);
  assert.ok(u.progress.titles.includes('dex-kalos'));
  progress.evaluate(u);
  assert.strictEqual(u.items['frame-dex-kalos'], 1);
  // los demás: progreso parcial, sin diploma
  assert.ok(regions.view(u).filter((r) => r.id !== 'kalos').every((r) => !r.diploma && r.have === 0));
});

test('los comerciantes NPC no reciben diplomas y el cliente recibe las regiones en el estado privado', () => {
  const npc = user({ npc: true });
  for (const id of idsOf('alola')) npc.collection[id] = { n: 1, s: 0 };
  regions.check(npc);
  assert.ok(!npc.dexDip || !npc.dexDip.alola);
  const hub = require('../server/hub');
  const u = user();
  const me = hub.privateUser(u);
  assert.strictEqual(me.dexReg.length, 9);
  assert.deepStrictEqual(me.dexReg[0], { id: 'kanto', name: 'Kanto', gen: 1, total: 151, have: 0, diploma: 0 });
});
