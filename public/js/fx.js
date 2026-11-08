// Efectos compartidos: partículas, destellos, lluvia de monedas hacia el contador, confeti, temblores,
// cuenta ascendente y la pantalla de celebración para los grandes momentos.
// Todo usa transform/opacity (fluido en móvil), limita el número de partículas y respeta
// prefers-reduced-motion y el botón de silencio (el sonido lo gestiona sfx() de core.js).
import { h, $, fmt, sfx, sprite } from './core.js';

export const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const vibrate = (p) => { try { if (!reduced() && navigator.vibrate) navigator.vibrate(p); } catch { /* sin vibración */ } };
export const centerOf = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
// Punto de origen: un elemento, unas coordenadas [x, y] o, por defecto, el centro de la pantalla.
const pt = (o) => (o instanceof Element && o.isConnected ? centerOf(o) : Array.isArray(o) ? o : [window.innerWidth / 2, window.innerHeight * 0.5]);

// Capa global fija: nunca desborda ni captura toques.
let host = null;
export function layer() {
  if (!host || !host.isConnected) { host = h('div', { class: 'fx-layer', 'aria-hidden': 'true' }); document.body.append(host); }
  return host;
}

// ---- Partículas: estrellas y confeti que salen de un punto (usa .gx-p de style.css) ----
let live = 0;
const MAX_LIVE = 240;
export function burst(layerEl, x, y, color, n, { spread = 260, stars = 0.4, size = 1 } = {}) {
  if (reduced()) n = Math.min(n, 8);
  n = Math.min(n, Math.max(4, MAX_LIVE - live));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = spread * (0.35 + Math.random() * 0.65);
    const star = Math.random() < stars;
    const p = h('span', { class: 'gx-p' + (star ? ' star' : '') }, star ? '★' : '');
    p.style.cssText = `left:${x}px;top:${y}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 40}px;--rot:${(Math.random() - 0.5) * 720}deg;`
      + `--s:${(0.6 + Math.random() * 0.9) * size};--c:${color};animation-duration:${700 + Math.random() * 700}ms`;
    layerEl.append(p);
    live++;
    setTimeout(() => { p.remove(); live--; }, 1500);
  }
}
// Atajos sobre la capa global.
export const burstAt = (x, y, color, n, opts) => burst(layer(), x, y, color, n, opts);
export const burstEl = (el, color, n, opts) => burst(layer(), ...pt(el), color, n, opts);

// ---- Destello de pantalla completa ----
export function flash(color = '#ffffff', ms = 500) {
  if (reduced()) return;
  const el = h('div', { class: 'fx-flash', style: { '--fc': color, animationDuration: ms + 'ms' } });
  layer().append(el);
  setTimeout(() => el.remove(), ms + 60);
}

// ---- Temblor (por defecto, de toda la vista) ----
export function shake(el = $('#view'), ms = 450) {
  if (!el || reduced()) return;
  const k = [0, -6, 5, -4, 3, -2, 0];
  el.animate(k.map((v, i) => ({ translate: `${v}px ${i % 2 ? 1 : -1}px`, offset: i / (k.length - 1) })), { duration: ms, easing: 'ease-out' });
}

// Resplandor breve alrededor de un elemento.
export function glow(el, color = '#ffd54f', ms = 900) {
  if (!el || reduced()) return;
  el.animate([{ boxShadow: `0 0 0 0 ${color}00` }, { boxShadow: `0 0 26px 8px ${color}`, offset: 0.3 }, { boxShadow: `0 0 0 0 ${color}00` }], { duration: ms, easing: 'ease-out' });
}
// Rebote (escala) de un elemento.
export function pop(el, to = 1.35) {
  if (!el || reduced()) return;
  el.animate([{ scale: 1 }, { scale: to, offset: 0.4 }, { scale: 1 }], { duration: 450, easing: 'cubic-bezier(.2,1.8,.4,1)' });
}

// ---- Cuenta ascendente de un número ----
export function countUp(el, from, to, ms = 900, format = fmt) {
  return new Promise((res) => {
    if (reduced() || from === to) { el.textContent = format(to); return res(); }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      el.textContent = format(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1 && el.isConnected) requestAnimationFrame(step); else { el.textContent = format(to); res(); }
    };
    requestAnimationFrame(step);
  });
}

// Texto flotante que sube y se desvanece («+250», «×5»…).
export function floatText(text, origin, { color = '#ffd54f', size = 22 } = {}) {
  const [x, y] = pt(origin);
  const el = h('div', { class: 'fx-float', style: { left: x + 'px', top: y + 'px', color, fontSize: size + 'px' } }, text);
  layer().append(el);
  setTimeout(() => el.remove(), 1500);
  return el;
}

