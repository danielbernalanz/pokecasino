// Selector de Pokémon de la colección propia.
import { S, h, sprite, art, img, modal, typeBadge, rarityName, RARITY_ORDER, TYPE_ES } from './core.js';

export function bestEff(attTypes, defTypes) {
  let best = 0;
  for (const t of attTypes) {
    const e = defTypes.reduce((m, d) => m * (S.data.chart[t][d] ?? 1), 1);
    if (e > best) best = e;
  }
  return best;
}

// Formas Mega desbloqueadas por el jugador para una especie.
export function megasFor(speciesId) {
  const have = new Set((S.me && S.me.mega && S.me.mega.megas) || []);
  return ((S.data && S.data.mega && S.data.mega.forms) || []).filter((f) => f.species === speciesId && have.has(f.formId));
}

// `mega: true` añade el interruptor «Megaevolucionar en el combate» (solo si hay alguna Mega desbloqueada en la colección).
export function pickPokemon({ title = 'Elige un Pokémon', vs, mega = false } = {}) {
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
    const anyMega = mega && owned.some((p) => megasFor(p.id).length);
    // Interruptor grande: al activarlo, los Pokémon con Mega desbloqueada aparecen en su forma Mega.
    const megaChk = { checked: false };
    const megaLbl = h('b', {}, 'Megaevolucionar en el combate: NO');
    const megaRow = anyMega ? h('button', { class: 'mega-btn', type: 'button', 'aria-pressed': 'false', onclick: () => {
      megaChk.checked = !megaChk.checked;
      megaRow.classList.toggle('on', megaChk.checked);
      megaRow.setAttribute('aria-pressed', String(megaChk.checked));
      megaLbl.textContent = `Megaevolucionar en el combate: ${megaChk.checked ? 'SÍ' : 'NO'}`;
      render();
    } }, h('span', { class: 'mega-btn-ico' }, '💠'), h('span', { class: 'mega-btn-t' }, megaLbl, h('small', {}, 'Con SÍ, elige la forma Mega: pelea con sus estadísticas y tipos'))) : null;
    const render = () => {
      const q = search.value.trim().toLowerCase();
      grid.replaceChildren(...owned.filter((p) => !q || p.name.toLowerCase().includes(q) || p.types.some((t) => TYPE_ES[t].toLowerCase().includes(q)))
        .flatMap((p) => {
          const variants = [false];
          if (p.s > 0) variants.push(true);
          const forms = anyMega && megaChk.checked ? megasFor(p.id) : [];
          return variants.flatMap((shiny) => (forms.length ? forms : [null]).map((f) => {
            const eff = vsP ? bestEff(p.types, vsP.types) : null;
            return h('button', { class: `pick r-${p.rarity}${shiny ? ' shiny' : ''}`, onclick: () => { m.close(); resolve(f ? { id: p.id, shiny, mega: f.formId } : { id: p.id, shiny }); } },
              f ? img(art(f.formId, shiny), { cls: 'pixel', alt: f.name, fallback: art(f.formId, false) }) : h('img', { class: 'pixel', src: sprite(p.id, shiny), alt: '' }),
              h('b', {}, (f ? '💠 ' + f.name : p.name) + (shiny ? ' ✨' : '')),
              h('span', { class: 'stars' }, '★'.repeat(Math.min(5, p.n))),
              h('span', { class: 'small muted' }, rarityName(p.rarity)),
              h('div', { class: 'types' }, (f ? f.types : p.types).map(typeBadge)),
              eff !== null ? h('span', { class: 'eff e' + String(eff).replace('.', '_') }, eff === 0 ? 'Sin efecto' : '×' + eff + ' vs ' + vsP.name) : null);
          }));
        }));
    };
    search.addEventListener('input', render);

    render();
    const m = modal(h('div', { class: 'stack' }, search, megaRow, grid), { title, wide: true });
  });
}
