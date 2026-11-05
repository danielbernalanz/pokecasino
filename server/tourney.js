'use strict';
// Torneos entre amigos: eliminación directa de 4, 8 o 16 plazas, Individual o Dobles, nivel 50 justo (como el VGC) o niveles reales y las
// mismas opciones de amistad y Teracristalización que los retos PvP. Cada ronda es un combate PvP NORMAL (showdown.js: mismo simulador, mismos
// turnos y tiempos), con la marca `tn` para avisar a este módulo cuando acaba. El anfitrión es cualquier jugador.
//
//  · INSCRIPCIÓN: por código (5 letras) o desde la lista pública. El cuadro se genera al llenarse las plazas o cuando el anfitrión lo inicia
//    (mínimo 3 jugadores: las plazas libres son «bye» para las mejores siembras). Cada jugador está como mucho en un torneo a la vez.
//  · RONDAS: cada combate tiene un plazo (5/10/15 min) desde que los dos rivales están definidos; cada uno elige equipo («Listo»). Quien no se
//    presenta pierde (si lo hace uno solo, gana el otro por incomparecencia; si no se presenta ninguno, nadie pasa y el siguiente rival
//    avanza solo). Un empate se repite.
//  · BOTE (opcional): inscripción de 0/100/250/500/1.000 monedas. Suma cero MENOS la misma comisión del PvP (5 %, 0 % el Lunes de Duelos): el
//    campeón se lleva el 70 % y el finalista el 30 % del bote neto. Cada inscripción queda en `db.data.escrow` («trn:<id>:<jugador>») hasta
//    el pago, así que un reinicio ni la pierde ni la paga dos veces (`t.paid`). Sin campeón (nadie se presentó a la final) se devuelve todo.
//  · ANTIABUSO: con bote hace falta cuenta no nueva ni ayudada por la Enfermera Joy (transfer.young/healed) y cada cuenta puede inscribirse
//    como mucho por 1.000 monedas al día (las devoluciones no cuentan), así que no sirve para pasar monedas a una cuenta principal.
//  · PREMIO: el título «Campeón de Torneo» y el Marco Trofeo al ganar (una sola vez), solo si había ≥ 4 inscritos y el campeón ganó ≥ 2 combates reales.
const crypto = require('crypto');
const db = require('./db');
const hub = require('./hub');
const tr = require('./transfer');
const notify = require('./notify');

const SIZES = [4, 8, 16];
const ENTRIES = [0, 100, 250, 500, 1000];
const ENTRY_DAILY = 1000;
const WAITS = [5, 10, 15];
const RAKE = 0.05;
const SHARE_CHAMP = 0.7;
const MIN_PLAYERS = 3;
const MAX_ACTIVE = 30; // torneos sin terminar a la vez en el casino
const OPEN_MS = 24 * 3600e3; // una inscripción abierta se cancela (y se devuelve) a las 24 h
const KEEP_MS = 24 * 3600e3; // un torneo terminado se conserva 24 h
const EXTRA_MS = 2 * 60e3; // si los dos están listos pero no cabe el combate, se prolonga el plazo
const INVITES = 10;
const NAME_MAX = 24;
const CHAMP_TITLE = 'torneo-campeon';
const CHAMP_FRAME = 'frame-torneo';
const STATIC = { sizes: SIZES, entries: ENTRIES, entryDaily: ENTRY_DAILY, waits: WAITS, rake: RAKE, champ: SHARE_CHAMP, min: MIN_PLAYERS };

