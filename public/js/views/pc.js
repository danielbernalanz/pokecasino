import { S, h, fmt, act, emit, sfx, toast, sprite, art, modal, typeBadge, rarityName, TYPE_ES, bus, confirmRisk } from '../core.js';

const BATCH = 60;
const STAT_NAMES = ['PS', 'Ataque', 'Defensa', 'At. Esp.', 'Def. Esp.', 'Velocidad'];

let mons = [];
let filter = { q: '', type: '', rarity: '', shiny: false, fav: false, species: 0, sort: 'recent' };
let loading = null;

const ivTotal = (m) => m.ivs.reduce((s, v) => s + v, 0);
const judge = (t) => (t >= 170 ? 'Increíble' : t >= 140 ? 'Muy bueno' : t >= 100 ? 'Bueno' : 'Normal');
const genderTag = (m) => (m.gender === 'M' ? '♂' : m.gender === 'F' ? '♀' : '');
const label = (m) => m.nick || S.dexById.get(m.id).name;

export function openInPc(id) { filter = { ...filter, q: '', species: Number(id) }; location.hash = '#/pc'; }

function load() {
  if (loading) return loading;
  loading = emit('pc:box').then((r) => { mons = r.mons; }).catch((e) => toast(e.message, 'error')).finally(() => { loading = null; });
  return loading;
}

function openMon(uid) {
  const m = mons.find((x) => x.uid === uid);
  if (!m) return;
  const p = S.dexById.get(m.id);
  const total = ivTotal(m);
    const reopen = async (ok) => { if (ok) { await load(); modalRef.close(); openMon(uid); } };
  const rows = STAT_NAMES.map((name, i) => {
    const cls = m.up === i ? 'up' : m.down === i ? 'down' : '';
    return h('tr', { class: cls },
      h('th', {}, name + (cls === 'up' ? ' ▲' : cls === 'down' ? ' ▼' : '')),
      h('td', {}, p.stats[i]),
      h('td', { class: 'pc-ivcell' }, h('span', { class: 'pc-ivbar' }, h('i', { style: { width: (m.ivs[i] / 31 * 100) + '%' } })), h('span', { class: 'small' }, m.ivs[i])),
      h('td', { class: 'pc-final' }, m.stats[i]));
  });
  const hearts = Math.round(m.friendship / 255 * 5);
  const nickInput = h('input', { class: 'pc-nick', maxlength: 12, value: m.nick, placeholder: 'Mote (máx. 12)' });
  const nickRow = h('div', { class: 'row gap', style: { display: 'none' } }, nickInput,
    h('button', { class: 'btn primary', onclick: async (e) => { reopen(await act('pc:nick', { id: m.id, uid, nick: nickInput.value }, e.target)); } }, 'Guardar'));
  const modalRef = modal(h('div', { class: 'pc-detail' },
    h('div', { class: 'pc-detail-left r-' + p.rarity }, h('img', { class: 'detail-art', src: art(m.id, m.shiny), alt: p.name })),
    h('div', { class: 'stack pc-detail-right' },
      h('h2', {}, `${m.shiny ? '✨ ' : ''}${label(m)} ${genderTag(m)}`),
      h('div', { class: 'muted small' }, `#${String(m.id).padStart(3, '0')} ${p.name} · Nv. ${m.level} · ${m.nature}${m.buddy ? ' · 🤝 Compañero' : ''}`),
      h('div', { class: 'types' }, p.types.map(typeBadge), h('span', { class: 'rar r-' + p.rarity }, rarityName(p.rarity))),
      h('div', { class: 'pc-table-wrap' }, h('table', { class: 'pc-stats' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Base'), h('th', {}, 'IV'), h('th', {}, 'Nv. 50'))),
        h('tbody', {}, rows))),
      h('div', {}, h('b', {}, `IV total ${total}/186`), ` · ${judge(total)}`),
      h('div', { class: 'small' }, h('b', {}, 'Habilidad: '), m.ability),
      h('div', { class: 'small' }, h('b', {}, 'Movimientos: '), m.moves.join(' · ')),
      h('div', { class: 'small' }, h('b', {}, 'Amistad: '), '♥'.repeat(hearts) + '♡'.repeat(5 - hearts), ` (${m.friendship})`),
      h('div', { class: 'small muted' }, 'Obtenido: ' + new Date(m.at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })),
      nickRow,
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn', onclick: () => { nickRow.style.display = nickRow.style.display === 'none' ? '' : 'none'; nickInput.focus(); } }, '✏️ Editar mote'),
        h('button', { class: 'btn', onclick: async (e) => { reopen(await act('pc:fav', { id: m.id, uid, fav: !m.fav }, e.target)); } }, m.fav ? '★ Quitar favorito' : '☆ Favorito'),
        h('button', { class: 'btn primary', disabled: m.buddy, onclick: async (e) => { if (await act('pc:buddy', { id: m.id, uid }, e.target)) { toast(`${label(m)} es tu compañero`, 'success'); sfx('win'); reopen(true); } } }, '🤝 Poner de compañero'),
        h('button', { class: 'btn danger', onclick: async (e) => {
          const c = S.me.collection[m.id];
          if (!c || c.n - (c.cn || 0) < 2) return toast('Debes conservar al menos una copia de cada Pokémon.', 'error');
          const dust = S.data.rarity[p.rarity].dust;
          if ((m.shiny || m.fav || m.buddy) && !(await confirmRisk('release-precious', { title: 'Vas a liberar un ejemplar especial', danger: 'Liberar igualmente', safe: 'Conservarlo',
            text: `${label(m)} es ${[m.shiny ? 'variocolor ✨' : '', m.fav ? 'favorito' : '', m.buddy ? 'tu compañero' : ''].filter(Boolean).join(' y ')}. Solo recibes ${dust} ✦ de polvo y no se puede deshacer.` }))) return;
          if (await act('pc:release', { id: m.id, uid }, e.target)) { sfx('shiny'); toast(`Liberaste a ${label(m)}: +${dust} ✦`, 'success'); await load(); modalRef.close(); } } }, 'Liberar este'))
    )), { title: 'Caja PC', wide: true });
}

