'use strict';
// Intercambio directo entre dos jugadores conectados (como el intercambio en línea de los juegos): sala por invitación, cada uno elige UN ejemplar de su Caja,
// ve el del otro (resumen de solo lectura), los dos confirman y se intercambian al momento. Reutiliza gts.js: los mismos bloqueos (`busyReason`), los mismos rasgos
// que viajan (`snapOf`/`receive`: IV, naturaleza, Ball, marca, tamaño, OT, Teratipo, nivel, EXP, movimientos, objeto y mote; no EVs ni amistad), los mismos topes
// de `transfer.js` (cuentas nuevas, 10 Pokémon y 2 legendarios o míticos recibidos al día) y los mismos 5 intercambios al día por cuenta (`u.gts`, compartido con la
// GTS). Como en los juegos, NO tiene comisión (ver docs/BALANCE.md → «Intercambio directo» para lo que eso abre y por qué no cambia nada).
//
//  · SALAS en memoria: nada cambia de sitio hasta que los dos confirman, así que un reinicio, una desconexión o una cancelación no pueden perder ni duplicar nada.
//  · SIN TRAMPAS: cualquier cambio de oferta (o que el ejemplar ofrecido cambie: nivel, objeto, mote, movimientos…) anula las dos confirmaciones; al confirmar
//    se compara el ejemplar con lo que ve el otro (`sig`) y, si ha cambiado, se anula y se vuelve a enseñar.
//  · ATÓMICO: todo se valida antes de tocar nada; el intercambio se hace de una vez (el servidor es de un solo hilo) y, si algo fallara a medias, se restaura el estado
//    de los dos jugadores tal y como estaba.
const crypto = require('crypto');
const db = require('./db');
const hub = require('./hub');
const gts = require('./gts');
const tr = require('./transfer');
const notify = require('./notify');
const { BY_ID } = require('./pokedex');

const INVITE_MS = 2 * 60e3;
const IDLE_MS = 10 * 60e3;
const WHAT = 'el intercambio';

const rooms = new Map(); // id → sala
const byUser = new Map(); // userId → sala
let online = () => true; // lo fija index.js: ¿está conectado ese jugador?
const setOnline = (fn) => { online = fn; };
const nameOf = (id) => BY_ID.get(Number(id)).name;
const userName = (id) => (db.userById(id) || {}).username || '?';

// ¿Está ese ejemplar ofrecido en alguna sala? (gts.busyReason lo usa para no dejarlo depositar ni ofrecer en otro sitio a la vez.)
function heldIn(userId, uid) {
  const r = byUser.get(userId);
  if (!r || r.state !== 'open') return null;
  const side = r.a.userId === userId ? r.a : r.b;
  return side.offer && side.offer.uid === uid ? r.id : null;
}

// ---- Resumen de un ejemplar (solo lectura): lo que ve el otro antes de confirmar ----
function summary(owner, id, m) {
  const snap = gts.snapOf(owner, id, m);
  require('./abilities').resolve(Number(id), m);
  const mv = require('./moves');
  const lot = require('./lottery');
  return {
    id: Number(id), uid: m.uid, shiny: !!m.shiny, nick: m.nick || '', level: m.level, gender: require('./eggroups').genderOf(id, m), nature: require('./specimen').natureOf(m), ability: m.ability || '',
    ball: m.ball || null, ot: lot.otOf(owner, m), otn: lot.otNameOf(owner, m) || owner.username, tera: m.tera || null, item: m.item || null, mark: m.mark || null, size: m.size === undefined ? null : m.size,
    ivSum: require('./specimen').ivTotal(m), moves: (snap.mv.sdMoves || []).slice(0, 4).map((x) => mv.name(x)),
  };
}
// Firma de lo que el otro ve: si cambia, hay que volver a confirmar.
const sigOf = (owner, id, m) => JSON.stringify(gts.snapOf(owner, id, m));

