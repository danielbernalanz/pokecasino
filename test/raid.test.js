'use strict';
// Teraincursiones cooperativas: jefes del día, estrellas por medallas, combate por turnos (escudo, aturdimiento, Tera, debilitados), salas
// (solo, abiertas, privadas), temporizador y desconexiones, recompensas con tope diario, captura garantizada del jefe y persistencia.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-raid-'));

const db = require('../server/db');
const sp = require('../server/specimen');
const items = require('../server/items');
const gacha = require('../server/gacha');
const balls = require('../server/balls');
const tera = require('../server/tera');
const cap = require('../server/capture');
const raid = require('../server/raid');
const { BY_ID, TYPES, RARITY, effectiveness } = require('../server/pokedex');

// Generador pseudoaleatorio determinista (mulberry32).
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const DAY = Date.UTC(2026, 10, 5, 12, 0);
const H = 3600e3;

let n = 0;
function user(ids = [6], badges = 8, extra = {}) {
  const name = 'raid' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 1000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection: Object.fromEntries(ids.map((i) => [i, { n: 1, s: 0 }])), stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, createdAt: Date.now() - 9 * 864e5, ...extra };
  db.addUser(u);
  u.progress.badges = ['roca', 'cascada', 'trueno', 'arcoiris', 'alma', 'pantano', 'volcan', 'tierra'].slice(0, badges);
  sp.syncAll(u);
  // movimientos del nivel 50 (como un jugador que ha entrenado)
  for (const [id, arr] of Object.entries(u.mons)) for (const m of arr) { m.level = 50; delete m.mv; delete m.learned; delete m.sdMoves; delete m.pending; require('../server/moves').ensure(Number(id), m); }
  tera.ensureOrb(u);
  return u;
}
const mon = (u, id = 6) => ({ id, uid: u.mons[id][0].uid });
const mk = (u, star = 1, mode = 'solo', id = 6, now = DAY) => raid.create(u, { star, slot: 0, ...mon(u, id), mode }, now);
const clean = () => { for (const k of Object.keys(raid.store())) delete raid.store()[k]; };
const act = (u, o = {}) => { const r = raid.raidOf(u.id); return raid.choose(u, { move: raid.bestMove(r, r.players.find((p) => p.userId === u.id)), ...o }, DAY); };
// Juega hasta el final por un jugador (siempre el mejor movimiento).
function play(u, max = 80) {
  let r = raid.raidOf(u.id);
  for (let i = 0; i < max && !r.over; i++) {
    const p = r.players.find((x) => x.userId === u.id && x.human);
    if (p.mon.ko) raid.tick(Date.now() + 1e9); else raid.choose(u, { move: raid.bestMove(r, p), tera: false }, DAY);
    r = raid.raidOf(u.id) || r;
  }
  return r;
}
// Varios humanos: cada uno elige el mejor movimiento; si ninguno puede, corre el reloj.
function playMulti(users, max = 80) {
  let r = raid.raidOf(users[0].id);
  for (let i = 0; i < max && !r.over; i++) {
    let any = false;
    for (const u of users) {
      const p = r.players.find((x) => x.userId === u.id && x.human);
      if (p && !p.mon.ko && !r.over) { raid.choose(u, { move: raid.bestMove(r, p) }, DAY); any = true; }
    }
    if (!any && !r.over) raid.tick(r.deadline + 1);
    r = raid.raidOf(users[0].id) || r;
  }
  return r;
}
test.beforeEach(() => { clean(); raid.setRng(seeded(11)); });
test.after(() => raid.stop());

test('jefes del día: 2 por estrella, deterministas, distintos, con Teratipo y de la rareza de la estrella', () => {
  const a = raid.bossesOf('2026-11-05');
  assert.strictEqual(a.length, 10);
  assert.deepStrictEqual(raid.bossesOf('2026-11-05'), a);
  assert.notDeepStrictEqual(raid.bossesOf('2026-11-06').map((b) => [b.id, b.tera]), a.map((b) => [b.id, b.tera]));
  for (const s of raid.STARS) {
    const two = a.filter((b) => b.star === s);
    assert.strictEqual(two.length, 2);
    assert.notStrictEqual(two[0].id, two[1].id);
    for (const b of two) { assert.ok(TYPES.includes(b.tera)); assert.strictEqual(b.level, raid.LEVEL[s]); assert.ok(raid.poolOf(s).some((p) => p.id === b.id)); }
  }
  // Ningún legendario ni mítico; las rarezas suben con las estrellas y los Teratipos salen de los 18 tipos a lo largo de las semanas.
  const rar = (s) => new Set(raid.poolOf(s).map((p) => p.rarity));
  for (const s of raid.STARS) { assert.ok(raid.poolOf(s).length >= 100, `pool ${s}`); assert.ok(!rar(s).has('L') && !rar(s).has('M')); }
  assert.deepStrictEqual([...rar(1)], ['C']);
  assert.deepStrictEqual([...rar(5)], ['E']);
  const types = new Set();
  for (let d = 1; d <= 200; d++) for (const b of raid.bossesOf('2027-01-' + String(d).padStart(3, '0'))) types.add(b.tera);
  assert.strictEqual(types.size, 18);
});