export default {
  id: 'pc', title: 'Caja PC', icon: '🖥️',
  async mount(root) {
    let observer = null;
    const grid = h('div', { class: 'dex-grid pc-grid' });
    const counter = h('span', { class: 'muted' });
    const chip = h('div', { class: 'pc-chip hidden' });
    const search = h('input', { type: 'search', placeholder: 'Buscar nombre, mote o nº…', value: filter.q, oninput: (e) => { filter.q = e.target.value; render(); } });
    const sel = (key, opts) => {
      const s = h('select', { onchange: (e) => { filter[key] = e.target.value; render(); } }, opts.map(([v, t]) => h('option', { value: v, selected: filter[key] === v }, t)));
      return s;
    };
    const check = (key, text) => h('label', { class: 'pc-check' }, h('input', { type: 'checkbox', checked: filter[key], onchange: (e) => { filter[key] = e.target.checked; render(); } }), text);

    function render() {
      if (observer) observer.disconnect();
      document.querySelectorAll('.pc-more').forEach((n) => n.remove());
      const q = filter.q.trim().toLowerCase();
      const list = mons.filter((m) => {
        const p = S.dexById.get(m.id);
        if (filter.species && m.id !== filter.species) return false;
        if (filter.type && !p.types.includes(filter.type)) return false;
        if (filter.rarity && p.rarity !== filter.rarity) return false;
        if (filter.shiny && !m.shiny) return false;
        if (filter.fav && !m.fav) return false;
        if (q && !(p.name.toLowerCase().includes(q) || m.nick.toLowerCase().includes(q) || String(m.id) === q.replace('#', ''))) return false;
        return true;
      });
      const sorts = {
        recent: (a, b) => b.at - a.at, number: (a, b) => a.id - b.id || b.at - a.at, iv: (a, b) => ivTotal(b) - ivTotal(a),
        name: (a, b) => label(a).localeCompare(label(b), 'es'),
      };
      list.sort(sorts[filter.sort] || sorts.recent);
      counter.textContent = `${fmt(list.length)} de ${fmt(mons.length)} ejemplares`;
      chip.classList.toggle('hidden', !filter.species);
      chip.replaceChildren(...(filter.species ? [`Solo ${S.dexById.get(filter.species).name} `, h('button', { class: 'btn', onclick: () => { filter.species = 0; render(); } }, 'Ver todos')] : []));
      const card = (m) => {
        const p = S.dexById.get(m.id);
        return h('button', { class: `dex-card pc-card r-${p.rarity}${m.shiny ? ' shiny' : ''}${m.buddy ? ' buddy' : ''}`, onclick: () => openMon(m.uid) },
          h('span', { class: 'dex-no' }, '#' + String(m.id).padStart(3, '0')),
          m.fav ? h('span', { class: 'pc-fav' }, '★') : null,
          h('img', { class: 'pixel', src: sprite(m.id, m.shiny), alt: p.name, loading: 'lazy' }),
          h('b', { class: 'pc-name' }, (m.shiny ? '✨ ' : '') + label(m)),
          h('span', { class: 'small muted' }, `Nv. ${m.level} ${genderTag(m)}`),
          h('span', { class: 'small muted' }, m.nature));
      };
      let shown = Math.min(BATCH, list.length);
      grid.replaceChildren(...(list.length ? list.slice(0, shown).map(card) : [h('p', { class: 'muted' }, mons.length ? 'Ningún ejemplar coincide con los filtros.' : 'Tu caja está vacía: ¡tira del gacha!')]));
      if (shown < list.length) {
        const sentinel = h('div', { class: 'pc-more muted small' }, 'Cargando más…');
        grid.after(sentinel);
        observer = new IntersectionObserver((entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          const next = list.slice(shown, shown + BATCH);
          grid.append(...next.map(card));
          shown += next.length;
          if (shown >= list.length) { observer.disconnect(); sentinel.remove(); }
        }, { rootMargin: '600px' });
        observer.observe(sentinel);
      }
    }
    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '🖥️ Caja PC'), counter),
      chip,
      h('div', { class: 'filters' }, search,
        sel('type', [['', 'Cualquier tipo'], ...S.data.types.map((t) => [t, TYPE_ES[t]])]),
        sel('rarity', [['', 'Cualquier rareza'], ...['M', 'L', 'E', 'R', 'U', 'C'].map((r) => [r, rarityName(r)])]),
        sel('sort', [['recent', 'Más recientes'], ['number', 'Nº Pokédex'], ['iv', 'IV total'], ['name', 'Nombre']]),
        check('shiny', '✨ Variocolor'), check('fav', '★ Favoritos')),
      grid);
    await load();
    render();
    let t = 0;
    this.off = bus.on('me', () => { clearTimeout(t); t = setTimeout(async () => { await load(); if (S.view === 'pc') render(); }, 200); });
    this.stopObs = () => { clearTimeout(t); if (observer) observer.disconnect(); };
  },
  unmount() { this.off && this.off(); this.stopObs && this.stopObs(); },
};
