// Utilidades compartidas del cliente.
import { plain } from './pkicons.js';
export const S = { me: null, data: null, dexById: new Map(), online: [], jackpot: 0, race: null, duels: [], token: null, socket: null };

// ---- Bus de eventos ----
const listeners = {};
export const bus = {
  on(ev, fn) { (listeners[ev] ||= new Set()).add(fn); return () => listeners[ev].delete(fn); },
  // Se recorre una copia: un oyente que se vuelve a suscribir (p. ej. al repintar una vista) no se ejecuta otra vez.
  emit(ev, data) { [...(listeners[ev] || [])].forEach((fn) => fn(data)); },
};

// ---- Sprites públicos de PokeAPI ----
const SPR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites';
export const art = (id, shiny) => `${SPR}/pokemon/other/official-artwork/${shiny ? 'shiny/' : ''}${id}.png`;
export const sprite = (id, shiny) => `${SPR}/pokemon/${shiny ? 'shiny/' : ''}${id}.png`;
export const anim = (id, shiny, back) => `${SPR}/pokemon/other/showdown/${back ? 'back/' : ''}${shiny ? 'shiny/' : ''}${id}.gif`;
export const item = (name) => `${SPR}/items/${name}.png`;
export const SPR_BADGE = (n) => `${SPR}/badges/${n}.png`;
// Pokémon de adorno (detallitos de fan service) y objetos del juego.
export const MON = { chansey: 113, meowth: 52, snorlax: 143, psyduck: 54, slowpoke: 79, kecleon: 352, wobbuffet: 202, pikachu: 25, jigglypuff: 39, gengar: 94, unown: 201, eevee: 133, togepi: 175, oddish: 43 };

// ---- DOM ----
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : (k === 'title' || k === 'placeholder' || k === 'aria-label') && typeof v === 'string' ? plain(v) : v);
  }
  // Los emojis del texto se convierten en iconos de Pokémon (pkicons.js); donde no caben imágenes se quitan.
  const noImg = tag === 'option' || tag === 'textarea' || tag === 'title';
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(noImg ? plain(c) : String(c)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);

// ---- Piezas de interfaz «de juego de Pokémon» ----
// Sprite pequeño de adorno (nunca estorba: sin texto, oculto si no carga).
export function monImg(id, cls = '', shiny = false) {
  const el = h('img', { class: 'pixel ' + cls, src: sprite(id, shiny), alt: '', loading: 'lazy', draggable: 'false' });
  el.addEventListener('error', () => { el.style.visibility = 'hidden'; }, { once: true });
  return el;
}
// Barra de PS: verde, amarilla (<50 %) o roja (<20 %).
export function hpBar(pct, cls = '') {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return h('div', { class: `bar ${cls} ${p < 20 ? 'r' : p < 50 ? 'y' : ''}`.trim(), role: 'progressbar', 'aria-valuenow': Math.round(p), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: p + '%' } }));
}
// Caja de texto dicha por un Pokémon (mon) o personaje (emoji): una frase corta y, si hace falta, botones.
export function say({ who, mon, emoji, text, actions, cls = '' } = {}) {
  const av = emoji ? h('span', { class: 'say-av emoji', 'aria-hidden': 'true' }, emoji) : h('span', { class: 'say-av' }, mon ? monImg(mon) : null);
  return h('div', { class: 'say ' + cls }, av,
    h('div', { class: 'say-box' }, who ? h('span', { class: 'say-who' }, who) : null, h('div', { class: 'say-text' }, text),
      actions && actions.length ? h('div', { class: 'say-actions' }, actions) : null));
}
// Cargando…: Poké Ball giratoria.
export const loader = (text = 'Cargando…') => h('div', { class: 'loader', role: 'status' }, h('span', { class: 'ball-spin' }), text);
// Estado vacío: Snorlax dormido (o el Pokémon que se indique) y una frase.
export function emptyState(text, mon = MON.snorlax, ...extra) {
  return h('div', { class: 'empty-state' }, h('span', { class: mon === MON.snorlax ? 'zzz' : '' }, monImg(mon)), h('div', {}, text), ...extra);
}