test('estrellas por medallas: 1★ con 1, 2★ con 2, 3★ con 4, 4★ con 6, 5★ con 8', () => {
  assert.deepStrictEqual(raid.BADGES, { 1: 1, 2: 2, 3: 4, 4: 6, 5: 8 });
  const u = user([6], 1);
  assert.throws(() => mk(u, 2), /2 medallas/);
  assert.throws(() => mk(u, 5), /8 medallas/);
  const v = raid.view(u, DAY);
  assert.deepStrictEqual(v.stars.map((s) => s.locked), [false, true, true, true, true]);
  assert.ok(v.bosses.every((b) => b.locked === (b.star > 1)));
  assert.doesNotThrow(() => mk(u, 1));
  const z = user([6], 0);
  assert.throws(() => mk(z, 1), /1 medalla/);
  assert.throws(() => raid.create({ npc: true, id: 'x', items: {} }, { star: 1 }), /NPC/);
  assert.throws(() => raid.create(user(), { star: 9, ...{ id: 6, uid: 'x' } }), /no válida/);
});

test('incursión en solitario completa: tú + 3 aliados CPU contra un jefe con escudo; ganas y cobras', () => {
  const u = user();
  const r0 = mk(u, 1).raid;
  assert.strictEqual(r0.state, 'battle');
  assert.strictEqual(r0.players.length, 4);
  assert.deepStrictEqual(r0.players.map((p) => p.human), [true, false, false, false]);
  assert.strictEqual(r0.boss.hpMax, raid.HP[1]);
  assert.ok(r0.me.moves.length >= 1);
  assert.strictEqual(raid.view(u, DAY).raid.id, r0.id);
  assert.throws(() => mk(u, 1), /Ya estás/);
  let sawShield = false; let sawStun = false;
  let r = raid.raidOf(u.id);
  for (let i = 0; i < 60 && !r.over; i++) {
    const p = r.players[0];
    if (p.mon.ko) { raid.tick(Date.now() + 1e9); } else raid.choose(u, { move: raid.bestMove(r, p) }, DAY);
    r = raid.raidOf(u.id);
    if (r.boss.shield.on) sawShield = true;
    if (r.log.some((l) => /escudo del jefe se ha roto/.test(l))) sawStun = true;
  }
  assert.strictEqual(r.state, 'won');
  assert.ok(sawShield, 'a mitad de PS aparece el escudo');
  assert.ok(sawStun, 'al romperse pierde un turno');
  assert.ok(r.log.some((l) => /aturdido/.test(l)));
  assert.strictEqual(r.boss.hp, 0);
  assert.ok(r.boss.shield.done);
  const rw = r.rewards[u.id];
  assert.ok(rw && rw.shards && rw.shards.n >= 1 && rw.capture);
  assert.strictEqual(u.items[tera.shardId(r.boss.tera)], rw.shards.n);
  assert.strictEqual(u.coins, 1000, 'nunca monedas');
});

test('el escudo aparece al llegar al 50 %, absorbe el daño y su rotura aturde al jefe', () => {
  const u = user();
  mk(u, 1);
  const r = raid.raidOf(u.id);
  const b = r.boss;
  const lead = r.players[0];
  const mv = lead.mon.moves.findIndex((m) => m.kind === 'dmg');
  // Los aliados no atacan; el jefe no hace daño: solo se mira lo que le pasa al jefe.
  r.players.slice(1).forEach((p) => { p.mon.moves = [{ id: 'x', name: 'Nada', type: 'normal', cat: 'x', power: 0, kind: 'none' }]; });
  b.stats[1] = 1; b.stats[3] = 1;
  lead.mon.stats[1] = 9999; lead.mon.stats[3] = 9999;
  assert.ok(!b.shield.on && !b.shield.done);
  // Un golpe enorme se detiene en el 50 % y se pone el escudo (aunque sobrara daño para rematarlo).
  raid.choose(u, { move: mv }, DAY);
  assert.ok(b.shield.on && b.shield.done);
  assert.strictEqual(b.hp, Math.ceil(b.hpMax * raid.SHIELD_AT));
  assert.strictEqual(b.shield.hp, b.shield.max);
  assert.strictEqual(b.shield.max, Math.round(b.hpMax * raid.SHIELD_FRAC));
  assert.ok(r.log.some((l) => /escudo de cristales/.test(l)));
  // El escudo absorbe: los PS no cambian mientras dura.
  lead.mon.stats[1] = 30; lead.mon.stats[3] = 30;
  const hp = b.hp;
  raid.choose(u, { move: mv }, DAY);
  assert.strictEqual(b.hp, hp);
  assert.ok(b.shield.on && b.shield.hp < b.shield.max && b.shield.hp > 0);
  // Al romperse, el jefe pierde su próximo ataque y los PS vuelven a bajar.
  lead.mon.stats[1] = 9999; lead.mon.stats[3] = 9999;
  raid.choose(u, { move: mv }, DAY);
  assert.ok(!b.shield.on && b.shield.hp === 0);
  assert.strictEqual(b.hp, hp);
  assert.ok(r.log.some((l) => /escudo del jefe se ha roto/.test(l)));
  assert.ok(r.log.some((l) => /aturdido y no puede atacar/.test(l)));
  assert.strictEqual(b.stunned, false, 'el aturdimiento dura un solo ataque');
  raid.choose(u, { move: mv }, DAY);
  assert.ok(b.hp < hp || r.over);
});

