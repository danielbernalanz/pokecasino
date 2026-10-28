import { S, h, fmt, act, sfx, toast, sprite, art, modal, typeBadge, rarityName, TYPE_ES, bus, confirmRisk } from '../core.js';
import { useFx } from '../rewards.js';
import { burstAt, centerOf } from '../fx.js';
import { openItem } from './market.js';
import { openInPc } from './pc.js';

let filter = { q: '', show: null, rarity: '', type: '', gen: '' };
const REGIONS = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Teselia', 'Kalos', 'Alola', 'Galar', 'Paldea'];

const lockedN = () => Object.keys(S.me.locked || {}).length;
// «progreso X/5.000 apostadas o Y/10 tiradas»: lo que falta para el próximo crédito de recuperación.
const lockedLine = () => {
  const lp = S.me.lockedProg;
  return lp ? `progreso ${fmt(lp.wager)}/${fmt(lp.step.wager)} apostadas o ${lp.pulls}/${lp.step.pulls} tiradas` : '';
};

export function openDetail(id) {
  const p = S.dexById.get(id);
  const c = S.me.collection[id];
  const lk = !c && S.me.locked && S.me.locked[id];
  let shiny = false;
  const big = h('img', { class: 'detail-art' + (c ? '' : ' silhouette'), src: art(id), alt: p.name });
  if (lk) big.classList.add('locked-art');
  const toggle = c && c.s > 0 ? h('button', { class: 'btn', onclick: () => { shiny = !shiny; big.src = art(id, shiny); toggle.textContent = shiny ? 'Ver normal' : 'Ver variocolor ✨'; } }, 'Ver variocolor ✨') : null;
  const r = S.data.rarity[p.rarity];
  const giftTo = h('input', { list: 'gift-users', placeholder: 'Entrenador' });
  let actions = c ? h('div', { class: 'stack' },
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn primary', onclick: async (e) => { if (await act('buddy:set', { id, shiny: false }, e.target)) { toast(`${p.name} es tu compañero`, 'success'); sfx('win'); } } }, '🤝 Compañero'),
      c.s > 0 ? h('button', { class: 'btn gold', onclick: async (e) => { if (await act('buddy:set', { id, shiny: true }, e.target)) { toast(`${p.name} ✨ es tu compañero`, 'success'); sfx('shiny'); } } }, '✨ Compañero variocolor') : null,
      c.n > 1 ? h('button', { class: 'btn', onclick: async (e) => {
        if (c.s > 0 && c.n - 1 < c.s && !(await confirmRisk('release-precious', { title: 'Vas a liberar una copia variocolor', danger: 'Liberar igualmente', safe: 'Conservarla',
          text: `Tienes ${c.n} copia(s) de ${p.name} y ${c.s} es variocolor ✨. Si liberas una, perderías una versión variocolor (solo recibes ${r.dust} ✦ de polvo), y es mucho más difícil de conseguir.` }))) return;
        const at = centerOf(e.target); if (await act('shop:release', { id, count: 1 }, e.target)) { burstAt(...at, '#a5b4fc', 18, { spread: 120, stars: 0.8 }); sfx('shiny'); toast(`Liberaste una copia: +${r.dust} ✦`, 'success'); m.close(); openDetail(id); } } }, `Liberar 1 copia (+${r.dust} ✦)`) : null,
      S.me.items['rare-candy'] && c.n < 5 ? h('button', { class: 'btn', onclick: async (e) => { const at = centerOf(e.target); if (await act('item:use', { itemId: 'rare-candy', pokeId: id }, e.target)) { useFx('rare-candy', at); toast(`¡${p.name} gana una estrella!`, 'success'); m.close(); openDetail(id); } } }, `🍬 Caramelo Raro (${S.me.items['rare-candy']})`) : null,
      h('button', { class: 'btn', onclick: () => { m.close(); openInPc(id); } }, '🖥️ Ver en la Caja PC'),
      h('button', { class: 'btn', onclick: () => { m.close(); openItem({ kind: 'poke', pokeId: id, shiny: false }, 'sell'); } }, '🏪 Vender en el Mercado')),
    h('div', { class: 'row gap wrap' }, giftTo,
      h('datalist', { id: 'gift-users' }, S.online.filter((u) => u.username !== S.me.username).map((u) => h('option', { value: u.username }))),
      h('button', { class: 'btn', onclick: async (e) => {
        const to = giftTo.value.trim();
        if (!to) return toast('Escribe el nombre del entrenador.', 'error');
        if (!confirm(`¿Regalar ${p.name} a ${to}? Perderás una copia.`)) return;
        const isBuddy = S.me.buddy && S.me.buddy.id === id;
        if ((c.n === 1 || isBuddy) && !(await confirmRisk('release-precious', { title: c.n === 1 ? 'Es tu única copia' : 'Es tu compañero', danger: 'Regalar igualmente', safe: 'Quedármelo',
          text: `${c.n === 1 ? `Es tu única copia de ${p.name}: tu Pokédex dejaría de tenerlo registrado.` : ''}${isBuddy ? ` ${p.name} es tu compañero actual: dejarías de recibir su bonus en las ganancias hasta que elijas otro.` : ''} El regalo no se puede deshacer.`.trim() }))) return;
        if (await act('gift:poke', { to, id, shiny: false }, e.target)) { toast('¡Regalo enviado!', 'success'); m.close(); }
      } }, '🎁 Regalar copia'))) : h('div', { class: 'stack' },
    h('p', { class: 'muted' }, '¿Quién es ese Pokémon? Aún no lo has atrapado.'),
    h('button', { class: 'btn primary', onclick: () => { m.close(); openItem({ kind: 'poke', pokeId: id, shiny: false }); } }, '🏪 Comprarlo en el Mercado'),
    h('a', { class: 'btn', href: '#/shop', onclick: () => m.close() }, `Fabricar por ${fmt(r.craft)} ✦`));
  if (lk) {
    const credits = (S.me.lockedProg && S.me.lockedProg.credits) || 0;
    actions = h('div', { class: 'stack' },
      h('p', { class: 'small' }, `🔒 Este Pokémon (${lk.n} copia(s)${lk.s ? `, ${lk.s} variocolor` : ''}) está guardado con candado: no cuenta en tu Pokédex, colecciones ni ranking. Se recupera solo si te sale en el gacha, o con una recuperación (1 cada 5.000 monedas apostadas o 10 tiradas).`),
      h('p', { class: 'small muted' }, `Recuperaciones disponibles: ${credits} · ${lockedLine()}`),
      h('button', { class: 'btn primary', disabled: credits < 1, onclick: async (e) => {
        if (await act('locked:unlock', { id }, e.target)) { sfx('shiny'); toast(`🔓 ¡${p.name} recuperado!`, 'success'); m.close(); openDetail(id); }
      } }, 'Recuperar (1 crédito)'));
  }
  const m = modal(h('div', { class: 'detail' },
    h('div', { class: 'detail-left r-' + p.rarity }, big, toggle),
    h('div', { class: 'stack' },
      h('h2', {}, `#${String(id).padStart(3, '0')} ${p.name}`),
      h('div', { class: 'muted small' }, `${['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Teselia', 'Kalos', 'Alola', 'Galar', 'Paldea'][p.gen - 1]} · PS ${p.stats[0]} · Atq ${p.stats[1]} · Def ${p.stats[2]} · AtqEsp ${p.stats[3]} · DefEsp ${p.stats[4]} · Vel ${p.stats[5]}`),
      h('div', { class: 'types' }, p.types.map(typeBadge)),
      h('div', {}, h('span', { class: 'rar r-' + p.rarity }, rarityName(p.rarity))),
      lk ? h('div', { class: 'locked-tag' }, '🔒 Con candado') : null,
      c ? h('div', {}, h('span', { class: 'stars big' }, '★'.repeat(Math.min(5, c.n)) + '☆'.repeat(5 - Math.min(5, c.n))), h('span', { class: 'muted' }, ` · ${c.n} copia(s)${c.s ? ` · ${c.s} variocolor` : ''}`)) : null,
      h('p', { class: 'small muted' }, `Como compañero: +${(r.bonus * 100).toFixed(0)} % base, +0,5 % por estrella extra, +2 % si es variocolor.`),
      actions)), { title: 'Pokédex', wide: true });
}

