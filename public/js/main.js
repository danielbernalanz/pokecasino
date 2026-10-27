import { S, bus, $, h, fmt, toast, sfx, setMe, isMuted, toggleMute, sprite, art, emit } from './core.js';
import { initSocial, addChat, addFeed, renderOnline, showPlayer } from './social.js';
import lobby from './views/lobby.js';
import slots from './views/slots.js';
import roulette from './views/roulette.js';
import voltorb from './views/voltorb.js';
import race from './views/race.js';
import duels from './views/duels.js';
import gacha from './views/gacha.js';
import pokedex from './views/pokedex.js';
import shop from './views/shop.js';
import ranking from './views/ranking.js';
import admin from './views/admin.js';
import blackjack from './views/blackjack.js';
import videopoker from './views/videopoker.js';
import baccarat from './views/baccarat.js';
import plinko from './views/plinko.js';
import mines from './views/mines.js';
import crash from './views/crash.js';
import poker from './views/poker.js';
import market from './views/market.js';
import trainer from './views/trainer.js';

const VIEWS = [lobby, trainer, poker, crash, race, duels, blackjack, videopoker, baccarat, roulette, slots, plinko, mines, voltorb, gacha, pokedex, shop, market, ranking, admin];
const SECTIONS = { poker: 'Multijugador', blackjack: 'Mesas', slots: 'Máquinas', gacha: 'Colección', market: 'Comunidad' };

// ---------- Autenticación ----------
let mode = 'login';
function showAuth() {
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  const mons = [25, 6, 150, 94, 143, 133, 149, 249];
  $('#auth-mons').replaceChildren(...mons.map((id, i) => h('img', { src: art(id), alt: '', style: { animationDelay: i * 0.3 + 's' } })));
}
document.querySelectorAll('#auth .tab').forEach((t) => t.addEventListener('click', () => {
  mode = t.dataset.mode;
  document.querySelectorAll('#auth .tab').forEach((x) => x.classList.toggle('active', x === t));
  const needsInvite = mode === 'register' && !(S.data && S.data.openRegistration);
  $('.reg-only').classList.toggle('hidden', !needsInvite);
  $('#auth-form [name=invite]').required = needsInvite;
  $('#auth-form button[type=submit]').textContent = mode === 'register' ? 'Crear entrenador' : 'Entrar';
  $('#auth-form [name=password]').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
}));
$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = Object.fromEntries(f.entries());
  $('#auth-error').textContent = '';
  try {
    const r = await fetch('/api/' + mode, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ ok: false, error: 'Acceso denegado.' }));
    if (!j.ok) throw new Error(j.error);
    try { localStorage.setItem('token', j.token); } catch { /* nada */ }
    S.token = j.token;
    connect();
  } catch (err) { $('#auth-error').textContent = err.message; sfx('error'); }
});

function logout() {
  fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: S.token }) });
  try { localStorage.removeItem('token'); } catch { /* nada */ }
  location.hash = '';
  location.reload();
}

// ---------- Cabecera ----------
let shownCoins = 0;
function animateCoins(to) {
  const el = $('#coins');
  const from = shownCoins;
  shownCoins = to;
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 600);
    el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  const pill = el.parentElement;
  pill.classList.remove('up', 'down');
  void pill.offsetWidth;
  if (to !== from) pill.classList.add(to > from ? 'up' : 'down');
}
bus.on('me', (me) => {
  animateCoins(me.coins);
  $('#dust').textContent = fmt(me.dust);
  $('#level').textContent = me.level;
  $('#xpfill').style.width = Math.min(100, ((me.xp - me.xpCur) / (me.xpNext - me.xpCur)) * 100) + '%';
  $('#uname').textContent = me.username;
  $('#buddy-mini').replaceChildren(me.buddy ? h('img', { class: 'pixel', src: sprite(me.buddy.id, me.buddy.shiny), alt: '' }) : '');
  $('#buddy-mini').className = me.looks && me.looks.frame ? 'mini-frame fr ' + me.looks.frame : '';
  document.querySelector('[data-view=admin]')?.classList.toggle('hidden', !me.isAdmin);
});
bus.on('toast', (t) => toast(t, 'success'));

