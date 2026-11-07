import { aniImg } from '../anim.js';
import { S, h, multiSelect, fmt, act, sfx, toast, sprite, art, item, modal, typeBadge, rarityName, TYPE_ES, bus, confirmRisk, dexState } from '../core.js';
import { useFx } from '../rewards.js';
import { burstAt, centerOf } from '../fx.js';
import { openItem } from './market.js';
import { openInPc } from './pc.js';
import { craftFilter } from './workshop.js';

let filter = { q: '', show: null, rarity: [], type: [], gen: [] };
// Desde Mi Entrenador → Colecciones: abre la Pokédex ya filtrada por región.
export function showRegion(gen) { filter = { q: '', show: null, rarity: [], type: [], gen: [String(gen)] }; location.hash = '#/pokedex'; }
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
  const st = dexState(id); // 'caught' | 'seen' | 'none' (lo decide el servidor: dexreg.js)
  let shiny = false;
  // Si lo tienes, sprite animado (arte oficial de respaldo); si está obtenido pero ya no lo tienes, arte a color; si solo está visto o no, la silueta.
  const mkBig = () => (c ? aniImg(id, { shiny, cls: 'detail-art', alt: p.name, fallback: art(id, shiny) })
    : st === 'caught' ? h('img', { class: 'detail-art', src: art(id), alt: p.name }) : h('img', { class: 'detail-art silhouette', src: art(id), alt: st === 'none' ? '???' : p.name }));
  let big = mkBig();
  if (lk) big.classList.add('locked-art');
  const toggle = c && c.s > 0 ? h('button', { class: 'btn', onclick: () => { shiny = !shiny; const nb = mkBig(); big.replaceWith(nb); big = nb; toggle.textContent = shiny ? 'Ver normal' : 'Ver variocolor ✨'; } }, 'Ver variocolor ✨') : null;
  const r = S.data.rarity[p.rarity];
  const giftTo = h('input', { list: 'gift-users', placeholder: 'Entrenador' });
  // «⋯ Más»: acciones definitivas (liberar, regalar), aparte de las frecuentes.
  function openMore() {
    const canRelease = (c.cn || 0) > 0 ? c.n - c.cn > 1 : true; // la última copia también se puede liberar; solo la respaldan las estrellas de Caramelo Raro
    const gift = async (e) => {
      const to = giftTo.value.trim();
      if (!to) return toast('Escribe el nombre del entrenador.', 'error');
      const isBuddy = S.me.buddy && S.me.buddy.id === id;
      if (!(await confirmRisk('gift-poke', { title: `¿Regalar ${p.name} a ${to}?`, danger: 'Regalar', safe: 'Cancelar',
        text: `Perderás una copia de ${p.name}.${c.n === 1 ? ' Es tu última copia: seguirá registrado como obtenido en tu Pokédex.' : ''}${isBuddy ? ` Es tu compañero actual: dejarías de recibir su bonus hasta que elijas otro.` : ''} El regalo no se puede deshacer.` }))) return;
      if (await act('gift:poke', { to, id, shiny: false }, e.target)) { toast('¡Regalo enviado!', 'success'); more.close(); m.close(); }
    };
    const release = async (e) => {
      if (c.s > 0 && c.n - 1 < c.s && !(await confirmRisk('release-precious', { title: 'Vas a liberar una copia variocolor', danger: 'Liberar igualmente', safe: 'Conservarla',
        text: `Tienes ${c.n} copia(s) de ${p.name} y ${c.s} es variocolor ✨. Si liberas una, perderías una versión variocolor (solo recibes ${r.dust} ✦ de polvo), y es mucho más difícil de conseguir.` }))) return;
      if (!(await confirmRisk('release-one', { section: 'la Pokédex', title: `¿Liberar una copia de ${p.name}?`, danger: 'Liberar', safe: 'Cancelar',
        text: `Solo recibes ${r.dust} ✦ de polvo y no se puede deshacer. Si quieres también Caramelos Exp., usa Transferir en la Caja PC.` }))) return;
      const at = centerOf(e.target);
      if (await act('shop:release', { id, count: 1 }, e.target)) { burstAt(...at, '#a5b4fc', 18, { spread: 120, stars: 0.8 }); sfx('shiny'); toast(`Liberaste una copia: +${r.dust} ✦`, 'success'); more.close(); m.close(); openDetail(id); }
    };
    const more = modal(h('div', { class: 'stack pc-more' },
      h('div', { class: 'pc-box' }, h('h4', {}, '🎁 Regalar una copia'),
        h('div', { class: 'row gap wrap' }, giftTo, h('datalist', { id: 'gift-users' }, S.online.filter((u) => u.username !== S.me.username).map((u) => h('option', { value: u.username }))),
          h('button', { class: 'btn', type: 'button', onclick: gift }, 'Regalar'))),
      canRelease ? h('div', { class: 'pc-box' }, h('h4', {}, '🕊️ Liberar una copia'), h('p', { class: 'small muted' }, `Solo recibes ${r.dust} ✦ de polvo (sin Caramelos Exp.).${c.n === 1 ? ' Seguirá registrado en tu Pokédex.' : ''}`),
        h('button', { class: 'btn danger', type: 'button', onclick: release }, `Liberar 1 copia (+${r.dust} ✦)`)) : h('p', { class: 'small muted' }, 'Tus estrellas de Caramelo Raro necesitan esta copia real.')),
    { title: `⋯ Más: ${p.name}` });
  }
  let actions = c ? h('div', { class: 'stack' },
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn primary', onclick: async (e) => { if (await act('buddy:set', { id, shiny: false }, e.target)) { toast(`${p.name} es tu compañero`, 'success'); sfx('win'); } } }, '🤝 Compañero'),
      c.s > 0 ? h('button', { class: 'btn gold', onclick: async (e) => { if (await act('buddy:set', { id, shiny: true }, e.target)) { toast(`${p.name} ✨ es tu compañero`, 'success'); sfx('shiny'); } } }, '✨ Compañero variocolor') : null,
      S.me.items['rare-candy'] && c.n < 5 ? h('button', { class: 'btn', onclick: async (e) => { const at = centerOf(e.target); if (await act('item:use', { itemId: 'rare-candy', pokeId: id }, e.target)) { useFx('rare-candy', at); toast(`¡${p.name} gana una estrella!`, 'success'); m.close(); openDetail(id); } } }, `🍬 Caramelo Raro (${S.me.items['rare-candy']})`) : null,
      h('button', { class: 'btn', onclick: () => { m.close(); openInPc(id); } }, '🖥️ Ver en la Caja PC'),
      h('button', { class: 'btn', onclick: () => { m.close(); openItem({ kind: 'poke', pokeId: id, shiny: false }, 'sell'); } }, '🏪 Vender en el Mercado'),
      h('button', { class: 'btn', type: 'button', title: 'Liberar o regalar una copia', onclick: () => openMore() }, '⋯ Más'))) : h('div', { class: 'stack' },
    st === 'caught' ? h('p', { class: 'small', 'data-testid': 'dex-registered' }, '📕 Registrado como obtenido · ahora no tienes ninguno en tu Caja.')
      : h('p', { class: 'muted' }, st === 'seen' ? '👁 Lo has visto, pero aún no lo has atrapado.' : '¿Quién es ese Pokémon? Aún no lo has visto.'),
    h('button', { class: 'btn primary', onclick: () => { m.close(); openItem({ kind: 'poke', pokeId: id, shiny: false }); } }, '🏪 Comprarlo en el Mercado'),
    h('a', { class: 'btn', href: '#/workshop/craft', onclick: () => { Object.assign(craftFilter, { q: S.dexById.get(id).name, show: 'all' }); m.close(); } }, `Fabricar por ${fmt(r.craft)} ✦`));
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
      h('h2', {}, `#${String(id).padStart(3, '0')} ${st === 'none' ? '???' : p.name}`, st === 'caught' ? h('img', { class: 'dex-ball', src: item('poke-ball'), alt: 'Obtenido', title: 'Obtenido' }) : st === 'seen' ? h('span', { class: 'dex-eye', title: 'Visto' }, '👁') : null),
      st !== 'none' || c ? null : h('div', { class: 'small muted' }, 'Aún no lo has visto: combate contra él, encuéntralo en Captura o consíguelo.'),
      c ? h('div', { class: 'small muted', 'data-testid': 'dex-box-n' }, 'Registrado como obtenido · en tu Caja: ' + c.n) : null,
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
    if (filter.show === null) filter.show = S.me.dex && S.me.dex.caught.length ? 'owned' : 'all';
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
    const ms = (key, label, opts, allLabel, plural) => multiSelect({ label, options: opts, value: filter[key], allLabel, plural, onChange: (v) => { filter[key] = v; renderedCount = 0; render(); } }).el;
    function render() {
      if (currentSentinel) { currentSentinel.remove(); currentSentinel = null; }
      const col = S.me.collection;
      const lockedOf = S.me.locked || {};
      const nl = lockedN();
      banner.replaceChildren(...(nl ? [h('span', {}, `🔒 ${nl} Pokémon con candado · ${(S.me.lockedProg && S.me.lockedProg.credits) || 0} recuperaciones disponibles · ${lockedLine()}`),
        h('button', { class: 'btn small', onclick: () => { filter.show = 'locked'; showSel.value = 'locked'; renderedCount = 0; render(); } }, 'Verlos')] : []));
      banner.hidden = !nl;
      const dx = S.me.dex || { seen: [], caught: [] };
      const owned = dx.caught.length; // obtenidos (registro permanente)
      const shinies = Object.values(col).filter((c) => c.s > 0).length;
      counter.replaceChildren(h('span', { 'data-testid': 'dex-seen' }, 'Vistos ', h('b', {}, dx.seen.length)), ' · ', h('span', { 'data-testid': 'dex-caught' }, 'Obtenidos ', h('b', {}, `${owned}/${S.data.dex.length}`)), ' · ', h('b', {}, shinies), ' variocolor',
        h('div', { class: 'pity-bar' }, h('i', { style: { width: (owned / S.data.dex.length) * 100 + '%' } })));
      const q = filter.q.trim().toLowerCase();
      const list = S.data.dex.filter((p) => {
        const c = col[p.id];
        const st = dexState(p.id);
        if (filter.show === 'owned' && st !== 'caught') return false;
        if (filter.show === 'seen' && st !== 'seen') return false;
        if (filter.show === 'inbox' && !c) return false;
        if (filter.show === 'missing' && st === 'caught') return false;
        if (filter.show === 'shiny' && !(c && c.s)) return false;
        if (filter.show === 'locked' && !(!c && lockedOf[p.id])) return false;
        if (filter.rarity.length && !filter.rarity.includes(p.rarity)) return false;
        if (filter.type.length && !p.types.some((t) => filter.type.includes(t))) return false;
        if (filter.gen.length && !filter.gen.includes(String(p.gen))) return false;
        if (q && !(st !== 'none' ? p.name.toLowerCase().includes(q) : String(p.id).includes(q))) return false;
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
        const st = dexState(p.id);
        // Como en los juegos: sin ver → «???»; visto → silueta con nombre y ojo; obtenido → a color con la Poké Ball (aunque ya no lo tengas).
        return h('button', { class: `dex-card r-${p.rarity} dex-${st}${st === 'caught' ? '' : ' missing'}${c && c.s ? ' shiny' : ''}${isBuddy ? ' buddy' : ''}`, 'data-testid': `dex-card-${p.id}`, 'data-state': st, onclick: () => openDetail(p.id) },
          h('span', { class: 'dex-no' }, '#' + String(p.id).padStart(3, '0')),
          st === 'caught' ? h('img', { class: 'dex-ball', src: item('poke-ball'), alt: 'Obtenido', title: 'Obtenido' }) : st === 'seen' ? h('span', { class: 'dex-eye', title: 'Visto' }, '👁') : null,
          h('img', { class: 'pixel', src: sprite(p.id, !!(c && c.s)), alt: st === 'none' ? '?' : p.name, loading: 'lazy' }),
          h('b', {}, st === 'none' ? '???' : p.name),
          c ? h('span', { class: 'stars' }, '★'.repeat(Math.min(5, c.n))) : h('span', { class: 'stars dim' }, '—'),
          st === 'caught' ? h('span', { class: 'dex-box' }, 'En tu Caja: ' + (c ? c.n : 0)) : null,
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
    const showSel = sel('show', [['all', 'Todos'], ['owned', 'Obtenidos'], ['seen', 'Solo vistos'], ['missing', 'Faltan (sin obtener)'], ['inbox', 'En mi Caja'], ['shiny', 'Variocolor'], ['locked', 'Con candado']]);
    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '📕 Pokédex'), counter),
      banner,
      h('div', { class: 'filters' }, search, showSel,
        ms('rarity', 'Rareza', ['M', 'L', 'E', 'R', 'U', 'C'].map((r) => [r, rarityName(r)]), 'Todas', 'seleccionadas'),
        ms('type', 'Tipo', S.data.types.map((t) => [t, TYPE_ES[t]]), 'Todos', 'seleccionados'),
        ms('gen', 'Región', REGIONS.map((r, i) => [String(i + 1), `${r} (gen. ${i + 1})`]), 'Todas', 'seleccionadas')),
      h('div', { class: 'dex-scroll' }, grid)); // la lista (1.025) se desplaza dentro de su panel: la pantalla no
    render();
    this.off = bus.on('me', render);
    this.stopObs = () => observer && observer.disconnect();
  },
  unmount() { this.off(); this.stopObs(); },
};