test('Teracristalizar: una vez por incursión, con Orbe; sube el STAB (×2 si ya era de sus tipos) y cambia su tipo defensivo', () => {
  const u = user();
  mk(u, 1);
  let r = raid.raidOf(u.id);
  const p = r.players[0];
  const m = p.mon;
  assert.strictEqual(m.tera, tera.teraOf(6, u.mons[6][0]));
  // STAB: Charizard (fuego/volador) con Teratipo fuego → STAB ×2 en ataques de fuego; sin Tera ×1,5.
  m.tera = 'fire'; m.teraOn = false;
  const fire = { type: 'fire', cat: 's', power: 80, kind: 'dmg' };
  const base = raid.dmgToBoss(r, m, fire);
  m.teraOn = true;
  const boosted = raid.dmgToBoss(r, m, fire);
  assert.ok(boosted > base * 1.25 && boosted < base * 1.45, `${base} → ${boosted}`); // 2/1,5 = ×1,33
  // Un tipo que no era suyo: STAB ×1,5 (en lugar de ×1).
  m.tera = 'water'; m.teraOn = true;
  const water = { type: 'water', cat: 's', power: 80, kind: 'dmg' };
  m.teraOn = false; const w0 = raid.dmgToBoss(r, m, water); m.teraOn = true; const w1 = raid.dmgToBoss(r, m, water);
  assert.ok(w1 > w0 * 1.4 && w1 < w0 * 1.6, `${w0} → ${w1}`);
  // Tipo defensivo: tera agua → sin la debilidad a eléctrico/roca de Charizard.
  m.teraOn = false;
  const rock = raid.dmgToMon({ boss: { ...r.boss, tera: 'rock', stats: r.boss.stats, level: 30 } }, m, 60, () => 0.5);
  m.teraOn = true; m.tera = 'fighting';
  const rockT = raid.dmgToMon({ boss: { ...r.boss, tera: 'rock', stats: r.boss.stats, level: 30 } }, m, 60, () => 0.5);
  assert.ok(rock.eff === 4 && rockT.eff === 0.5, `${rock.eff} / ${rockT.eff}`); // Roca vs fuego/volador ×4; vs un Pokémon cristalizado de Lucha ×0,5
  m.teraOn = false; m.teraUsed = false; m.tera = tera.teraOf(6, u.mons[6][0]);
  // Una vez por incursión y solo con Orbe.
  raid.choose(u, { move: 0, tera: true }, DAY);
  r = raid.raidOf(u.id);
  assert.ok(r.players[0].mon.teraOn && r.players[0].mon.teraUsed);
  assert.ok(r.log.some((l) => /teracristalizado de tipo/.test(l) && l.includes(r.players[0].mon.name)));
  assert.throws(() => raid.choose(u, { move: 0, tera: true }, DAY), /Ya has teracristalizado/);
  const poor = user([6]);
  mk(poor, 1);
  delete poor.items[tera.ORB];
  assert.throws(() => raid.choose(poor, { move: 0, tera: true }, DAY), /Orbe/);
});

test('debilitados: el Pokémon vuelve con los PS llenos dos turnos después y con 4 debilitados se pierde', () => {
  const u = user();
  mk(u, 1);
  const r = raid.raidOf(u.id);
  const p = r.players[0];
  // Fuerza el golpe del jefe sobre el jugador: PS a 1 y un jefe muy fuerte.
  r.boss.stats[1] = 999; r.boss.stats[3] = 999;
  p.mon.hp = 1;
  r.players.slice(1).forEach((x) => { x.mon.ko = 1; x.mon.hp = 0; });
  raid.setRng(() => 0); // el jefe siempre ataca al primero en pie
  raid.choose(u, { move: 0 }, DAY);
  assert.ok(p.mon.ko > 0 && r.kos >= 1);
  assert.throws(() => raid.choose(u, { move: 0 }, DAY), /debilitado/);
  // Sigue el temporizador (nadie puede decidir): vuelve con los PS llenos.
  for (let i = 0; i < 4 && p.mon.ko; i++) raid.tick(Date.now() + 1e9);
  assert.strictEqual(p.mon.ko, 0);
  assert.strictEqual(p.mon.hp, p.mon.maxHp);
  // Límite de debilitados.
  const v = user();
  mk(v, 1);
  const r2 = raid.raidOf(v.id);
  r2.kos = raid.MAX_KOS - 1;
  r2.boss.stats[1] = 9999; r2.boss.stats[3] = 9999; r2.boss.hp = r2.boss.hpMax; r2.boss.shield.done = true;
  r2.players.forEach((x) => { x.mon.hp = 1; x.mon.stats[1] = 1; x.mon.stats[3] = 1; });
  raid.setRng(() => 0.99);
  raid.choose(v, { move: 0 }, DAY);
  assert.strictEqual(r2.state, 'lost');
  assert.match(r2.why, /debilitado/);
  assert.strictEqual(v.items[tera.shardId(r2.boss.tera)] || 0, 0, 'perder no da nada');
});