// ---- Salas ----
const sideOf = (r, u) => (r.a.userId === u.id ? r.a : r.b.userId === u.id ? r.b : null);
const other = (r, u) => (r.a.userId === u.id ? r.b : r.a);
function roomOf(u) {
  const r = byUser.get(u.id);
  if (!r) throw new Error('No estás en ninguna sala de intercambio.');
  return r;
}
function viewFor(r, u) {
  const me = sideOf(r, u);
  const them = other(r, u);
  const peek = (s) => { const o = db.userById(s.userId); if (!s.offer || !o) return null; try { return summary(o, s.offer.id, specimenOf(o, s.offer)); } catch { return null; } };
  return { id: r.id, state: r.state, with: userName(them.userId), at: r.at, inviter: r.a.userId === u.id,
    mine: { offer: peek(me), confirmed: !!me.confirmed }, theirs: { offer: peek(them), confirmed: !!them.confirmed, present: r.state === 'open' },
    left: Math.max(0, (r.state === 'invited' ? INVITE_MS : IDLE_MS) - (Date.now() - r.at)) };
}
const specimenOf = (u, o) => require('./specimen').find(u, { id: o.id, uid: o.uid });
function push(r) {
  for (const s of [r.a, r.b]) { const u = db.userById(s.userId); if (u) hub.emitUser(u.id, 'trade:room', { room: viewFor(r, u) }); }
}
function close(r, why, { notifyBoth = true, by = null } = {}) {
  if (!rooms.delete(r.id)) return;
  for (const s of [r.a, r.b]) {
    if (byUser.get(s.userId) === r) byUser.delete(s.userId);
    const u = db.userById(s.userId);
    if (!u) continue;
    hub.emitUser(u.id, 'trade:closed', { id: r.id, reason: why });
    if (notifyBoth && (!by || by !== u.id)) notify.push(u, { kind: 'trade', text: `🔁 ${why}`, link: '#/trade' });
  }
}

function invite(u, p = {}, now = Date.now()) {
  gts.canUse(u, now, WHAT);
  const t = db.userByName(String(p.to || ''));
  if (!t || t.npc || t.id === u.id) throw new Error('Jugador no encontrado.');
  gts.canUse(t, now, WHAT); // (si no puede intercambiar, no tiene sentido invitarle)
  if (byUser.has(u.id)) throw new Error('Ya estás en una sala de intercambio: ciérrala antes.');
  if (byUser.has(t.id)) throw new Error(`${t.username} ya está en otra sala de intercambio.`);
  if (!online(t.id)) throw new Error(`${t.username} no está conectado ahora mismo.`);
  const r = { id: crypto.randomUUID().slice(0, 8), state: 'invited', at: now, a: { userId: u.id, offer: null, confirmed: false, sig: null }, b: { userId: t.id, offer: null, confirmed: false, sig: null } };
  rooms.set(r.id, r); byUser.set(u.id, r); byUser.set(t.id, r);
  notify.push(t, { kind: 'trade', text: `🔁 ${u.username} te invita a intercambiar Pokémon.`, link: '#/trade', toast: true });
  hub.emitUser(t.id, 'trade:invite', { id: r.id, from: u.username });
  push(r);
  return state(u);
}

function accept(u, p = {}, now = Date.now()) {
  const r = rooms.get(String(p.id));
  if (!r || r.state !== 'invited' || r.b.userId !== u.id) throw new Error('Esa invitación ya no existe.');
  gts.canUse(u, now, WHAT);
  r.state = 'open'; r.at = now;
  const inv = db.userById(r.a.userId);
  if (inv) notify.push(inv, { kind: 'trade', text: `🔁 ${u.username} ha aceptado: elegid vuestro Pokémon.`, link: '#/trade', toast: true });
  push(r);
  return state(u);
}

// Rechazar una invitación, retirar la propia o salir de una sala abierta: todo se cierra y nadie pierde nada.
function leave(u, _p = {}) {
  const r = byUser.get(u.id);
  if (!r) return state(u);
  close(r, r.state === 'invited' ? (r.a.userId === u.id ? `${u.username} ha retirado la invitación de intercambio.` : `${u.username} ha rechazado tu invitación de intercambio.`) : `${u.username} ha cancelado el intercambio: no se ha movido ningún Pokémon.`, { by: u.id });
  return state(u);
}

