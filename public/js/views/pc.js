import { aniImg } from '../anim.js';
import { S, h, fmt, act, emit, sfx, toast, sprite, art, modal, typeBadge, rarityName, TYPE_ES, bus, confirmRisk, hpBar, emptyState, loader, MON } from '../core.js';
import { evolveAnim, wonderReveal } from './pc-fx.js';
import { heartsEl, friendLabel, berryImg, berryCount, berryIds, LOVE_MIN } from './huerto.js';
import { movesPage, learnPrompt } from './moves-ui.js';
import { gearPage } from './bp-ui.js';
import { loadNames } from '../battle-screen.js';

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
const awayIcon = (m) => (m.away === 'care' ? '🥚' : '🧭');
const awayText = (m) => (m.away === 'care' ? 'Está en el Criadero' : 'Está de expedición');

const candyOf = (id) => box.candy[S.dexById.get(id).chain] || 0;
const famNames = new Map();
const famName = (id) => {
  if (!famNames.size) for (const x of S.data.dex) if (!x.evolvesFrom && !famNames.has(x.chain)) famNames.set(x.chain, x.name);
  return famNames.get(S.dexById.get(id).chain) || S.dexById.get(id).name;
};
const levelCost = (lv) => Math.ceil(lv / ((box.rules && box.rules.levelDiv) || 50));
const trainLeft = (m) => (m.uid in box.train ? box.train[m.uid] : box.rules.trainDaily);
const spareCount = (id) => { const c = S.me.collection[id]; return c ? Math.max(0, c.n - (c.cn || 0) - 1) : 0; };
// Mismo criterio que el servidor: ni favoritos, ni compañero, ni variocolor; si no hay protegidos se conserva el mejor.
function bulkList(id) {
  const all = mons.filter((m) => m.id === id);
  const cand = all.filter((m) => !m.fav && !m.shiny && !m.buddy && !m.away);
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

export function openInPc(id) { filter = { ...filter, q: '', species: Number(id) }; boxIdx = 0; location.hash = '#/pc'; }

function load() {
  if (loading) return loading;
  loading = Promise.all([emit('pc:box'), loadNames()]).then(([r]) => { mons = r.mons; box = { candy: r.candy || {}, train: r.train || {}, wonderLeft: r.wonderLeft, rules: r.rules }; }).catch((e) => toast(e.message, 'error')).finally(() => { loading = null; });
  return loading;
}

function openMon(uid, openPage = 'info') {
  const m = mons.find((x) => x.uid === uid);
  if (!m) return;
  const p = S.dexById.get(m.id);
  const total = ivTotal(m);
    const reopen = async (ok) => { if (ok) { await load(); modalRef.close(); openMon(uid, tabs.querySelector('.tab.active')?.dataset.page || openPage); render && render(); } };
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
    if (m.away) reasons.push('fuera ahora');
    if (m.level < e.level) reasons.push(`Nv. ${e.level}`);
    if (candyOf(m.id) < e.cost) reasons.push(`${e.cost} 🍬`);
    if (spareCount(m.id) < 1 && !(ru.evoFirst && ru.evoFirst.includes(t.id))) reasons.push('otra copia');
    const tc = S.me.collection[t.id];
    if (tc && tc.n >= 5) reasons.push('ya tienes 5 estrellas');
    return h('div', { class: 'pc-evo' }, h('img', { src: sprite(t.id, m.shiny), alt: t.name }),
      h('div', { class: 'grow small' }, h('b', {}, t.name), h('div', { class: 'muted' }, (viaFriend ? `💖 Por amistad: ${e.cost} 🍬 · sin nivel mínimo` : `${e.cost} 🍬${e.level ? ` · Nv. ${e.level} mín.` : ''}`) + (reasons.length ? ` · Falta: ${reasons.join(', ')}` : ''))),
      h('button', { class: 'btn primary', disabled: reasons.length > 0, onclick: async (ev) => {
        const r = await act('pc:evolve', { id: m.id, uid, to: t.id }, ev.target);
        if (!r) return;
        modalRef.close();
        await evolveAnim(m.id, t.id, m.shiny);
        toast(`¡Tu ${label(m)} evolucionó a ${t.name}!`, 'success');
        await load(); render && render();
        if (r.pending && r.pending.length) openMon(uid);
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
          h('button', { class: 'btn', disabled: spare < 1 || !!m.away, title: m.away ? awayText(m) : '', onclick: async (e) => {
            if ((m.shiny || m.fav || m.buddy) && !(await confirmRisk('release-precious', { title: 'Vas a transferir un ejemplar especial', danger: 'Transferir igualmente', safe: 'Conservarlo',
              text: `${label(m)} es ${[m.shiny ? 'variocolor ✨' : '', m.fav ? 'favorito' : '', m.buddy ? 'tu compañero' : ''].filter(Boolean).join(' y ')}. Solo recibes ${tDust} ✦ y ${tCandy} 🍬 y no se puede deshacer.` }))) return;
            const r = await act('pc:transfer', { id: m.id, uid }, e.target);
            if (r) { sfx('shiny'); toast(`Transferido: +${fmt(r.dust)} ✦ y +${r.candy} 🍬`, 'success'); await load(); modalRef.close(); render && render(); } } }, `Transferir (+${tDust} ✦ +${tCandy} 🍬)`),
          h('button', { class: 'btn', disabled: spare < 1 || !!m.away || m.shiny || m.fav || m.buddy || p.rarity === 'M' || box.wonderLeft < 1, title: 'Recibes un Pokémon al azar de la misma rareza', onclick: async (e) => {
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
      h('div', { class: 'small bd-feedlbl' }, `🍓 Dar baya (máx. +${ru.feedCap || 100} de amistad al día por Pokémon)`),
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
  // Pantalla de «Datos» como en los juegos: páginas en lugar de un scroll largo.
  const pages = {
    info: () => h('div', { class: 'stack' },
      m.away ? h('div', { class: 'pc-away-note' }, `${awayIcon(m)} ${awayText(m)}: no se puede liberar, transferir, evolucionar ni llevar a combates hasta que vuelva.`) : null,
      h('div', { class: 'muted small' }, `#${String(m.id).padStart(3, '0')} ${p.name} · Nv. ${m.level} · Naturaleza ${m.nature}${m.buddy ? ' · 🤝 Compañero' : ''}`),
      h('div', { class: 'types' }, p.types.map(typeBadge), h('span', { class: 'rar r-' + p.rarity }, rarityName(p.rarity))),
      h('div', { class: 'small' }, h('b', {}, 'Habilidad: '), m.ability),
      h('div', {}, h('b', {}, `IV total ${total}/186`), ` · ${judge(total)}`, hpBar(total / 186 * 100)),
      h('div', { class: 'small muted' }, 'Obtenido: ' + new Date(m.at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })),
      nickRow),
    stats: () => h('div', { class: 'pc-table-wrap' }, h('table', { class: 'pc-stats' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Base'), h('th', {}, 'IV'), h('th', {}, 'Nv. 50'))),
      h('tbody', {}, rows))),
    moves: () => movesPage(m, async () => { await load(); modalRef.close(); openMon(uid, 'moves'); render && render(); }),
    gear: () => { const box2 = h('div', {}); gearPage(m, async () => { await load(); modalRef.close(); openMon(uid, 'gear'); render && render(); }).then((el) => box2.append(el)); return box2; },
    bond: () => friendPanel(),
    menu: () => (box.rules ? candyPanel() : h('p', { class: 'muted' }, 'Sin datos de la caja.')),
  };
  const PAGE_NAMES = [['info', 'Info'], ['stats', 'Estadísticas'], ['moves', 'Movimientos'], ['gear', 'Objeto'], ['bond', 'Vínculo'], ['menu', 'Menú']];
  const body = h('div', { class: 'pc-page' });
  const tabs = h('div', { class: 'tabs pc-tabs' });
  const show = (k) => {
    tabs.replaceChildren(...PAGE_NAMES.map(([id, t]) => h('button', { class: 'tab' + (id === k ? ' active' : ''), type: 'button', 'data-page': id, onclick: () => show(id) }, t)));
    body.replaceChildren(pages[k]());
  };
  show(openPage);
  const modalRef = modal(h('div', { class: 'pc-detail' },
    h('div', { class: 'pc-detail-left r-' + p.rarity }, aniImg(m.id, { shiny: m.shiny, cls: 'detail-art', alt: p.name, fallback: art(m.id, m.shiny) }),
      h('div', { class: 'pc-name-big' }, `${m.shiny ? '✨ ' : ''}${label(m)} ${genderTag(m)}`),
      h('div', { class: 'small muted' }, `Nv. ${m.level}`)),
    h('div', { class: 'stack pc-detail-right' }, tabs, body,
      h('div', { class: 'pc-menu' },
        h('button', { class: 'btn', onclick: () => { show('info'); nickRow.style.display = nickRow.style.display === 'none' ? '' : 'none'; nickInput.focus(); } }, '✏️ Mote'),
        h('button', { class: 'btn', onclick: async (e) => { reopen(await act('pc:fav', { id: m.id, uid, fav: !m.fav }, e.target)); } }, m.fav ? '★ Quitar favorito' : '☆ Favorito'),
        h('button', { class: 'btn primary', disabled: m.buddy, onclick: async (e) => { if (await act('pc:buddy', { id: m.id, uid }, e.target)) { toast(`${label(m)} es tu compañero`, 'success'); sfx('win'); reopen(true); } } }, '🤝 Compañero'),
        h('button', { class: 'btn danger', disabled: !!m.away, title: m.away ? awayText(m) : '', onclick: async (e) => {
          const c = S.me.collection[m.id];
          if (!c || c.n - (c.cn || 0) < 2) return toast('Debes conservar al menos una copia de cada Pokémon.', 'error');
          const dust = S.data.rarity[p.rarity].dust;
          if ((m.shiny || m.fav || m.buddy) && !(await confirmRisk('release-precious', { title: 'Vas a liberar un ejemplar especial', danger: 'Liberar igualmente', safe: 'Conservarlo',
            text: `${label(m)} es ${[m.shiny ? 'variocolor ✨' : '', m.fav ? 'favorito' : '', m.buddy ? 'tu compañero' : ''].filter(Boolean).join(' y ')}. Solo recibes ${dust} ✦ de polvo y no se puede deshacer.` }))) return;
          if (await act('pc:release', { id: m.id, uid }, e.target)) { sfx('shiny'); toast(`Liberaste a ${label(m)}: +${dust} ✦`, 'success'); await load(); modalRef.close(); render && render(); } } }, 'Liberar'))
    )), { title: 'Datos', wide: true });
  // Movimientos nuevos por decidir (subida de nivel, evolución…): se preguntan al abrir la ficha.
  if (m.pending && m.pending.length && openPage !== 'moves') learnPrompt(m, async () => { await load(); modalRef.close(); openMon(uid, openPage); render && render(); });
}

// Cajas de 30 huecos (6×5) con fondo propio, como en los juegos.
const PER_BOX = 30;
const WALLPAPERS = ['bosque', 'ciudad', 'desierto', 'sabana', 'cueva', 'mar', 'volcan', 'nieve'];
const WALL_NAMES = ['Bosque', 'Ciudad', 'Desierto', 'Sabana', 'Cueva', 'Mar', 'Volcán', 'Nieve'];
let boxIdx = 0;
let selUid = null;

export default {
  id: 'pc', title: 'Caja PC', icon: '🖥️',
  async mount(root) {
    const grid = h('div', { class: 'pc-grid pc-slots' });
    const side = h('div', { class: 'pc-side' });
    const counter = h('span', { class: 'muted' });
    const chip = h('div', { class: 'pc-chip hidden' });
    const boxHead = h('div', { class: 'pc-boxhead' });
    const search = h('input', { type: 'search', placeholder: 'Buscar nombre, mote o nº…', value: filter.q, oninput: (e) => { filter.q = e.target.value; boxIdx = 0; render(); } });
    const sel = (key, opts) => h('select', { onchange: (e) => { filter[key] = e.target.value; boxIdx = 0; render(); } }, opts.map(([v, t]) => h('option', { value: v, selected: filter[key] === v }, t)));
    const check = (key, text) => h('label', { class: 'pc-check' }, h('input', { type: 'checkbox', checked: filter[key], onchange: (e) => { filter[key] = e.target.checked; boxIdx = 0; render(); } }), text);
    const filters = h('div', { class: 'filters pc-filters hidden' }, search,
      sel('type', [['', 'Cualquier tipo'], ...S.data.types.map((t) => [t, TYPE_ES[t]])]),
      sel('rarity', [['', 'Cualquier rareza'], ...['M', 'L', 'E', 'R', 'U', 'C'].map((r) => [r, rarityName(r)])]),
      sel('sort', [['recent', 'Más recientes'], ['number', 'Nº Pokédex'], ['iv', 'IV total'], ['name', 'Nombre']]),
      check('shiny', '✨ Variocolor'), check('fav', '★ Favoritos'));
    const searchBtn = h('button', { class: 'btn', type: 'button', onclick: () => { const o = filters.classList.toggle('hidden'); searchBtn.classList.toggle('active', !o); if (!o) search.focus(); } }, '🔍 Buscar');
    let list = [];

    function drawSide() {
      const m = mons.find((x) => x.uid === selUid);
      if (!m) {
        side.replaceChildren(h('div', { class: 'pc-empty-side' }, emptyState(mons.length ? 'Elige un Pokémon de la caja.' : 'Tu caja está vacía: ¡tira del gacha!', MON.snorlax,
          mons.length ? null : h('a', { class: 'btn primary', href: '#/gacha' }, '🎁 Ir al Gacha'))));
        return;
      }
      const p = S.dexById.get(m.id);
      side.replaceChildren(h('div', { class: 'pc-sel r-' + p.rarity },
        h('div', { class: 'pc-sel-art' }, aniImg(m.id, { shiny: m.shiny, cls: 'pc-sel-img', alt: p.name, fallback: art(m.id, m.shiny) })),
        h('div', { class: 'pc-sel-name' }, `${m.shiny ? '✨ ' : ''}${label(m)} ${genderTag(m)}`),
        h('div', { class: 'small muted' }, `#${String(m.id).padStart(3, '0')} ${p.name} · Nv. ${m.level}`),
        h('div', { class: 'types' }, p.types.map(typeBadge)),
        heartsEl(m.friendship, 'sm'),
        m.away ? h('div', { class: 'pc-away-note' }, `${awayIcon(m)} ${awayText(m)}`) : null,
        h('div', { class: 'pc-sel-actions' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => openMon(m.uid) }, 'Datos'),
          h('button', { class: 'btn', type: 'button', onclick: async (e) => { if (await act('pc:fav', { id: m.id, uid: m.uid, fav: !m.fav }, e.target)) { await load(); render(); } } }, m.fav ? '★' : '☆'),
          h('button', { class: 'btn', type: 'button', disabled: m.buddy, title: 'Poner de compañero', onclick: async (e) => { if (await act('pc:buddy', { id: m.id, uid: m.uid }, e.target)) { toast(`${label(m)} es tu compañero`, 'success'); sfx('win'); await load(); render(); } } }, '🤝'))));
    }

    function render() {
      const q = filter.q.trim().toLowerCase();
      list = mons.filter((m) => {
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
      const boxes = Math.max(1, Math.ceil(list.length / PER_BOX));
      boxIdx = Math.max(0, Math.min(boxes - 1, boxIdx));
      counter.textContent = `${fmt(list.length)} de ${fmt(mons.length)} ejemplares`;
      chip.classList.toggle('hidden', !filter.species);
      chip.classList.add('pc-species-bar');
      chip.replaceChildren(...(filter.species && box.rules ? [`Solo ${S.dexById.get(filter.species).name} `, h('span', { class: 'pc-candy' }, `🍬 ${fmt(candyOf(filter.species))} de ${famName(filter.species)}`),
        h('button', { class: 'btn', disabled: !bulkList(filter.species).length, onclick: (e) => bulkTransfer(filter.species, e.target, () => render()) }, 'Transferir repetidos'),
        h('button', { class: 'btn', onclick: () => { filter.species = 0; boxIdx = 0; render(); } }, 'Ver todos')] : []));
      const wall = WALLPAPERS[boxIdx % WALLPAPERS.length];
      boxHead.replaceChildren(
        h('button', { class: 'btn pc-arrow', type: 'button', 'aria-label': 'Caja anterior', disabled: boxIdx === 0, onclick: () => { boxIdx--; render(); } }, '◀'),
        h('div', { class: 'pc-boxname' }, h('b', {}, `Caja ${boxIdx + 1}`), h('span', { class: 'small' }, ` · ${WALL_NAMES[boxIdx % WALLPAPERS.length]} · ${boxIdx + 1}/${boxes}`)),
        h('button', { class: 'btn pc-arrow', type: 'button', 'aria-label': 'Caja siguiente', disabled: boxIdx >= boxes - 1, onclick: () => { boxIdx++; render(); } }, '▶'));
      grid.className = 'pc-grid pc-slots bw-' + wall;
      const slice = list.slice(boxIdx * PER_BOX, (boxIdx + 1) * PER_BOX);
      if (selUid && !mons.some((x) => x.uid === selUid)) selUid = null;
      const slot = (m) => {
        const p = S.dexById.get(m.id);
        return h('button', { class: `pc-slot pc-card r-${p.rarity}${m.away ? ' away' : ''}${m.shiny ? ' shiny' : ''}${m.buddy ? ' buddy' : ''}${m.uid === selUid ? ' sel' : ''}`, type: 'button', title: `${label(m)} Nv. ${m.level}`,
          onclick: () => { selUid = m.uid; grid.querySelectorAll('.pc-slot.sel').forEach((n) => n.classList.remove('sel')); sfx('click'); drawSide(); grid.querySelector(`[data-uid="${m.uid}"]`)?.classList.add('sel'); }, 'data-uid': m.uid },
          h('img', { class: 'pixel', src: sprite(m.id, m.shiny), alt: '', loading: 'lazy' }),
          m.shiny ? h('span', { class: 'sl-shiny' }, '✨') : null,
          m.fav ? h('span', { class: 'sl-fav' }, '★') : null,
          m.buddy ? h('span', { class: 'sl-buddy' }, '🤝') : null,
          m.pending && m.pending.length ? h('span', { class: 'sl-new', title: 'Quiere aprender un movimiento' }, '🆕') : null,
          m.away ? h('span', { class: 'sl-away', title: awayText(m) }, awayIcon(m)) : null,
          h('span', { class: 'sr-only' }, `${label(m)} Nv. ${m.level}${m.away ? ' · ' + awayText(m) : ''}`));
      };
      const cells = slice.map(slot);
      while (cells.length < PER_BOX) cells.push(h('div', { class: 'pc-slot empty', 'aria-hidden': 'true' }));
      grid.replaceChildren(...cells);
      drawSide();
    }
    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '🖥️ Caja PC'), counter, searchBtn),
      chip, filters,
      h('div', { class: 'pc-layout' }, h('div', { class: 'pc-boxwrap' }, boxHead, grid), side));
    root.append(loader('Abriendo la Caja…'));
    await load();
    root.querySelector('.loader')?.remove();
    render();
    let t = 0;
    this.off = bus.on('me', () => { clearTimeout(t); t = setTimeout(async () => { await load(); if (S.view === 'pc') render(); }, 200); });
    this.stopObs = () => { clearTimeout(t); };
  },
  unmount() { this.off && this.off(); this.stopObs && this.stopObs(); },
};
