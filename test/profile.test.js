'use strict';
// Ficha pública (sin datos privados) y centro de notificaciones (persistentes, con tope, leídas/borrar) con sus orígenes.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-profile-'));

const db = require('../server/db');
const sp = require('../server/specimen');
const gts = require('../server/gts');
const progress = require('../server/progress');
const gacha = require('../server/gacha');
const profile = require('../server/profile');
const notify = require('../server/notify');
const regions = require('../server/regions');
const { BY_ID } = require('../server/pokedex');

let n = 0;
function user(extra = {}) {
  const name = 'pf' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 987654321, dust: 424242, buddy: null, items: { 'rare-candy': 31337 }, buffs: { shinyCharges: 0 }, games: {}, collection: {}, stats: { pulls: 7, wagered: 0, won: 0, biggestWin: 0, duelsWon: 3, duelsLost: 1 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 5, createdAt: Date.now() - 9 * 864e5, ip: 'SECRET-IP-1.2.3.4', salt: 'SECRETSALT', hash: 'SECRETHASH', ...extra };
  db.addUser(u);
  return u;
}
const COMMON = [...BY_ID.values()].filter((p) => p.rarity === 'C' && !sp.isFixed(p) && p.stats);
const A = COMMON[0].id; const B = COMMON[1].id;
const keys = (o, out = []) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.push(k); keys(v, out); } return out; };

test('ficha pública: ID, medallas, Salón de la Fama, Pokédex regionales, títulos y torneos; sin monedas, polvo, objetos, IP ni contraseña', () => {
  const viewer = user();
  const u = user({ buddy: { id: A, shiny: false }, collection: { [A]: { n: 2, s: 1 } }, trn: { played: 5, won: 2, champion: 1 }, elite: { clears: 7, hof: Array.from({ length: 7 }, (_, i) => ({ n: i + 1, at: 1000 + i, team: [{ id: A, name: 'Bicho', level: 70 + i, shiny: false }] })), amulet: true, run: { stage: 2, members: [{ id: 1, uid: 'secret' }], carry: {} } } });
  u.progress.badges = ['roca', 'cascada']; u.progress.titles = ['campeon', 'dex-kanto', 'torneo-campeon'];
  u.dexDip = { kanto: 123 };
  const { player: p } = profile.view(viewer, { username: u.username });
  assert.strictEqual(p.username, u.username);
  assert.strictEqual(p.tid, require('../server/lottery').tidOf(u));
  assert.deepStrictEqual(p.progress.badges, ['roca', 'cascada']);
  assert.strictEqual(p.hof.total, 7);
  assert.strictEqual(p.hof.last.length, 5);
  assert.strictEqual(p.hof.last[0].n, 7, 'los más recientes primero');
  assert.strictEqual(p.dexReg.length, 9);
  assert.strictEqual(p.dexReg[0].diploma, 123);
  assert.deepStrictEqual(p.titles.map((t) => t.text), ['Campeón de la Liga', 'Diploma de Kanto', 'Campeón de Torneo']);
  assert.deepStrictEqual(p.tourney, { played: 5, won: 1 });
  assert.strictEqual(p.buddy.id, A);
  // Nada privado: ni las claves ni los valores.
  const json = JSON.stringify(profile.view(viewer, { username: u.username }));
  for (const secret of ['987654321', '424242', '31337', 'SECRET-IP', 'SECRETSALT', 'SECRETHASH', 'secret']) assert.ok(!json.includes(secret), 'filtra ' + secret);
  const ks = new Set(keys(profile.view(viewer, { username: u.username })));
  for (const k of ['coins', 'dust', 'items', 'ip', 'hash', 'salt', 'token', 'hist', 'run', 'btTeams', 'lastHeal', 'notes', 'bp', 'daily']) assert.ok(!ks.has(k), 'clave privada ' + k);
  assert.throws(() => profile.view(viewer, { username: 'nadie' }), /no encontrado/);
});