// Elegir (o quitar con `uid` vacío) el ejemplar que ofreces. Cambiar la oferta anula las dos confirmaciones.
function offer(u, p = {}, now = Date.now()) {
  const r = roomOf(u);
  if (r.state !== 'open') throw new Error('La sala aún no está abierta: espera a que acepte la invitación.');
  const me = sideOf(r, u);
  if (p.uid === undefined || p.uid === null || p.uid === '') { me.offer = null; me.sig = null; } else {
    const id = Number(p.id);
    if (!Number.isInteger(id) || !BY_ID.has(id)) throw new Error('Pokémon no válido.');
    const m = require('./specimen').find(u, { id, uid: p.uid });
    const why = gts.busyReason(u, id, m, WHAT, r.id);
    if (why) throw new Error(why);
    me.offer = { id, uid: m.uid }; me.sig = sigOf(u, id, m);
  }
  me.confirmed = false; other(r, u).confirmed = false;
  r.at = now;
  push(r);
  return state(u);
}

function unconfirm(u) {
  const r = roomOf(u);
  sideOf(r, u).confirmed = false;
  push(r);
  return state(u);
}

// Confirmar: cuando están los dos, se intercambia. Si algo ha cambiado desde que el otro lo vio, se anula y se vuelve a enseñar.
function confirm(u, _p = {}, now = Date.now()) {
  const r = roomOf(u);
  if (r.state !== 'open') throw new Error('La sala aún no está abierta.');
  const me = sideOf(r, u); const them = other(r, u);
  if (!me.offer || !them.offer) throw new Error('Los dos tenéis que elegir un Pokémon antes de confirmar.');
  r.at = now;
  // ¿Sigue siendo lo que se enseñó?
  let changed = false;
  for (const s of [me, them]) {
    const o = db.userById(s.userId);
    let sg = null;
    try { sg = sigOf(o, s.offer.id, specimenOf(o, s.offer)); } catch { /* ya no está */ }
    if (sg !== s.sig) { changed = true; s.sig = sg; if (sg === null) s.offer = null; }
  }
  if (changed) {
    me.confirmed = false; them.confirmed = false;
    push(r);
    throw new Error('Uno de los Pokémon ha cambiado (nivel, objeto, movimientos…) o ya no está: revisa la oferta y vuelve a confirmar.');
  }
  me.confirmed = true;
  if (!them.confirmed) { push(r); return state(u); }
  return execute(r, u, now);
}

const SAVE = ['collection', 'mons', 'dexSeen', 'locked', 'buddy', 'dust'];
const snapshot = (u) => JSON.parse(JSON.stringify(Object.fromEntries(SAVE.map((k) => [k, u[k] === undefined ? null : u[k]]))));
function restore(u, s) { for (const k of SAVE) { if (s[k] === null) delete u[k]; else u[k] = s[k]; } }

