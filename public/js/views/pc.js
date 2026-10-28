import { S, h, fmt, act, emit, sfx, toast, sprite, art, modal, typeBadge, rarityName, TYPE_ES, bus, confirmRisk } from '../core.js';
import { evolveAnim, wonderReveal } from './pc-fx.js';
import { heartsEl, friendLabel, berryImg, berryCount, berryIds, LOVE_MIN } from './huerto.js';

const BATCH = 60;
const STAT_NAMES = ['PS', 'Ataque', 'Defensa', 'At. Esp.', 'Def. Esp.', 'Velocidad'];

let mons = [];
let box = { candy: {}, train: {}, wonderLeft: 0, rules: null };
const TRAIN_STATS = [...STAT_NAMES];
let filter = { q: '', type: '', rarity: '', shiny: false, fav: false, species: 0, sort: 'recent' };
let loading = null;
let render = null;

const ivTotal = (m) => m.ivs.reduce((s, v) => s + v, 0);
const judge = (t) => (t >= 170 ? 'Increíble' : t >= 140 ? 'Muy bueno' : t >= 100 ? 'Bueno' : 'Normal');
const genderTag = (m) => (m.gender === 'M' ? '♂' : m.gender === 'F' ? '♀' : '');
const label = (m) => m.nick || S.dexById.get(m.id).name;

const candyOf = (id) => box.candy[S.dexById.get(id).chain] || 0;
const famNames = new Map();
const famName = (id) => {
  if (!famNames.size) for (const x of S.data.dex) if (!x.evolvesFrom && !famNames.has(x.chain)) famNames.set(x.chain, x.name);
  return famNames.get(S.dexById.get(id).chain) || S.dexById.get(id).name;
};
const levelCost = (lv) => Math.ceil(lv / 10);
const trainLeft = (m) => (m.uid in box.train ? box.train[m.uid] : box.rules.trainDaily);
const spareCount = (id) => { const c = S.me.collection[id]; return c ? Math.max(0, c.n - (c.cn || 0) - 1) : 0; };
// Mismo criterio que el servidor: ni favoritos, ni compañero, ni variocolor; si no hay protegidos se conserva el mejor.
function bulkList(id) {
  const all = mons.filter((m) => m.id === id);
  const cand = all.filter((m) => !m.fav && !m.shiny && !m.buddy);
  cand.sort((a, b) => b.level - a.level || ivTotal(b) - ivTotal(a) || a.at - b.at);
  return all.length - cand.length ? cand : cand.slice(1);
}
async function bulkTransfer(id, btn, after) {
  const list = bulkList(id);
  const p = S.dexById.get(id);
  if (!list.length) return toast('No hay repetidos que transferir: se conservan favoritos, compañero, variocolores y el mejor ejemplar.', 'error');
  const dust = S.data.rarity[p.rarity].dust * list.length;
  const cdy = box.rules.transfer[p.rarity] * list.length;
  if (!(await confirmRisk('transfer-bulk', { section: 'la Caja PC', title: `¿Transferir ${list.length} ${p.name}?`, danger: 'Transferir', safe: 'Cancelar',
    text: 'Se transferirán al Profesor Oak y no se pueden recuperar. Se conserva el mejor ejemplar y nunca se tocan favoritos, compañero ni variocolores.',
    details: [`${list.length} ejemplar${list.length > 1 ? 'es' : ''} de ${p.name}`, `+${fmt(dust)} ✦ de polvo estelar`, `+${cdy} 🍬 caramelos de ${famName(id)}`] }))) return;
  const r = await act('pc:transferBulk', { id }, btn);
  if (r) { sfx('shiny'); toast(`Transferiste ${r.count} ${p.name}: +${fmt(r.dust)} ✦ y +${r.candy} 🍬`, 'success'); await load(); if (after) after(); }
}

export function openInPc(id) { filter = { ...filter, q: '', species: Number(id) }; location.hash = '#/pc'; }

