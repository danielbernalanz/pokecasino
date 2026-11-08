'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-export-'));

const db = require('../server/db');
const sp = require('../server/specimen');
const sd = require('../server/sdmap');
const showdown = require('../server/showdown');
const exp = require('../server/export');
const { BY_ID } = require('../server/pokedex');

let n = 0;
function user(extra = {}) {
  const name = 'exp' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 987654, dust: 321, hash: 'SECRETHASH', salt: 'SECRETSALT', ip: '203.0.113.9', token: 'SECRETTOKEN', buddy: null, items: { 'rare-candy': 7 }, buffs: { shinyCharges: 0 }, games: {}, collection: {}, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, ...extra };
  db.addUser(u);
  return u;
}

test('export de la caja: campos esperados y nada interno', () => {
  const other = user({ collection: { 133: { n: 1, s: 0 } } });
  sp.syncAll(other);
  const u = user({ collection: { 25: { n: 2, s: 1 }, 6: { n: 1, s: 0 } } });
  sp.syncAll(u);
  const m = u.mons[25][0];
  m.nick = 'Rayito'; m.fav = true; m.mint = 'Modesta'; m.hyper = [true, false, false, false, false, false];
  const r = exp.exportData(u, { what: 'box' });
  assert.strictEqual(r.format, 'pokecasino-export');
  assert.strictEqual(r.version, 1);
  assert.strictEqual(r.trainer.name, u.username);
  assert.match(r.trainer.tid, /^\d+$/);
  assert.ok(!Number.isNaN(Date.parse(r.exportedAt)));
  assert.strictEqual(r.box.length, 3);
  assert.strictEqual(r.team, undefined);
  const e = r.box.find((x) => x.id === m.uid);
  assert.strictEqual(e.species.id, 25);
  assert.strictEqual(e.species.name, BY_ID.get(25).name);
  assert.strictEqual(e.species.showdownId, 'pikachu');
  assert.strictEqual(e.nickname, 'Rayito');
  assert.strictEqual(e.favorite, true);
  assert.strictEqual(e.nature, m.nature);
  assert.strictEqual(e.mint, 'Modesta');
  assert.strictEqual(e.effectiveNature, 'Modesta');
  assert.strictEqual(e.level, 5);
  assert.deepStrictEqual(Object.keys(e.ivs), ['hp', 'atk', 'def', 'spa', 'spd', 'spe']);
  assert.deepStrictEqual(e.ivs, Object.fromEntries(['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map((s, i) => [s, m.ivs[i]])));
  assert.strictEqual(e.hyperTrained.hp, true);
  assert.ok(e.moves.length >= 1 && e.moves.every((x) => x.id && x.name));
  assert.ok(e.ability.id && e.ability.name);
  assert.strictEqual(typeof e.ability.hidden, 'boolean');
  assert.strictEqual(e.originalTrainer.tid, r.trainer.tid);
  assert.ok(e.ball.id && e.ball.name);
  assert.ok(e.teraType);
  assert.ok(typeof e.friendship === 'number' && typeof e.exp === 'number');
  assert.strictEqual(r.box.filter((x) => x.shiny).length, 1);
  const txt = JSON.stringify(r);
  for (const bad of ['SECRETHASH', 'SECRETSALT', 'SECRETTOKEN', '203.0.113.9', '987654', 'rare-candy', u.id, other.username, 'coins', 'password']) assert.ok(!txt.includes(bad), 'filtra ' + bad);
  JSON.parse(txt);
});

test('equipo guardado: JSON y texto de Showdown que Teams.import vuelve a leer', () => {
  const u = user({ collection: { 25: { n: 1, s: 0 }, 6: { n: 1, s: 0 }, 9: { n: 1, s: 0 }, 150: { n: 1, s: 0 } } });
  sp.syncAll(u);
  const refs = [25, 6, 9].map((id) => ({ id, uid: u.mons[id][0].uid, mega: 0 }));
  u.mons[25][0].nick = 'Chispa (!)'; // caracteres que romperían el formato
  showdown.saveTeam(u, { slot: 1, name: 'Mi equipo', members: refs });
  const r = exp.exportData(u, { what: 'team', team: 1 });
  assert.strictEqual(r.team.length, 3);
  assert.strictEqual(r.box, undefined);
  assert.strictEqual(r.teamName, 'Mi equipo');
  assert.deepStrictEqual(r.team.map((x) => x.species.id), [25, 6, 9]);
  const back = sd.ps().Teams.import(r.showdown);
  assert.strictEqual(back.length, 3);
  for (let i = 0; i < 3; i++) {
    const src = u.mons[refs[i].id][0];
    assert.strictEqual(sd.toID(back[i].species), r.team[i].species.showdownId);
    assert.deepStrictEqual(back[i].moves.map(sd.toID), src.sdMoves);
    assert.strictEqual(sd.toID(back[i].ability), src.sdAbility);
    assert.strictEqual(back[i].level, src.level);
    assert.strictEqual(back[i].nature, sd.NATURE_EN[sp.natureOf(src)]);
  }
  assert.ok(!back[0].name.includes('('));
  assert.throws(() => exp.exportData(u, { what: 'team', team: 2 }), /no existe/);
  assert.throws(() => exp.exportData(u, { what: 'team' }), /no existe/);
  assert.throws(() => exp.exportData(u, { what: 'x' }), /Elige/);
  const all = exp.exportData(u, { what: 'all' });
  assert.strictEqual(all.box.length, 4);
  assert.strictEqual(all.teams[0].slot, 1);
  assert.ok(all.teams[0].members.every((id) => all.box.some((b) => b.id === id)));
});

test('un jugador no puede exportar datos de otro', () => {
  const a = user({ collection: { 25: { n: 1, s: 0 } } });
  const b = user({ collection: { 6: { n: 1, s: 0 } } });
  sp.syncAll(a); sp.syncAll(b);
  showdown.saveTeam(a, { slot: 0, name: 'A', members: [{ id: 25, uid: a.mons[25][0].uid, mega: 0 }] });
  assert.throws(() => exp.exportData(b, { what: 'team', team: 0 }), /no existe/);
  const r = exp.exportData(b, { what: 'all' });
  assert.deepStrictEqual(r.box.map((x) => x.species.id), [6]);
  assert.ok(!JSON.stringify(r).includes(a.username));
});