test('límite de 20 turnos: el jefe escapa', () => {
  const u = user();
  mk(u, 1);
  const r = raid.raidOf(u.id);
  r.boss.hp = r.boss.hpMax; r.boss.shield.done = true;
  r.boss.stats[1] = 1; r.boss.stats[3] = 1; // no hace daño
  r.players.forEach((x) => { x.mon.stats[1] = 1; x.mon.stats[3] = 1; x.mon.moves = x.mon.moves.map((m) => ({ ...m, power: 1 })); });
  for (let i = 0; i < raid.MAX_TURNS + 2 && !r.over; i++) raid.choose(u, { move: raid.bestMove(r, r.players[0]) }, DAY);
  assert.strictEqual(r.state, 'lost');
  assert.match(r.why, /tiempo/);
  assert.strictEqual(r.turn, raid.MAX_TURNS + 1);
});

test('cooperativa: sala abierta en la lista, unirse con código, empezar y completar con aliados CPU', () => {
  const host = user([6]), a = user([9]), b = user([25]);
  const c = mk(host, 2, 'open').raid;
  assert.strictEqual(c.state, 'lobby');
  assert.match(c.code, /^[A-Z]{4}$/);
  assert.strictEqual(raid.publicList().length, 1);
  assert.strictEqual(raid.publicList()[0].host, host.username);
  assert.throws(() => raid.start(a, {}), /sala/);
  // Unirse por id (lista) y por código.
  raid.join(a, { id: c.id, ...{ monId: 9, uid: a.mons[9][0].uid } }, DAY);
  raid.join(b, { code: c.code.toLowerCase(), monId: 25, uid: b.mons[25][0].uid }, DAY);
  assert.strictEqual(raid.raidOf(host.id).players.length, 3);
  assert.throws(() => raid.start(a, {}), /Solo quien creó/);
  // Los de medallas insuficientes no entran.
  const low = user([6], 1);
  assert.throws(() => raid.join(low, { id: c.id, monId: 6, uid: low.mons[6][0].uid }, DAY), /2 medallas/);
  // Empieza el anfitrión: la 4.ª plaza es de la CPU.
  raid.start(host, {}, DAY);
  const r = raid.raidOf(host.id);
  assert.strictEqual(r.state, 'battle');
  assert.deepStrictEqual(r.players.map((p) => p.human), [true, true, true, false]);
  assert.strictEqual(raid.publicList().length, 0);
  // El turno solo se resuelve cuando los tres humanos han elegido.
  raid.choose(host, { move: 0 }, DAY);
  assert.strictEqual(r.turn, 1);
  raid.choose(a, { move: 0 }, DAY);
  assert.strictEqual(r.turn, 1);
  raid.choose(b, { move: 0 }, DAY);
  assert.strictEqual(r.turn, 2);
  assert.ok(r.players.slice(0, 3).every((p) => p.acts === 1));
  // Cuatro humanos: empieza solo y sin CPU (sala privada).
  clean();
  const four = [user([6]), user([9]), user([25]), user([3])];
  const ids = [6, 9, 25, 3];
  const pr = mk(four[0], 1, 'private').raid;
  assert.strictEqual(raid.publicList().length, 0, 'las privadas no salen en la lista');
  four.slice(1).forEach((u, i) => raid.join(u, { code: pr.code, monId: ids[i + 1], uid: u.mons[ids[i + 1]][0].uid }, DAY));
  assert.strictEqual(raid.raidOf(four[0].id).state, 'battle');
  assert.ok(raid.raidOf(four[0].id).players.every((p) => p.human));
  assert.throws(() => raid.join(user([6]), { code: pr.code, monId: 6, uid: 'x' }, DAY), /ya no existe|completa/);
});

test('salas: el anfitrión cancela, los demás salen, la sala caduca a los 2 minutos y empieza con CPU', () => {
  const host = user([6]), a = user([9]);
  const c = mk(host, 1, 'open').raid;
  raid.join(a, { id: c.id, monId: 9, uid: a.mons[9][0].uid }, DAY);
  raid.leave(a);
  assert.strictEqual(raid.raidOf(a.id), null);
  assert.strictEqual(raid.raidOf(host.id).players.length, 1);
  raid.tick(DAY + raid.LOBBY_MS - 1000);
  assert.strictEqual(raid.raidOf(host.id).state, 'lobby');
  raid.tick(DAY + raid.LOBBY_MS + 1000);
  assert.strictEqual(raid.raidOf(host.id).state, 'battle', 'la sala arranca sola y se completa con la CPU');
  assert.strictEqual(raid.raidOf(host.id).players.filter((p) => !p.human).length, 3);
  clean();
  const h2 = user([6]), x = user([9]);
  const c2 = mk(h2, 1, 'private').raid;
  raid.join(x, { code: c2.code, monId: 9, uid: x.mons[9][0].uid }, DAY);
  raid.leave(h2);
  assert.strictEqual(raid.raidOf(h2.id), null);
  assert.strictEqual(raid.raidOf(x.id), null, 'si el anfitrión se va, la sala se cancela');
  assert.strictEqual(Object.keys(raid.store()).length, 0);
});

