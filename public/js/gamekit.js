// Utilidades comunes del flujo de juego: modo rápido global, atajo de teclado para la acción principal
// y esperas que se acortan con «⚡ Rápido». Las usan todos los juegos del casino.
import { h, sfx } from './core.js';

const KEY = 'fast';
let fastOn = false;
try { fastOn = localStorage.getItem(KEY) === '1'; } catch { /* sin almacenamiento */ }
const subs = new Set();

export const fast = () => fastOn;
export function setFast(v) {
  fastOn = !!v;
  try { localStorage.setItem(KEY, fastOn ? '1' : '0'); } catch { /* nada */ }
  subs.forEach((f) => f(fastOn));
}
// Duración efectiva: en modo rápido, un tercio.
export const tw = (ms) => (fastOn ? Math.max(0, Math.round(ms / 3)) : ms);
export const wait = (ms) => new Promise((r) => setTimeout(r, tw(ms)));

// Botón «⚡ Rápido» (mismo estado en todos los juegos y se recuerda entre sesiones).
export function speedToggle() {
  const b = h('button', { class: 'chip speed-chip', type: 'button', 'aria-pressed': 'false', title: 'Acorta las animaciones para jugar más deprisa' }, '⚡ Rápido');
  const paint = (v) => { b.classList.toggle('active', v); b.setAttribute('aria-pressed', v ? 'true' : 'false'); };
  paint(fastOn);
  b.addEventListener('click', () => { setFast(!fastOn); sfx('click'); });
  const f = (v) => { if (!b.isConnected) { subs.delete(f); return; } paint(v); };
  subs.add(f);
  return b;
}

// ¿Sigue en pantalla la vista que lo creó? (#view es fijo: al cambiar de pantalla se vacía su contenido, no el propio #view.)
export function viewAlive(root) {
  const mark = document.createElement('i');
  mark.hidden = true;
  root.append(mark);
  return () => mark.isConnected;
}

const TYPING = 'input, textarea, select, button, a, summary, [contenteditable="true"]';
const TEXTY = 'input, textarea, select, a, summary, [contenteditable="true"]';
// Un botón que acaba de recibir un clic de ratón/táctil conserva el foco, pero no es una orden de teclado:
// Espacio / Intro deben lanzar la acción principal, no repetir ese botón.
const pointerFocused = (t) => t.tagName === 'BUTTON' && !(t.matches && t.matches(':focus-visible'));
// Espacio / Intro = acción principal de la vista, salvo que se esté escribiendo, haya un aviso abierto o el foco
// esté en un botón (que ya reacciona solo). Intro dentro de la caja de apuesta también la lanza.
// Se desengancha solo cuando la vista deja de estar en pantalla.
export function hotkey(root, fn) {
  const alive = viewAlive(root);
  const onKey = (e) => {
    if (!alive()) { document.removeEventListener('keydown', onKey); return; }
    if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (document.querySelector('.modal-wrap, .gx')) return;
    const t = e.target;
    const inBet = t && t.classList && t.classList.contains('bet-input') && e.key === 'Enter';
    if (!inBet && t && t.closest) {
      if (t.closest(TEXTY)) return;
      if (t.closest('button') && !pointerFocused(t.closest('button'))) return;
    }
    e.preventDefault();
    if (e.key === ' ') { const quiet = (k) => { if (k.key === ' ') { k.preventDefault(); document.removeEventListener('keyup', quiet, true); } }; document.addEventListener('keyup', quiet, true); }
    if (inBet) t.blur();
    fn();
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