export default {
  id: 'pokedex', title: 'Pokédex', icon: '📕',
  mount(root) {
    // La primera vez se abre en «Atrapados» si ya tienes alguno (con 1.025 es lo más útil).
    if (filter.show === null) filter.show = Object.keys(S.me.collection).length ? 'owned' : 'all';
    const grid = h('div', { class: 'dex-grid' });
    const BATCH = 150;
    let observer = null;
    let currentSentinel = null;
    let renderedCount = 0; // al re-renderizar (p. ej. tras una acción) se mantienen las tandas ya cargadas
    const counter = h('div', { class: 'dex-count' });
    const banner = h('div', { class: 'locked-banner', hidden: true });
    const search = h('input', { placeholder: 'Buscar por nombre…', value: filter.q, oninput: (e) => { filter.q = e.target.value; render(); } });
    const sel = (key, opts) => {
      const s = h('select', { onchange: (e) => { filter[key] = e.target.value; render(); } }, opts.map(([v, l]) => h('option', { value: v, selected: filter[key] === v }, l)));
      return s;
    };
    function render() {
      if (currentSentinel) { currentSentinel.remove(); currentSentinel = null; }
      const col = S.me.collection;
      const lockedOf = S.me.locked || {};
      const nl = lockedN();
      banner.replaceChildren(...(nl ? [h('span', {}, `🔒 ${nl} Pokémon con candado · ${(S.me.lockedProg && S.me.lockedProg.credits) || 0} recuperaciones disponibles · ${lockedLine()}`),
        h('button', { class: 'btn small', onclick: () => { filter.show = 'locked'; showSel.value = 'locked'; renderedCount = 0; render(); } }, 'Verlos')] : []));
      banner.hidden = !nl;
      const owned = Object.keys(col).length;
      const shinies = Object.values(col).filter((c) => c.s > 0).length;
      counter.replaceChildren(h('b', {}, `${owned}/${S.data.dex.length}`), ' atrapados · ', h('b', {}, shinies), ' variocolor',
        h('div', { class: 'pity-bar' }, h('i', { style: { width: (owned / S.data.dex.length) * 100 + '%' } })));
      const q = filter.q.trim().toLowerCase();
      const list = S.data.dex.filter((p) => {
        const c = col[p.id];
        if (filter.show === 'owned' && !c) return false;
        if (filter.show === 'missing' && c) return false;
        if (filter.show === 'shiny' && !(c && c.s)) return false;
        if (filter.show === 'locked' && !(!c && lockedOf[p.id])) return false;
        if (filter.rarity && p.rarity !== filter.rarity) return false;
        if (filter.type && !p.types.includes(filter.type)) return false;
        if (filter.gen && p.gen !== Number(filter.gen)) return false;
        if (q && !(c ? p.name.toLowerCase().includes(q) : String(p.id).includes(q))) return false;
        return true;
      });
      // Se pintan por tandas al hacer scroll: 1.025 tarjetas de golpe van lentas en el móvil.
      const card = (p) => {
        const c = col[p.id];
        const isBuddy = S.me.buddy && S.me.buddy.id === p.id;
        const lk = !c && lockedOf[p.id];
        if (lk) return h('button', { class: `dex-card r-${p.rarity} missing locked`, onclick: () => openDetail(p.id) },
          h('span', { class: 'dex-no' }, '#' + String(p.id).padStart(3, '0')),
          h('img', { class: 'pixel', src: sprite(p.id, false), alt: p.name, loading: 'lazy' }),
          h('b', {}, p.name), h('span', { class: 'stars dim' }, '—'), h('span', { class: 'lock-tag' }, '🔒'));
        return h('button', { class: `dex-card r-${p.rarity}${c ? '' : ' missing'}${c && c.s ? ' shiny' : ''}${isBuddy ? ' buddy' : ''}`, onclick: () => openDetail(p.id) },
          h('span', { class: 'dex-no' }, '#' + String(p.id).padStart(3, '0')),
          h('img', { class: 'pixel', src: sprite(p.id, !!(c && c.s)), alt: c ? p.name : '?', loading: 'lazy' }),
          h('b', {}, c ? p.name : '???'),
          c ? h('span', { class: 'stars' }, '★'.repeat(Math.min(5, c.n))) : h('span', { class: 'stars dim' }, '—'),
          isBuddy ? h('span', { class: 'buddy-tag' }, '🤝') : null);
      };
      if (observer) observer.disconnect();
      let shown = Math.max(BATCH, renderedCount);
      grid.replaceChildren(...list.slice(0, shown).map(card));
      if (shown < list.length) {
        const sentinel = h('div', { class: 'dex-more muted small' }, 'Cargando más…');
        grid.after(sentinel);
        observer = new IntersectionObserver((entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          const next = list.slice(shown, shown + BATCH);
          grid.append(...next.map(card));
          shown += next.length;
          renderedCount = shown;
          if (shown >= list.length) { observer.disconnect(); sentinel.remove(); }
        }, { rootMargin: '600px' });
        observer.observe(sentinel);
        currentSentinel = sentinel;
      }
    }
    const showSel = sel('show', [['all', 'Todos'], ['owned', 'Atrapados'], ['missing', 'Faltan'], ['shiny', 'Variocolor'], ['locked', 'Con candado']]);
    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '📕 Pokédex'), counter),
      banner,
      h('div', { class: 'filters' }, search, showSel,
        sel('rarity', [['', 'Cualquier rareza'], ...['M', 'L', 'E', 'R', 'U', 'C'].map((r) => [r, rarityName(r)])]),
        sel('type', [['', 'Cualquier tipo'], ...S.data.types.map((t) => [t, TYPE_ES[t]])]),
        sel('gen', [['', 'Todas las regiones'], ...REGIONS.map((r, i) => [String(i + 1), `${r} (gen. ${i + 1})`])])),
      grid);
    render();
    this.off = bus.on('me', render);
    this.stopObs = () => observer && observer.disconnect();
  },
  unmount() { this.off(); this.stopObs(); },
};