test('temporizador y desconexiones: sin respuesta se elige solo; 3 turnos seguidos = piloto automático; salir deja a la CPU', () => {
  const a = user([6]), b = user([9]);
  const c = mk(a, 1, 'open').raid;
  raid.join(b, { id: c.id, monId: 9, uid: b.mons[9][0].uid }, DAY);
  raid.start(a, {}, DAY);
  const r = raid.raidOf(a.id);
  const t0 = r.deadline;
  assert.strictEqual(t0, DAY + raid.TURN_MS);
  // `a` elige y `b` está desconectado: al vencer el plazo el turno se resuelve con su movimiento automático.
  raid.choose(a, { move: raid.bestMove(r, r.players[0]) }, DAY);
  assert.strictEqual(r.turn, 1);
  raid.tick(t0 - 1);
  assert.strictEqual(r.turn, 1);
  raid.tick(t0 + 1);
  assert.strictEqual(r.turn, 2);
  assert.strictEqual(r.players[1].timeouts, 1);
  assert.strictEqual(r.players[1].acts, 0);
  assert.ok(r.log.some((l) => l.includes('se ha quedado sin tiempo')));
  for (let i = 0; i < 3 && !r.over && !r.players[1].afk; i++) {
    if (!r.players[0].mon.ko) raid.choose(a, { move: raid.bestMove(r, r.players[0]) }, DAY);
    raid.tick(r.deadline + 1);
  }
  if (!r.over) {
    assert.ok(r.players[1].afk, 'tras 3 turnos sin tiempo pasa al piloto automático');
    assert.ok(r.log.some((l) => /piloto automático/.test(l)));
    // Con él en automático, el turno ya no espera por él.
    const turn = r.turn;
    if (!r.players[0].mon.ko) { raid.choose(a, { move: raid.bestMove(r, r.players[0]) }, DAY); assert.ok(r.over || r.turn === turn + 1); }
    // Vuelve y elige: deja de estar en automático.
    if (!r.over && !r.players[1].mon.ko) { raid.choose(b, { move: 0 }, DAY); assert.strictEqual(r.players[1].afk, false); }
  }
  // Salir en pleno combate: la CPU lleva su Pokémon y no cobra.
  clean();
  const x = user([6]), y = user([9]);
  const c2 = mk(x, 1, 'open').raid;
  raid.join(y, { id: c2.id, monId: 9, uid: y.mons[9][0].uid }, DAY);
  raid.start(x, {}, DAY);
  const r2 = raid.raidOf(x.id);
  raid.leave(y);
  assert.strictEqual(raid.raidOf(y.id), null);
  assert.ok(r2.players[1].left && !r2.players[1].human);
  const fin = play(x);
  assert.strictEqual(fin.state, 'won');
  assert.ok(!fin.rewards[y.id]);
  // Todos se van: se abandona.
  clean();
  const z = user([6]);
  mk(z, 1);
  raid.leave(z);
  assert.strictEqual(raid.raidOf(z.id), null);
});

test('recompensas: Teralitos del tipo del jefe, Caramelos Exp. con tope de EXP y sin monedas; hay que participar de verdad', () => {
  const u = user();
  mk(u, 3);
  const f = play(u);
  assert.strictEqual(f.state, 'won');
  const rw = f.rewards[u.id];
  const [lo, hi] = raid.SHARDS[3];
  assert.ok(rw.shards.n >= lo && rw.shards.n <= hi);
  assert.strictEqual(rw.shards.type, f.boss.tera);
  assert.strictEqual(u.items[tera.shardId(f.boss.tera)], rw.shards.n);
  const [cid, cn] = raid.CANDY[3];
  assert.deepStrictEqual(rw.candy, { id: cid, n: cn });
  assert.strictEqual(u.items[cid], cn);
  assert.strictEqual(u.coins, 1000);
  assert.strictEqual(raid.dayState(u, DAY).n, 1);
  assert.strictEqual(raid.dayState(u, DAY).claims.length, 1);
  // Participación: quien deja que la CPU juegue por él no cobra.
  clean();
  const a = user([6]), lazy = user([9]);
  const c = mk(a, 1, 'open').raid;
  raid.join(lazy, { id: c.id, monId: 9, uid: lazy.mons[9][0].uid }, DAY);
  raid.start(a, {}, DAY);
  let r = raid.raidOf(a.id);
  for (let i = 0; i < 60 && !r.over; i++) {
    if (!r.players[0].mon.ko) raid.choose(a, { move: raid.bestMove(r, r.players[0]) }, DAY);
    raid.tick(r.deadline + 1);
    r = raid.raidOf(a.id) || r;
  }
  assert.strictEqual(r.state, 'won');
  assert.ok(r.rewards[a.id].shards);
  assert.ok(r.rewards[lazy.id].none, 'sin elegir movimiento no hay premio');
  assert.deepStrictEqual(lazy.items, { [tera.ORB]: 1 });
  assert.strictEqual(raid.dayState(lazy, DAY).n, 0);
  assert.ok(raid.needActs(r) >= 1);
});

