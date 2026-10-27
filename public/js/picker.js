// Selector de Pokémon de la colección propia.
import { S, h, sprite, modal, typeBadge, rarityName, RARITY_ORDER, TYPE_ES } from './core.js';

export function bestEff(attTypes, defTypes) {
  let best = 0;
  for (const t of attTypes) {
    const e = defTypes.reduce((m, d) => m * (S.data.chart[t][d] ?? 1), 1);
    if (e > best) best = e;
  }
  return best;
}

export function pickPokemon({ title = 'Elige un Pokémon', vs } = {}) {
  return new Promise((resolve) => {
    const owned = Object.entries(S.me.collection).map(([id, c]) => ({ ...S.dexById.get(Number(id)), ...c })).filter((p) => p.id)
      .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || b.n - a.n || a.id - b.id);
    if (!owned.length) {
      const m = modal(h('div', { class: 'stack' }, h('p', {}, 'Todavía no tienes Pokémon. ¡Consigue alguno en el Gacha!'), h('a', { class: 'btn primary', href: '#/gacha', onclick: () => m.close() }, 'Ir al Gacha')), { title });
      return resolve(null);
    }
    const vsP = vs && S.dexById.get(vs);
    const search = h('input', { placeholder: 'Buscar…', class: 'grow' });
    const grid = h('div', { class: 'pick-grid' });
    const render = () => {
      const q = search.value.trim().toLowerCase();
      grid.replaceChildren(...owned.filter((p) => !q || p.name.toLowerCase().includes(q) || p.types.some((t) => TYPE_ES[t].toLowerCase().includes(q)))
        .flatMap((p) => {
          const variants = [false];
          if (p.s > 0) variants.push(true);
          return variants.map((shiny) => {
            const eff = vsP ? bestEff(p.types, vsP.types) : null;
            return h('button', { class: `pick r-${p.rarity}${shiny ? ' shiny' : ''}`, onclick: () => { m.close(); resolve({ id: p.id, shiny }); } },
              h('img', { class: 'pixel', src: sprite(p.id, shiny), alt: '' }),
              h('b', {}, p.name + (shiny ? ' ✨' : '')),
              h('span', { class: 'stars' }, '★'.repeat(Math.min(5, p.n))),
              h('span', { class: 'small muted' }, rarityName(p.rarity)),
              h('div', { class: 'types' }, p.types.map(typeBadge)),
              eff !== null ? h('span', { class: 'eff e' + String(eff).replace('.', '_') }, eff === 0 ? 'Sin efecto' : '×' + eff + ' vs ' + vsP.name) : null);
          });
        }));
    };
    search.addEventListener('input', render);
    render();
    const m = modal(h('div', { class: 'stack' }, search, grid), { title, wide: true });
  });
}