const T = () => (db.data.tourneys ||= {});
const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const showdown = () => require('./showdown');
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => { for (;;) { const c = Array.from({ length: 5 }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join(''); if (!T()[c]) return c; } };
const clean = (s) => Array.from(String(s ?? '').replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').trim()).slice(0, NAME_MAX).join('').trim();
const flag = (v) => { if (v === undefined || v === null) return true; if (typeof v !== 'boolean') throw new Error('Opción no válida.'); return v; };
const rounds = (t) => Math.log2(t.size);
const active = (t) => t.state === 'open' || t.state === 'running';
const nameOf = (id) => (db.userById(id) || {}).username || '?';
const escKey = (t, id) => `trn:${t.id}:${id}`;

// Torneo sin terminar en el que está el jugador (como mucho uno).
const activeOf = (u) => Object.values(T()).find((t) => active(t) && t.players.some((p) => p.id === u.id)) || null;
const get = (id) => { const t = T()[String(id || '').toUpperCase()]; if (!t) throw new Error('Ese torneo no existe (o ya terminó hace tiempo).'); return t; };

// ---- Inscripción y bote ----
function entryLeft(u, now = Date.now()) {
  const d = dayKey(now);
  if (!u.trnDay || u.trnDay.d !== d) u.trnDay = { d, n: 0 };
  return Math.max(0, ENTRY_DAILY - u.trnDay.n);
}
function canPot(u, now) {
  if (u.isAdmin) return;
  if (tr.young(u, now)) throw new Error(`Los torneos con bote piden nivel ${tr.GIFT_MIN_LEVEL} y una cuenta de al menos ${tr.GIFT_MIN_DAYS} días (puedes entrar a uno sin bote).`);
  if (tr.healed(u, now)) throw new Error('La Enfermera Joy te ayudó hace menos de 24 h: hasta entonces no puedes entrar en torneos con bote.');
}
function charge(u, t, now) {
  if (!t.entry) return;
  canPot(u, now);
  if (u.coins < t.entry) throw new Error(`La inscripción cuesta ${t.entry.toLocaleString('es')} monedas.`);
  if (entryLeft(u, now) < t.entry) throw new Error(`Hoy solo puedes inscribirte en torneos por ${ENTRY_DAILY.toLocaleString('es')} monedas en total (te quedan ${entryLeft(u, now).toLocaleString('es')}).`);
  hub.takeBet(u, t.entry, 'duel', { quiet: true, noXp: true });
  u.trnDay.n += t.entry;
  db.escrowSet(escKey(t, u.id), u.id, t.entry);
}
function refund(u, t, now = Date.now()) {
  if (!t.entry || !u || !db.data.escrow[escKey(t, u.id)]) return;
  db.escrowDel(escKey(t, u.id));
  u.coins += t.entry; u.stats.wagered -= t.entry;
  hub.gameStat(u, 'duel', -t.entry, 0, -1);
  entryLeft(u, now); u.trnDay.n = Math.max(0, u.trnDay.n - t.entry);
  hub.pushMe(u);
}
const rakeOf = (pool) => (require('./events').has('duels') ? 0 : Math.floor(pool * RAKE));
function pot(t, withRunner = true) {
  const pool = t.entry * t.players.length;
  const rake = rakeOf(pool);
  const net = pool - rake;
  const runner = withRunner ? Math.floor(net * (1 - SHARE_CHAMP)) : 0;
  return { pool, rake, net, champ: net - runner, runner };
}

// ---- Acciones ----
function create(u, p = {}, now = Date.now()) {
  if (u.npc) throw new Error('Los comerciantes NPC no organizan torneos.');
  if (activeOf(u)) throw new Error('Ya estás en un torneo: termínalo (o sal de él) antes de crear otro.');
  if (Object.values(T()).filter(active).length >= MAX_ACTIVE) throw new Error('Hay demasiados torneos abiertos ahora mismo.');
  const size = Number(p.size);
  const entry = Number(p.entry || 0);
  const wait = Number(p.wait || 10);
  const format = p.format || 'singles';
  const level = p.level || 'fair';
  if (!SIZES.includes(size)) throw new Error('Un torneo es de 4, 8 o 16 plazas.');
  if (!ENTRIES.includes(entry)) throw new Error('Inscripción no válida.');
  if (!WAITS.includes(wait)) throw new Error('Plazo por combate no válido.');
  if (!showdown().FORMATS[format]) throw new Error('Formato no válido.');
  if (level !== 'fair' && level !== 'real') throw new Error('Regla de nivel no válida.');
  const name = clean(p.name) || `Torneo de ${u.username}`;
  const t = { id: newCode(), name, host: u.id, size, format, level, bond: flag(p.bond), tera: flag(p.tera), pub: p.pub === true, entry, wait, state: 'open', at: now, players: [], matches: [], wins: {}, invites: 0, paid: false };
  charge(u, t, now);
  t.players.push({ id: u.id, name: u.username });
  T()[t.id] = t;
  db.save();
  changed(t);
  return { id: t.id, ...state(u, { id: t.id }) };
}

function join(u, p = {}, now = Date.now()) {
  if (u.npc) throw new Error('Los comerciantes NPC no juegan torneos.');
  const t = get(p.id);
  if (t.state !== 'open') throw new Error('La inscripción de este torneo ya está cerrada.');
  if (t.players.some((x) => x.id === u.id)) throw new Error('Ya estás inscrito.');
  if (activeOf(u)) throw new Error('Ya estás en otro torneo: termínalo antes de inscribirte en este.');
  if (t.players.length >= t.size) throw new Error('El torneo está completo.');
  charge(u, t, now);
  t.players.push({ id: u.id, name: u.username });
  db.save();
  if (t.players.length >= t.size) begin(t, now);
  changed(t);
  return state(u, { id: t.id });
}

function leave(u, p = {}, now = Date.now()) {
  const t = get(p.id);
  if (t.state !== 'open') throw new Error('Una vez empezado el cuadro no se puede abandonar: pierdes por incomparecencia si no juegas.');
  if (t.host === u.id) throw new Error('Eres el anfitrión: cancela el torneo para devolver las inscripciones.');
  const i = t.players.findIndex((x) => x.id === u.id);
  if (i < 0) throw new Error('No estás inscrito.');
  t.players.splice(i, 1);
  refund(u, t, now);
  db.save();
  changed(t);
  return state(u, {});
}

function cancel(u, p = {}, now = Date.now()) {
  const t = get(p.id);
  if (t.host !== u.id && !u.isAdmin) throw new Error('Solo el anfitrión puede cancelar el torneo.');
  if (!active(t)) throw new Error('El torneo ya terminó.');
  if (t.state === 'running' && !u.isAdmin) throw new Error('Con el cuadro en marcha solo un administrador puede cancelarlo.');
  shutdown(t, 'cancelled', now, `${u.username} ha cancelado el torneo «${t.name}»: se devuelven las inscripciones.`);
  return state(u, {});
}

function invite(u, p = {}) {
  const t = get(p.id);
  if (t.host !== u.id) throw new Error('Solo el anfitrión invita.');
  if (t.state !== 'open') throw new Error('La inscripción ya está cerrada.');
  const to = db.userByName(String(p.to || ''));
  if (!to || to.npc || to.id === u.id) throw new Error('Jugador no encontrado.');
  if (t.invites >= INVITES) throw new Error(`Máximo ${INVITES} invitaciones por torneo: comparte el código ${t.id}.`);
  t.invites++;
  db.save();
  notify.push(to, { kind: 'tourney', text: `🏆 ${u.username} te invita al torneo «${t.name}» (código ${t.id})`, link: '#/torneos', toast: true });
  return {};
}

function start(u, p = {}, now = Date.now()) {
  const t = get(p.id);
  if (t.host !== u.id && !u.isAdmin) throw new Error('Solo el anfitrión puede iniciar el torneo.');
  if (t.state !== 'open') throw new Error('El torneo ya ha empezado.');
  if (t.players.length < MIN_PLAYERS) throw new Error(`Hacen falta al menos ${MIN_PLAYERS} jugadores.`);
  begin(t, now);
  changed(t);
  return state(u, { id: t.id });
}

// ---- Cuadro ----
// Orden de siembra estándar: 1 contra N, 4 contra N-3… (las mejores siembras reciben los «bye» si faltan jugadores).
function seedOrder(N) {
  let r = [1];
  while (r.length < N) { const m = r.length * 2 + 1; r = r.flatMap((s) => [s, m - s]); }
  return r;
}
function begin(t, now = Date.now()) {
  const order = t.players.map((p) => p.id);
  for (let i = order.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  t.players = order.map((id, i) => ({ id, name: nameOf(id), seed: i + 1 }));
  const N = t.size;
  t.matches = [];
  for (let r = 1; r <= rounds(t); r++) for (let i = 0; i < N / 2 ** r; i++) t.matches.push({ r, i, a: null, b: null, pa: r > 1, pb: r > 1, state: 'pend', winner: null, how: null, deadline: 0, ready: {}, teams: {}, battle: null });
  const ord = seedOrder(N);
  const bySeed = (s) => (t.players[s - 1] ? t.players[s - 1].id : null);
  t.matches.filter((m) => m.r === 1).forEach((m) => { m.a = bySeed(ord[2 * m.i]); m.b = bySeed(ord[2 * m.i + 1]); });
  t.state = 'running';
  t.startedAt = now;
  for (const p of t.players) {
    const u = db.userById(p.id);
    if (u) { (u.trn ||= { played: 0, won: 0, champion: 0 }).played++; notify.push(u, { kind: 'tourney', text: `🏆 ¡Empieza el torneo «${t.name}»! Entra en Torneos y pulsa «Listo» en tu combate.`, link: '#/torneos', toast: true }); }
  }
  hub.feed('duel', `🏆 Empieza el torneo «${t.name}» con ${t.players.length} entrenadores${t.entry ? ` (inscripción ${t.entry.toLocaleString('es')})` : ''}`);
  db.save();
  for (const m of t.matches.filter((x) => x.r === 1)) activate(t, m, now);
}
const matchAt = (t, r, i) => t.matches.find((m) => m.r === r && m.i === i);

// Cuando los dos lados de un combate ya están definidos: o se juega, o es un «bye» (pasa el que haya).
function activate(t, m, now) {
  if (t.state !== 'running' || m.state !== 'pend' || m.pa || m.pb) return;
  if (m.a && m.b) {
    m.state = 'wait';
    m.deadline = now + t.wait * 60e3;
    m.ready = {}; m.teams = {};
    for (const id of [m.a, m.b]) {
      const other = id === m.a ? m.b : m.a;
      notify.push(db.userById(id), { kind: 'tourney', text: `⚔️ Torneo «${t.name}»: ronda ${m.r}, te toca contra ${nameOf(other)}. Tienes ${t.wait} min para pulsar «Listo».`, link: '#/torneos', toast: true });
    }
  } else advance(t, m, m.a || m.b || null, m.a || m.b ? 'bye' : 'none', now);
}

function advance(t, m, winner, how, now = Date.now()) {
  m.state = 'done'; m.winner = winner; m.how = how; m.deadline = 0; m.battle = null;
  for (const loser of [m.a, m.b].filter((x) => x && x !== winner)) {
    if (how === 'bye') break;
    notify.push(db.userById(loser), { kind: 'tourney', text: `🏆 Torneo «${t.name}»: quedas eliminado en la ronda ${m.r}${how === 'wo' || how === 'dq' ? ' por no presentarte' : ''}. ¡Gracias por jugar!`, link: '#/torneos' });
  }
  if (m.r === rounds(t)) return finish(t, m, now);
  const next = matchAt(t, m.r + 1, m.i >> 1);
  const slot = m.i % 2 ? 'b' : 'a';
  next[slot] = winner; next['p' + slot] = false;
  activate(t, next, now);
}

function finish(t, fin, now) {
  t.state = 'done'; t.endedAt = now;
  t.champion = fin.winner || null;
  t.runnerUp = fin.winner ? [fin.a, fin.b].find((x) => x && x !== fin.winner) || null : null;
  const champ = db.userById(t.champion);
  if (!champ) { shutdown(t, 'done', now, `El torneo «${t.name}» terminó sin campeón: nadie se presentó a la final. Se devuelven las inscripciones.`); return; }
  settleMoney(t);
  const ru = db.userById(t.runnerUp);
  (champ.trn ||= { played: 0, won: 0, champion: 0 }).champion++;
  champ.trn.won++;
  const gets = (!champ.trn.titled && t.players.length >= 4 && (t.wins[champ.id] || 0) >= 2) ? award(champ) : false;
  const pz = t.entry ? pot(t, !!ru) : null;
  notify.push(champ, { kind: 'tourney', text: `🏆 ¡Has ganado el torneo «${t.name}»!${pz ? ` Premio: ${pz.champ.toLocaleString('es')} monedas.` : ''}${gets ? ' Título «Campeón de Torneo» y Marco Trofeo conseguidos.' : ''}`, link: '#/torneos', toast: true });
  if (ru) notify.push(ru, { kind: 'tourney', text: `🥈 Eres finalista del torneo «${t.name}».${pz ? ` Premio: ${pz.runner.toLocaleString('es')} monedas.` : ''}`, link: '#/torneos' });
  hub.feed('duel', `🏆 ${champ.username} ha ganado el torneo «${t.name}»${ru ? ` (finalista: ${ru.username})` : ''}${pz ? ` y se lleva ${pz.champ.toLocaleString('es')} monedas` : ''}`);
  db.save();
  hub.pushMe(champ);
}

// Título y marco: una sola vez por cuenta.
function award(u) {
  u.trn.titled = true;
  const p = u.progress;
  if (p && !p.titles.includes(CHAMP_TITLE)) p.titles.push(CHAMP_TITLE);
  u.items[CHAMP_FRAME] = (u.items[CHAMP_FRAME] || 0) + 1;
  return true;
}

// Pago único del bote (el campeón, y el finalista si lo hay). Se marca `paid` ANTES de pagar: lo guardado nunca puede pagar dos veces.
function settleMoney(t) {
  if (t.paid) return;
  t.paid = true;
  if (!t.entry) { return; }
  for (const p of t.players) db.escrowDel(escKey(t, p.id));
  const ru = db.userById(t.runnerUp);
  const z = pot(t, !!ru);
  t.prize = { champ: z.champ, runner: ru ? z.runner : 0, rake: z.rake, pool: z.pool };
  const champ = db.userById(t.champion);
  if (champ && z.champ) hub.pay(champ, z.champ, t.entry, 'duel', { noBonus: true });
  if (ru && z.runner) { hub.pay(ru, z.runner, t.entry, 'duel', { noBonus: true }); hub.pushMe(ru); }
}

// Cierra el torneo sin campeón (cancelado o sin presentados): se devuelve todo y se avisa.
function shutdown(t, state, now, text) {
  if (t.paid) { t.state = state; db.save(); changed(t); return; }
  t.paid = true; t.state = state; t.endedAt = now;
  for (const p of t.players) {
    const u = db.userById(p.id);
    refund(u, t, now);
    db.escrowDel(escKey(t, p.id));
    if (u && text) notify.push(u, { kind: 'tourney', text: `🏆 ${text}`, link: '#/torneos' });
  }
  for (const m of t.matches) if (m.battle) m.battle = null;
  db.save();
  changed(t);
}

// ---- Combates ----
function autoTeam(u, format) {
  const n = format === 'doubles' ? 4 : 6;
  const box = showdown().boxForBuilder(u).mons.slice().sort((a, b) => b.level - a.level || b.iv - a.iv);
  const seen = new Set();
  const out = [];
  for (const m of box) { if (seen.has(m.id)) continue; seen.add(m.id); out.push({ id: m.id, uid: m.uid, mega: 0 }); if (out.length >= n) break; }
  return out;
}
function teamOf(u, t, p) {
  if (p.slot !== undefined && p.slot !== null && p.slot !== 'auto') {
    const slot = Number(p.slot);
    const saved = (u.btTeams || [])[slot];
    if (!Number.isInteger(slot) || !saved || !saved.members.length) throw new Error('Ese equipo guardado no existe.');
    return saved.members.map((m) => ({ id: m.id, uid: m.uid, mega: m.mega || 0 }));
  }
  const team = autoTeam(u, t.format);
  if (!team.length) throw new Error('Necesitas al menos un Pokémon para combatir.');
  return team;
}

function ready(u, p = {}, now = Date.now()) {
  const t = get(p.id);
  if (t.state !== 'running') throw new Error('El torneo no está en marcha.');
  const m = t.matches.find((x) => x.state === 'wait' && (x.a === u.id || x.b === u.id));
  if (!m) throw new Error('Ahora mismo no tienes ningún combate que preparar.');
  const team = teamOf(u, t, p);
  showdown().resolveTeam(u, team, { format: t.format, level: t.level, itemClause: true }); // valida (errores en español)
  m.teams[u.id] = team;
  m.ready[u.id] = true;
  db.save();
  tryStart(t, m, now);
  changed(t);
  return state(u, { id: t.id });
}

function tryStart(t, m, now = Date.now()) {
  if (m.state !== 'wait' || !m.ready[m.a] || !m.ready[m.b]) return false;
  const ua = db.userById(m.a); const ub = db.userById(m.b);
  if (!ua || !ub) return false;
  try {
    const b = showdown().startTourney(ua, ub, { format: t.format, level: t.level, bond: t.bond, tera: t.tera, teamA: m.teams[m.a], teamB: m.teams[m.b], tn: { id: t.id, r: m.r, i: m.i } });
    m.state = 'live'; m.battle = b.id; m.deadline = 0;
    db.save();
    return true;
  } catch (e) {
    if (e.team) { // el equipo de ese jugador ya no vale: se le pide otro
      const bad = e.side === 0 ? m.a : m.b;
      m.ready[bad] = false; delete m.teams[bad];
      notify.push(db.userById(bad), { kind: 'tourney', text: `⚠️ Tu equipo para el torneo «${t.name}» ya no es válido (${e.message}). Elige otro.`, link: '#/torneos', toast: true });
      db.save();
    } else if (now >= m.deadline) m.deadline = now + EXTRA_MS; // ocupados o sin sitio: se reintenta en el siguiente latido
    return false;
  }
}

// Lo llama showdown.settle al acabar un combate con la marca `tn`.
function onBattleEnd(b, now = Date.now()) {
  const t = T()[b.tn.id];
  const m = t && t.matches.find((x) => x.r === b.tn.r && x.i === b.tn.i);
  if (!m || m.state !== 'live' || m.battle !== b.id) return;
  if (b.winner === null || b.winner === undefined) { // empate: se repite
    m.state = 'wait'; m.battle = null; m.ready = {}; m.teams = {}; m.deadline = now + t.wait * 60e3;
    for (const id of [m.a, m.b]) notify.push(db.userById(id), { kind: 'tourney', text: `⚔️ Torneo «${t.name}»: empate. Hay que repetir el combate (pulsa «Listo»).`, link: '#/torneos', toast: true });
    db.save(); changed(t);
    return;
  }
  const win = b.sides[b.winner].userId;
  t.wins[win] = (t.wins[win] || 0) + 1;
  advance(t, m, win, 'battle', now);
  db.save(); changed(t);
}
// El combate se interrumpió (error del simulador o no se pudo restaurar): no es culpa de nadie, se vuelve a preparar.
function onAbort(tn, now = Date.now()) {
  const t = tn && T()[tn.id];
  const m = t && t.matches.find((x) => x.r === tn.r && x.i === tn.i);
  if (!m || m.state !== 'live') return;
  m.state = 'wait'; m.battle = null; m.ready = {}; m.teams = {}; m.deadline = now + t.wait * 60e3;
  for (const id of [m.a, m.b]) notify.push(db.userById(id), { kind: 'tourney', text: `⚔️ Torneo «${t.name}»: tu combate se interrumpió por un error. Pulsa «Listo» para repetirlo.`, link: '#/torneos', toast: true });
  db.save(); changed(t);
}

// ---- Temporizador: plazos, reintentos de combates y limpieza ----
function tick(now = Date.now()) {
  let any = false;
  for (const t of Object.values(T())) {
    if (t.state === 'open' && now - t.at > OPEN_MS) { shutdown(t, 'cancelled', now, `El torneo «${t.name}» no llegó a empezar en 24 h: se devuelven las inscripciones.`); any = true; continue; }
    if (t.state === 'done' || t.state === 'cancelled') { if (now - (t.endedAt || t.at) > KEEP_MS) { delete T()[t.id]; any = true; } continue; }
    if (t.state !== 'running') continue;
    for (const m of t.matches.filter((x) => x.state === 'wait')) {
      if (m.ready[m.a] && m.ready[m.b]) { if (tryStart(t, m, now)) any = true; }
      if (m.state !== 'wait' || now < m.deadline) continue;
      const ra = !!m.ready[m.a]; const rb = !!m.ready[m.b];
      if (ra && rb) continue; // los dos listos: ya se prolongó el plazo, se sigue reintentando
      advance(t, m, ra ? m.a : rb ? m.b : null, ra || rb ? 'wo' : 'dq', now);
      any = true;
    }
  }
  if (any) { db.save(); for (const t of Object.values(T())) if (active(t)) changed(t); }
  return any;
}
let timer = null;
function begin_() { // (al arrancar el casino)
  tick();
  if (!timer) { timer = setInterval(() => { try { tick(); } catch (e) { console.error('Torneos:', e); } }, 5000); timer.unref(); }
}

// ---- Vistas ----
function changed(t) { hub.broadcast('tourney:changed', { id: t.id, state: t.state }); }
const brief = (t) => ({ id: t.id, name: t.name, host: nameOf(t.host), size: t.size, n: t.players.length, format: t.format, level: t.level, entry: t.entry, state: t.state, pub: t.pub, at: t.at });
function view(t, u) {
  const names = (id) => (id ? nameOf(id) : null);
  const mine = u && t.players.some((p) => p.id === u.id);
  const cur = u && t.matches.find((m) => (m.state === 'wait' || m.state === 'live') && (m.a === u.id || m.b === u.id));
  const z = t.entry ? (t.prize ? { ...t.prize, done: true } : { ...pot(t, true), done: false }) : null;
  return {
    ...brief(t), hostId: u && t.host === u.id, bond: t.bond, tera: t.tera, wait: t.wait, rounds: rounds(t), joined: !!mine, code: t.id,
    players: t.players.map((p) => ({ name: p.name, seed: p.seed || null })),
    matches: t.matches.map((m) => ({ r: m.r, i: m.i, a: names(m.a), b: names(m.b), pa: m.pa, pb: m.pb, state: m.state, winner: names(m.winner), how: m.how, left: m.deadline ? Math.max(0, m.deadline - Date.now()) : 0, ra: !!m.ready[m.a], rb: !!m.ready[m.b], mine: !!u && (m.a === u.id || m.b === u.id) })),
    champion: names(t.champion), runnerUp: names(t.runnerUp), pot: z,
    me: cur ? { r: cur.r, i: cur.i, state: cur.state, ready: !!cur.ready[u.id], foe: names(cur.a === u.id ? cur.b : cur.a), left: cur.deadline ? Math.max(0, cur.deadline - Date.now()) : 0, battle: cur.battle } : null,
  };
}
function state(u, p = {}, now = Date.now()) {
  const list = Object.values(T()).filter((t) => (t.pub && (t.state === 'open' || t.state === 'running')) || t.players.some((x) => x.id === u.id) && active(t)).sort((a, b) => b.at - a.at).slice(0, 40).map(brief);
  const mine = activeOf(u);
  const sel = p.id ? T()[String(p.id).toUpperCase()] : mine;
  return { list, mine: mine ? mine.id : null, current: sel ? view(sel, u) : null, left: entryLeft(u, now), recent: Object.values(T()).filter((t) => t.state === 'done' && t.champion).sort((a, b) => b.endedAt - a.endedAt).slice(0, 5).map((t) => ({ id: t.id, name: t.name, champion: nameOf(t.champion), n: t.players.length })), stats: u.trn || { played: 0, won: 0, champion: 0 } };
}

module.exports = { STATIC, SIZES, ENTRIES, ENTRY_DAILY, WAITS, RAKE, SHARE_CHAMP, MIN_PLAYERS, CHAMP_TITLE, CHAMP_FRAME, T, create, join, leave, cancel, invite, start, ready, state, tick, begin: begin_, onBattleEnd, onAbort, seedOrder, entryLeft, pot, tryStart, activeOf };
