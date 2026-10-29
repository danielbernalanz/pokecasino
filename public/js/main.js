import { animPref, setAnimPref } from './anim.js';
import { S, bus, $, h, fmt, toast, sfx, setMe, isMuted, toggleMute, sprite, art, emit, modal, notify, notifyEnabled, toggleNotify, badgeImg, resetWarnings, buddyImg, monImg, MON } from './core.js';
import { celebrate, coinRain, burstAt, vibrate } from './fx.js';
import { initSocial, addChat, addFeed, renderOnline, showPlayer } from './social.js';
import lobby from './views/lobby.js';
import slots from './views/slots.js';
import roulette from './views/roulette.js';
import voltorb from './views/voltorb.js';
import race from './views/race.js';
import duels from './views/duels.js';
import battle from './views/battle.js';
import gacha from './views/gacha.js';
import pokedex from './views/pokedex.js';
import pc from './views/pc.js';
import huerto from './views/huerto.js';
import shop from './views/shop.js';
import ranking from './views/ranking.js';
import admin from './views/admin.js';
import blackjack from './views/blackjack.js';
import videopoker from './views/videopoker.js';
import baccarat from './views/baccarat.js';
import plinko from './views/plinko.js';
import mines from './views/mines.js';
import quiz from './views/quiz.js';
import crash from './views/crash.js';
import poker from './views/poker.js';
import market from './views/market.js';
import trainer from './views/trainer.js';
import megaView from './views/mega.js';
import news from './views/news.js';
import { initNews, openPublicNews } from './news.js';
import hubs, { notFound } from './views/hubs.js';
import { buildSidebar, buildTabbar, markNav, refreshNew, markVisited, resetVisited } from './nav.js';

duels.title = 'Duelos rápidos'; // los duelos de siempre (1 Pokémon a ciegas) pasan a llamarse así junto a los nuevos Combates
const VIEWS = [lobby, news, trainer, poker, crash, race, duels, battle, blackjack, videopoker, baccarat, roulette, slots, plinko, mines, voltorb, quiz, gacha, pokedex, pc, huerto, shop, megaView, market, ranking, admin, ...hubs];

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
$('#auth-news').addEventListener('click', openPublicNews);
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

// Celebración de los avisos del servidor: nivel y medalla a pantalla completa; misiones y regalos con monedas al contador.
const coinsIn = (text) => { const m = /([\d.]+)\s+monedas/.exec(text); return m ? Number(m[1].replace(/\./g, '')) || 0 : 0; };
function toastFx(t) {
  const text = t.text || '';
  if (t.kind === 'level') {
    const n = (/nivel (\d+)/.exec(text) || [])[1];
    celebrate('level', { title: n ? `¡NIVEL ${n}!` : '¡SUBISTE DE NIVEL!', subtitle: text.replace(/^¡Subiste a nivel \d+!\s*/, ''), icon: '⭐' });
    return true;
  }
  if (t.kind === 'quest') {
    const badge = (S.me?.progress?.badges || []).find((b) => text.includes(b.name));
    if (badge) {
      celebrate('medal', { title: badge.name.toUpperCase(), subtitle: text.replace(/^🎯 [^:]*:\s*/, ''), icon: badgeImg(badge.n, true, 'fx-badge') });
      return true;
    }
    if (text.includes('Campeón de la Liga')) { celebrate('jackpot', { title: '¡CAMPEÓN DE LA LIGA!', subtitle: text.replace(/^🎯 [^:]*:\s*/, ''), icon: '👑' }); return true; }
    if (text.includes('Colección')) { celebrate('level', { title: '¡COLECCIÓN COMPLETA!', subtitle: text.replace(/^🎯 /, ''), icon: '📚' }); return true; }
    // Misión o paso de la Ruta completado.
    sfx('win'); vibrate(40);
    burstAt(window.innerWidth / 2, window.innerHeight * 0.35, '#4ade80', 26, { spread: 190, stars: 0.6 });
    coinRain(coinsIn(text), { from: [window.innerWidth / 2, window.innerHeight * 0.35] });
    return true;
  }
  if (t.kind === 'mega') {
    sfx('sparkle'); vibrate(30);
    import('./fx.js').then(({ burst, layer }) => burst(layer(), window.innerWidth / 2, 60, '#7df9ff', 22, { spread: 170, stars: 0.8 }));
    return true;
  }
  if ((t.kind === t.kind === 'market') && coinsIn(text) && !/Compraste/.test(text)) { sfx('win'); coinRain(coinsIn(text), { from: [window.innerWidth / 2, window.innerHeight * 0.4] }); return true; }
  return false;
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
  // ¡Día de Pago! Meowth hace saltar chispas cuando suben las monedas.
  if (to > from && from > 0) { const sp = h('span', { class: 'sparkle', 'aria-hidden': 'true' }, '✨'); pill.append(sp); setTimeout(() => sp.remove(), 1000); }
}
bus.on('me', (me) => {
  animateCoins(me.coins);
  $('#dust').textContent = fmt(me.dust);
  $('#level').textContent = me.level;
  $('#xpfill').style.width = Math.min(100, ((me.xp - me.xpCur) / (me.xpNext - me.xpCur)) * 100) + '%';
  $('#uname').textContent = me.username;
  $('#buddy-mini').replaceChildren(me.buddy ? buddyImg(me.buddy) : '');
  if (!S.megaHold) updateMegaPill(me);
  $('#buddy-mini').className = me.looks && me.looks.frame ? 'mini-frame fr ' + me.looks.frame : '';
  document.querySelector('[data-view=admin]')?.classList.toggle('hidden', !me.isAdmin);
});
bus.on('toast', (t) => toast(t, 'success'));

