import { aniImg } from '../anim.js';
import { S, h, multiSelect, fmt, act, emit, sfx, toast, sprite, art, itemImg, modal, typeBadge, rarityName, TYPE_ES, bus, confirmRisk, hpBar, emptyState, loader, MON } from '../core.js';
import { evolveAnim, wonderReveal, expBar, levelUpFx, askEvolution } from './pc-fx.js';
import { heartsEl, friendLabel, friendTier, movePower, petButton, berryImg, berryCount, berryIds, LOVE_MIN } from './huerto.js';
import { movesPage, learnPrompt, swapDialog } from './moves-ui.js';
import { gearPage } from './bp-ui.js';
import { loadNames, moveEs } from '../battle-screen.js';

const STAT_NAMES = ['PS', 'Ataque', 'Defensa', 'At. Esp.', 'Def. Esp.', 'Velocidad'];

let mons = [];
let box = { wonderLeft: 0, rules: null, tradeTokens: 0, phase: 'day' };
let filter = { q: '', type: [], rarity: [], shiny: false, fav: false, species: 0, sort: 'recent' };
let loading = null;
let render = null;

const ivTotal = (m) => m.ivs.reduce((s, v) => s + v, 0);
const judge = (t) => (t >= 170 ? 'Increíble' : t >= 140 ? 'Muy bueno' : t >= 100 ? 'Bueno' : 'Normal');
const genderTag = (m) => (m.gender === 'M' ? '♂' : m.gender === 'F' ? '♀' : '');
const label = (m) => m.nick || S.dexById.get(m.id).name;
const awayIcon = (m) => (m.away === 'care' ? '🥚' : '🧭');
const awayText = (m) => (m.away === 'care' ? 'Está en el Criadero' : 'Está de expedición');

// Caramelos Exp. recibidos: { 'exp-xs': 2 } → «2× Caramelo Exp. XS».
const givenText = (given) => Object.entries(given || {}).map(([id, q]) => `${q}× ${(S.data.items[id] || {}).name || id}`).join(', ') || 'nada';
const transferText = (rarity, count = 1) => { const t = box.rules.transfer[rarity]; return `${t.n * count}× ${S.data.items[t.item].name}`; };
const transferExpOf = (rarity, count = 1) => box.rules.transfer[rarity].exp * count;
const effIv = (m, i) => (m.hyper && m.hyper[i] ? 31 : m.ivs[i]);
const pkrsBadge = (m) => (m.pkrs ? h('span', { class: 'pkrs-badge' + (m.pkrs === 'cured' ? ' cured' : ''), title: m.pkrs === 'cured' ? 'Pokérus curado: sigue ganando el doble de EVs, pero ya no contagia' : 'Pokérus: gana el doble de EVs y puede contagiar a su equipo', 'data-testid': 'pkrs' }, 'PKRS') : null);
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
  if (!(await confirmRisk('transfer-bulk', { section: 'la Caja PC', title: `¿Transferir ${list.length} ${p.name}?`, danger: 'Transferir', safe: 'Cancelar',
    text: 'Se transferirán al Profesor Oak y no se pueden recuperar. Se conserva el mejor ejemplar y nunca se tocan favoritos, compañero ni variocolores.',
    details: [`${list.length} ejemplar${list.length > 1 ? 'es' : ''} de ${p.name}`, `+${fmt(dust)} ✦ de polvo estelar`, `+${transferText(p.rarity, list.length)}`] }))) return;
  const r = await act('pc:transferBulk', { id }, btn);
  if (r) { sfx('shiny'); toast(`Transferiste ${r.count} ${p.name}: +${fmt(r.dust)} ✦ y +${givenText(r.given)}`, 'success'); await load(); if (after) after(); }
}

// Abre la ficha «Datos» de un ejemplar desde otra pantalla (p. ej. el montador de equipos de Combates), sin ir a
// la Caja PC. `onDone` se llama al cerrarla del todo (no cuando la ficha se recarga a sí misma tras una acción).
let afterClose = null;
export async function openSpecimen(uid, page = 'info', onDone = null) {
  await load();
  afterClose = onDone;
  openMon(uid, page);
}
function detailClosed() {
  setTimeout(() => {
    if (document.querySelector('.pc-detail') || !afterClose) return;
    const f = afterClose; afterClose = null; f();
  }, 0);
}

export function openInPc(id) { filter = { ...filter, q: '', species: Number(id) }; boxIdx = 0; location.hash = '#/pc'; }

function load() {
  if (loading) return loading;
  loading = Promise.all([emit('pc:box'), loadNames()]).then(([r]) => { mons = r.mons; box = { wonderLeft: r.wonderLeft, rules: r.rules, tradeTokens: r.tradeTokens || 0, phase: r.phase || 'day' }; }).catch((e) => toast(e.message, 'error')).finally(() => { loading = null; });
  return loading;
}

