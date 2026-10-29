// Centros de sección (Casino, Pokémon, Mercado, Entrenador): una pantalla sencilla con fichas grandes.
import { h, MON, monImg, say } from '../core.js';
import { META, SECTIONS, groupsOf, isNew, secIcon } from '../nav.js';

function card(id) {
  const m = META[id];
  return h('a', { class: `hub-card tone-${m.tone}`, href: '#/' + id, 'data-go': id, title: m.d },
    isNew(id) ? h('span', { class: 'new-badge' }, '¡NUEVO!') : null,
    h('span', { class: 'hub-art' }, monImg(m.art)),
    h('b', { class: 'hub-name' }, m.t),
    h('span', { class: 'hub-desc' }, m.d));
}

export const hubCard = card;

const hubs = SECTIONS.filter((s) => s.id !== 'lobby').map((sec) => ({
  id: sec.id, title: sec.label, icon: '📂', hub: true,
  mount(root) {
    root.append(
      h('div', { class: 'hub-head' },
        h('div', { class: 'game-head' }, h('h1', { class: 'hub-title' }, h('span', { class: 'hub-ico' }, secIcon(sec)), sec.label, monImg(MON.unown, 'unown-deco'))),
        say({ ...sec.say, cls: 'compact' })),
      h('div', { class: 'hub-groups' }, groupsOf(sec).map((g) => h('section', { class: 'hub-group' }, h('h2', { class: 'section-title' }, g.name), h('div', { class: 'hub-grid' }, g.items.map(card))))),
      h('div', { class: 'footprints', 'aria-hidden': 'true' }));
  },
}));
export default hubs;

// Ruta desconocida: Psyduck, confundido.
export const notFound = {
  id: 'notfound', title: 'No encontrado', icon: '❓',
  mount(root) {
    root.append(h('div', { class: 'empty-state lost' }, monImg(MON.psyduck, 'big'), h('h2', {}, '¿Psy… duck?'), h('div', {}, 'Aquí no hay nada. ¿Te has perdido, entrenador?'),
      h('a', { class: 'btn primary', href: '#/lobby' }, 'Volver al Inicio')));
  },
};