// ---- Lluvia de monedas que vuela hasta el contador de la barra superior ----
let lastBump = 0;
export function coinRain(amount, { from, count, label = true } = {}) {
  const pill = $('#coins')?.parentElement;
  let [tx, ty] = [window.innerWidth - 70, 28];
  if (pill) { const r = pill.getBoundingClientRect(); if (r.width) [tx, ty] = [r.left + r.width / 2, r.top + r.height / 2]; }
  const [ox, oy] = pt(from);
  const n = reduced() ? 3 : count ?? Math.max(5, Math.min(22, Math.round(4 + Math.log10(Math.max(10, amount || 10)) * 3)));
  let arrived = 0;
  for (let i = 0; i < n; i++) {
    const coin = h('span', { class: 'fx-coin' });
    coin.style.left = ox + 'px'; coin.style.top = oy + 'px';
    layer().append(coin);
    const a = Math.random() * Math.PI * 2;
    const r = 40 + Math.random() * 90;
    const sx = Math.cos(a) * r;
    const sy = Math.sin(a) * r * 0.7 - 30;
    const dur = reduced() ? 400 : 850 + Math.random() * 350;
    const anim = coin.animate([
      { transform: 'translate(0,0) scale(.3)', opacity: 0 },
      { transform: `translate(${sx}px,${sy}px) scale(1) rotateY(180deg)`, opacity: 1, offset: 0.28 },
      { transform: `translate(${tx - ox}px,${ty - oy}px) scale(.45) rotateY(540deg)`, opacity: 0.95 },
    ], { duration: dur, delay: i * 38, easing: 'cubic-bezier(.45,.05,.75,.5)', fill: 'backwards' });
    anim.onfinish = () => {
      coin.remove();
      arrived++;
      if (arrived % 2 === 1) sfx('coin', Math.min(5, arrived >> 1));
      const now = performance.now();
      if (pill && now - lastBump > 90) { lastBump = now; pop(pill, 1.18); }
    };
  }
  if (label && amount > 0) {
    const el = h('div', { class: 'fx-float plus', style: { left: ox + 'px', top: oy + 'px' } }, '+0');
    layer().append(el);
    countUp(el, 0, amount, 700, (v) => '+' + fmt(v));
    setTimeout(() => el.remove(), 1700);
  }
  return new Promise((res) => setTimeout(res, n * 38 + 1300));
}

// ---- Confeti de colores que cae desde arriba ----
const CONF = ['#ffd54f', '#f472b6', '#38bdf8', '#4ade80', '#c084fc', '#fb923c', '#ffffff'];
export function confetti({ count = 60, colors = CONF } = {}) {
  const n = reduced() ? 12 : Math.min(count, 70);
  const W = window.innerWidth;
  const H = window.innerHeight;
  for (let i = 0; i < n; i++) {
    const p = h('i', { class: 'fx-conf' });
    p.style.cssText = `left:${Math.random() * W}px;background:${colors[i % colors.length]};width:${6 + Math.random() * 6}px;height:${9 + Math.random() * 8}px`;
    layer().append(p);
    const sway = (Math.random() - 0.5) * 160;
    const dur = 1800 + Math.random() * 1600;
    const an = p.animate([
      { transform: 'translate(0,-20px) rotate(0)', opacity: 1 },
      { transform: `translate(${sway}px,${H * 0.55}px) rotate(${Math.random() * 540}deg)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${sway * -0.6}px,${H + 30}px) rotate(${Math.random() * 1080}deg)`, opacity: 0.8 },
    ], { duration: dur, delay: Math.random() * 450, easing: 'cubic-bezier(.3,.2,.6,1)', fill: 'backwards' });
    an.onfinish = () => p.remove();
  }
}

// ---- Pantalla de celebración (subida de nivel, medalla, premio gordo) ----
const LEVEL_OF = { level: 3, medal: 4, jackpot: 5 };
const COLOR_OF = { 3: '#7dd3fc', 4: '#fbbf24', 5: '#ffd54f' };
let chain = Promise.resolve();
/**
 * @param {'level'|'medal'|'jackpot'|number} level intensidad (1-5)
 * @param {{title?: string, subtitle?: string, icon?: string|Node, amount?: number, ms?: number}} opts
 * @returns {Promise<void>} se resuelve al cerrarse (toque o cierre automático). Las celebraciones se encolan.
 */
