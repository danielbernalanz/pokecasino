import { h } from '../core.js';
import { loadChangelog, releaseCard, unseenReleases, markSeen } from '../news.js';

export default {
  id: 'news', title: 'Novedades', icon: '📰',
  async mount(root) {
    const list = h('div', { class: 'news-list' }, h('p', { class: 'muted' }, 'Cargando…'));
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '📰 Novedades')), h('p', { class: 'muted' }, 'Registro de actualizaciones del PokéCasino, de la más reciente a la más antigua.'), list);
    const all = await loadChangelog();
    if (!list.isConnected) return;
    const fresh = new Set(unseenReleases(all).map((r) => r.version));
    list.replaceChildren(...(all.length ? all.map((r) => releaseCard(r, fresh.has(r.version))) : [h('p', { class: 'muted' }, 'No hay novedades publicadas todavía.')]));
    if (fresh.size) markSeen();
  },
};