function openMon(uid, openPage = 'info') {
  const m = mons.find((x) => x.uid === uid);
  if (!m) return;
  const p = S.dexById.get(m.id);
  const total = ivTotal(m);
    const reopen = async (ok) => { if (ok) { await load(); modalRef.close(); openMon(uid, tabs.querySelector('.tab.active')?.dataset.page || openPage); render && render(); } };
  const evMax = (S.data.evs && S.data.evs.max) || 252;
  const evCap = (S.data.evs && S.data.evs.total) || 510;
  const rows = STAT_NAMES.map((name, i) => {
    const cls = m.up === i ? 'up' : m.down === i ? 'down' : '';
    return h('tr', { class: cls },
      h('th', {}, name + (cls === 'up' ? ' ▲' : cls === 'down' ? ' ▼' : '')),
      h('td', {}, p.stats[i]),
      h('td', { class: 'pc-ivcell' + (m.hyper && m.hyper[i] ? ' hyper' : '') }, h('span', { class: 'pc-ivbar' }, h('i', { style: { width: (effIv(m, i) / 31 * 100) + '%' } })),
        m.hyper && m.hyper[i] ? h('span', { class: 'small hyper-iv', title: `31 (Entrenamiento Extremo): su IV real es ${m.ivs[i]}`, 'data-testid': 'hyper-iv' }, '31⚡') : h('span', { class: 'small' }, m.ivs[i])),
      h('td', { class: 'pc-ivcell pc-evcell' }, h('span', { class: 'pc-ivbar pc-evbar' }, h('i', { style: { width: (m.evs[i] / evMax * 100) + '%' } })), h('span', { class: 'small' }, m.evs[i])),
      h('td', { class: 'pc-final' }, m.stats[i]));
  });
  const ru = box.rules;
  // Requisitos especiales de evolución (piedras, intercambio, sexo, hora…): [{ text, ok }]. Los valida el servidor (evoreq.js).
  const evoNeeds = (t) => {
    const r = (S.data.evo.req || {})[t.id];
    if (!r) return [];
    const out = [];
    if (r.item) { const have = S.me.items[r.item] || 0; out.push({ text: `${S.data.items[r.item].name} (tienes ${have})`, ok: have > 0 }); }
    if (r.trade) {
      const cords = S.me.items[S.data.evo.link] || 0;
      const tokens = box.tradeTokens || 0;
      out.push({ text: `intercambio: ${S.data.items[S.data.evo.link].name} (tienes ${cords}${tokens ? ` + ${tokens} intercambio${tokens > 1 ? 's' : ''} pendiente${tokens > 1 ? 's' : ''}` : ''})`, ok: cords > 0 || tokens > 0 });
    }
    if (r.gender) out.push({ text: r.gender === 'M' ? 'ser macho' : 'ser hembra', ok: m.gender === r.gender });
    if (r.time) out.push({ text: r.time === 'day' ? 'que sea de día (06:00–21:00)' : 'que sea de noche (21:00–06:00)', ok: box.phase === r.time });
    if (r.stat) { const [a, op, b] = [m.stats[1], r.stat[3], m.stats[2]]; out.push({ text: op === '>' ? 'más Ataque que Defensa' : op === '<' ? 'menos Ataque que Defensa' : 'Ataque igual a Defensa', ok: op === '>' ? a > b : op === '<' ? a < b : a === b }); }
    if (r.move) out.push({ text: `conocer ${moveEs(r.move)}`, ok: (m.learned || []).includes(r.move) });
    return out;
  };
  const evoRow = (t) => {
    const love = m.friendship >= (ru.loveMin || LOVE_MIN);
    const need = (ru.evoLevel || {})[t.id] || 0;
    const byFriend = (ru.friendEvo || []).includes(t.id);
    const reasons = [];
    if (m.away) reasons.push('fuera ahora');
    if (byFriend && !love) reasons.push(`amistad ≥ ${ru.loveMin || LOVE_MIN}`);
    const needs = evoNeeds(t);
    for (const n of needs) if (!n.ok) reasons.push(n.text);
    if (m.level < need) reasons.push(`Nv. ${need}`);
    if (spareCount(m.id) < 1 && !(ru.evoFirst && ru.evoFirst.includes(t.id))) reasons.push('otra copia');
    const tc = S.me.collection[t.id];
    if (tc && tc.n >= 5) reasons.push('ya tienes 5 estrellas');
    const reqs = [need ? `Nv. ${need}` : null, byFriend ? `amistad ≥ ${ru.loveMin || LOVE_MIN}` : null].filter(Boolean);
    return h('div', { class: 'pc-evo', 'data-testid': 'evo-row' }, h('img', { src: sprite(t.id, m.shiny), alt: t.name }),
      h('div', { class: 'grow small' }, h('b', {}, t.name),
        needs.length ? h('div', { class: 'pc-evo-needs', 'data-testid': 'evo-needs' }, 'Necesita: ', needs.flatMap((n, i) => [i ? (i === needs.length - 1 ? ' y ' : ', ') : '', h('span', { class: n.ok ? 'good' : 'bad' }, (n.ok ? '✓ ' : '✗ ') + n.text)])) : null,
        h('div', { class: 'muted' }, (reqs.length ? `Requisitos: ${reqs.join(' · ')}` : 'Sin requisito de nivel') + (reasons.length ? ` · Falta: ${reasons.join(', ')}` : ' · ¡Listo!'))),
      h('button', { class: 'btn primary', disabled: reasons.length > 0, onclick: async (ev) => {
        const r = await act('pc:evolve', { id: m.id, uid, to: t.id }, ev.target);
        if (!r) return;
        modalRef.close();
        await evolveAnim(m.id, t.id, m.shiny);
        toast(`¡Tu ${label(m)} evolucionó a ${t.name}!${r.form ? ` (${r.form})` : ''}`, 'success');
        if (r.evo && r.evo.length) await askEvolution({ id: r.to, uid, shiny: m.shiny, name: label(m), to: r.evo });
        await load(); render && render();
        if (r.pending && r.pending.length) openMon(uid);
      } }, 'Evolucionar'));
  };
  // Vitaminas (+10 EV) y bayas (−10 EV) de la mochila.
  function evPanel() {
    const ev = S.data.evs;
    const byStat = (kind) => Object.entries(S.data.items).filter(([, it]) => it.cat === kind).sort((a, b) => a[1].ev.stat - b[1].ev.stat);
    const vit = byStat('vitamin');
    const ber = byStat('evberry');
    const use = async (itemId, qty, btn) => {
      const r = await act('pc:ev', { id: m.id, uid, itemId, qty }, btn);
      if (r) { sfx('click'); toast(`${S.data.items[itemId].name}: ${STAT_NAMES[r.stat]} ${r.delta >= 0 ? '+' : ''}${r.delta} EV (${r.evs[r.stat]}/${ev.max})`, 'success'); reopen(true); }
    };
    return h('div', { class: 'pc-box', 'data-testid': 'ev-panel' }, h('h4', {}, `💊 EVs: ${m.evTotal}/${ev.total}`),
      h('div', { class: 'small muted' }, `Vitaminas: +${ev.vitamin} EV (hasta ${ev.max} por estadística). Bayas: −${ev.berry} EV. Se compran en la `, h('a', { href: '#/shop', onclick: () => modalRef.close() }, 'Tienda Poké'), '.'),
      STAT_NAMES.map((name, i) => {
        const [vid] = vit.find(([, it]) => it.ev.stat === i) || [];
        const [bid] = ber.find(([, it]) => it.ev.stat === i) || [];
        const nv = (S.me.items[vid] || 0);
        const nb = (S.me.items[bid] || 0);
        return h('div', { class: 'row gap wrap pc-evrow' }, h('span', { class: 'pc-evname' }, `${name}: ${m.evs[i]}`),
          h('button', { class: 'btn small', type: 'button', 'data-ev': vid, disabled: !nv || m.evs[i] >= ev.max || m.evTotal >= ev.total, onclick: (e) => use(vid, 1, e.currentTarget) }, `+${ev.vitamin} ${S.data.items[vid].name} ×${nv}`),
          h('button', { class: 'btn small', type: 'button', 'data-ev': bid, disabled: !nb || m.evs[i] <= 0, onclick: (e) => use(bid, 1, e.currentTarget) }, `−${ev.berry} ${S.data.items[bid].name} ×${nb}`));
      }));
  }
  // ⭐ EXP y Caramelos Exp.: elige el tipo y cuántos usar.
  let candySel = null;
  let candyQty = 1;
  function expPanel() {
    const maxed = m.level >= ru.maxLevel;
    const tiers = ru.exp.candies;
    const have = (id) => S.me.items[id] || 0;
    if (!candySel || !tiers.some((t) => t.id === candySel)) candySel = (tiers.slice().reverse().find((t) => have(t.id) > 0) || tiers[0]).id;
    const cur = tiers.find((t) => t.id === candySel);
    const toNext = maxed ? 0 : m.expHi - m.exp;
    const needNext = Math.max(1, Math.ceil(toNext / cur.exp));
    const maxUse = Math.min(have(cur.id), maxed ? 0 : Math.ceil((m.expMax - m.exp) / cur.exp));
    candyQty = Math.max(1, Math.min(candyQty, Math.max(1, have(cur.id))));
    const qty = h('input', { type: 'number', min: 1, max: Math.max(1, have(cur.id)), value: candyQty, 'aria-label': 'Cantidad de Caramelos Exp.', class: 'exp-qty', 'data-testid': 'exp-qty',
      oninput: (e) => { candyQty = Math.max(1, Math.min(have(cur.id) || 1, Math.floor(Number(e.target.value)) || 1)); preview.textContent = previewText(); } });
    const previewText = () => `+${fmt(candyQty * cur.exp)} EXP${maxed ? '' : ` · ${needNext} de este tipo para el siguiente nivel`}`;
    const preview = h('span', { class: 'small muted' }, previewText());
    const setQty = (n) => { candyQty = Math.max(1, Math.min(have(cur.id) || 1, n)); qty.value = candyQty; preview.textContent = previewText(); };
    return h('div', { class: 'pc-box', 'data-testid': 'exp-panel' }, h('h4', {}, `⭐ Nv. ${m.level} · EXP`),
      expBar(m),
      m.level < ru.maxLevel ? h('div', { class: 'small muted' }, `Combates contra la CPU y expediciones: hasta ${fmt(m.capLeft)} EXP más hoy para este Pokémon (tope diario por ejemplar). Los Caramelos Exp. no tienen tope.`) : null,
      h('div', { class: 'exp-tiers', role: 'radiogroup', 'aria-label': 'Tipo de Caramelo Exp.' }, tiers.map((t) => h('button', { class: 'exp-tier' + (t.id === candySel ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': t.id === candySel ? 'true' : 'false', 'data-exp-item': t.id, disabled: !have(t.id), onclick: () => { candySel = t.id; candyQty = 1; show('menu'); } },
        itemImg(t.id), h('b', {}, t.tag), h('small', {}, `${fmt(t.exp)} EXP`), h('small', { class: 'exp-own' }, `×${fmt(have(t.id))}`)))),
      h('div', { class: 'row gap wrap exp-use' },
        h('button', { class: 'btn small', type: 'button', 'aria-label': 'Menos', disabled: maxed, onclick: () => setQty(candyQty - 1) }, '−'), qty,
        h('button', { class: 'btn small', type: 'button', 'aria-label': 'Más', disabled: maxed, onclick: () => setQty(candyQty + 1) }, '+'),
        h('button', { class: 'btn small', type: 'button', disabled: maxed || !have(cur.id), onclick: () => setQty(needNext) }, 'Hasta el siguiente nivel'),
        h('button', { class: 'btn small', type: 'button', disabled: maxed || !have(cur.id), onclick: () => setQty(maxUse || 1) }, 'Todos'),
        h('button', { class: 'btn primary', type: 'button', 'data-testid': 'exp-use', disabled: maxed || !have(cur.id) || !!m.away, onclick: async (e) => {
          const r = await act('pc:expcandy', { id: m.id, uid, itemId: cur.id, qty: candyQty }, e.target);
          if (!r) return;
          sfx('click');
          if (!(r.evo && r.evo.length)) toast(`${r.used}× ${S.data.items[cur.id].name}: +${fmt(r.exp)} EXP${r.to > r.from ? ` · ¡Nv. ${r.to}!` : ''}`, 'success');
          if (r.to > r.from) levelUpFx({ id: m.id, shiny: m.shiny, name: label(m), from: r.from, to: r.to, learned: r.learned, pending: r.pending });
          await load();
          if (r.evo && r.evo.length) { modalRef.close(); await askEvolution({ id: m.id, uid, shiny: m.shiny, name: label(m), to: r.evo }); await load(); openMon(uid, 'menu'); render && render(); return; }
          modalRef.close(); openMon(uid, 'menu'); render && render();
        } }, 'Usar')),
      preview,
      !tiers.some((t) => have(t.id) > 0) ? h('div', { class: 'small muted' }, 'No tienes Caramelos Exp.: caen de combates, expediciones, Torre, Liga, tiradas y transferencias, o se compran con PB en la Tienda de Combate.') : null);
  }
  // 💪 Entrenamiento Extremo (Chapas): IV efectivos a 31 en combate (los reales no cambian).
  function hyperPanel() {
    const hy = ru.hyper;
    const nb = S.me.items[hy.bottle] || 0;
    const ng = S.me.items[hy.gold] || 0;
    const locked = m.level < hy.minLevel;
    const use = async (itemId, stat, btn, what) => {
      if (!(await confirmRisk('hyper', { section: 'los objetos', title: `¿Usar ${S.data.items[itemId].name}?`, danger: 'Usar', safe: 'Cancelar',
        text: `${what} No se puede deshacer. Los IV reales de ${label(m)} no cambian (el Criadero sigue heredando los de siempre); en combate cuentan como 31.` }))) return;
      const r = await act('pc:hyper', { id: m.id, uid, itemId, stat }, btn);
      if (r) { sfx('win'); toast(`Entrenamiento Extremo: ${r.stats.map((i) => STAT_NAMES[i]).join(', ')} a 31`, 'success'); reopen(true); }
    };
    return h('div', { class: 'pc-box', 'data-testid': 'hyper-panel' }, h('h4', {}, '🏋️ Entrenamiento Extremo'),
      h('div', { class: 'small muted' }, `Chapa de Botella: una estadística a 31 · Chapa Dorada: las seis. Hace falta nivel ${hy.minLevel} o más (tiene ${m.level}). Se compran con PB (${hy.bottleBp} y ${hy.goldBp} PB) y caen de la Torre y la Liga. Tienes ${nb} de Botella y ${ng} Doradas.`),
      STAT_NAMES.map((name, i) => {
        const done = m.hyper && m.hyper[i];
        return h('div', { class: 'row gap wrap pc-evrow' }, h('span', { class: 'pc-evname' }, `${name}: IV ${m.ivs[i]}`),
          done ? h('span', { class: 'small good' }, '31 (Entrenamiento Extremo)')
            : m.ivs[i] >= 31 ? h('span', { class: 'small muted' }, 'ya es 31')
              : h('button', { class: 'btn small', type: 'button', 'data-hyper': i, disabled: locked || !nb || !!m.away, onclick: (e) => use(hy.bottle, i, e.currentTarget, `Pone ${name} a 31 en combate.`) }, 'Chapa de Botella'));
      }),
      h('button', { class: 'btn', type: 'button', 'data-testid': 'hyper-gold', disabled: locked || !ng || !!m.away || !m.ivs.some((v, i) => v < 31 && !(m.hyper && m.hyper[i])), onclick: (e) => use(hy.gold, undefined, e.currentTarget, 'Pone todas las estadísticas que aún no son 31 a 31 en combate.') }, 'Chapa Dorada (todas)'));
  }
  function trainPanel() {
    const evos0 = S.data.dex.filter((x) => x.evolvesFrom === m.id);
    const evos = m.evoForced ? evos0.filter((x) => x.id === m.evoForced) : evos0;
    return h('div', { class: 'stack' },
      expPanel(),
      p.rarity === 'M' || !evos.length ? null : h('div', { class: 'pc-box' }, h('h4', {}, '🌟 Evolución'),
        m.evoForced ? h('div', { class: 'small muted' }, `Según su personalidad, ${m.nick || p.name} solo puede evolucionar a ${S.dexById.get(m.evoForced).name}.`) : null,
        evos.map(evoRow)),
      hyperPanel(),
      evPanel());
  }
  function friendPanel() {
    const love = m.friendship >= LOVE_MIN;
    const owned = berryIds().filter((id) => berryCount(id) > 0);
    const tier = friendTier(m.friendship);
    const nm = m.nick || p.name;
    const known = new Set(m.learned || []);
    const bondMoves = [['return', 'Retribución', m.friendship >= 150, 'necesita 150 o más de amistad'], ['frustration', 'Frustración', m.friendship <= 99, 'solo con 99 o menos de amistad']];
    const eff = [tier.survive && `aguantar un golpe con 1 PS ${tier.survive} %`, tier.evade && `esquivar ${tier.evade} %`, tier.cure && `curarse de estados ${tier.cure} %`, tier.crit && `golpe crítico ${tier.crit} %`].filter(Boolean);
    const phrase = h('div', { class: 'bd-phrase' }, `“${m.phrase || ''}”`);
    return h('div', { class: 'pc-box bd-friend' },
      phrase,
      h('div', { class: 'row gap wrap' }, h('b', {}, 'Amistad: '), heartsEl(m.friendship), h('span', { class: 'small' }, `${friendLabel(m.friendship)} (${m.friendship}/255)`)),
      h('div', { class: 'row gap wrap' }, petButton({ id: m.id, uid, name: nm, petted: m.petted, maxed: m.friendship >= 255, onDone: () => reopen(true) }),
        h('span', { class: 'small muted' }, 'Una vez al día por Pokémon.')),
      love ? h('div', { class: 'small good' }, '💖 Te adora: +3 % a todas sus estadísticas en duelos rápidos y +10 % de botín (EXP, bayas y polvo) en expediciones.') : h('div', { class: 'small muted' }, `A partir de ${LOVE_MIN} te adora: +3 % en duelos, +10 % de botín en expediciones y evoluciones por amistad. Sube con bayas, caricias, apostando con él de compañero y ganando duelos.`),
      h('div', { class: 'small' }, h('b', {}, 'En combates contra la CPU: '), eff.length ? eff.join(' · ') + '.' : 'a partir de 150 de amistad le salen efectos (aguantar golpes, esquivar, curarse). No actúan en PvP.'),
      h('div', { class: 'bd-moves' }, h('div', { class: 'small bd-feedlbl' }, '💞 Movimientos del vínculo'),
        bondMoves.map(([mv, mvName, ok, why]) => h('div', { class: 'row gap wrap bd-bm' },
          h('span', { class: 'small' }, `${mvName}: potencia actual ${movePower(mv, m.friendship)}`),
          known.has(mv) ? h('span', { class: 'small muted' }, 'ya la sabe')
            : h('button', { class: 'btn small', type: 'button', disabled: !ok || !!m.away, title: ok ? '' : why, onclick: async (ev) => {
              const r = await act('pc:bondmove', { id: m.id, uid, move: mv }, ev.currentTarget);
              if (!r) return;
              sfx('win'); toast(`¡${nm} aprendió ${mvName}!`, 'success');
              if (r.how === 'equipped') { reopen(true); return; }
              m.eq = r.eq; m.learned = r.learned; // sin hueco libre: a elegir qué lleva equipado
              await loadNames();
              swapDialog(m, () => reopen(true));
            } }, ok ? 'Enseñar' : why)))),
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
  // «⋯ Más»: lo que sirve para deshacerse de un ejemplar. Nunca junto a las acciones frecuentes.
  function openMore() {
    const spare = spareCount(m.id);
    const tDust = S.data.rarity[p.rarity].dust;
    const tCandy = transferText(p.rarity);
    const special = [m.shiny ? 'variocolor ✨' : '', m.fav ? 'favorito' : '', m.buddy ? 'tu compañero' : ''].filter(Boolean).join(' y ');
    const done = async () => { more.close(); await load(); modalRef.close(); render && render(); };
    const more = modal(h('div', { class: 'stack pc-more' },
      h('p', { class: 'small muted' }, `${label(m)} · Nv. ${m.level}. Estas acciones son definitivas; si el ejemplar es especial te pediremos confirmación.`),
      h('div', { class: 'pc-box' }, h('h4', {}, '🎓 Transferir al Profesor Oak'),
        h('p', { class: 'small muted' }, `Recibes ${tDust} ✦ de polvo y ${tCandy}. Hace falta otra copia (se conserva siempre una de cada Pokémon).`),
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn', disabled: spare < 1 || !!m.away, title: m.away ? awayText(m) : '', onclick: async (e) => {
            if (special && !(await confirmRisk('release-precious', { title: 'Vas a transferir un ejemplar especial', danger: 'Transferir igualmente', safe: 'Conservarlo',
              text: `${label(m)} es ${special}. Solo recibes ${tDust} ✦ y ${tCandy} y no se puede deshacer.` }))) return;
            const r = await act('pc:transfer', { id: m.id, uid }, e.target);
            if (r) { sfx('shiny'); toast(`Transferido: +${fmt(r.dust)} ✦ y +${givenText(r.given)}`, 'success'); await done(); } } }, `Transferir (+${tDust} ✦ +${tCandy})`),
          spare > 0 ? h('button', { class: 'btn', onclick: (e) => bulkTransfer(m.id, e.target, () => done()) }, 'Transferir repetidos') : null)),
      h('div', { class: 'pc-box' }, h('h4', {}, '🎁 Intercambio Milagroso'),
        h('p', { class: 'small muted' }, 'Entregas una copia sobrante (no favorita, compañero ni variocolor) y recibes otra de la misma rareza. Sin monedas.'),
        h('button', { class: 'btn', disabled: spare < 1 || !!m.away || m.shiny || m.fav || m.buddy || p.rarity === 'M' || box.wonderLeft < 1, title: 'Recibes un Pokémon al azar de la misma rareza', onclick: async (e) => {
          const r = await act('pc:wonder', { id: m.id, uid }, e.target);
          if (!r) return;
          more.close(); modalRef.close();
          await wonderReveal(r);
          await load(); render && render();
        } }, `Intercambio Milagroso (${box.wonderLeft}/${ru.wonderDaily})`)),
      h('div', { class: 'pc-box' }, h('h4', {}, '🕊️ Liberar'),
        h('p', { class: 'small muted' }, `Solo recibes ${S.data.rarity[p.rarity].dust} ✦ de polvo (sin Caramelos Exp.): casi siempre es mejor Transferir.`),
        h('button', { class: 'btn danger', disabled: !!m.away, title: m.away ? awayText(m) : '', onclick: async (e) => {
          const c = S.me.collection[m.id];
          if (!c || c.n - (c.cn || 0) < 2) return toast('Debes conservar al menos una copia de cada Pokémon.', 'error');
          const dust = S.data.rarity[p.rarity].dust;
          if (!(await confirmRisk('release-one', { section: 'la Caja PC', title: `¿Liberar a ${label(m)}?`, danger: 'Liberar', safe: 'Conservarlo',
            text: `${special ? `${label(m)} es ${special}. ` : ''}Solo recibes ${dust} ✦ de polvo y no se puede deshacer.` }))) return;
          if (await act('pc:release', { id: m.id, uid }, e.target)) { sfx('shiny'); toast(`Liberaste a ${label(m)}: +${dust} ✦`, 'success'); await done(); } } }, 'Liberar'))),
    { title: '⋯ Más acciones' });
  }
  const pages = {
    info: () => h('div', { class: 'stack' },
      m.away ? h('div', { class: 'pc-away-note' }, `${awayIcon(m)} ${awayText(m)}: no se puede liberar, transferir, evolucionar ni llevar a combates hasta que vuelva.`) : null,
      h('div', { class: 'muted small' }, `#${String(m.id).padStart(3, '0')} ${p.name} · Nv. ${m.level} · Naturaleza ${m.nature}${m.buddy ? ' · 🤝 Compañero' : ''}`),
      h('div', { class: 'types' }, p.types.map(typeBadge), h('span', { class: 'rar r-' + p.rarity }, rarityName(p.rarity)), pkrsBadge(m)),
      h('div', { class: 'pc-exp-line' }, h('b', {}, `Nv. ${m.level}`), expBar(m)),
      m.form ? h('div', { class: 'small', 'data-testid': 'form' }, h('b', {}, 'Forma: '), m.form) : null,
      m.pkrs ? h('div', { class: 'small' }, h('b', {}, '🦠 Pokérus: '), m.pkrs === 'cured' ? 'curado (sigue ganando el doble de EVs; ya no contagia)' : 'infectado (gana el doble de EVs y puede contagiar a su equipo)') : null,
      m.hyper && m.hyper.some(Boolean) ? h('div', { class: 'small' }, h('b', {}, '🏋️ Entrenamiento Extremo: '), m.hyper.map((x, i) => (x ? STAT_NAMES[i] : null)).filter(Boolean).join(', '), ' a 31 en combate') : null,
      h('div', { class: 'small' }, h('b', {}, 'Habilidad: '), m.ability),
      m.eg ? h('div', { class: 'small', title: 'Para criar, dos Pokémon deben compartir grupo huevo (y ser macho y hembra, o uno Ditto)' }, h('b', {}, 'Grupo huevo: '), m.eg.join(' · '), ' · ', m.gender === 'M' ? '♂ macho' : m.gender === 'F' ? '♀ hembra' : 'sin sexo') : null,
      h('div', {}, h('b', {}, `IV total ${total}/186`), ` · ${judge(total)}`, hpBar(total / 186 * 100)),
      h('div', { class: 'small muted' }, 'Obtenido: ' + new Date(m.at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })),
      nickRow),
    stats: () => h('div', { class: 'stack' }, h('div', { class: 'pc-table-wrap' }, h('table', { class: 'pc-stats' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Base'), h('th', {}, 'IV'), h('th', { title: 'Puntos de esfuerzo: máx. 252 por estadística y 510 en total' }, 'EV'), h('th', {}, 'Nv. 50'))),
      h('tbody', {}, rows))),
      h('div', { class: 'small', 'data-testid': 'ev-total' }, h('b', {}, `EV total ${m.evTotal}/${evCap}`), ` · ${evCap - m.evTotal > 0 ? `te quedan ${evCap - m.evTotal} por repartir` : 'repartidos al máximo'}`, hpBar(m.evTotal / evCap * 100)),
      m.hyper && m.hyper.some(Boolean) ? h('div', { class: 'small' }, '⚡ = 31 (Entrenamiento Extremo): ', m.hyper.map((x, i) => (x ? `${STAT_NAMES[i]} (IV real ${m.ivs[i]})` : null)).filter(Boolean).join(', '), '.') : null,
      h('div', { class: 'small muted' }, 'Los EV suben con expediciones, victorias contra la CPU y vitaminas (Entrenar). Cuentan en todos los combates; el Nv. 50 ya los incluye.')),
    moves: () => movesPage(m, async () => { await load(); modalRef.close(); openMon(uid, 'moves'); render && render(); }),
    gear: () => { const box2 = h('div', {}); gearPage(m, async () => { await load(); modalRef.close(); openMon(uid, 'gear'); render && render(); }).then((el) => box2.append(el)); return box2; },
    bond: () => friendPanel(),
    menu: () => (box.rules ? trainPanel() : h('p', { class: 'muted' }, 'Sin datos de la caja.')),
  };
  const PAGE_NAMES = [['info', 'Info'], ['stats', 'Estadísticas'], ['moves', 'Movimientos'], ['gear', 'Equipo'], ['bond', 'Vínculo'], ['menu', 'Entrenar']];
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
      h('div', { class: 'small muted' }, `Nv. ${m.level}`), expBar(m, { compact: true }), pkrsBadge(m)),
    h('div', { class: 'stack pc-detail-right' }, tabs, body,
      h('div', { class: 'pc-menu' },
        h('button', { class: 'btn', onclick: () => { show('info'); nickRow.style.display = nickRow.style.display === 'none' ? '' : 'none'; nickInput.focus(); } }, '✏️ Mote'),
        h('button', { class: 'btn', onclick: async (e) => { reopen(await act('pc:fav', { id: m.id, uid, fav: !m.fav }, e.target)); } }, m.fav ? '★ Quitar favorito' : '☆ Favorito'),
        h('button', { class: 'btn primary', disabled: m.buddy, onclick: async (e) => { if (await act('pc:buddy', { id: m.id, uid }, e.target)) { toast(`${label(m)} es tu compañero`, 'success'); sfx('win'); reopen(true); } } }, '🤝 Compañero'),
        h('button', { class: 'btn', type: 'button', title: 'Transferir, Intercambio Milagroso y Liberar', onclick: () => openMore() }, '⋯ Más'))
    )), { title: 'Datos', wide: true, onClose: detailClosed });
  // Movimientos nuevos por decidir (subida de nivel, evolución…): se preguntan al abrir la ficha.
  if (m.pending && m.pending.length && openPage !== 'moves') learnPrompt(m, async () => { await load(); modalRef.close(); openMon(uid, openPage); render && render(); });
}