export function celebrate(level, opts = {}) {
  const p = chain.then(() => show(level, opts));
  chain = p.catch(() => {});
  return p;
}
function show(level, { title = '', subtitle = '', icon = '🏆', amount = 0, ms } = {}) {
  return new Promise((resolve) => {
    const lv = typeof level === 'number' ? level : LEVEL_OF[level] || 3;
    const color = COLOR_OF[lv] || '#ffd54f';
    const rays = h('div', { class: 'gx-rays' });
    const fxl = h('div', { class: 'gx-fx' });
    const iconEl = h('div', { class: 'fx-cel-icon' }, icon);
    const titleEl = h('h2', { class: 'fx-cel-title' }, title);
    const amt = h('div', { class: 'fx-cel-amt' }, amount ? '0' : '');
    const stage = h('div', { class: 'gx-stage fx-cel-stage' }, iconEl, titleEl, subtitle ? h('div', { class: 'fx-cel-sub' }, subtitle) : null, amount ? h('div', { class: 'fx-cel-amtrow' }, h('span', { class: 'coin-ico' }), amt) : null);
    const hint = h('div', { class: 'gx-hint' }, 'Toca para continuar');
    const ov = h('div', { class: 'gx fx-cel', 'data-lv': String(lv), role: 'dialog', 'aria-label': title || 'Celebración' }, rays, stage, fxl, hint);
    let closed = false;
    const t0 = performance.now();
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      ov.classList.add('out');
      setTimeout(() => { ov.remove(); document.body.classList.remove('gx-open'); }, 220);
      resolve();
    };
    const tap = () => { if (performance.now() - t0 > 350) close(); };
    const onKey = (e) => { if (e.target && e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]')) return; if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); tap(); } };
    ov.addEventListener('click', tap);
    document.addEventListener('keydown', onKey);
    document.body.append(ov);
    document.body.classList.add('gx-open');

    const [x, y] = [window.innerWidth / 2, window.innerHeight * 0.38];
    sfx('whoosh');
    flash(color, 600);
    setTimeout(() => {
      sfx(lv >= 5 ? 'jackpot' : lv === 4 ? 'fanfare' : 'levelup');
      vibrate(lv >= 5 ? [80, 40, 80, 40, 200] : [60, 40, 100]);
      burst(fxl, x, y, color, 30 + lv * 14, { spread: 200 + lv * 55, stars: 0.6, size: 1 + lv * 0.1 });
      if (lv >= 4) setTimeout(() => burst(fxl, x, y, '#ffffff', 40, { spread: 420, stars: 0.8, size: 1.3 }), 260);
      if (lv >= 4) confetti({ count: lv >= 5 ? 70 : 40 });
      if (amount) {
        countUp(amt, 0, amount, 1300 + lv * 150).then(() => { sfx('shiny'); pop(amt); });
        const tk = setInterval(() => { if (!amt.isConnected) return clearInterval(tk); sfx('tick'); }, 110);
        setTimeout(() => clearInterval(tk), 1300 + lv * 150);
        coinRain(amount, { from: [x, y + 40], count: lv >= 5 ? 20 : 12, label: false });
      }
    }, 180);
    setTimeout(close, ms ?? (amount ? 5200 : lv >= 4 ? 4200 : 3300));
  });
}

// ---- Premios de juegos: sube el efecto con el multiplicador ----
// Pequeño: ráfaga + monedas. Grande (≥5×): destello, más monedas y temblor. Enorme (≥20× o bote): pantalla de celebración.
export function tierOf(paid, bet, jackpot = false) {
  if (!(paid > 0)) return null;
  const ratio = bet > 0 ? paid / bet : 0;
  if (jackpot || ratio >= 20) return 'huge';
  if (ratio >= 5) return 'big';
  if (ratio > 1) return 'small';
  return null;
}
export function winFx(paid, bet, { el, jackpot = false, title = '¡GRAN PREMIO!', icon = '🏆' } = {}) {
  const tier = tierOf(paid, bet, jackpot);
  if (!tier) return null;
  const o = pt(el);
  const ratio = bet > 0 ? Math.round((paid / bet) * 10) / 10 : 0;
  if (tier === 'small') {
    burst(layer(), ...o, '#ffd54f', 16, { spread: 150 });
    coinRain(paid, { from: o, count: 5, label: false });
  } else if (tier === 'big') {
    flash('#ffe08a', 450);
    burst(layer(), ...o, '#ffd54f', 40, { spread: 280, stars: 0.5 });
    setTimeout(() => burst(layer(), ...o, '#ffffff', 22, { spread: 200, stars: 0.8 }), 180);
    coinRain(paid, { from: o, count: 12 });
    floatText(`×${fmt(ratio)}`, [o[0], o[1] - 30], { size: 30 });
    shake(undefined, 400);
    vibrate([40, 30, 70]);
  } else {
    // ¡Pikachu lo celebra contigo!
    const pika = h('img', { class: 'pixel pika-cheer', src: sprite(25), alt: '' });
    celebrate('jackpot', { title, icon: pika, amount: paid, subtitle: jackpot ? '¡Bote!' : ratio ? `×${fmt(ratio)} tu apuesta` : '' });
  }
  return tier;
}
