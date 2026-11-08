// Sprites animados de Pokémon Showdown (con imagen estática de respaldo) y ajuste de «Animaciones de Pokémon».
// Es un módulo pequeño: no toca la red hasta que alguien pide un sprite.
import { S, h, sprite } from './core.js';
import { showdownSlug } from './slug.js';
export { showdownSlug };

const HOST = 'https://play.pokemonshowdown.com/sprites/';

// Slug de un Pokémon del Pokédex del casino (el servidor lo manda ya calculado) o de su forma Mega (formId).
export function slugOf(id, mega = 0) {
  const p = S.dexById?.get(id);
  const f = mega && S.megaById?.get(mega);
  if (f) {
    const sp = S.dexById.get(f.species);
    const m = / ([XYZ])$/.exec(f.name);
    return ((sp && sp.slug) || showdownSlug(sp ? sp.name : '')) + '-mega' + (m ? m[1].toLowerCase() : '');
  }
  return (p && (p.slug || showdownSlug(p.name))) || '';
}

// ---- Ajuste «Animaciones de Pokémon» ----
const KEY = 'anim';
export const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
export function animPref() {
  try { const v = localStorage.getItem(KEY); if (v === '1' || v === '0') return v === '1'; } catch { /* sin almacenamiento */ }
  try { if (navigator.connection && navigator.connection.saveData) return false; } catch { /* sin API */ }
  return true;
}
export function setAnimPref(on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* no se recuerda */ } return on; }
// Sprites animados activos: ajuste del jugador y sin «reducir movimiento» del sistema.
export const animEnabled = () => animPref() && !reducedMotion();

/** URL del sprite animado de Showdown. `mega` = formId de la Mega. */
export function aniSprite(id, { shiny = false, back = false, mega = 0, gen5 = false } = {}) {
  const slug = slugOf(id, mega);
  if (!slug) return '';
  return `${HOST}${gen5 ? 'gen5ani' : 'ani'}${back ? '-back' : ''}${shiny ? '-shiny' : ''}/${slug}.gif`;
}

// Sprite estático de respaldo (de espaldas si se pide).
export const staticSprite = (id, shiny, back, mega = 0) => {
  const m = mega && S.megaById?.get(mega);
  if (m) return sprite(mega, shiny);
  const u = sprite(id, shiny);
  return back ? u.replace('/pokemon/', '/pokemon/back/') : u;
};

/**
 * <img> con sprite animado. Cadena de respaldo, sin bucles: ani → gen5ani → estático (`fallback`).
 * Con las animaciones desactivadas va directo al estático.
 */
export function aniImg(id, { shiny = false, back = false, mega = 0, cls = '', alt = '', fallback } = {}) {
  const still = fallback || staticSprite(id, shiny, back, mega);
  const urls = animEnabled() ? [aniSprite(id, { shiny, back, mega }), aniSprite(id, { shiny, back, mega, gen5: true })].filter(Boolean) : [];
  urls.push(still);
  let i = 0;
  const el = h('img', { class: cls + (urls.length > 1 ? ' ani' : ''), alt, src: urls[0], loading: 'lazy', draggable: 'false', referrerpolicy: 'no-referrer' });
  el.addEventListener('error', () => {
    if (i < urls.length - 1) { el.src = urls[++i]; if (i === urls.length - 1) el.classList.remove('ani'); } // al llegar al estático no hay más intentos
    else el.style.visibility = 'hidden';
  });
  return el;
}

// Colores de las partículas por tipo de ataque.
export const TYPE_COLOR = {
  normal: '#c9c5b8', fire: '#ff7a2f', water: '#4fa3ff', electric: '#ffe03a', grass: '#6fd45a', ice: '#9be9f5',
  fighting: '#d9553a', poison: '#b45fd1', ground: '#d6b25c', flying: '#a9b8ff', psychic: '#ff6fa8', bug: '#a8c534',
  rock: '#b9a45e', ghost: '#7d62b8', dragon: '#6a5cff', dark: '#6b574a', steel: '#b8c2d1', fairy: '#ffadd6',
};

/**
 * Cambia un <img> estático ya mostrado por el sprite animado cuando éste termina de cargar (sin parpadeos
 * ni huecos: si no existe o falla, el estático se queda). Devuelve el <img>.
 */
export function upgradeToAni(el, id, { shiny = false, back = false, mega = 0 } = {}) {
  if (!animEnabled()) return el;
  const urls = [aniSprite(id, { shiny, back, mega }), aniSprite(id, { shiny, back, mega, gen5: true })].filter(Boolean);
  const tryAt = (i) => {
    if (i >= urls.length) return;
    const pre = new Image();
    pre.onload = () => { if (el.isConnected) { el.src = urls[i]; el.classList.add('ani'); } };
    pre.onerror = () => tryAt(i + 1);
    pre.src = urls[i];
  };
  tryAt(0);
  return el;
}