// Chip 💠 de la barra superior: fragmentos y combo mientras el evento está activo.
let shownFrags = null;
export function updateMegaPill(me = S.me) {
  const pill = $('#mega-pill');
  if (!pill || !me || !me.mega) return;
  const on = !!(S.mega && S.mega.active);
  pill.classList.toggle('hidden', !on);
  if (!on) return;
  const f = me.mega.frags;
  if (shownFrags !== null && f > shownFrags) {
    pill.classList.remove('gain'); void pill.offsetWidth; pill.classList.add('gain');
    if (f - shownFrags <= 200) floatMega(`+${f - shownFrags} 💠`, pill);
  }
  shownFrags = f;
  $('#mega-frags').textContent = fmt(f);
  const c = me.mega.combo;
  const m = me.mega.mult || 1;
  const hot = S.mega.hour || m > 1;
  pill.classList.toggle('hot', !!hot);
  $('#mega-mult').textContent = m > 1 ? `×${m}` : '';
  clearTimeout(updateMegaPill.t);
  if (c && c.ttl > 0) updateMegaPill.t = setTimeout(() => updateMegaPill(), c.ttl + 50);
}
function floatMega(text, el) {
  import('./fx.js').then(({ floatText }) => floatText(text, el, { color: '#7df9ff', size: 18 }));
}
bus.on('mega', () => updateMegaPill());