test('tope diario: 10 incursiones premiadas por jugador y día; la 11.ª no da nada y mañana se renueva', () => {
  const u = user();
  const day = (k) => DAY + k * 864e5;
  let got = 0;
  for (let i = 0; i < raid.DAILY + 2; i++) {
    clean();
    mk(u, 1);
    const f = play(u);
    assert.strictEqual(f.state, 'won');
    const rw = f.rewards[u.id];
    if (i < raid.DAILY) { assert.ok(rw.shards, `incursión ${i + 1}`); got++; } else { assert.ok(rw.capped, 'a partir de la 10.ª no hay recompensas'); assert.ok(!rw.shards); }
  }
  assert.strictEqual(got, raid.DAILY);
  const d = raid.dayState(u, DAY);
  assert.strictEqual(d.n, raid.DAILY);
  assert.strictEqual(d.claims.length, raid.DAILY, 'una captura por incursión premiada');
  assert.strictEqual(raid.view(u, DAY).left, 0);
  // Los Teralitos totales del día están acotados por el máximo de la estrella.
  const total = Object.entries(u.items).filter(([k]) => k.startsWith('tera-shard-')).reduce((s, [, v]) => s + v, 0);
  assert.ok(total <= raid.DAILY * raid.SHARDS[1][1]);
  // Al día siguiente el contador vuelve a 0.
  assert.strictEqual(raid.dayState(u, day(1)).n, 0);
  assert.strictEqual(raid.view(u, day(1)).left, raid.DAILY);
  // Tope de EXP de caramelos: nunca más de EXP_DAY al día aunque sean 10 incursiones de 5★.
  const w = user();
  for (let i = 0; i < raid.DAILY; i++) { clean(); const r = mk(w, 5).raid; raid.raidOf(w.id).boss.hp = 1; raid.raidOf(w.id).boss.shield.done = true; const rr = raid.raidOf(w.id); rr.players[0].mon.stats[1] = 9999; rr.players[0].mon.stats[3] = 9999; raid.choose(w, { move: raid.bestMove(rr, rr.players[0]) }, DAY); assert.ok(raid.raidOf(w.id).over); }
  const exp = require('../server/exp');
  const earned = Object.entries(w.items).filter(([k]) => exp.CANDY_EXP[k]).reduce((s, [k, v]) => s + exp.CANDY_EXP[k] * v, 0);
  assert.ok(earned <= raid.EXP_DAY, `${earned} EXP de caramelos`);
  assert.ok(raid.dayState(w, DAY).exp <= raid.EXP_DAY);
});

test('captura garantizada del jefe con su Teratipo: gasta una Ball (mínimo según estrellas), no se escapa y es un ejemplar normal', () => {
  const u = user();
  mk(u, 4);
  const r = raid.raidOf(u.id);
  r.boss.hp = 1; r.boss.shield.done = true; r.players[0].mon.stats[1] = 9999; r.players[0].mon.stats[3] = 9999;
  raid.choose(u, { move: raid.bestMove(r, r.players[0]) }, DAY);
  assert.strictEqual(r.state, 'won');
  const cl = raid.view(u, DAY).claims[0];
  assert.ok(cl && cl.star === 4 && cl.boss === r.boss.id && cl.tera === r.boss.tera);
  assert.strictEqual(cl.minBall, 'ultra-ball');
  // Sin Ball, o con una Ball menor, no se puede.
  assert.throws(() => raid.claim(u, { claim: cl.id, ball: 'ultra-ball' }, DAY), /No te queda/);
  u.items['poke-ball'] = 5; u.items['great-ball'] = 5;
  assert.throws(() => raid.claim(u, { claim: cl.id, ball: 'poke-ball' }, DAY), /Ultra Ball o mejor/);
  assert.throws(() => raid.claim(u, { claim: cl.id, ball: 'great-ball' }, DAY), /Ultra Ball o mejor/);
  assert.throws(() => raid.claim(u, { claim: cl.id, ball: 'nada' }, DAY), /Ultra Ball o mejor/);
  assert.strictEqual(u.items['poke-ball'], 5, 'las Balls rechazadas no se gastan');
  u.items['ultra-ball'] = 1;
  const before = u.collection[cl.boss] ? u.collection[cl.boss].n : 0;
  const out = raid.claim(u, { claim: cl.id, ball: 'ultra-ball' }, DAY);
  assert.strictEqual(u.items['ultra-ball'], undefined, 'se gasta la Ball');
  assert.strictEqual(out.got.id, cl.boss);
  assert.strictEqual(out.got.tera, cl.tera);
  assert.strictEqual(u.collection[cl.boss].n, before + 1);
  const m = sp.sync(u, cl.boss).find((x) => x.uid === out.got.uid);
  assert.strictEqual(m.tera, cl.tera, 'el jefe capturado conserva su Teratipo');
  assert.strictEqual(tera.teraOf(cl.boss, m), cl.tera);
  assert.strictEqual(m.ball, 'ultra-ball');
  assert.strictEqual(m.level, raid.LEVEL[4]);
  assert.strictEqual(m.caught.zone, 'raid');
  assert.strictEqual(m.caught.raid, 4);
  assert.strictEqual(m.ot, require('../server/lottery').tidOf(u));
  assert.ok(m.ivs.filter((x) => x === 31).length >= raid.PERFECT_IVS[4]);
  // Una sola vez.
  u.items['ultra-ball'] = 3;
  assert.throws(() => raid.claim(u, { claim: cl.id, ball: 'ultra-ball' }, DAY), /ya no está/);
  // La Master Ball también vale; la captura caduca a las 24 h.
  const v = user();
  mk(v, 1);
  const r2 = raid.raidOf(v.id);
  r2.boss.hp = 1; r2.boss.shield.done = true; r2.players[0].mon.stats[1] = 9999; r2.players[0].mon.stats[3] = 9999;
  raid.choose(v, { move: raid.bestMove(r2, r2.players[0]) }, DAY);
  const c2 = raid.view(v, DAY).claims[0];
  assert.throws(() => raid.claim(v, { claim: c2.id, ball: 'poke-ball' }, DAY + raid.CLAIM_MS + 1000), /ya no está/);
  assert.strictEqual(raid.view(v, DAY + raid.CLAIM_MS + 1000).claims.length, 0);
});