test('tiempo de juego: solo si es público (o es el propio jugador)', () => {
  const viewer = user(); const u = user({ playMs: 3600e3 });
  assert.strictEqual(profile.view(viewer, { username: u.username }).player.playMs, 3600e3);
  u.playPublic = false;
  assert.strictEqual(profile.view(viewer, { username: u.username }).player.playMs, null);
  assert.strictEqual(profile.view(u, { username: u.username }).player.playMs, 3600e3, 'él mismo sí lo ve');
});

test('notificaciones: persistentes, con tope, leídas, borrar y enlaces seguros', () => {
  const u = user();
  const n1 = notify.push(u, { kind: 'trade', text: 'hola', link: '#/trade' });
  assert.strictEqual(n1.link, '#/trade');
  assert.strictEqual(notify.push(u, { kind: 'raro', text: 'x', link: 'javascript:alert(1)' }).link, '', 'enlaces solo internos');
  assert.strictEqual(notify.list(u).list[0].kind, 'info', 'tipo desconocido → info');
  assert.strictEqual(notify.unread(u), 2);
  notify.read(u, { id: n1.id });
  assert.strictEqual(notify.unread(u), 1);
  assert.strictEqual(notify.list(u).list[0].text, 'x', 'la más nueva primero');
  assert.strictEqual(u.notes.list.length, 2, 'se guardan en la cuenta (persisten con db.json)');
  for (let i = 0; i < 60; i++) notify.push(u, { text: 'n' + i });
  assert.strictEqual(notify.list(u).list.length, notify.MAX);
  assert.strictEqual(notify.list(u).list[0].text, 'n59');
  assert.ok(!notify.list(u).list.some((x) => x.id === n1.id), 'las más antiguas se descartan');
  notify.read(u, { id: 'all' });
  assert.strictEqual(notify.unread(u), 0);
  const id = notify.list(u).list[3].id;
  notify.clear(u, { id });
  assert.strictEqual(notify.list(u).list.length, notify.MAX - 1);
  notify.clear(u, { id: 'all' });
  assert.deepStrictEqual(notify.list(u).list, []);
  assert.strictEqual(notify.push(user({ npc: true }), { text: 'nada' }), null, 'los NPC no tienen avisos');
  assert.strictEqual(notify.push(u, { text: '' }), null);
  assert.ok(notify.push(u, { text: 'y'.repeat(500) }).text.length <= 200);
});

test('orígenes: GTS (te han intercambiado, depósito caducado), logros y Diploma', () => {
  const a = user({ collection: { [A]: { n: 1, s: 0 }, [B]: { n: 1, s: 0 } } });
  const b = user({ collection: { [B]: { n: 1, s: 0 }, [A]: { n: 1, s: 0 } } });
  sp.syncAll(a); sp.syncAll(b);
  gts.noteSeen(a, B);
  const dep = gts.deposit(a, { id: A, uid: a.mons[A][0].uid, want: { id: B, g: 'any', lv: 0 } });
  gts.offer(b, { dep: dep.mine[0].id, uid: b.mons[B][0].uid });
  assert.ok(notify.list(a).list.some((x) => x.kind === 'gts' && /ha intercambiado tu/.test(x.text)), 'te han intercambiado en la GTS');
  // depósito caducado
  const c = user({ collection: { [A]: { n: 1, s: 0 } } }); sp.syncAll(c); gts.noteSeen(c, B);
  gts.deposit(c, { id: A, uid: c.mons[A][0].uid, want: { id: B, g: 'any', lv: 0 } });
  gts.settle(Date.now() + gts.EXPIRE_MS + 1000);
  assert.ok(notify.list(c).list.some((x) => x.kind === 'gts' && /caducó/.test(x.text)));
  // logro (insignia o misión) y Diploma
  progress.awardBadge(a, 1);
  assert.ok(notify.list(a).list.some((x) => x.kind === 'quest' && /Medalla Roca/.test(x.text)));
  const d = user();
  for (const id of regions.BY_ID.get('alola').ids) gacha.grant(d, id, false);
  assert.ok(notify.list(d).list.some((x) => x.kind === 'dex' && /Alola/.test(x.text)));
});