// El intercambio de verdad. Todo se valida antes de tocar nada.
function execute(r, who, now) {
  const ua = db.userById(r.a.userId); const ub = db.userById(r.b.userId);
  const fail = (msg) => { r.a.confirmed = false; r.b.confirmed = false; push(r); throw new Error(msg); };
  if (!ua || !ub) { close(r, 'El intercambio se ha cancelado.'); throw new Error('El otro jugador ya no existe.'); }
  const A = r.a.offer; const B = r.b.offer;
  let mA; let mB;
  try { mA = specimenOf(ua, A); mB = specimenOf(ub, B); } catch (e) { fail('Uno de los Pokémon ya no está en la Caja: revisa la oferta.'); }
  try {
    gts.canUse(ua, now, WHAT); gts.canUse(ub, now, WHAT);
    if (gts.dayLeft(ua, now) < 1) throw new Error(`${ua.username} ya ha hecho ${gts.STATIC.daily} intercambios hoy (los de la GTS cuentan).`);
    if (gts.dayLeft(ub, now) < 1) throw new Error(`${ub.username} ya ha hecho ${gts.STATIC.daily} intercambios hoy (los de la GTS cuentan).`);
    for (const [u, id, m] of [[ua, A.id, mA], [ub, B.id, mB]]) { const why = gts.busyReason(u, id, m, WHAT, r.id); if (why) throw new Error(`${u.username}: ${why}`); }
    tr.pokeInCheck(ua, gts.isRare(B.id), now);
    tr.pokeInCheck(ub, gts.isRare(A.id), now);
    if (A.id !== B.id) {
      if (!gts.room(ua, B.id)) throw new Error(`${ua.username} ya tiene ${gts.MAX_STARS} ${nameOf(B.id)} en la Caja.`);
      if (!gts.room(ub, A.id)) throw new Error(`${ub.username} ya tiene ${gts.MAX_STARS} ${nameOf(A.id)} en la Caja.`);
    }
  } catch (e) { fail(e.message); }
  const snapA = gts.snapOf(ua, A.id, mA); const snapB = gts.snapOf(ub, B.id, mB);
  const back = [snapshot(ua), snapshot(ub)];
  try {
    gts.pull(ua, A.id, mA);
    gts.pull(ub, B.id, mB);
    gts.receive(ua, snapB);
    gts.receive(ub, snapA);
  } catch (e) {
    restore(ua, back[0]); restore(ub, back[1]);
    console.error('Intercambio directo: se ha deshecho (', e.message, ')');
    fail('No se ha podido completar el intercambio; no se ha movido nada.');
  }
  tr.notePokeIn(ua, gts.isRare(B.id), now);
  tr.notePokeIn(ub, gts.isRare(A.id), now);
  gts.dayLeft(ua, now); ua.gts.n++;
  gts.dayLeft(ub, now); ub.gts.n++;
  const evo = require('./evoreq'); // intercambio real: vale como un Cordón Unión para los dos (ver evoreq.noteTrade)
  evo.noteTrade(ua, ub, now); evo.noteTrade(ub, ua, now);
  const g = (db.data.gts ||= { deps: [], log: [], nextId: 1 });
  g.log.push({ at: now, a: ua.username, b: ub.username, ga: { id: A.id, shiny: !!mA.shiny, level: snapA.level, nick: snapA.nick, ball: snapA.tr.ball || null, ot: null }, gb: { id: B.id, shiny: !!mB.shiny, level: snapB.level, nick: snapB.nick, ball: snapB.tr.ball || null, ot: null }, direct: true });
  if (g.log.length > 200) g.log.splice(0, g.log.length - 200);
  const done = { a: { gave: A.id, got: B.id }, b: { gave: B.id, got: A.id } };
  db.save();
  const nm = (id, shiny) => (shiny ? nameOf(id) + ' variocolor' : nameOf(id));
  hub.feed('trade', `🔁 ${ua.username} y ${ub.username} intercambiaron ${nm(A.id, snapA.shiny)} por ${nm(B.id, snapB.shiny)}`);
  for (const [u, o, give, get, snapGet] of [[ua, ub, A.id, B.id, snapB], [ub, ua, B.id, A.id, snapA]]) {
    notify.push(u, { kind: 'trade', text: `🔁 Intercambio completado con ${o.username}: recibes ${nm(get, snapGet.shiny)} (Nv. ${snapGet.level}).`, link: '#/trade', toast: true });
    hub.pushMe(u);
  }
  for (const s of [r.a, r.b]) { const u = db.userById(s.userId); if (u) hub.emitUser(u.id, 'trade:done', { id: r.id, ...(s === r.a ? done.a : done.b) }); }
  const mine = r.a.userId === who.id ? done.a : done.b;
  rooms.delete(r.id); byUser.delete(ua.id); byUser.delete(ub.id);
  return { done: mine, ...state(who) };
}

// El jugador se ha desconectado del todo (cerró la pestaña): su sala se cierra y el otro lo sabe.
function onDisconnect(userId) {
  const r = byUser.get(userId);
  if (!r) return;
  close(r, `${userName(userId)} se ha desconectado: el intercambio se ha cancelado y no se ha movido ningún Pokémon.`, { by: userId });
}
function tick(now = Date.now()) {
  for (const r of [...rooms.values()]) {
    if (r.state === 'invited' && now - r.at > INVITE_MS) close(r, `La invitación de intercambio de ${userName(r.a.userId)} ha caducado.`);
    else if (r.state === 'open' && now - r.at > IDLE_MS) close(r, 'La sala de intercambio se ha cerrado por inactividad: no se ha movido ningún Pokémon.');
  }
}
let timer = null;
function start() { if (!timer) { timer = setInterval(() => tick(), 20000); timer.unref(); } }

function state(u) {
  const r = byUser.get(u.id);
  let blocked = null;
  try { gts.canUse(u, Date.now(), WHAT); } catch (e) { blocked = e.message; }
  return { room: r ? viewFor(r, u) : null, left: gts.dayLeft(u), max: gts.STATIC.daily, blocked };
}
const _reset = () => { rooms.clear(); byUser.clear(); };

module.exports = { INVITE_MS, IDLE_MS, rooms, heldIn, setOnline, invite, accept, leave, offer, unconfirm, confirm, onDisconnect, tick, start, state, summary, _reset };