// Imagen con respaldo: si el sprite animado no existe, usa el estático.
export function img(src, { cls = '', alt = '', fallback } = {}) {
  const el = h('img', { src, class: cls, alt, loading: 'lazy', draggable: 'false' });
  el.addEventListener('error', () => {
    if (fallback && el.src !== fallback) el.src = fallback;
    else el.style.visibility = 'hidden';
  }, { once: false });
  return el;
}
// `mega`: id de la forma Mega (megadata) para pintar la megaevolución. Los variocolor de algunas formas no existen: se cae a la normal.
export const pokeImg = (id, shiny, cls = '', mega = 0) => (mega
  ? img(art(mega, shiny), { cls, alt: S.megaById?.get(mega)?.name || '', fallback: art(mega, false) })
  : img(art(id, shiny), { cls, alt: S.dexById.get(id)?.name || '', fallback: sprite(id, shiny) }));
// Sprite pequeño del compañero (con su megaevolución si la lleva puesta).
export const buddySprite = (b) => (b.mega ? sprite(b.mega, b.shiny) : sprite(b.id, b.shiny));
export const buddyImg = (b, cls = 'pixel') => { const el = h('img', { class: cls, src: buddySprite(b), alt: '' }); if (b.mega) el.addEventListener('error', () => { if (el.src !== sprite(b.mega)) el.src = sprite(b.mega); }, { once: true }); return el; };
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
  // Los errores los «dice» Psyduck, confundido, en la caja de texto inferior.
  const t = h('div', { class: `toast toast-${kind}`, role: 'status' }, kind === 'error' ? h('img', { class: 't-ico pixel', src: sprite(MON.psyduck), alt: '' }) : null, h('span', { class: 't-txt' }, text));
  box.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export function modal(content, { title, wide, onClose } = {}) {
  const close = () => { if (!wrap.isConnected) return; wrap.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const wrap = h('div', { class: 'modal-wrap', onclick: (e) => { if (e.target === wrap) close(); } },
    h('div', { class: 'modal' + (wide ? ' wide' : '') },
      h('div', { class: 'modal-head' }, h('h3', {}, title || ''), h('button', { class: 'icon-btn', onclick: close, 'aria-label': 'Cerrar' }, '✕')),
      h('div', { class: 'modal-body' }, content)));
  document.body.append(wrap);
  document.addEventListener('keydown', onKey);
  return { close, el: wrap };
}

// ---- Avisos de acciones arriesgadas ----
// Cada aviso se puede silenciar por apartado (clave 'warn:<key>' = 'off' en localStorage).
const SECTION_NAMES = {
  slots: 'Pika-Slots', roulette: 'la Ruleta', plinko: 'Plinko', mines: 'Minas', quiz: 'el Desafío', voltorb: 'Voltorb Flip', crash: 'Crash', race: 'las Carreras',
  blackjack: 'el Blackjack', videopoker: 'el Video Póker', baccarat: 'el Baccarat', duels: 'los Duelos', poker: 'el Póker', gacha: 'el Gacha',
  bj: 'el Blackjack', vp: 'el Video Póker', masterball: 'el Gacha', release: 'la Pokédex y la Tienda', item: 'la Mochila', market: 'el Mercado', pokedex: 'la Pokédex', shop: 'la Tienda', gift: 'los regalos', items: 'los objetos',
};
const warnKey = (key) => 'warn:' + key;
const warnIsOff = (key) => { try { return localStorage.getItem(warnKey(key)) === 'off'; } catch { return false; } };
export function resetWarnings() {
  let n = 0;
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('warn:')) keys.push(k); }
    keys.forEach((k) => localStorage.removeItem(k));
    n = keys.length;
  } catch { /* sin almacenamiento */ }
  return n;
}
// Devuelve una promesa: true = continuar, false = cancelar (Escape, fondo o botón seguro).
export function confirmRisk(key, { title, text, danger = 'Continuar', safe = 'Cancelar', details, section } = {}) {
  if (warnIsOff(key)) return Promise.resolve(true);
  const sec = section || SECTION_NAMES[key.split(':')[1]] || SECTION_NAMES[key.split(':')[0].split('-')[0]] || 'este apartado';
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (ok && chk.checked) { try { localStorage.setItem(warnKey(key), 'off'); } catch { /* no se recuerda */ } }
      document.removeEventListener('keydown', onKey, true);
      m.close();
      resolve(ok);
    };
    const chk = h('input', { type: 'checkbox' });
    const safeBtn = h('button', { class: 'btn primary big', type: 'button', onclick: () => finish(false) }, safe);
    const riskBtn = h('button', { class: 'btn risk-go', type: 'button', onclick: () => finish(true) }, danger);
    const body = h('div', { class: 'risk-box', role: 'alertdialog', 'aria-label': title },
      h('div', { class: 'risk-ico', 'aria-hidden': 'true' }, '⚠️'),
      h('h3', { class: 'risk-title' }, title),
      h('p', { class: 'risk-text' }, text),
      details && details.length ? h('ul', { class: 'risk-details' }, details.map((d) => h('li', {}, d))) : null,
      h('label', { class: 'risk-check' }, chk, h('span', {}, `No volver a avisarme de esto en ${sec}`)),
      h('div', { class: 'risk-actions' }, safeBtn, riskBtn));
    const m = modal(body, { title: '', onClose: () => finish(false) });
    m.el.classList.add('risk-wrap');
    // Enter = opción segura (salvo que el foco esté en el botón de continuar).
    const onKey = (e) => {
      if (e.key !== 'Enter' || !m.el.isConnected) return;
      if (document.activeElement === riskBtn) return;
      e.preventDefault(); e.stopPropagation(); finish(false);
    };
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => safeBtn.focus(), 30);
  });
}
// Apuesta alta: ≥ 50 % de tus monedas o que te deje por debajo del umbral de la enfermera Joy.
export function confirmBet(game, stake, { details, what = 'apostar' } = {}) {
  const coins = Math.floor(S.me?.coins || 0);
  stake = Math.floor(Number(stake) || 0);
  if (stake <= 0 || coins <= 0) return Promise.resolve(true);
  const limit = S.data?.heal?.limit ?? 200;
  const pct = stake / coins;
  const left = coins - stake;
  const high = pct >= 0.5;
  const broke = left < limit && coins >= limit;
  if (!high && !broke) return Promise.resolve(true);
  let text = `Vas a ${what} ${fmt(stake)} de tus ${fmt(coins)} monedas (${Math.round(pct * 100)} %).`;
  if (broke) text += ` Si lo pierdes te quedarías con ${fmt(Math.max(0, left))}. La enfermera Joy solo te presta monedas cuando tienes menos de ${fmt(limit)} y una vez por hora.`;
  else text += ` Si sale mal, perderías más de la mitad de tu saldo de golpe.`;
  return confirmRisk('bet-high:' + game, { title: 'Apuesta muy alta', text, details, danger: 'Apostar igualmente', safe: 'Cancelar' });
}

