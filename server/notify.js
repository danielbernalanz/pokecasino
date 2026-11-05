'use strict';
// Centro de notificaciones: avisos personales PERSISTENTES (te han intercambiado en la GTS, invitación a un torneo,
// regalo recibido, torneo que empieza, depósito caducado, logro conseguido…). Se guardan en la cuenta (`u.notes`),
// como mucho MAX por jugador (los más antiguos se descartan), y se pueden marcar como leídas o borrar.
// No dan nada ni mueven monedas: solo avisan de cosas que ya han ocurrido por otras vías.
const db = require('./db');
const hub = require('./hub');

const MAX = 40;
const KINDS = new Set(['gts', 'trade', 'tourney', 'raid', 'gift', 'quest', 'dex', 'info']);

const stateOf = (u) => (u.notes ||= { next: 1, list: [] });

// `toast: true` hace que el cliente lo enseñe también como aviso emergente (los que ya llegan con su propio toast no lo piden).
function push(u, { kind = 'info', text, link = '', toast = false } = {}) {
  if (!u || u.npc || !text) return null;
  const S = stateOf(u);
  const n = { id: S.next++, at: Date.now(), kind: KINDS.has(kind) ? kind : 'info', text: String(text).slice(0, 200), link: /^#\/[\w/-]{0,40}$/.test(link) ? link : '', read: false };
  S.list.push(n);
  if (S.list.length > MAX) S.list.splice(0, S.list.length - MAX);
  db.save();
  hub.emitUser(u.id, 'note', { note: n, unread: unread(u), toast: !!toast });
  return n;
}
const unread = (u) => (u.notes ? u.notes.list.filter((n) => !n.read).length : 0);
const list = (u) => ({ list: stateOf(u).list.slice().reverse(), unread: unread(u), max: MAX });

function read(u, { id } = {}) {
  const S = stateOf(u);
  for (const n of S.list) if (id === undefined || id === 'all' || n.id === Number(id)) n.read = true;
  db.save();
  return list(u);
}
function clear(u, { id } = {}) {
  const S = stateOf(u);
  S.list = id === undefined || id === 'all' ? [] : S.list.filter((n) => n.id !== Number(id));
  db.save();
  return list(u);
}

module.exports = { MAX, KINDS, push, unread, list, read, clear };