test('economía: capturar al jefe nunca es rentable (la Ball mínima cuesta más que el valor de reventa del Pokémon, variocolor incluido)', () => {
  for (const s of raid.STARS) {
    const ball = balls.BALLS[raid.MIN_BALL[s]];
    for (const p of raid.poolOf(s)) {
      const resale = cap.resaleValue(p.id);
      assert.ok(resale < ball.price, `${s}★ ${p.name}: ${resale} ≥ ${ball.price}`);
      assert.ok(RARITY[p.rarity].dust * gacha.DUST_RATE * 3 <= ball.price * 3);
    }
    // Y con el tope de 10 al día, lo máximo que se podría sacar de reventa sigue siendo menos que lo gastado en Balls.
    const top = Math.max(...raid.poolOf(s).map((p) => cap.resaleValue(p.id)));
    assert.ok(top * raid.DAILY < ball.price * raid.DAILY);
  }
  // Las Balls mínimas valen más cuanto más difícil es el jefe.
  const price = (s) => balls.BALLS[raid.MIN_BALL[s]].price;
  assert.ok(price(1) <= price(3) && price(3) <= price(4) && price(4) <= price(5));
  assert.ok(raid.ballOk(5, 'master-ball') && !raid.ballOk(5, 'great-ball') && raid.ballOk(3, 'ultra-ball') && !raid.ballOk(3, 'poke-ball'));
});

test('persistencia: una incursión en curso sobrevive a un reinicio del servidor (estado, plazos y resultado)', () => {
  const a = user([6]), b = user([9]);
  const c = mk(a, 2, 'open').raid;
  raid.join(b, { id: c.id, monId: 9, uid: b.mons[9][0].uid }, DAY);
  raid.start(a, {}, DAY);
  const r = raid.raidOf(a.id);
  raid.choose(a, { move: raid.bestMove(r, r.players[0]) }, DAY);
  raid.choose(b, { move: raid.bestMove(r, r.players[1]) }, DAY);
  const snap = JSON.parse(JSON.stringify(db.data.raids)); // como si se leyera de disco
  const hp = r.boss.hp, turn = r.turn;
  clean();
  Object.assign(raid.store(), snap);
  raid.begin(DAY + 10 * 60e3); // «arranque» 10 minutos después: los plazos se amplían (nadie pierde turnos por el reinicio)
  const r2 = raid.raidOf(a.id);
  assert.ok(r2 && r2.state === 'battle');
  assert.strictEqual(r2.boss.hp, hp);
  assert.strictEqual(r2.turn, turn);
  assert.ok(r2.deadline >= DAY + 10 * 60e3 + raid.TURN_MS - 1);
  raid.tick(DAY + 10 * 60e3 + 1000);
  assert.strictEqual(r2.turn, turn, 'no pierde el turno por el reinicio');
  assert.strictEqual(raid.viewFor(r2, b.id).me.idx, 1);
  // Y sigue hasta el final.
  raid.stop();
  const fin = playMulti([a, b]);
  assert.ok(fin.over);
  // Una sala a medias también se restaura.
  clean();
  const h = user([6]);
  mk(h, 1, 'open');
  const snap2 = JSON.parse(JSON.stringify(db.data.raids));
  clean(); Object.assign(raid.store(), snap2);
  raid.begin(DAY);
  raid.stop();
  assert.strictEqual(raid.raidOf(h.id).state, 'lobby');
  assert.strictEqual(raid.publicList().length, 1);
  // Las terminadas se limpian al cabo de 6 h.
  const g = user([6]);
  clean();
  mk(g, 1);
  const done = play(g);
  assert.ok(done.over && done.endedAt);
  raid.tick(done.endedAt + raid.KEEP_MS + 1000);
  assert.strictEqual(Object.keys(raid.store()).length, 0);
});

test('vista: el cliente recibe el estado sin datos ajenos y solo ve la vista previa de daño de sus movimientos', () => {
  const a = user([6]), b = user([9]);
  const c = mk(a, 1, 'open').raid;
  raid.join(b, { id: c.id, monId: 9, uid: b.mons[9][0].uid }, DAY);
  raid.start(a, {}, DAY);
  const r = raid.raidOf(a.id);
  const va = raid.viewFor(r, a.id), vb = raid.viewFor(r, b.id);
  assert.strictEqual(va.me.idx, 0); assert.strictEqual(vb.me.idx, 1);
  assert.ok(!JSON.stringify(va).includes(b.id) && !JSON.stringify(va).includes(a.id), 'sin ids de usuario');
  assert.ok(va.me.moves.every((m) => m.kind !== 'dmg' || (typeof m.dmg === 'number' && m.eff !== null)));
  assert.strictEqual(va.players.length, 4);
  assert.ok(!('stats' in va.players[0].mon) && !('moves' in va.players[0].mon));
  // El simulador no cambia nada de lo que hay guardado en el ejemplar.
  const tm = raid.team(a);
  assert.ok(tm.mons.length >= 1 && tm.mons.every((x) => TYPES.includes(x.tera)));
});