// ---- Selector de apuesta reutilizable ----
export const maxBet = () => (S.me && S.me.maxBet) || S.data.maxBet;
export function betInput(initial = 100, storeKey) {
  let saved = initial;
  try { saved = Number(localStorage.getItem('bet:' + storeKey)) || initial; } catch { /* sin almacenamiento */ }
  const input = h('input', { type: 'number', min: S.data.minBet, max: maxBet(), step: 10, value: Math.min(saved, maxBet()), class: 'bet-input' });
  const persist = () => { try { localStorage.setItem('bet:' + storeKey, input.value); } catch { /* nada */ } };
  input.addEventListener('change', persist);
  const set = (v) => { input.value = Math.max(S.data.minBet, Math.min(maxBet(), Math.floor(v))); persist(); };
  const chips = [['½', () => set(input.value / 2)], ['×2', () => set(input.value * 2)], ['MIN', () => set(S.data.minBet)], ['MAX', () => set(Math.min(maxBet(), S.me.coins))]];
  const el = h('div', { class: 'bet-box' },
    h('label', { title: 'El límite sube con las medallas de gimnasio' }, `Apuesta (máx. ${fmt(maxBet())})`), h('div', { class: 'bet-row' }, h('span', { class: 'coin-ico' }), input,
      ...chips.map(([t, fn]) => h('button', { class: 'chip', type: 'button', onclick: () => { fn(); sfx('click'); } }, t))));
  return { el, get value() { return Math.floor(Number(input.value)); }, set };
}

