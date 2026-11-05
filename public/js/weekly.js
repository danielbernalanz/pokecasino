// Semana temática (server/themes.js): tarjeta del Vestíbulo y una línea para Captura y Teraincursiones.
import { S, h } from './core.js';

const left = (ms) => {
  const m = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440);
  const hr = Math.floor((m % 1440) / 60);
  return d ? `${d} d ${hr} h` : hr ? `${hr} h ${m % 60} min` : `${m} min`;
};
const theme = () => (S.events && S.events.theme) || null;
const mis = () => (S.me && S.me.themeMis) || null;

// Tarjeta compacta del Vestíbulo: qué tipo toca, qué cambia y cómo va tu misión.
export function themeCard() {
  const t = theme();
  if (!t) return '';
  const m = mis();
  return h('a', { class: `card theme-card t-${t.type}`, href: '#/captura', title: `${t.name}: ×${t.boost} de ${t.typeName} en las rutas, jefes de Teraincursión de ese tipo y una misión semanal` },
    h('span', { class: 'theme-ico', 'aria-hidden': 'true' }, t.icon),
    h('div', { class: 'grow' },
      h('b', {}, t.name),
      h('div', { class: 'small' }, `Más Pokémon de tipo ${t.typeName} en Captura y jefes de Teraincursión de ese tipo.`,
        m ? h('span', { class: m.done ? 'good' : '' }, m.done ? ' ✔ Misión completada' : ` Misión: captura ${m.max} (${m.n}/${m.max}) → 2 Tickets Gacha.`) : null)),
    h('span', { class: 'muted small nowrap' }, `quedan ${left(t.ends - Date.now())}`));
}
// Línea para las cabeceras de Captura y Teraincursiones.
export function themeNote() {
  const t = theme();
  if (!t) return null;
  const m = mis();
  return h('span', { class: `theme-note t-${t.type}`, title: `${t.name}: ×${t.boost} de ${t.typeName} en las rutas, jefes de Teraincursión de ese tipo` }, `${t.icon} ${t.name}${m ? (m.done ? ' · misión ✔' : ` · misión ${m.n}/${m.max}`) : ''}`);
}