// Cajas de 30 huecos (6×5) con fondo propio, como en los juegos.
const PER_BOX = 30;
const WALLPAPERS = ['bosque', 'ciudad', 'desierto', 'sabana', 'cueva', 'mar', 'volcan', 'nieve'];
const WALL_NAMES = ['Bosque', 'Ciudad', 'Desierto', 'Sabana', 'Cueva', 'Mar', 'Volcán', 'Nieve'];
let boxIdx = 0;
let selUid = null;
// Modo «Transferir varios»: los huecos se marcan al tocarlos en vez de abrir la ficha.
let picking = null; // Set de uids o null

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
    const ms = (key, label, opts, allLabel, plural) => multiSelect({ label, options: opts, value: filter[key], allLabel, plural, onChange: (v) => { filter[key] = v; boxIdx = 0; render(); } }).el;
    const check = (key, text) => h('label', { class: 'pc-check' }, h('input', { type: 'checkbox', checked: filter[key], onchange: (e) => { filter[key] = e.target.checked; boxIdx = 0; render(); } }), text);
    const filters = h('div', { class: 'filters pc-filters hidden' }, search,
      ms('type', 'Tipo', S.data.types.map((t) => [t, TYPE_ES[t]]), 'Todos', 'seleccionados'),
      ms('rarity', 'Rareza', ['M', 'L', 'E', 'R', 'U', 'C'].map((r) => [r, rarityName(r)]), 'Todas', 'seleccionadas'),
      sel('sort', [['recent', 'Más recientes'], ['number', 'Nº Pokédex'], ['iv', 'IV total'], ['name', 'Nombre']]),
      check('shiny', '✨ Variocolor'), check('fav', '★ Favoritos'));
    const searchBtn = h('button', { class: 'btn', type: 'button', onclick: () => { const o = filters.classList.toggle('hidden'); searchBtn.classList.toggle('active', !o); if (!o) search.focus(); } }, '🔍 Buscar');
    // ---- Transferir al Profesor Oak en bloque ----
    const pickable = (m) => !m.buddy && !m.away;
    const pickBar = h('div', { class: 'pc-pickbar hidden' });
    const pickBtn = h('button', { class: 'btn', type: 'button', title: 'Marca varios Pokémon y transfiérelos de una vez', onclick: () => { picking = picking ? null : new Set(); render(); } }, '🎓 Transferir varios');
    const allBtn = h('button', { class: 'btn', type: 'button', title: 'Transfiere todos los repetidos de todas las especies (se conservan favoritos, compañero, variocolores y el mejor de cada especie)', onclick: async (e) => {
      const btn = e.currentTarget;
      const pre = await act('pc:transferAll', { preview: true }, btn);
      if (!pre) return;
      if (!pre.count) return toast('No tienes repetidos que transferir: se conservan favoritos, compañero, variocolores y el mejor de cada especie.', 'info');
      if (!(await confirmRisk('transfer-all', { section: 'la Caja PC', title: `¿Transferir ${fmt(pre.count)} repetidos?`, danger: 'Transferir todos', safe: 'Cancelar',
        text: 'Se transfieren al Profesor Oak todos los repetidos de todas tus especies. Se conserva siempre el mejor de cada una y nunca se tocan favoritos, compañero ni variocolores.',
        details: [`${fmt(pre.count)} Pokémon de ${fmt(pre.species)} especies`, `+${fmt(pre.dust)} ✦ de polvo estelar`, `+${fmt(pre.exp)} EXP en Caramelos Exp.`] }))) return;
      const r = await act('pc:transferAll', {}, btn);
      if (r) { sfx('shiny'); toast(`Transferiste ${fmt(r.count)} Pokémon: +${fmt(r.dust)} ✦ y +${givenText(r.given)}`, 'success'); await load(); render(); }
    } }, '🧹 Todos los repetidos');
    function drawPickBar() {
      pickBar.classList.toggle('hidden', !picking);
      pickBtn.classList.toggle('active', !!picking);
      if (!picking) return;
      const chosen = mons.filter((m) => picking.has(m.uid));
      const dust = chosen.reduce((s, m) => s + S.data.rarity[S.dexById.get(m.id).rarity].dust, 0);
      const cdy = box.rules ? chosen.reduce((s, m) => s + transferExpOf(S.dexById.get(m.id).rarity), 0) : 0;
      const slice = list.slice(boxIdx * PER_BOX, (boxIdx + 1) * PER_BOX).filter((m) => pickable(m) && !m.fav && !m.shiny);
      // Según los filtros (rareza, tipo, búsqueda…): todos los que se ven en todas las cajas, o solo sus repetidos.
      const filtered = list.filter((m) => pickable(m) && !m.fav && !m.shiny);
      const dupes = filtered.filter((m) => bulkList(m.id).some((x) => x.uid === m.uid));
      pickBar.replaceChildren(
        h('span', {}, h('b', {}, `${chosen.length} marcados`), chosen.length ? ` · +${fmt(dust)} ✦ · +${fmt(cdy)} EXP` : ' · toca los Pokémon que quieras transferir'),
        h('button', { class: 'btn small', type: 'button', title: 'Marca los de esta caja (sin favoritos, variocolores ni compañero)', onclick: () => { for (const m of slice) picking.add(m.uid); render(); } }, 'Marcar la caja'),
        h('button', { class: 'btn small', type: 'button', disabled: !filtered.length, title: 'Marca todos los que cumplen los filtros de 🔍 Buscar (rareza, tipo…), en todas las cajas', onclick: () => { for (const m of filtered) picking.add(m.uid); render(); } }, `Marcar lo filtrado (${filtered.length})`),
        h('button', { class: 'btn small', type: 'button', disabled: !dupes.length, title: 'Solo los repetidos de lo filtrado: se conserva el mejor de cada especie', onclick: () => { for (const m of dupes) picking.add(m.uid); render(); } }, `Repetidos de lo filtrado (${dupes.length})`),
        h('button', { class: 'btn small', type: 'button', disabled: !chosen.length, onclick: () => { picking.clear(); render(); } }, 'Desmarcar'),
        h('button', { class: 'btn primary', type: 'button', disabled: !chosen.length, onclick: async (e) => {
          const btn = e.currentTarget;
          const special = chosen.filter((m) => m.fav || m.shiny).length;
          if (!(await confirmRisk('transfer-many', { section: 'la Caja PC', title: `¿Transferir ${chosen.length} Pokémon?`, danger: 'Transferir', safe: 'Cancelar',
            text: 'Se transfieren al Profesor Oak y no se pueden recuperar. De cada especie se conserva al menos una copia.',
            details: [`+${fmt(dust)} ✦ de polvo estelar`, `+${fmt(cdy)} EXP en Caramelos Exp.`, ...(special ? [`⚠ Incluye ${special} favorito(s) o variocolor(es)`] : [])] }))) return;
          // En tandas (el servidor acepta hasta 300 por llamada).
          let r = null;
          for (let i = 0; i < chosen.length; i += 300) {
            const part = await act('pc:transferMany', { list: chosen.slice(i, i + 300).map((m) => ({ id: m.id, uid: m.uid })) }, btn);
            if (!part) break;
            r = r ? { count: r.count + part.count, dust: r.dust + part.dust, given: Object.entries(part.given || {}).reduce((a, [k, v]) => ({ ...a, [k]: (a[k] || 0) + v }), { ...r.given }), skipped: r.skipped + part.skipped, reason: r.reason || part.reason } : part;
          }
          if (r) { sfx('shiny'); toast(`Transferiste ${r.count} Pokémon: +${fmt(r.dust)} ✦ y +${givenText(r.given)}${r.skipped ? ` · ${r.skipped} no se pudieron (${r.reason})` : ''}`, r.count ? 'success' : 'error'); picking = null; await load(); render(); }
        } }, '🎓 Transferir'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { picking = null; render(); } }, 'Salir'));
    }
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
        expBar(m, { compact: true }),
        h('div', { class: 'types' }, p.types.map(typeBadge), pkrsBadge(m)),
        heartsEl(m.friendship, 'sm'),
        m.away ? h('div', { class: 'pc-away-note' }, `${awayIcon(m)} ${awayText(m)}`) : null,
        h('div', { class: 'pc-sel-actions' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => openMon(m.uid) }, 'Datos'),
          h('button', { class: 'btn', type: 'button', onclick: async (e) => { if (await act('pc:fav', { id: m.id, uid: m.uid, fav: !m.fav }, e.target)) { await load(); render(); } } }, m.fav ? '★ Favorito' : '☆ Favorito'),
          h('button', { class: 'btn', type: 'button', disabled: m.buddy, title: 'Hacer compañero', onclick: async (e) => { if (await act('pc:buddy', { id: m.id, uid: m.uid }, e.target)) { toast(`${label(m)} es tu compañero`, 'success'); sfx('win'); await load(); render(); } } }, '🤝 Compañero'))));
    }

    function render() {
      const q = filter.q.trim().toLowerCase();
      list = mons.filter((m) => {
        const p = S.dexById.get(m.id);
        if (filter.species && m.id !== filter.species) return false;
        if (filter.type.length && !p.types.some((t) => filter.type.includes(t))) return false;
        if (filter.rarity.length && !filter.rarity.includes(p.rarity)) return false;
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
      chip.replaceChildren(...(filter.species && box.rules ? [`Solo ${S.dexById.get(filter.species).name} `,
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
        const picked = picking && picking.has(m.uid);
        return h('button', { class: `pc-slot pc-card r-${p.rarity}${m.away ? ' away' : ''}${m.shiny ? ' shiny' : ''}${m.buddy ? ' buddy' : ''}${m.uid === selUid ? ' sel' : ''}${picked ? ' picked' : ''}`, type: 'button', title: `${label(m)} Nv. ${m.level}`,
          disabled: !!picking && !pickable(m),
          onclick: () => {
            if (picking) { if (picking.has(m.uid)) picking.delete(m.uid); else picking.add(m.uid); sfx('click'); render(); return; }
            selUid = m.uid; grid.querySelectorAll('.pc-slot.sel').forEach((n) => n.classList.remove('sel')); sfx('click'); drawSide(); grid.querySelector(`[data-uid="${m.uid}"]`)?.classList.add('sel'); }, 'data-uid': m.uid },
          h('img', { class: 'pixel', src: sprite(m.id, m.shiny), alt: '', loading: 'lazy' }),
          m.shiny ? h('span', { class: 'sl-shiny' }, '✨') : null,
          m.fav ? h('span', { class: 'sl-fav' }, '★') : null,
          m.buddy ? h('span', { class: 'sl-buddy' }, '🤝') : null,
          m.pending && m.pending.length ? h('span', { class: 'sl-new', title: 'Quiere aprender un movimiento' }, '🆕') : null,
          m.canEvo && m.canEvo.length ? h('span', { class: 'sl-evo', title: 'Puede evolucionar' }, '🌟') : null,
          m.pkrs ? h('span', { class: 'sl-pkrs', title: 'Pokérus' }, 'PKRS') : null,
          m.away ? h('span', { class: 'sl-away', title: awayText(m) }, awayIcon(m)) : null,
          h('span', { class: 'sr-only' }, `${label(m)} Nv. ${m.level}${m.away ? ' · ' + awayText(m) : ''}`));
      };
      const cells = slice.map(slot);
      while (cells.length < PER_BOX) cells.push(h('div', { class: 'pc-slot empty', 'aria-hidden': 'true' }));
      grid.replaceChildren(...cells);
      drawSide();
      drawPickBar();
    }
    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '🖥️ Caja PC'), counter, searchBtn, pickBtn, allBtn),
      chip, filters, pickBar,
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
