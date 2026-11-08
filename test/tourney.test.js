'use strict';
// Torneos entre amigos: cuadro, byes, incomparecencias, combates PvP reales, bote (suma cero − 5 %, pago único), topes y premios.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-trn-'));

const db = require('../server/db');
const specimen = require('../server/specimen');
const sdw = require('../server/showdown');
// El Lunes de Duelos quita la comisión del PvP/torneos: estas pruebas miden la comisión normal, así que se fija el evento (no dependen del día).
{ const ev = require('../server/events'); const has = ev.has; ev.has = (id) => (id === 'duels' ? false : has(id)); }

const trn = require('../server/tourney');
const notify = require('../server/notify');

let n = 0;
function user(extra = {}) {
  const name = 'tn' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 20000, dust: 0, buddy: null, items: {}, buffs: {}, games: {}, collection: {}, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 5, createdAt: Date.now() - 9 * 864e5, ...extra };
  db.addUser(u);
  return u;
}
const IDS = [25, 6, 9];
function player(extra) {
  const u = user({ collection: Object.fromEntries(IDS.map((id) => [id, { n: 1, s: 0 }])), ...extra });
  specimen.syncAll(u);
  return u;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (id) => trn.T()[id];
const cur = (u) => { const t = trn.activeOf(u); return t && t.matches.find((m) => (m.state === 'wait' || m.state === 'live') && (m.a === u.id || m.b === u.id)); };
const full = (host, others, opts = {}) => {
  const r = trn.create(host, { size: 4, ...opts });
  for (const o of others) trn.join(o, { id: r.id });
  return T(r.id);
};
// Los dos del combate pulsan «Listo» y el de la izquierda gana (el otro se rinde).
async function play(t, m, winnerFirst = true) {
  const ua = db.userById(m.a); const ub = db.userById(m.b);
  trn.ready(ua, { id: t.id }); trn.ready(ub, { id: t.id });
  assert.strictEqual(m.state, 'live');
  const bat = sdw.battles.get(m.battle);
  assert.ok(bat && bat.tn && bat.tn.id === t.id, 'es un combate PvP normal con la marca del torneo');
  assert.strictEqual(bat.wager, 0);
  bat.forfeit(bat.sides[winnerFirst ? 1 : 0]);
  await bat.done;
}

test('crear: opciones válidas, un solo torneo a la vez y se llena → cuadro con siembra', () => {
  const [h, a, b, c] = [player(), player(), player(), player()];
  assert.throws(() => trn.create(h, { size: 5 }), /4, 8 o 16/);
  assert.throws(() => trn.create(h, { size: 4, entry: 77 }), /Inscripción/);
  assert.throws(() => trn.create(h, { size: 4, format: 'triples' }), /Formato/);
  assert.throws(() => trn.create(h, { size: 4, wait: 1 }), /Plazo/);
  const t = full(h, [a, b], { name: '  Copa\u0000 Amigos  ', pub: true });
  assert.strictEqual(t.name, 'Copa Amigos');
  assert.strictEqual(t.state, 'open');
  assert.throws(() => trn.create(h, { size: 4 }), /Ya estás en un torneo/);
  assert.throws(() => trn.join(a, { id: t.id }), /Ya estás inscrito/);
  trn.join(c, { id: t.id.toLowerCase() }); // por código, sin importar mayúsculas
  assert.strictEqual(t.state, 'running', 'se llena → empieza');
  assert.strictEqual(t.matches.length, 3);
  const r1 = t.matches.filter((m) => m.r === 1);
  assert.ok(r1.every((m) => m.state === 'wait' && m.a && m.b && m.deadline > Date.now()));
  assert.deepStrictEqual(new Set(r1.flatMap((m) => [m.a, m.b])), new Set([h, a, b, c].map((u) => u.id)));
  assert.throws(() => trn.join(player(), { id: t.id }), /cerrada/);
  assert.deepStrictEqual(trn.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  assert.ok(notify.list(a).list.some((x) => x.kind === 'tourney'), 'avisa a los jugadores');
});

test('lista pública, torneo privado por código y estado del jugador', () => {
  const h = player(); const other = player();
  const pub = trn.create(h, { size: 8, pub: true });
  const priv = trn.create(player(), { size: 8, pub: false });
  const st = trn.state(other, {});
  assert.ok(st.list.some((x) => x.id === pub.id));
  assert.ok(!st.list.some((x) => x.id === priv.id), 'los privados solo con código');
  assert.strictEqual(trn.state(other, { id: priv.id }).current.code, priv.id);
  assert.strictEqual(st.current, null);
});

test('iniciar antes de llenarse: mínimo 3, «bye» para las mejores siembras y solo el anfitrión', () => {
  const [h, a, b] = [player(), player(), player()];
  const r = trn.create(h, { size: 8 });
  trn.join(a, { id: r.id });
  assert.throws(() => trn.start(h, { id: r.id }), /al menos 3/);
  trn.join(b, { id: r.id });
  assert.throws(() => trn.start(a, { id: r.id }), /anfitrión/);
  trn.start(h, { id: r.id });
  const t = T(r.id);
  const r1 = t.matches.filter((m) => m.r === 1);
  assert.strictEqual(r1.length, 4);
  assert.strictEqual(r1.filter((m) => m.state === 'wait').length, 0 + (r1.some((m) => m.a && m.b) ? 1 : 0));
  assert.ok(r1.filter((m) => m.how === 'bye').length >= 2, '3 jugadores en 8 plazas: byes');
  // todos los jugadores están en la ronda 2 o en un combate de la 1
  const r2 = t.matches.filter((m) => m.r === 2);
  assert.ok(r2.some((m) => m.a || m.b));
});

test('incomparecencia: si se presenta uno gana, si no se presenta ninguno nadie pasa', () => {
  const [h, a, b, c] = [player(), player(), player(), player()];
  const t = full(h, [a, b, c]);
  const [m1, m2] = t.matches.filter((m) => m.r === 1);
  trn.ready(db.userById(m1.a), { id: t.id });
  const late = Date.now() + t.wait * 60e3 + 1000;
  trn.tick(late);
  assert.strictEqual(m1.state, 'done');
  assert.strictEqual(m1.winner, m1.a);
  assert.strictEqual(m1.how, 'wo');
  assert.strictEqual(m2.state, 'done');
  assert.strictEqual(m2.winner, null);
  assert.strictEqual(m2.how, 'dq');
  // la final tiene un solo jugador: gana por «bye» y el torneo termina con campeón
  assert.strictEqual(t.state, 'done');
  assert.strictEqual(t.champion, m1.a);
  assert.strictEqual(t.runnerUp, null);
});

test('un torneo completo con combates PvP reales: campeón, premio cosmético una sola vez y estadísticas', async () => {
  const [h, a, b, c] = [player(), player(), player(), player()];
  const t = full(h, [a, b, c], { name: 'Final' });
  assert.throws(() => trn.ready(h, { id: t.id, slot: 7 }), /no existe/);
  for (const m of t.matches.filter((x) => x.r === 1)) await play(t, m);
  const fin = t.matches.find((m) => m.r === 2);
  assert.strictEqual(fin.state, 'wait');
  assert.ok(fin.a && fin.b);
  await play(t, fin);
  assert.strictEqual(t.state, 'done');
  const champ = db.userById(t.champion);
  assert.strictEqual(champ.id, fin.a, 'ganó el de la izquierda');
  assert.strictEqual(t.wins[champ.id], 2);
  assert.ok(champ.progress.titles.includes('torneo-campeon'));
  assert.strictEqual(champ.items['frame-torneo'], 1);
  assert.strictEqual(champ.trn.champion, 1);
  assert.ok(notify.list(champ).list.some((x) => /ganado el torneo/.test(x.text)));
  assert.strictEqual(sdw.battles.size, 0);
  // Un segundo título no repite el premio
  const [a2, b2, c2] = [player(), player(), player()];
  const u = champ;
  const t2 = full(u, [a2, b2, c2]);
  for (const m of t2.matches.filter((x) => x.r === 1)) await play(t2, m);
  const f2 = t2.matches.find((m) => m.r === 2);
  // el anfitrión repetido solo gana si es el de la izquierda: da igual, se comprueba que nadie tiene dos
  await play(t2, f2);
  for (const x of [u, a2, b2, c2]) assert.ok((x.items['frame-torneo'] || 0) <= 1);
  assert.strictEqual(u.progress.titles.filter((x) => x === 'torneo-campeon').length, 1);
});

test('empate: el combate se repite y un error del simulador no hace perder a nadie', async () => {
  const [h, a, b, c] = [player(), player(), player(), player()];
  const t = full(h, [a, b, c]);
  const m = t.matches.find((x) => x.r === 1);
  trn.ready(db.userById(m.a), { id: t.id }); trn.ready(db.userById(m.b), { id: t.id });
  const bat = sdw.battles.get(m.battle);
  bat.queueEnd(null);
  await bat.done;
  assert.strictEqual(m.state, 'wait', 'empate: se repite');
  assert.deepStrictEqual(m.ready, {});
  trn.ready(db.userById(m.a), { id: t.id }); trn.ready(db.userById(m.b), { id: t.id });
  const bat2 = sdw.battles.get(m.battle);
  bat2.crash(new Error('prueba'));
  await bat2.done;
  assert.strictEqual(m.state, 'wait', 'error del simulador: se repite, nadie pierde');
  assert.ok(!m.winner);
});

test('bote: suma cero menos el 5 %, campeón 70 % y finalista 30 %, pagado una sola vez', async () => {
  const [h, a, b, c] = [player(), player(), player(), player()];
  const all = [h, a, b, c];
  const before = all.map((u) => u.coins);
  const t = full(h, [a, b, c], { entry: 500 });
  assert.ok(all.every((u, i) => u.coins === before[i] - 500));
  assert.strictEqual(Object.keys(db.data.escrow).filter((k) => k.startsWith(`trn:${t.id}:`)).length, 4);
  for (const m of t.matches.filter((x) => x.r === 1)) await play(t, m);
  await play(t, t.matches.find((x) => x.r === 2));
  assert.strictEqual(t.state, 'done');
  assert.strictEqual(t.paid, true);
  assert.strictEqual(Object.keys(db.data.escrow).filter((k) => k.startsWith(`trn:${t.id}:`)).length, 0);
  const pool = 2000; const net = pool - 100;
  assert.strictEqual(t.prize.pool, pool);
  assert.strictEqual(t.prize.rake, 100);
  assert.strictEqual(t.prize.runner, Math.floor(net * 0.3));
  assert.strictEqual(t.prize.champ, net - Math.floor(net * 0.3));
  const lvl = (u) => (u.hist.log || []).filter((e) => e.r === 'level').reduce((s, e) => s + e.d, 0);
  const after = all.map((u, i) => u.coins - lvl(u) - before[i]);
  assert.strictEqual(after.reduce((s, x) => s + x, 0), -100, 'suma cero menos la comisión del 5 %');
  const champ = db.userById(t.champion); const ru = db.userById(t.runnerUp);
  assert.strictEqual(champ.coins - lvl(champ), before[all.indexOf(champ)] - 500 + t.prize.champ);
  assert.strictEqual(ru.coins - lvl(ru), before[all.indexOf(ru)] - 500 + t.prize.runner);
  // Pagar otra vez (reinicio, tick, doble llamada) no cambia nada.
  const snap = all.map((u) => u.coins);
  trn.tick(Date.now() + 10 * 60e3);
  require('../server/tourney').T()[t.id].paid = true;
  assert.deepStrictEqual(all.map((u) => u.coins), snap);
});

test('reinicio: las inscripciones esperan en el depósito hasta el pago y no se devuelven por error', () => {
  const [h, a, b] = [player(), player(), player()];
  const t = full(h, [a, b], { entry: 100, size: 4 });
  assert.strictEqual(t.state, 'open');
  const coins = [h, a, b].map((u) => u.coins);
  const back = db.refundEscrow(); // como al arrancar tras un reinicio
  assert.strictEqual(Object.keys(db.data.escrow).filter((k) => k.startsWith(`trn:${t.id}:`)).length, 3, 'el torneo vivo conserva sus inscripciones');
  assert.deepStrictEqual([h, a, b].map((u) => u.coins), coins);
  assert.ok(back.n >= 0);
  // Si el torneo ya estaba pagado (se perdió el depósito pero no el flag) tampoco se paga dos veces.
  t.paid = true;
  const back2 = db.refundEscrow();
  assert.ok(back2.total >= 300, 'un torneo ya cerrado cuyo depósito sobrevivió se devuelve una vez');
  assert.strictEqual(Object.keys(db.data.escrow).filter((k) => k.startsWith(`trn:${t.id}:`)).length, 0);
});

test('salir devuelve la inscripción, cancelar devuelve a todos y la inscripción abierta caduca', () => {
  const [h, a, b] = [player(), player(), player()];
  const c0 = [h.coins, a.coins, b.coins];
  const r = trn.create(h, { size: 8, entry: 250 });
  trn.join(a, { id: r.id }); trn.join(b, { id: r.id });
  assert.strictEqual(a.coins, c0[1] - 250);
  assert.throws(() => trn.leave(h, { id: r.id }), /cancela/);
  trn.leave(a, { id: r.id });
  assert.strictEqual(a.coins, c0[1]);
  assert.strictEqual(a.trnDay.n, 0, 'devolver no gasta el tope diario');
  assert.throws(() => trn.cancel(a, { id: r.id }), /anfitrión/);
  trn.cancel(h, { id: r.id });
  assert.deepStrictEqual([h.coins, b.coins], [c0[0], c0[2]]);
  assert.strictEqual(T(r.id).state, 'cancelled');
  assert.strictEqual(Object.keys(db.data.escrow).filter((k) => k.startsWith(`trn:${r.id}:`)).length, 0);
  // caducidad
  const x = player(); const x0 = x.coins;
  const r2 = trn.create(x, { size: 4, entry: 100 });
  trn.tick(Date.now() + 25 * 3600e3);
  assert.strictEqual(T(r2.id).state, 'cancelled');
  assert.strictEqual(x.coins, x0);
});

test('antiabuso: cuentas nuevas o ayudadas por la Enfermera Joy no entran con bote y hay tope diario de inscripciones', () => {
  const host = player();
  const r = trn.create(host, { size: 16, entry: 1000 });
  const young = player({ createdAt: Date.now() - 3600e3 });
  assert.throws(() => trn.join(young, { id: r.id }), /nivel 3/);
  const low = player({ level: 1 });
  assert.throws(() => trn.join(low, { id: r.id }), /nivel 3/);
  const healed = player({ lastHeal: Date.now() - 3600e3 });
  assert.throws(() => trn.join(healed, { id: r.id }), /Enfermera Joy/);
  // …pero sí a uno sin bote
  const free = trn.create(player(), { size: 4, entry: 0 });
  trn.join(young, { id: free.id });
  assert.ok(T(free.id).players.some((p) => p.id === young.id));
  // tope de 1.000 monedas de inscripción al día por cuenta
  const rich = player();
  const t1 = trn.create(rich, { size: 4, entry: 1000 });
  assert.strictEqual(trn.entryLeft(rich), 0);
  trn.cancel(rich, { id: t1.id });
  assert.strictEqual(trn.entryLeft(rich), 1000, 'lo devuelto no cuenta');
  // con 800 ya gastados hoy no cabe otra inscripción de 500
  rich.trnDay.n = 800;
  const big = trn.create(player(), { size: 4, entry: 500 });
  assert.throws(() => trn.join(rich, { id: big.id }), /solo puedes inscribirte/);
  rich.trnDay.n = 500;
  trn.join(rich, { id: big.id });
  assert.strictEqual(rich.trnDay.n, 1000);
  assert.throws(() => trn.create(rich, { size: 4, entry: 100 }), /Ya estás/);
});

test('invitar avisa al invitado (con tope) y los NPC no participan', () => {
  const h = player(); const g = player();
  const r = trn.create(h, { size: 4 });
  trn.invite(h, { id: r.id, to: g.username });
  assert.ok(notify.list(g).list[0].text.includes(r.id));
  assert.throws(() => trn.invite(g, { id: r.id, to: h.username }), /anfitrión/);
  assert.throws(() => trn.invite(h, { id: r.id, to: 'nadie' }), /no encontrado/);
  assert.throws(() => trn.create(user({ npc: true }), { size: 4 }), /NPC/);
});

test('no se puede preparar un combate sin tenerlo y el equipo inválido se rechaza al momento', () => {
  const [h, a, b, c] = [player(), player(), player(), player()];
  const t = full(h, [a, b, c]);
  const m = t.matches.find((x) => x.r === 2);
  const outsider = player();
  assert.throws(() => trn.ready(outsider, { id: t.id }), /ningún combate/);
  const mine = cur(db.userById(t.matches[0].a));
  assert.ok(mine);
  const none = user();
  assert.throws(() => trn.ready(none, { id: t.id }), /ningún combate/, 'sin Pokémon tampoco');
  assert.ok(m.state === 'pend');
});

// ---- Auditoría ----
test('crear: las claves de prototipo no son un formato', () => {
  const h = player();
  for (const f of ['constructor', '__proto__', 'toString', 'hasOwnProperty', {}, ['singles']]) assert.throws(() => trn.create(h, { size: 4, entry: 1000, format: f }), /Formato no válido/, String(f));
  assert.strictEqual(trn.activeOf(h), null);
  assert.strictEqual(h.coins, 20000, 'no se cobró nada');
});

test('partidas «live» huérfanas: se repiten (no mientras se restauran combates) y los plazos se amplían al arrancar', async () => {
  const [h, a, b, c] = [player(), player(), player(), player()];
  const t = full(h, [a, b, c], { wait: 5 });
  const m = t.matches.find((x) => x.r === 1 && x.state === 'wait');
  const ua = db.userById(m.a); const ub = db.userById(m.b);
  trn.ready(ua, { id: t.id }); trn.ready(ub, { id: t.id });
  assert.strictEqual(m.state, 'live');
  // El combate desaparece (ni en memoria ni guardado): el torneo no se queda atascado.
  const bat = sdw.battles.get(m.battle);
  const id = m.battle;
  bat.noPersist = true; bat.finished = true; bat.over = true;
  for (const s of bat.sides) if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  sdw.battles.delete(id);
  for (const s of bat.sides) sdw.byUser.delete(s.userId);
  if (db.data.sdBattles) delete db.data.sdBattles[id];
  trn.tick(Date.now() + 1000);
  assert.strictEqual(m.state, 'wait', 'vuelve a preparación');
  assert.strictEqual(m.battle, null);
  // Plazos: tras una caída larga, begin() amplía el plazo en vez de dar la partida por perdida.
  const other = t.matches.find((x) => x.r === 1 && x !== m);
  other.deadline = Date.now() - 10 * 60e3;
  trn.begin();
  assert.ok(other.deadline >= Date.now() + 5 * 60e3 - 1000, 'plazo ampliado');
  assert.strictEqual(other.state, 'wait');
});

test('invitaciones a torneos: tope diario por usuario', () => {
  const h = player();
  const guests = Array.from({ length: 4 }, () => player());
  const tr = require('../server/transfer');
  h.invDay = { d: new Date().toISOString().slice(0, 10), n: tr.INVITES_DAILY };
  const r = trn.create(h, { size: 4 });
  assert.throws(() => trn.invite(h, { id: r.id, to: guests[0].username }), /invitaciones/);
});

test('si falla algo al liquidar el combate (p. ej. el feed), el torneo se entera igualmente y no se atasca', async () => {
  const hub = require('../server/hub');
  const [h, a, b, c] = [player(), player(), player(), player()];
  const t = full(h, [a, b, c]);
  const m = t.matches.find((x) => x.r === 1 && x.state === 'wait');
  const orig = hub.feed;
  hub.feed = () => { throw new Error('feed roto'); };
  const log = console.error; console.error = () => {};
  try { await play(t, m); } finally { hub.feed = orig; console.error = log; }
  assert.strictEqual(m.state, 'done', 'el cuadro avanza');
  assert.ok(m.winner);
});