test('equilibrio: con tipos y movimientos normales, 1★-2★ se ganan casi siempre y las estrellas altas cuestan cada vez más', () => {
  const pool = (r) => [...BY_ID.values()].filter((p) => p.rarity === r);
  const rates = {};
  for (const star of raid.STARS) {
    let wins = 0; const N = 40;
    raid.setRng(seeded(100 + star));
    for (let i = 0; i < N; i++) {
      clean();
      const ps = pool(['C', 'U', 'R', 'E'][i % 4]);
      const p = ps[(i * 37 + star * 11) % ps.length];
      const u = user([p.id]);
      mk(u, star, 'solo', p.id);
      const r = raid.raidOf(u.id);
      for (let k = 0; k < 60 && !r.over; k++) {
        const pl = r.players[0];
        if (pl.mon.ko) raid.tick(Date.now() + 1e9); else raid.choose(u, { move: raid.bestMove(r, pl), tera: !pl.mon.teraUsed && pl.mon.moves[raid.bestMove(r, pl)].type === pl.mon.tera }, DAY);
      }
      if (r.state === 'won') wins++;
    }
    rates[star] = wins / N;
  }
  assert.ok(rates[1] >= 0.9 && rates[2] >= 0.9, JSON.stringify(rates));
  assert.ok(rates[3] >= 0.6, JSON.stringify(rates));
  assert.ok(rates[5] <= 0.8 && rates[5] < rates[1], JSON.stringify(rates));
  assert.ok(rates[1] >= rates[3] && rates[3] >= rates[4] && rates[4] >= rates[5] - 0.1, JSON.stringify(rates));
});

test('invitar a una sala de incursión: solo el anfitrión, con tope, avisa con el código y no vale en solitario', () => {
  const host = user([6]); const g = user([6]); const g2 = user([6]);
  const solo = mk(host, 1, 'solo');
  assert.throws(() => raid.invite(host, { to: g.username }), /sala tuya por empezar|solitario/);
  raid.leave(host); clean();
  const r = mk(host, 1, 'private');
  assert.strictEqual(r.raid.state, 'lobby');
  assert.throws(() => raid.invite(g, { to: g2.username }), /sala tuya/);
  assert.throws(() => raid.invite(host, { to: 'nadie' }), /no encontrado/);
  raid.invite(host, { to: g.username });
  const note = require('../server/notify').list(g).list[0];
  assert.strictEqual(note.kind, 'raid');
  assert.ok(note.text.includes(r.raid.code) && note.text.includes(host.username));
  for (let i = 0; i < 5; i++) raid.invite(host, { to: g2.username });
  assert.throws(() => raid.invite(host, { to: g.username }), /Máximo 6/);
  void solo;
});

// ---- Auditoría ----
test('reclamar con 5 copias del jefe: se rechaza antes de gastar la Ball y la captura sigue disponible', () => {
  clean();
  const u = user([6]);
  const b = raid.bossOf(raid.dayKey(DAY), 1, 0);
  u.collection[b.id] = { n: 5, s: 0 };
  sp.syncAll(u);
  u.items['poke-ball'] = 3;
  const d = raid.dayState(u, DAY);
  d.claims.push({ id: 'abc', rid: 'x', star: 1, boss: b.id, tera: b.tera, level: 20, at: DAY });
  assert.throws(() => raid.claim(u, { claim: 'abc', ball: 'poke-ball' }, DAY), /Ya tienes 5/);
  assert.strictEqual(u.items['poke-ball'], 3, 'la Ball no se gasta');
  assert.strictEqual(d.claims.length, 1, 'el claim sigue');
});

test('una incursión abandonada por todos se limpia (tiene endedAt)', () => {
  clean();
  const u = user([6]);
  mk(u, 1, 'solo');
  const r = raid.raidOf(u.id);
  raid.leave(u);
  assert.strictEqual(r.state, 'abandoned');
  assert.ok(r.endedAt > 0);
  raid.tick(Date.now() + raid.KEEP_MS + 1000);
  assert.ok(!raid.store()[r.id]);
});

test('elegir en la incursión: el movimiento debe ser un entero y la Tera solo con true', () => {
  clean();
  const u = user([6]);
  mk(u, 1, 'solo');
  for (const bad of ['0', 1.5, null, undefined, {}, [0], NaN]) assert.throws(() => raid.choose(u, { move: bad }, DAY), /Movimiento no válido/, String(bad));
  raid.choose(u, { move: 0, tera: 'false' }, DAY); // «false» (texto) no es true: no teracristaliza
  const r = raid.raidOf(u.id);
  const p = r.players.find((x) => x.userId === u.id);
  assert.ok(!p.mon.teraUsed && !p.mon.teraOn);
});

test('invitaciones a Teraincursión: tope diario por usuario', () => {
  clean();
  const h = user([6]); const g = user([6]);
  mk(h, 1, 'open');
  h.invDay = { d: new Date().toISOString().slice(0, 10), n: require('../server/transfer').INVITES_DAILY };
  assert.throws(() => raid.invite(h, { to: g.username }), /invitaciones/);
});