function load() {
  if (loading) return loading;
  loading = emit('pc:box').then((r) => { mons = r.mons; box = { candy: r.candy || {}, train: r.train || {}, wonderLeft: r.wonderLeft, rules: r.rules }; }).catch((e) => toast(e.message, 'error')).finally(() => { loading = null; });
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
  const ru = box.rules;
  const evoRow = (t) => {
    const love = m.friendship >= (ru.loveMin || LOVE_MIN);
    const viaFriend = love && ru.evoFriend && ru.evoFriend[t.id];
    const e = viaFriend || ru.evo[t.id];
    const reasons = [];
    if (ru.friendOnly && ru.friendOnly.includes(t.id) && !love) reasons.push(`amistad ≥ ${LOVE_MIN}`);
    if (m.level < e.level) reasons.push(`Nv. ${e.level}`);
    if (candyOf(m.id) < e.cost) reasons.push(`${e.cost} 🍬`);
    if (spareCount(m.id) < 1) reasons.push('otra copia');
    const tc = S.me.collection[t.id];
    if (tc && tc.n >= 5) reasons.push('ya tienes 5 estrellas');
    return h('div', { class: 'pc-evo' }, h('img', { src: sprite(t.id, m.shiny), alt: t.name }),
      h('div', { class: 'grow small' }, h('b', {}, t.name), h('div', { class: 'muted' }, (viaFriend ? `💖 Por amistad: ${e.cost} 🍬 · sin nivel mínimo` : `${e.cost} 🍬 · Nv. ${e.level} mín.`) + (reasons.length ? ` · Falta: ${reasons.join(', ')}` : ''))),
      h('button', { class: 'btn primary', disabled: reasons.length > 0, onclick: async (ev) => {
        const r = await act('pc:evolve', { id: m.id, uid, to: t.id }, ev.target);
        if (!r) return;
        modalRef.close();
        await evolveAnim(m.id, t.id, m.shiny);
        toast(`¡Tu ${label(m)} evolucionó a ${t.name}!`, 'success');
        await load(); render && render();
      } }, 'Evolucionar'));
  };
  function candyPanel() {
    const have = candyOf(m.id);
    const lv1 = levelCost(m.level);
    let lv5 = 0; for (let i = 0; i < 5; i++) lv5 += levelCost(m.level + i);
    const maxed = m.level >= ru.maxLevel;
    const evos = S.data.dex.filter((x) => x.evolvesFrom === m.id);
    const statSel = h('select', { 'aria-label': 'Estadística a entrenar' }, TRAIN_STATS.map((n, i) => h('option', { value: i }, `${n} (IV ${m.ivs[i]})`)));
    const left = trainLeft(m);
    const spare = spareCount(m.id);
    const tDust = S.data.rarity[p.rarity].dust;
    const tCandy = ru.transfer[p.rarity];
    return h('div', { class: 'stack' },
      h('div', { class: 'pc-box' }, h('h4', {}, `🍬 Caramelos de ${famName(m.id)}: `, h('span', { class: 'pc-candy' }, fmt(have))),
        h('div', { class: 'row gap wrap' },
          h('span', { class: 'small' }, `Nivel ${m.level}/${ru.maxLevel}`),
          h('button', { class: 'btn', disabled: maxed || have < lv1, onclick: async (e) => { if (await act('pc:levelup', { id: m.id, uid, times: 1 }, e.target)) { sfx('click'); reopen(true); } } }, `Subir nivel (${lv1} 🍬)`),
          h('button', { class: 'btn', disabled: maxed || have < lv5 || m.level + 5 > ru.maxLevel, onclick: async (e) => { if (await act('pc:levelup', { id: m.id, uid, times: 5 }, e.target)) { sfx('win'); reopen(true); } } }, `+5 (${lv5} 🍬)`))),
      p.rarity === 'M' || !evos.length ? null : h('div', { class: 'pc-box' }, h('h4', {}, '🌟 Evolución'), evos.map(evoRow)),
      h('div', { class: 'pc-box' }, h('h4', {}, `💪 Entrenar IV (${ru.trainCost} 🍬 = +1 IV) · quedan ${left}/${ru.trainDaily} hoy`),
        h('div', { class: 'row gap' }, statSel, h('button', { class: 'btn', disabled: left < 1 || have < ru.trainCost, onclick: async (e) => {
          const r = await act('pc:train', { id: m.id, uid, stat: Number(statSel.value) }, e.target);
          if (r) { sfx('click'); toast(`${TRAIN_STATS[Number(statSel.value)]}: IV ${r.iv}/31`, 'success'); reopen(true); } } }, 'Entrenar'))),
      h('div', { class: 'pc-box' }, h('h4', {}, '🎓 Profesor Oak y Intercambio Milagroso'),
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn', disabled: spare < 1, onclick: async (e) => {
            if ((m.shiny || m.fav || m.buddy) && !(await confirmRisk('release-precious', { title: 'Vas a transferir un ejemplar especial', danger: 'Transferir igualmente', safe: 'Conservarlo',
              text: `${label(m)} es ${[m.shiny ? 'variocolor ✨' : '', m.fav ? 'favorito' : '', m.buddy ? 'tu compañero' : ''].filter(Boolean).join(' y ')}. Solo recibes ${tDust} ✦ y ${tCandy} 🍬 y no se puede deshacer.` }))) return;
            const r = await act('pc:transfer', { id: m.id, uid }, e.target);
            if (r) { sfx('shiny'); toast(`Transferido: +${fmt(r.dust)} ✦ y +${r.candy} 🍬`, 'success'); await load(); modalRef.close(); render && render(); } } }, `Transferir (+${tDust} ✦ +${tCandy} 🍬)`),
          h('button', { class: 'btn', disabled: spare < 1 || m.shiny || m.fav || m.buddy || p.rarity === 'M' || box.wonderLeft < 1, title: 'Recibes un Pokémon al azar de la misma rareza', onclick: async (e) => {
            const r = await act('pc:wonder', { id: m.id, uid }, e.target);
            if (!r) return;
            modalRef.close();
            await wonderReveal(r);
            await load(); render && render();
          } }, `🎁 Intercambio Milagroso (${box.wonderLeft}/${ru.wonderDaily})`),
          spare > 0 ? h('button', { class: 'btn', onclick: (e) => bulkTransfer(m.id, e.target, () => { modalRef.close(); render && render(); }) }, 'Transferir repetidos') : null),
        h('div', { class: 'small muted' }, 'Intercambio Milagroso: entregas una copia sobrante (no favorita, compañero ni variocolor) y recibes otra de la misma rareza. Sin monedas.')));
  }
  function friendPanel() {
    const love = m.friendship >= LOVE_MIN;
    const owned = berryIds().filter((id) => berryCount(id) > 0);
    return h('div', { class: 'pc-box bd-friend' },
      h('div', { class: 'row gap wrap' }, h('b', {}, 'Amistad: '), heartsEl(m.friendship), h('span', { class: 'small' }, `${friendLabel(m.friendship)} (${m.friendship}/255)`)),
      love ? h('div', { class: 'small good' }, '💖 Te adora: +3 % a todas sus estadísticas en duelos.') : h('div', { class: 'small muted' }, `A partir de ${LOVE_MIN} te adora: +3 % en duelos y evoluciones por amistad. Sube con bayas, apostando con él de compañero y ganando duelos.`),
      h('div', { class: 'small bd-feedlbl' }, '🍓 Dar baya (máx. +60 de amistad al día por Pokémon)'),
      owned.length
        ? h('div', { class: 'bd-feed' }, owned.map((id) => h('button', { class: 'btn bd-feed-btn', disabled: m.friendship >= 255, onclick: async (ev) => {
          const r = await act('pc:feed', { id: m.id, uid, berry: id }, ev.currentTarget);
          if (!r) return;
          sfx(r.gain >= 15 ? 'shiny' : 'click');
          toast(`${label(m)} se lo comió encantado: +${r.gain} de amistad`, 'success');
          reopen(true);
        } }, berryImg(id), h('span', {}, S.data.berries[id].name), h('small', {}, `×${berryCount(id)} · +${S.data.berries[id].friend}`))))
        : h('div', { class: 'small muted' }, 'No tienes bayas. Plántalas en el ', h('a', { href: '#/huerto', onclick: () => modalRef.close() }, 'Huerto'), '.'));
  }
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
      friendPanel(),
      h('div', { class: 'small muted' }, 'Obtenido: ' + new Date(m.at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })),
      nickRow,
      box.rules ? candyPanel() : null,
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

    render = function render() {
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
      chip.classList.add('pc-species-bar');
      chip.replaceChildren(...(filter.species && box.rules ? [`Solo ${S.dexById.get(filter.species).name} `, h('span', { class: 'pc-candy' }, `🍬 ${fmt(candyOf(filter.species))} de ${famName(filter.species)}`),
        h('button', { class: 'btn', disabled: !bulkList(filter.species).length, onclick: (e) => bulkTransfer(filter.species, e.target, () => render()) }, 'Transferir repetidos'),
        h('button', { class: 'btn', onclick: () => { filter.species = 0; render(); } }, 'Ver todos')] : []));
      const card = (m) => {
        const p = S.dexById.get(m.id);
        return h('button', { class: `dex-card pc-card r-${p.rarity}${m.shiny ? ' shiny' : ''}${m.buddy ? ' buddy' : ''}`, onclick: () => openMon(m.uid) },
          h('span', { class: 'dex-no' }, '#' + String(m.id).padStart(3, '0')),
          m.fav ? h('span', { class: 'pc-fav' }, '★') : null,
          h('img', { class: 'pixel', src: sprite(m.id, m.shiny), alt: p.name, loading: 'lazy' }),
          h('b', { class: 'pc-name' }, (m.shiny ? '✨ ' : '') + label(m)),
          h('span', { class: 'small muted' }, `Nv. ${m.level} ${genderTag(m)}`),
          heartsEl(m.friendship, 'sm'),
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
