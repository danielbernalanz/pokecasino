// Centro de notificaciones (server/notify.js): campana de la cabecera con contador, lista persistente, marcar como leídas y borrar.
// Los avisos nuevos llegan por el socket («note»); los marcados con `toast` salen además como aviso emergente (y como notificación del navegador si
// el jugador las activó; no hay push de servidor: solo la infraestructura local de avisos que ya existía).
import { S, h, $, emit, bus, toast, sfx, notify } from './core.js';
import { celebrate } from './fx.js';

const ICON = { gts: '🌐', trade: '🔁', tourney: '🏆', raid: '💎', gift: '🎁', quest: '🎯', dex: '📜', info: '🔔' };
S.notes = S.notes || { list: [], unread: 0, max: 40 };

function ago(t) {
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  const hr = Math.floor(m / 60);
  return hr < 24 ? `hace ${hr} h` : `hace ${Math.floor(hr / 24)} d`;
}
function paint() {
  const n = S.notes.unread;
  const dot = $('#note-dot');
  if (dot) { dot.textContent = n > 9 ? '9+' : String(n); dot.classList.toggle('hidden', !n); }
  const b = $('#note-btn');
  if (b) b.title = n ? `Notificaciones (${n} sin leer)` : 'Notificaciones';
  bus.emit('notes', S.notes);
}
const apply = (r) => { if (r) { S.notes = { ...S.notes, list: r.list, unread: r.unread, max: r.max || S.notes.max }; paint(); } };

export async function loadNotes() {
  try { apply(await emit('note:list')); } catch { /* sin conexión */ }
}
// Un aviso nuevo del servidor.
export function onNote({ note, unread, toast: show }) {
  S.notes.list = [note, ...S.notes.list.filter((x) => x.id !== note.id)].slice(0, S.notes.max);
  S.notes.unread = unread;
  paint();
  if (!show) return;
  if (note.kind === 'dex') celebrate('level', { title: '¡DIPLOMA DEL GAME FREAK!', subtitle: note.text.replace(/^📜 ¡Diploma del Game Freak!\s*/, ''), icon: '📜' });
  else { toast(note.text, 'success', 6000); sfx(note.kind === 'tourney' || note.kind === 'trade' ? 'big' : 'chat'); }
  notify(note.text, { link: (note.link || '').replace(/^#\//, '') });
}

function openPanel() {
  document.querySelector('.note-pop')?.remove();
  const list = h('div', { class: 'note-list' });
  const draw = () => {
    const ns = S.notes.list;
    list.replaceChildren(...(ns.length ? ns.map((n) => h('div', { class: 'note-item' + (n.read ? '' : ' unread') + (n.link ? ' link' : ''), role: n.link ? 'link' : undefined, tabindex: n.link ? 0 : undefined,
      onclick: async () => {
        if (!n.read) apply(await emit('note:read', { id: n.id }).catch(() => null));
        if (n.link) { close(); location.hash = n.link; }
      } },
      h('span', { class: 'note-ico', 'aria-hidden': 'true' }, ICON[n.kind] || '🔔'),
      h('div', { class: 'grow' }, h('div', { class: 'note-text' }, n.text.replace(/^[^\p{L}\p{N}¡¿(]+\s*/u, '')), h('div', { class: 'small muted' }, ago(n.at))),
      h('button', { class: 'icon-btn note-x', type: 'button', 'aria-label': 'Borrar', onclick: async (e) => { e.stopPropagation(); apply(await emit('note:clear', { id: n.id }).catch(() => null)); draw(); } }, '✕'))) : [h('p', { class: 'muted small note-empty' }, 'No tienes notificaciones. Aquí te avisamos de intercambios, torneos, invitaciones, regalos y logros.')]));
  };
  const wrap = h('div', { class: 'popover note-pop', onclick: (e) => e.stopPropagation() },
    h('div', { class: 'row between note-head' }, h('b', {}, '🔔 Notificaciones'),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn small', type: 'button', disabled: !S.notes.unread, onclick: async () => { apply(await emit('note:read', { id: 'all' }).catch(() => null)); draw(); } }, 'Marcar leídas'),
        h('button', { class: 'btn small', type: 'button', disabled: !S.notes.list.length, onclick: async () => { apply(await emit('note:clear', { id: 'all' }).catch(() => null)); draw(); } }, 'Borrar'))),
    list, h('div', { class: 'small muted note-foot' }, `Se guardan las últimas ${S.notes.max}.`));
  const close = () => { wrap.remove(); document.removeEventListener('click', close); off(); };
  const off = bus.on('notes', draw);
  draw();
  document.body.append(wrap);
  setTimeout(() => document.addEventListener('click', close), 0);
}

export function initNotes() {
  const b = $('#note-btn');
  if (b && !b.dataset.ready) { b.dataset.ready = '1'; b.addEventListener('click', (e) => { e.stopPropagation(); if (document.querySelector('.note-pop')) { document.querySelector('.note-pop').remove(); return; } openPanel(); }); }
  loadNotes();
}