// ---- Sonido sintetizado (sin archivos) ----
let actx = null;
let muted = false;
try { muted = localStorage.getItem('muted') === '1'; } catch { /* nada */ }
export const isMuted = () => muted;
export function toggleMute() { muted = !muted; try { localStorage.setItem('muted', muted ? '1' : '0'); } catch { /* nada */ } return muted; }
// Barrido de frecuencia (lanzamientos, subidas de tensión).
function sweep(f0, f1, dur, type = 'sine', vol = 0.05, delay = 0) {
  if (muted) return;
  actx ||= new (window.AudioContext || window.webkitAudioContext)();
  const t0 = actx.currentTime + delay;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + dur);
}
// Ruido filtrado (explosión de la Poké Ball).
function noise(dur, vol = 0.08, delay = 0) {
  if (muted) return;
  actx ||= new (window.AudioContext || window.webkitAudioContext)();
  const t0 = actx.currentTime + delay;
  const buf = actx.createBuffer(1, Math.floor(actx.sampleRate * dur), actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = actx.createBufferSource();
  const f = actx.createBiquadFilter();
  const g = actx.createGain();
  f.type = 'lowpass'; f.frequency.setValueAtTime(3000, t0); f.frequency.exponentialRampToValueAtTime(200, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  src.buffer = buf; src.connect(f).connect(g).connect(actx.destination); src.start(t0);
}
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
export function sfx(name, n = 0) {
  try {
    if (name === 'throw') sweep(300, 1400, 0.35, 'triangle', 0.05);
    else if (name === 'land') { tone(140, 0.12, 'triangle', 0.08); tone(90, 0.1, 'sine', 0.06, 0.03); }
    else if (name === 'wobble') { tone(520 + n * 140, 0.07, 'square', 0.04); tone(390 + n * 140, 0.07, 'square', 0.03, 0.08); }
    else if (name === 'upgrade') [784, 988, 1175, 1568].forEach((f, i) => tone(f * (1 + n * 0.12), 0.1, 'triangle', 0.05, i * 0.05));
    else if (name === 'charge') sweep(110, 880 + n * 300, 1.1 + n * 0.3, 'sawtooth', 0.025);
    else if (name === 'burst') { noise(0.6, 0.12); tone(70, 0.4, 'sine', 0.12); }
    else if (name === 'reveal') [659, 880].forEach((f, i) => tone(f, 0.12, 'triangle', 0.05, i * 0.08));
    else if (name === 'star') tone(1046 + n * 160, 0.07, 'sine', 0.04);
    else if (name === 'fanfare') [[523, 0], [523, 0.12], [523, 0.24], [698, 0.36], [880, 0.62], [784, 0.86], [880, 1.0], [1046, 1.14]].forEach(([f, t]) => { tone(f, 0.22, 'square', 0.05, t); tone(f / 2, 0.22, 'triangle', 0.05, t); });
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
    // Efectos de celebración (fx.js)
    else if (name === 'coin') { tone(1318 + n * 60, 0.05, 'square', 0.025); tone(1760 + n * 60, 0.09, 'square', 0.025, 0.05); }
    else if (name === 'crack') { noise(0.12, 0.08); tone(220 + n * 70, 0.06, 'square', 0.04); }
    else if (name === 'rumble') sweep(70, 140 + n * 40, 0.5, 'sawtooth', 0.04);
    else if (name === 'whoosh') sweep(220, 1200, 0.25, 'triangle', 0.025);
    else if (name === 'levelup') [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => tone(f, 0.16, 'triangle', 0.055, i * 0.07));
    else if (name === 'jackpot') { [523, 659, 784, 1046, 1318, 1568, 2093].forEach((f, i) => { tone(f, 0.22, 'square', 0.05, i * 0.08); tone(f / 2, 0.22, 'triangle', 0.05, i * 0.08); }); [2093, 1568, 2093, 2637].forEach((f, i) => tone(f, 0.12, 'sine', 0.045, 0.7 + i * 0.1)); }
    // Megaevolución
    else if (name === 'megacharge') { sweep(120, 1600 + n * 400, 1.6, 'sawtooth', 0.03); sweep(240, 3200, 1.6, 'triangle', 0.02, 0.1); }
    else if (name === 'megaboom') { noise(0.9, 0.14); tone(55, 0.7, 'sine', 0.14); [523, 659, 784, 1046, 1318, 1568, 2093].forEach((f, i) => tone(f, 0.28, 'square', 0.05, 0.1 + i * 0.07)); }
    else if (name === 'reel') tone(300 + n * 90, 0.04, 'square', 0.02);
    else if (name === 'reelstop') { tone(200, 0.08, 'triangle', 0.07); tone(120, 0.1, 'sine', 0.05, 0.02); }
    else if (name === 'heartbeat') { tone(70, 0.1, 'sine', 0.1); tone(60, 0.12, 'sine', 0.08, 0.14); }
    else if (name === 'sparkle') [2093, 2637, 3136].forEach((f, i) => tone(f, 0.08, 'sine', 0.035, i * 0.05));
  } catch { /* audio no disponible */ }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Naipes ----
const SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
export function playingCard(c, { cls = '', delay = 0, back = null } = {}) {
  if (!c || c === '??') {
    // Dorso personalizado: el cosmético muestra un Pokémon en el reverso.
    const cos = back && S.data.cosmetics[back];
    return h('div', { class: 'pcard-play back ' + (cos ? 'custom ' : '') + cls, style: { animationDelay: delay + 'ms' } },
      cos ? h('img', { class: 'pixel back-mon', src: sprite(cos.pokemon), alt: '' }) : null);
  }
  const r = c[0] === 'T' ? '10' : c[0];
  const red = c[1] === 'h' || c[1] === 'd';
  return h('div', { class: `pcard-play ${red ? 'red' : ''} ${cls}`, style: { animationDelay: delay + 'ms' } },
    h('span', { class: 'pc-r' }, r), h('span', { class: 'pc-s' }, SUIT_SYM[c[1]]), h('span', { class: 'pc-big' }, SUIT_SYM[c[1]]));
}

// ---- Objetos ----
export const itemImg = (id, cls = '') => {
  const it = S.data.items[id];
  return h('img', { class: 'pixel item-img ' + cls + (it.pokemon ? ' zoom' : ''), src: it.pokemon ? sprite(it.pokemon) : item(it.sprite), alt: it.name });
};

// ---- Aspecto del jugador: marco del avatar y título ----
export function avatar(buddy, looks = {}, cls = '') {
  const inner = buddy ? buddyImg(buddy) : h('span', { class: 'av-empty' }, '🧢');
  return h('span', { class: `avatar ${looks.frame ? 'fr ' + looks.frame : ''} ${cls}` }, inner);
}
export const titleTag = (t) => (t ? h('span', { class: 'title-tag' }, t) : null);
export const badgeImg = (n, got = true, cls = '') => h('img', { class: `pixel badge-img ${got ? '' : 'locked'} ${cls}`, src: `${SPR}/badges/${n}.png`, alt: `Medalla ${n}` });
export const RAR_NAME = { C: 'Común', U: 'Poco común', R: 'Rara', E: 'Épica', L: 'Legendaria', M: 'Mítica' };

// Abre el Mercado con una búsqueda ya escrita.
export function goMarket(q) { S.marketQuery = q; location.hash = '#/market'; }
export const itemName = (id) => S.data.items[id]?.name || id;

// ---------- Avisos (vibración, contador en el título y notificación del sistema) ----------
let notifyOn = false;
try { notifyOn = localStorage.getItem('notify') === '1'; } catch { /* nada */ }
export const notifyEnabled = () => notifyOn && typeof Notification !== 'undefined' && Notification.permission === 'granted';
export async function toggleNotify() {
  if (notifyOn) notifyOn = false;
  else {
    if (typeof Notification === 'undefined') { toast('Tu navegador no admite notificaciones. Instala la app para recibirlas.', 'error'); return false; }
    const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (perm !== 'granted') { toast('No diste permiso para las notificaciones.', 'error'); return false; }
    notifyOn = true;
  }
  try { localStorage.setItem('notify', notifyOn ? '1' : '0'); } catch { /* nada */ }
  return notifyOn;
}
const baseTitle = document.title;
let unread = 0;
document.addEventListener('visibilitychange', () => { if (!document.hidden) { unread = 0; document.title = baseTitle; } });
export function notify(text, { link, vibrate = true } = {}) {
  if (vibrate && navigator.vibrate) try { navigator.vibrate([60, 40, 60]); } catch { /* nada */ }
  if (!document.hidden) return;
  unread++;
  document.title = `(${unread}) ${baseTitle}`;
  if (!notifyEnabled()) return;
  const opts = { body: text, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'pokecasino-' + (link || 'msg'), data: { link: link ? '#/' + link : '' } };
  navigator.serviceWorker?.getRegistration().then((reg) => reg ? reg.showNotification('PokéCasino', opts) : new Notification('PokéCasino', opts)).catch(() => {});
}
