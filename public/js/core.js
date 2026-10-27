// Utilidades compartidas del cliente.
export const S = { me: null, data: null, dexById: new Map(), online: [], jackpot: 0, race: null, duels: [], token: null, socket: null };

// ---- Bus de eventos ----
const listeners = {};
export const bus = {
  on(ev, fn) { (listeners[ev] ||= new Set()).add(fn); return () => listeners[ev].delete(fn); },
  emit(ev, data) { (listeners[ev] || []).forEach((fn) => fn(data)); },
};

// ---- Sprites públicos de PokeAPI ----
const SPR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites';
export const art = (id, shiny) => `${SPR}/pokemon/other/official-artwork/${shiny ? 'shiny/' : ''}${id}.png`;
export const sprite = (id, shiny) => `${SPR}/pokemon/${shiny ? 'shiny/' : ''}${id}.png`;
export const anim = (id, shiny, back) => `${SPR}/pokemon/other/showdown/${back ? 'back/' : ''}${shiny ? 'shiny/' : ''}${id}.gif`;
export const item = (name) => `${SPR}/items/${name}.png`;

// ---- DOM ----
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);

// Imagen con respaldo: si el sprite animado no existe, usa el estático.
export function img(src, { cls = '', alt = '', fallback } = {}) {
  const el = h('img', { src, class: cls, alt, loading: 'lazy', draggable: 'false' });
  el.addEventListener('error', () => {
    if (fallback && el.src !== fallback) el.src = fallback;
    else el.style.visibility = 'hidden';
  }, { once: false });
  return el;
}
export const pokeImg = (id, shiny, cls = '') => img(art(id, shiny), { cls, alt: S.dexById.get(id)?.name || '', fallback: sprite(id, shiny) });
export const animImg = (id, shiny, cls = '', back = false) => img(anim(id, shiny, back), { cls: 'pixel ' + cls, alt: S.dexById.get(id)?.name || '', fallback: sprite(id, shiny) });

export const fmt = (n) => Math.floor(Number(n) || 0).toLocaleString('es-ES');

export const TYPE_ES = {
  normal: 'Normal', fire: 'Fuego', water: 'Agua', electric: 'Eléctrico', grass: 'Planta', ice: 'Hielo',
  fighting: 'Lucha', poison: 'Veneno', ground: 'Tierra', flying: 'Volador', psychic: 'Psíquico', bug: 'Bicho',
  rock: 'Roca', ghost: 'Fantasma', dragon: 'Dragón', dark: 'Siniestro', steel: 'Acero', fairy: 'Hada', pokeball: 'Poké Ball',
};
export const typeBadge = (t) => h('span', { class: `type t-${t}` }, TYPE_ES[t] || t);
export const RARITY_ORDER = ['M', 'L', 'E', 'R', 'U', 'C'];
export const rarityName = (r) => S.data.rarity[r].name;

// ---- Socket con promesas ----
export function emit(ev, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!S.socket || !S.socket.connected) return reject(new Error('Sin conexión con el servidor.'));
    S.socket.timeout(10000).emit(ev, payload, (err, res) => {
      if (err) return reject(new Error('El servidor no responde.'));
      if (res.me) setMe(res.me);
      if (!res.ok) return reject(new Error(res.error));
      resolve(res);
    });
  });
}
export function setMe(me) { S.me = me; bus.emit('me', me); }

// Ejecuta una acción mostrando el error como aviso.
export async function act(ev, payload, btn) {
  if (btn) btn.disabled = true;
  try { return await emit(ev, payload); } catch (e) { toast(e.message, 'error'); sfx('error'); return null; } finally { if (btn) btn.disabled = false; }
}

// ---- Avisos ----
export function toast(text, kind = 'info', ms = 3800) {
  const box = $('#toasts');
  const t = h('div', { class: `toast toast-${kind}` }, text);
  box.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export function modal(content, { title, wide } = {}) {
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const wrap = h('div', { class: 'modal-wrap', onclick: (e) => { if (e.target === wrap) close(); } },
    h('div', { class: 'modal' + (wide ? ' wide' : '') },
      h('div', { class: 'modal-head' }, h('h3', {}, title || ''), h('button', { class: 'icon-btn', onclick: close, 'aria-label': 'Cerrar' }, '✕')),
      h('div', { class: 'modal-body' }, content)));
  document.body.append(wrap);
  document.addEventListener('keydown', onKey);
  return { close, el: wrap };
}

// ---- Selector de apuesta reutilizable ----
export function betInput(initial = 100, storeKey) {
  let saved = initial;
  try { saved = Number(localStorage.getItem('bet:' + storeKey)) || initial; } catch { /* sin almacenamiento */ }
  const input = h('input', { type: 'number', min: S.data.minBet, max: S.data.maxBet, step: 10, value: saved, class: 'bet-input' });
  const persist = () => { try { localStorage.setItem('bet:' + storeKey, input.value); } catch { /* nada */ } };
  input.addEventListener('change', persist);
  const set = (v) => { input.value = Math.max(S.data.minBet, Math.min(S.data.maxBet, Math.floor(v))); persist(); };
  const chips = [['½', () => set(input.value / 2)], ['×2', () => set(input.value * 2)], ['MIN', () => set(S.data.minBet)], ['MAX', () => set(Math.min(S.data.maxBet, S.me.coins))]];
  const el = h('div', { class: 'bet-box' },
    h('label', {}, 'Apuesta'), h('div', { class: 'bet-row' }, h('span', { class: 'coin-ico' }), input,
      ...chips.map(([t, fn]) => h('button', { class: 'chip', type: 'button', onclick: () => { fn(); sfx('click'); } }, t))));
  return { el, get value() { return Math.floor(Number(input.value)); }, set };
}

// ---- Sonido sintetizado (sin archivos) ----
let actx = null;
let muted = false;
try { muted = localStorage.getItem('muted') === '1'; } catch { /* nada */ }
export const isMuted = () => muted;
export function toggleMute() { muted = !muted; try { localStorage.setItem('muted', muted ? '1' : '0'); } catch { /* nada */ } return muted; }
function tone(freq, dur, type = 'square', vol = 0.05, delay = 0) {
  if (muted) return;
  actx ||= new (window.AudioContext || window.webkitAudioContext)();
  const t0 = actx.currentTime + delay;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + dur);
}
export function sfx(name) {
  try {
    if (name === 'click') tone(660, 0.05, 'square', 0.03);
    else if (name === 'tick') tone(880, 0.03, 'square', 0.02);
    else if (name === 'win') [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.15, 'square', 0.05, i * 0.09));
    else if (name === 'big') [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(f, 0.18, 'square', 0.06, i * 0.1));
    else if (name === 'lose') [392, 330, 262].forEach((f, i) => tone(f, 0.18, 'triangle', 0.05, i * 0.12));
    else if (name === 'boom') { tone(90, 0.5, 'sawtooth', 0.08); tone(60, 0.6, 'square', 0.06, 0.05); }
    else if (name === 'error') tone(180, 0.15, 'square', 0.04);
    else if (name === 'flip') tone(1200, 0.04, 'triangle', 0.04);
    else if (name === 'shiny') [1568, 2093, 2637, 3136].forEach((f, i) => tone(f, 0.12, 'sine', 0.05, i * 0.07));
    else if (name === 'chat') tone(990, 0.06, 'sine', 0.03);
  } catch { /* audio no disponible */ }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
