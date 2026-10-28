// Registro de novedades: carga de /changelog.json, "visto" por jugador y avisos.
import { S, bus, h, modal, emit } from './core.js';

const LS = 'newsSeen';
let cache = null;

export async function loadChangelog() {
  if (cache) return cache;
  try {
    const r = await fetch('/changelog.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('http');
    const j = await r.json();
    cache = Array.isArray(j) ? j.filter((x) => x && x.version && Array.isArray(x.items)) : [];
  } catch { cache = []; }
  return cache;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}` : String(iso || '');
}

const localSeen = () => { try { return localStorage.getItem(LS); } catch { return null; } };

// Última versión vista: la más reciente entre la del servidor y la local.
function seenVersion(list) {
  const idx = (v) => (v ? list.findIndex((r) => r.version === v) : -1);
  const a = idx(S.newsSeen), b = idx(localSeen());
  const cands = [a, b].filter((i) => i >= 0);
  if (cands.length) return list[Math.min(...cands)].version;
  return S.newsSeen || localSeen() || null;
}

// Novedades que el jugador aún no ha visto (más nuevas primero).
export function unseenReleases(list) {
  if (!list.length) return [];
  const seen = seenVersion(list);
  const i = seen ? list.findIndex((r) => r.version === seen) : -1;
  if (seen && i === 0) return [];
  return i > 0 ? list.slice(0, i) : list;
}

export async function markSeen() {
  const list = await loadChangelog();
  if (!list.length) return;
  const v = list[0].version;
  S.newsSeen = v;
  try { localStorage.setItem(LS, v); } catch { /* nada */ }
  bus.emit('news', []);
  emit('news:seen', { version: v }).catch(() => {});
}

export function releaseCard(r, isNew) {
  return h('article', { class: 'news-rel' + (isNew ? ' is-new' : '') },
    h('div', { class: 'news-meta' }, isNew ? h('span', { class: 'news-tag' }, 'NUEVO') : '', h('time', { datetime: r.date }, fmtDate(r.date)), h('span', { class: 'news-ver' }, 'v' + r.version)),
    h('h3', { class: 'news-title' }, r.title),
    h('ul', { class: 'news-items' }, r.items.map((t) => h('li', {}, t))));
}

// Modal público (sin cuenta): todas las novedades.
export async function openPublicNews() {
  const list = await loadChangelog();
  modal(list.length ? h('div', { class: 'news-list' }, list.map((r) => releaseCard(r, false))) : h('p', { class: 'muted' }, 'No hay novedades publicadas todavía.'), { title: '📰 Novedades', wide: true });
}

// Tras el saludo del servidor: decide si avisar.
export async function initNews(hello) {
  S.newsSeen = hello.newsSeen || null;
  const list = await loadChangelog();
  if (!list.length) return;
  let fresh = unseenReleases(list);
  if (!fresh.length) { bus.emit('news', []); return; }
  if (location.hash.startsWith('#/news')) { bus.emit('news', fresh); return; } // la propia vista lo marca como visto
  const unknown = !S.newsSeen && !localSeen();
  // Cuenta creada tras la última novedad: ya parte de lo último, sin aviso.
  if (unknown && hello.createdAt && hello.createdAt >= Date.parse(list[0].date + 'T00:00:00Z')) { await markSeen(); return; }
  bus.emit('news', fresh);
  showNewsPopup(fresh);
}

let popup = null;
function showNewsPopup(fresh) {
  if (popup && popup.el.isConnected) return;
  const shown = fresh.slice(0, 3);
  const more = fresh.length - shown.length;
  const body = h('div', { class: 'news-pop' },
    h('div', { class: 'news-hero' }, h('div', { class: 'news-hero-ico' }, '🆕'), h('p', {}, fresh.length === 1 ? 'Hay una actualización desde tu última visita.' : `Hay ${fresh.length} actualizaciones desde tu última visita.`)),
    h('div', { class: 'news-list' }, shown.map((r) => releaseCard(r, true))),
    h('div', { class: 'news-actions' },
      h('button', { class: 'btn primary big', onclick: () => { markSeen(); popup.close(); } }, '¡Entendido!'),
      h('a', { class: 'news-all', href: '#/news', onclick: () => popup.close() }, more > 0 ? `Ver todas (+${more} más)` : 'Ver todas')));
  popup = modal(body, { title: '🆕 ¡Novedades en el PokéCasino!', wide: true });
  popup.el.classList.add('news-modal');
}