$('#mute-btn').addEventListener('click', () => { $('#mute-btn').textContent = toggleMute() ? '🔇' : '🔊'; });
$('#mute-btn').textContent = isMuted() ? '🔇' : '🔊';
$('#menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
$('#user-btn').addEventListener('click', () => {
  const menu = h('div', { class: 'stack' },
    h('button', { class: 'btn', onclick: () => { close(); showPlayer(S.me.username); } }, '👤 Ver mi ficha'),
    h('button', { class: 'btn', onclick: () => { close(); location.hash = '#/pokedex'; } }, '📕 Mi Pokédex'),
    h('button', { class: 'btn danger', onclick: logout }, '🚪 Cerrar sesión'));
  const wrap = h('div', { class: 'popover', onclick: (e) => e.stopPropagation() }, menu);
  const close = () => { wrap.remove(); document.removeEventListener('click', close); };
  document.body.append(wrap);
  setTimeout(() => document.addEventListener('click', close), 0);
});

// ---------- Navegación ----------
function buildNav() {
  const nav = $('#sidebar');
  nav.replaceChildren();
  for (const v of VIEWS) {
    if (SECTIONS[v.id]) nav.append(h('div', { class: 'nav-section' }, SECTIONS[v.id]));
    nav.append(h('a', { href: '#/' + v.id, class: 'nav-link' + (v.id === 'admin' ? ' hidden' : ''), 'data-view': v.id },
      h('span', { class: 'nav-ico' }, v.icon), h('span', {}, v.title)));
  }
}

let current = null;
function route() {
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'lobby';
  const view = VIEWS.find((v) => v.id === id) || lobby;
  if (current && current.unmount) current.unmount();
  current = view;
  S.view = view.id;
  document.querySelectorAll('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.view === view.id));
  document.body.classList.remove('nav-open');
  const root = $('#view');
  root.replaceChildren();
  root.scrollTop = 0;
  root.className = 'main view-' + view.id;
  view.mount(root);
}
window.addEventListener('hashchange', route);

// ---------- Conexión ----------
let booted = false;
function connect() {
  if (S.socket) S.socket.disconnect();
  const socket = io({ auth: { token: S.token } });
  S.socket = socket;
  socket.on('connect_error', (err) => {
    if (err.message === 'auth') { try { localStorage.removeItem('token'); } catch { /* nada */ } socket.disconnect(); showAuth(); }
    else if (err.message === 'red') { socket.disconnect(); showAuth(); $('#auth-error').textContent = 'Tu red no tiene acceso a este casino.'; }
    else $('#conn').classList.remove('hidden');
  });
  socket.on('disconnect', () => $('#conn').classList.remove('hidden'));
  socket.on('connect', async () => {
    $('#conn').classList.add('hidden');
    const res = await emit('hello').catch((e) => { toast(e.message, 'error'); return null; });
    if (!res) return;
    $('#auth').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#chat-log').replaceChildren();
    $('#feed').replaceChildren();
    res.chat.forEach((m) => addChat(m, true));
    res.feed.forEach((f) => addFeed(f, true));
    renderOnline(res.online);
    S.jackpot = res.jackpot; $('#jackpot').textContent = fmt(res.jackpot);
    S.race = res.race; S.raceBets = res.raceBets;
    S.duels = res.duels; S.duelHistory = res.duelHistory;
    S.crash = res.crash; S.poker = res.poker;
    bus.emit('race', res.race);
    if (!booted) { booted = true; buildNav(); setMe(S.me); route(); }
  });
  socket.on('me', setMe);
  socket.on('chat', (m) => addChat(m));
  socket.on('feed', (f) => { addFeed(f); if (f.kind === 'duel') bus.emit('duel:feed', f); });
  socket.on('online', renderOnline);
  socket.on('jackpot', (j) => { S.jackpot = j; $('#jackpot').textContent = fmt(j); bus.emit('jackpot', j); });
  socket.on('race:state', (r) => { if (S.race && r.round !== S.race.round) S.raceBets = []; S.race = r; bus.emit('race', r); });
  socket.on('race:payout', (p) => bus.emit('race:payout', p));
  socket.on('duel:list', (l) => { S.duels = l; bus.emit('duels', l); });
  socket.on('duel:result', (r) => {
    S.duelHistory = [r, ...(S.duelHistory || [])].slice(0, 20);
    bus.emit('duel:result', r);
    if (current !== duels && r.players[0] === S.me.username) {
      const won = r.players[r.winner] === S.me.username;
      toast(`⚔️ ${r.players[1]} aceptó tu reto: ${won ? '¡ganaste!' : 'perdiste.'} Míralo en Duelos.`, won ? 'success' : 'info', 6000);
    }
  });
  socket.on('toast', (t) => { toast(t.text, 'success', 5000); sfx('win'); });
  socket.on('crash:state', (c) => { S.crash = c; bus.emit('crash', c); });
  socket.on('crash:result', (r) => bus.emit('crash:result', r));
  socket.on('poker:lobby', (l) => { S.poker = l; bus.emit('poker:lobby', l); });
  socket.on('poker:table', (t) => bus.emit('poker:table', t));
  socket.on('poker:hole', (x) => bus.emit('poker:hole', x));
  socket.on('market', (m) => bus.emit('market', m));
}

// ---------- Arranque ----------
(async function boot() {
  initSocial();
  S.data = await fetch('/api/static').then((r) => {
    if (!r.ok) throw new Error('Acceso restringido');
    return r.json();
  }).catch(() => null);
  if (!S.data) { document.body.replaceChildren(h('div', { class: 'blocked' }, h('h1', {}, '🔒'), h('p', {}, 'Este casino solo está disponible desde la red privada del anfitrión.'))); return; }
  for (const p of S.data.dex) S.dexById.set(p.id, p);
  try { S.token = localStorage.getItem('token'); } catch { /* nada */ }
  if (S.data.openRegistration) $('#auth-sub').textContent = '¡Crea tu entrenador y empieza a jugar!';
  if (S.token) connect(); else showAuth();
})();