// Jigglypuff es el botón de sonido: dormida (con «z») cuando está apagado.
function paintMute() {
  const b = $('#mute-btn');
  b.classList.toggle('is-muted', isMuted());
  b.title = isMuted() ? 'Sonido apagado' : 'Sonido encendido';
  b.setAttribute('aria-label', b.title);
  b.replaceChildren(monImg(MON.jigglypuff, 'jp'), h('span', { class: 'jp-z', 'aria-hidden': 'true' }, 'z'));
}
$('#mute-btn').addEventListener('click', () => { toggleMute(); paintMute(); });
paintMute();
$('#menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
$('#user-btn').addEventListener('click', () => {
  const muteBtn = h('button', { class: 'btn', onclick: () => { const m = toggleMute(); paintMute(); muteBtn.textContent = m ? '🔇 Sonido apagado' : '🔊 Sonido encendido'; } }, isMuted() ? '🔇 Sonido apagado' : '🔊 Sonido encendido');
  const animLabel = () => (animPref() ? '🎞️ Animaciones de Pokémon: sí' : '🎞️ Animaciones de Pokémon: no');
  const animBtn = h('button', { class: 'btn', title: 'Sprites animados en combates, Caja PC, Pokédex y compañero. Apágalas para ahorrar datos. (Se desactivan solas con «reducir movimiento».)', onclick: () => { setAnimPref(!animPref()); animBtn.textContent = animLabel(); toast(animPref() ? 'Animaciones activadas (se aplican al abrir cada pantalla).' : 'Animaciones desactivadas: se usarán imágenes estáticas.', 'info'); } }, animLabel());
  const theme = window.PCTheme;
  const themeLabel = () => (theme && theme.get() === 'night' ? '☀️ Modo día' : '🌙 Modo noche');
  const themeBtn = h('button', { class: 'btn', title: 'Cambia entre el tema claro y el «Modo noche». Por defecto sigue a tu dispositivo.', onclick: () => { if (!theme) return; theme.set(theme.get() === 'night' ? 'day' : 'night'); themeBtn.textContent = themeLabel(); } }, themeLabel());
  const nLabel = () => notifyEnabled() ? '🔔 Avisos activados' : '🔕 Activar avisos';
  const notifyBtn = h('button', { class: 'btn', title: 'Notificación cuando te toca en el póker, te escriben por privado o te mencionan, aunque no estés mirando', onclick: async () => { await toggleNotify(); notifyBtn.textContent = nLabel(); } }, nLabel());
  const menu = h('div', { class: 'stack' },
    h('button', { class: 'btn', onclick: () => { close(); showPlayer(S.me.username); } }, '👤 Ver mi ficha'),
    h('button', { class: 'btn', onclick: () => { close(); location.hash = '#/trainer'; } }, '🏅 Mi Entrenador'),
    themeBtn,
    muteBtn,
    animBtn,
    notifyBtn,
    h('button', { class: 'btn', title: 'Vuelve a mostrar los avisos de acciones arriesgadas que marcaste como «no volver a avisar»', onclick: () => { const n = resetWarnings(); close(); toast(n ? `Avisos restablecidos (${n}): volverás a verlos.` : 'Todos los avisos ya estaban activos.', 'success'); } }, '⚠️ Restablecer avisos'),
    h('button', { class: 'btn', title: 'Vuelve a marcar como «¡Nuevo!» los apartados que aún no has visitado en este dispositivo', onclick: () => { resetVisited(); close(); toast('Los apartados vuelven a salir como «¡Nuevo!».', 'info'); } }, '✨ Volver a ver los «¡Nuevo!»'),
    canInstall() ? h('button', { class: 'btn', onclick: () => { close(); installApp(); } }, '📲 Instalar app') : '',
    h('button', { class: 'btn danger', onclick: logout }, '🚪 Cerrar sesión'));
  const wrap = h('div', { class: 'popover', onclick: (e) => e.stopPropagation() }, menu);
  const close = () => { wrap.remove(); document.removeEventListener('click', close); };
  document.body.append(wrap);
  setTimeout(() => document.addEventListener('click', close), 0);
});

// ---------- Navegación ----------
// Cinco secciones (Inicio, Casino, Pokémon, Mercado, Entrenador): barra lateral en escritorio y barra inferior en móvil (ver nav.js).
// Punto rojo en «Entrenador» y «Novedades» mientras haya algo sin ver.
let newsFresh = false;
function updateNewsDots() {
  document.querySelectorAll('[data-view=news], [data-tab=entrenador], .nav-sec[data-sec=entrenador]').forEach((el) => el.classList.toggle('has-news', newsFresh));
}
bus.on('news', (fresh) => { newsFresh = fresh.length > 0; updateNewsDots(); });
bus.on('visited', () => refreshNew());
function buildNav() { buildSidebar($('#sidebar')); updateNewsDots(); markNav(S.view); }
let navTimer = 0;
// El evento Mega o la cuenta de anfitrión añaden o quitan entradas.
bus.on('mega', () => { clearTimeout(navTimer); navTimer = setTimeout(() => { if (booted) buildNav(); }, 300); });

// Primera visita a una pantalla: el servidor regala 50 monedas (una vez por apartado).
function exploreReward(id) {
  emit('explore:visit', { section: id }).then((r) => { if (r && r.reward) { sfx('win'); toast(`¡Nuevo apartado descubierto! +${r.reward} monedas`, 'success'); } }).catch(() => {});
}

let current = null;
function route() {
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'lobby';
  const view = VIEWS.find((v) => v.id === id) || (id === 'lobby' ? lobby : notFound);
  if (current && current.unmount) current.unmount();
  current = view;
  S.view = view.id;
  markNav(view.id);
  if (markVisited(view.id)) exploreReward(view.id);
  document.body.classList.remove('social-open');
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
    else if (err.message === 'starting') {
      // Los errores del middleware no reconectan solos: se reintenta a mano.
      $('#conn').textContent = 'Actualizando el casino…';
      $('#conn').classList.remove('hidden');
      setTimeout(() => { if (S.socket === socket) socket.connect(); }, 2000);
    }
    else $('#conn').classList.remove('hidden');
  });
  socket.on('disconnect', () => $('#conn').classList.remove('hidden'));
  socket.on('connect', async () => {
    $('#conn').classList.add('hidden');
    $('#conn').textContent = 'Reconectando…';
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
    S.crash = res.crash; S.poker = res.poker; S.events = res.events; S.mega = res.mega;
    bus.emit('mega', res.mega);
    bus.emit('events', res.events);
    bus.emit('race', res.race);
    if (!booted) { booted = true; buildNav(); buildTabbar($('#tabbar')); setMe(S.me); route(); nightPeek(); }
    initNews(res).then(updateNewsDots).catch(() => {});
  });
  socket.on('me', setMe);
  socket.on('events', (e) => { S.events = e; bus.emit('events', e); });
  socket.on('mega:state', (m) => { S.mega = m; bus.emit('mega', m); });
  socket.on('mega:bote', (b) => { if (S.mega) S.mega.bote = b.bote; bus.emit('mega:bote', b); });
  socket.on('mega:hour', (w) => { bus.emit('mega:hour', w); import('./fx.js').then(({ flash, vibrate }) => { flash('#7df9ff', 700); vibrate([60, 40, 60, 40, 120]); }); sfx('levelup'); });
  socket.on('mega:bote:hit', (b) => {
    toast(`💥 ${b.user} ha ganado el BOTE MEGA: ${fmt(b.amount)} monedas`, 'success', 8000);
    import('./fx.js').then(({ confetti, flash }) => { flash('#ffd54f', 600); confetti({ count: 50 }); });
    sfx('jackpot');
  });
  socket.on('chat', (m) => addChat(m));
  socket.on('feed', (f) => { addFeed(f); if (f.kind === 'duel') bus.emit('duel:feed', f); });
  socket.on('online', renderOnline);
  socket.on('jackpot', (j) => { S.jackpot = j; $('#jackpot').textContent = fmt(j); bus.emit('jackpot', j); });
  socket.on('race:state', (r) => { if (S.race && r.round !== S.race.round) S.raceBets = []; S.race = r; bus.emit('race', r); });
  socket.on('race:payout', (p) => bus.emit('race:payout', p));
  socket.on('duel:list', (l) => { S.duels = l; bus.emit('duels', l); });
  for (const ev of ['battle:start', 'battle:event', 'battle:end', 'battle:list']) socket.on(ev, (p) => bus.emit(ev, p));
  socket.on('duel:result', (r) => {
    S.duelHistory = [r, ...(S.duelHistory || [])].slice(0, 20);
    bus.emit('duel:result', r);
    if (current !== duels && r.players[0] === S.me.username) {
      const won = r.players[r.winner] === S.me.username;
      toast(`⚔️ ${r.players[1]} aceptó tu reto: ${won ? '¡ganaste!' : 'perdiste.'} Míralo en Duelos.`, won ? 'success' : 'info', 6000);
    }
  });
  socket.on('toast', (t) => { toast(t.text, 'success', 5000); if (!toastFx(t)) sfx('win'); notify(t.text, { vibrate: t.kind !== 'level' }); });
  socket.on('notify', (n) => {
    // Turno en el póker: solo avisa si no estás ya mirando esa mesa.
    if (n.kind === 'turn' && !document.hidden && location.hash.startsWith('#/' + n.link)) return;
    if (!document.hidden) toast(n.text, 'info', 4000);
    sfx('chat');
    notify(n.text, { link: n.link });
  });
  socket.on('crash:state', (c) => { S.crash = c; bus.emit('crash', c); });
  socket.on('crash:result', (r) => bus.emit('crash:result', r));
  socket.on('poker:lobby', (l) => { S.poker = l; bus.emit('poker:lobby', l); });
  socket.on('poker:table', (t) => bus.emit('poker:table', t));
  socket.on('poker:hole', (x) => bus.emit('poker:hole', x));
  socket.on('market', (m) => bus.emit('market', m));
}

// ---------- App instalable ----------
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; bus.emit('installable', true); });
window.addEventListener('appinstalled', () => { installEvent = null; toast('¡PokéCasino instalado en tu pantalla de inicio!', 'success'); });
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export function canInstall() { return !isStandalone() && (!!installEvent || isIOS()); }
export async function installApp() {
  if (installEvent) {
    installEvent.prompt();
    await installEvent.userChoice.catch(() => null);
    installEvent = null;
  } else if (isIOS()) {
    modal(h('div', { class: 'stack' },
      h('p', {}, 'En iPhone/iPad, desde Safari:'),
      h('ol', { class: 'install-steps' }, h('li', {}, 'Pulsa el botón Compartir (el cuadrado con la flecha ↑).'), h('li', {}, 'Elige «Añadir a pantalla de inicio».'), h('li', {}, 'Pulsa «Añadir». ¡Listo!')),
    ), { title: '📲 Instalar PokéCasino' });
  }
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'goto' && e.data.link) location.hash = e.data.link; });
}

// ---------- Gengar asoma de noche (22:00–07:00, hora local) ----------
function nightPeek() {
  const night = () => { const hr = new Date().getHours(); return hr >= 22 || hr < 7; };
  let el = null;
  const tick = () => {
    if (night() && !el) { el = h('div', { class: 'gengar-peek', 'aria-hidden': 'true' }, monImg(MON.gengar)); document.body.append(el); }
    else if (!night() && el) { el.remove(); el = null; }
  };
  tick();
  setInterval(tick, 600000);
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
  S.megaById = new Map(S.data.mega.forms.map((f) => [f.formId, f]));
  S.megaByStone = new Map(S.data.mega.forms.map((f) => [f.stone, f]));
  try { S.token = localStorage.getItem('token'); } catch { /* nada */ }
  if (S.data.openRegistration) $('#auth-sub').textContent = '¡Crea tu entrenador y empieza a jugar!';
  if (S.token) connect(); else showAuth();
})();
