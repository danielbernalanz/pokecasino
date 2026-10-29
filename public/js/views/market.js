import { S, h, fmt, act, art as artwork, sfx, toast, bus, sprite, modal, typeBadge, TYPE_ES, rarityName, itemImg, itemName, RARITY_ORDER, confirmRisk } from '../core.js';

// Mercado estilo Albion Online: libro de órdenes por artículo (ventas y pedidos de compra).
let tab = 'browse';
const REGIONS = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Teselia', 'Kalos', 'Alola', 'Galar', 'Paldea'];
// Filtros por pestaña: se conservan al cambiar de pestaña durante la sesión.
const DEF = {
  browse: { q: '', cat: '', sub: '', rar: '', ench: '', gen: '', sets: '', min: '', max: '', side: '', sort: '' },
  sell: { q: '', cat: '', sub: '', rar: '', ench: '', gen: '', dup: '', bids: '', sort: '' },
  mine: { q: '', sort: '' },
  history: { q: '', side: 'mine', range: '' },
};
const F = Object.fromEntries(Object.entries(DEF).map(([k, v]) => [k, { ...v }]));
let panelOpen = false; // panel de filtros desplegado (móvil)
// Minúsculas y sin acentos, para buscar con tolerancia.
const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let state = null;

// ---- Artículos ----
const refOf = (a) => (a.kind === 'poke' ? `poke:${a.pokeId}:${a.shiny ? 1 : 0}` : a.kind === 'item' ? `item:${a.itemId}` : 'dust');
function parseRef(ref) {
  const [kind, x, y] = ref.split(':');
  if (kind === 'poke') return { kind, pokeId: Number(x), shiny: y === '1', ref };
  if (kind === 'item') return { kind, itemId: x, ref };
  return { kind: 'dust', ref: 'dust' };
}
const isCos = (a) => a.kind === 'item' && S.data.cosmetics[a.itemId];
function nameOf(a) {
  if (a.kind === 'poke') return S.dexById.get(a.pokeId).name + (a.shiny ? ' ✨' : '');
  if (a.kind === 'item') return itemName(a.itemId);
  return 'Polvo estelar';
}
function rarityOf(a) {
  if (a.kind === 'poke') return S.dexById.get(a.pokeId).rarity;
  if (isCos(a)) return S.data.cosmetics[a.itemId].rarity;
  return null;
}
function thumb(a, cls = 'mk-img') {
  if (a.kind === 'poke') return h('img', { class: 'pixel ' + cls, src: sprite(a.pokeId, a.shiny), alt: '' });
  if (a.kind === 'item') return itemImg(a.itemId, cls);
  return h('span', { class: cls + ' dust-big' }, '✦');
}
function owned(a) {
  const me = S.me;
  if (a.kind === 'poke') { const c = me.collection[a.pokeId]; return c ? (a.shiny ? c.s : c.n - c.s) : 0; }
  if (a.kind === 'item') return me.items[a.itemId] || 0;
  return me.dust;
}
function setsNeeding(a) {
  if (a.kind !== 'poke' || S.me.collection[a.pokeId]) return [];
  return S.me.progress.sets.filter((s) => !s.done && s.ids.includes(a.pokeId));
}

// ---- Libro de órdenes ----
function summary() {
  const by = new Map();
  for (const o of state.orders) {
    const r = by.get(o.ref) || { a: parseRef(o.ref), asks: [], bids: [] };
    (o.side === 'sell' ? r.asks : r.bids).push(o);
    by.set(o.ref, r);
  }
  for (const r of by.values()) {
    r.asks.sort((x, y) => x.price - y.price || x.createdAt - y.createdAt);
    r.bids.sort((x, y) => y.price - x.price || x.createdAt - y.createdAt);
  }
  return by;
}
// Etiqueta de los comerciantes NPC (sus órdenes y operaciones llevan `npc: true`).
const npcTag = (on) => (on ? h('span', { class: 'npc-tag', title: 'Comerciante NPC: compra y vende con límites diarios' }, 'NPC') : '');
const levels = (orders) => {
  const m = new Map();
  for (const o of orders) { const l = m.get(o.price) || [0, false]; l[0] += o.qty; l[1] ||= !!o.npc; m.set(o.price, l); }
  return [...m.entries()].map(([price, [qty, npc]]) => [price, qty, npc]);
};
// Recorre el libro para saber cuánto cuesta/rinde operar ya `qty` unidades.
function walk(orders, qty) {
  let left = qty;
  let total = 0;
  let worst = 0;
  let n = 0;
  for (const o of orders) {
    if (!left) break;
    if (o.username === S.me.username) continue;
    const q = Math.min(left, o.qty);
    total += q * o.price;
    worst = o.price;
    left -= q;
    n++;
  }
  return { filled: qty - left, total, worst, orders: n, avg: qty - left ? total / (qty - left) : 0 };
}
// Las tasas vienen con el estado del Mercado (cambian en el «Viernes de Mercado»).
const marketFee = () => (state && state.setupFee != null ? state.setupFee : S.data.marketFee);
const salesTax = () => (state && state.salesTax != null ? state.salesTax : S.data.salesTax);
const feeOf = (total) => Math.max(1, Math.ceil(total * marketFee()));
const taxOf = (total) => Math.floor(total * salesTax());

// ---- Gráfica de precios (SVG) ----
function chart(days) {
  if (!days.length) return h('div', { class: 'mk-chart empty muted small' }, 'Aún no hay ventas de este artículo.');
  const W = 420;
  const H = 120;
  const maxP = Math.max(...days.map((d) => d.max));
  const maxN = Math.max(...days.map((d) => d.n));
  const bw = W / Math.max(days.length, 7);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H + 20}`);
  svg.setAttribute('class', 'mk-chart');
  const el = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  let path = '';
  days.forEach((d, i) => {
    const x = i * bw + bw / 2;
    svg.append(el('rect', { x: i * bw + bw * 0.2, y: H - (d.n / maxN) * 40, width: bw * 0.6, height: (d.n / maxN) * 40, class: 'vol' }));
    svg.append(el('line', { x1: x, x2: x, y1: H - (d.max / maxP) * (H - 10), y2: H - (d.min / maxP) * (H - 10), class: 'range' }));
    const y = H - (d.avg / maxP) * (H - 10);
    path += `${i ? 'L' : 'M'}${x},${y}`;
    const t = el('circle', { cx: x, cy: y, r: 3, class: 'pt' });
    t.append(Object.assign(document.createElementNS(ns, 'title'), { textContent: `${d.day}: media ${d.avg} · ${d.n} uds` }));
    svg.append(t);
    if (i === 0 || i === days.length - 1) svg.append(Object.assign(el('text', { x, y: H + 15, class: 'lbl', 'text-anchor': 'middle' }), { textContent: d.day.slice(5) }));
  });
  svg.append(el('path', { d: path, class: 'line' }));
  return svg;
}

// ---- Utilidades de la interfaz ----
const MAXQ = { poke: 20, item: 999, dust: 1000000 };
const DURS = [1, 3, 7, 14];
let lastDays = 14; // la última duración elegida se recuerda durante la sesión
const isMine = (o) => o.username === S.me.username;
const others = (list) => list.filter((o) => !isMine(o));
const sumQty = (list) => list.reduce((s, o) => s + o.qty, 0);
const money = (n) => h('span', { class: 'mk-money' }, h('span', { class: 'coin-ico' }), fmt(n));
const pct = (x) => String(Math.round(x * 10000) / 100).replace('.', ',');
// Tiempo que le queda a una orden (las antiguas sin `expiresAt` caducan a los 14 días).
function expiryOf(o) { return o.expiresAt || o.createdAt + 14 * 86400000; }
function timeLeft(o) {
  const ms = expiryOf(o) - Date.now();
  if (ms <= 0) return 'Caducando…';
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  if (d >= 1) return `${d} d ${Math.floor((m % 1440) / 60)} h`;
  const hh = Math.floor(m / 60);
  return hh ? `${hh} h ${m % 60} min` : `${Math.max(1, m)} min`;
}
const urgent = (o) => expiryOf(o) - Date.now() < 86400000;
const kv = (label, value, cls = '') => h('div', { class: 'mk-kv ' + cls }, h('span', {}, label), h('b', {}, value));
const kindLabel = (a) => (a.kind === 'poke' ? (a.shiny ? 'Variocolor' : 'Pokémon') : a.kind === 'dust' ? 'Recurso' : isCos(a) ? 'Cosmético' : 'Objeto');
function tags(a) {
  const rar = rarityOf(a);
  return h('span', { class: 'mk-tags' }, rar ? h('span', { class: 'rar r-' + rar }, rarityName(rar)) : '', h('span', { class: 'mk-kind' + (a.shiny ? ' shiny' : '') }, kindLabel(a)));
}
// Quién está detrás de una orden: nombre bien visible (o «Tú») y etiqueta NPC si es un comerciante.
function who(o) {
  return h('span', { class: 'mk-who' }, h('span', { class: 'mk-who-ico', 'aria-hidden': 'true' }, o.npc ? '🏪' : isMine(o) ? '⭐' : '👤'),
    isMine(o) ? h('b', { class: 'mk-me' }, 'Tú') : o.npc ? npcLink(o.username) : h('b', {}, o.username), npcTag(o.npc),
    isFlash(o) ? h('span', { class: 'mk-flash', title: 'Oferta flash' }, '🔥 Oferta') : '');
}
// «vende Ana +2 más»: el jugador de la mejor orden y cuántos más hay a ese lado.
function byLine(orders, verb) {
  if (!orders || !orders.length) return '';
  const names = [...new Set(orders.map((o) => (isMine(o) ? 'Tú' : o.username)))];
  return h('span', { class: 'mk-by' }, `${verb} `, orders[0].npc && names[0] === orders[0].username ? npcLink(names[0]) : h('b', {}, names[0]), orders[0].npc ? npcTag(true) : '', names.length > 1 ? ` +${names.length - 1} más` : '');
}


// ---- Encargos, ofertas flash y fichas de los comerciantes NPC ----
const npcData = () => (state && state.npcs) || { encargos: [], flash: [], cards: [] };
const BONUS_TXT = { ticket: (n) => `🎟️ ${n}× Ticket Gacha`, egg: (n) => `🥚 ${n}× Huevo Misterioso`, frag: (n) => `💠 ${n} Megafragmentos` };
const isFlash = (o) => !!o.flash && o.flash > Date.now();
function countdown(ts) {
  const m = Math.floor((ts - Date.now()) / 60000);
  if (m < 0) return 'Caducando…';
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.max(1, m)} min`;
}
function npcLink(name) {
  return h('button', { class: 'mk-npc-link', type: 'button', title: `Ver la ficha de ${name}`, onclick: (e) => { e.stopPropagation(); npcCard(name); } }, name);
}
function encCard(e) {
  const a = parseRef(e.ref);
  const have = owned(a);
  const done = e.done.includes(S.me.username);
  return h('div', { class: 'mk-sp-card enc', 'data-enc': e.id },
    icon(a),
    h('div', { class: 'mk-sp-info' },
      h('b', { class: 'mk-name' }, nameOf(a)),
      h('span', { class: 'small muted' }, npcLink(e.npc), npcTag(true), ` · ⏳ ${countdown(e.expiresAt)}`),
      h('span', { class: 'mk-sp-rew small' }, 'Paga ', money(e.price), ` + ${fmt(e.premium)} de prima`, h('br', {}), h('b', { class: 'gold-text' }, '+ ' + BONUS_TXT[e.bonus.type](e.bonus.n)))),
    h('button', { class: 'btn small blue mk-enc-sell', type: 'button', disabled: done || !have, title: done ? 'Ya cumpliste este encargo' : have ? '' : 'No tienes este artículo',
      onclick: () => itemDialog(a, { side: 'sell', mode: 'now', orderId: e.orderId }) }, done ? '✔ Cumplido' : 'Vender'));
}
function flashCard(f) {
  const a = parseRef(f.ref);
  return h('div', { class: 'mk-sp-card flash', 'data-flash': f.id },
    icon(a),
    h('div', { class: 'mk-sp-info' },
      h('b', { class: 'mk-name' }, nameOf(a), h('span', { class: 'mk-flash' }, '🔥 Oferta')),
      h('span', { class: 'small muted' }, npcLink(f.npc), npcTag(true), ` · ⏳ ${countdown(f.until)}`),
      h('span', { class: 'mk-sp-rew small' }, money(f.price), ' ', h('s', { class: 'muted' }, fmt(f.normal)), ` · −${Math.round((1 - f.price / f.normal) * 100)} %`)),
    h('button', { class: 'btn small green mk-flash-buy', type: 'button', onclick: () => itemDialog(a, { side: 'buy', mode: 'now', orderId: f.orderId }) }, 'Comprar'));
}
// Franja de la parte superior de Comprar y Vender.
function specialStrip() {
  const el = h('section', { class: 'mk-special', 'aria-label': 'Encargos y ofertas' });
  const update = () => {
    const { encargos, flash } = npcData();
    el.hidden = !encargos.length && !flash.length;
    el.replaceChildren(
      encargos.length ? h('div', { class: 'mk-sp-block' }, h('h3', {}, '📜 Encargos'),
        h('p', { class: 'small muted' }, 'Pedidos especiales de los comerciantes: cobras el precio, una prima y un premio. Uno por encargo y 2 premios al día.'),
        h('div', { class: 'mk-sp-list' }, encargos.map(encCard))) : '',
      flash.length ? h('div', { class: 'mk-sp-block' }, h('h3', {}, '🔥 Ofertas flash'), h('div', { class: 'mk-sp-list' }, flash.map(flashCard))) : '');
  };
  update();
  return { el, update };
}
function npcCard(name) {
  const c = npcData().cards.find((x) => x.name === name);
  if (!c) return;
  const mine = state.orders.filter((o) => o.npc && o.username === name);
  const lines = (side) => {
    const os = mine.filter((o) => o.side === side).sort((x, y) => (side === 'buy' ? y.price - x.price : x.price - y.price)).slice(0, 6);
    return os.length ? h('ul', { class: 'mk-npc-list' }, os.map((o) => { const a = parseRef(o.ref); return h('li', {}, thumb(a), h('span', {}, nameOf(a), o.qty > 1 ? ` ×${fmt(o.qty)}` : '', isFlash(o) ? h('span', { class: 'mk-flash' }, '🔥') : ''), h('b', {}, money(o.price))); }))
      : h('p', { class: 'small muted' }, 'Ahora mismo no tiene órdenes de este tipo.');
  };
  const { encargos, flash } = npcData();
  const encs = encargos.filter((e) => e.npc === name);
  const fls = flash.filter((f) => f.npc === name);
  const body = h('div', { class: 'mk-npcard' },
    h('div', { class: 'mk-npc-head' }, h('img', { class: 'mk-npc-art', src: artwork(c.art), alt: '', width: 96, height: 96 }),
      h('div', {}, h('h3', {}, c.name, npcTag(true)), h('div', { class: 'small gold-text' }, c.title))),
    h('blockquote', { class: 'mk-npc-quote' }, `«${c.quote}»`),
    h('p', { class: 'small' }, c.bio),
    h('h4', {}, '📜 Encargos'), encs.length ? h('div', { class: 'mk-sp-list' }, encs.map(encCard)) : h('p', { class: 'small muted' }, 'Sin encargos ahora mismo. Suele publicar alguno cada día.'),
    fls.length ? [h('h4', {}, '🔥 Oferta flash'), h('div', { class: 'mk-sp-list' }, fls.map(flashCard))] : '',
    h('h4', {}, '🔵 Lo que busca'), h('p', { class: 'small muted' }, c.seeks), lines('buy'),
    h('h4', {}, '🟢 Lo que vende'), h('p', { class: 'small muted' }, c.sells), lines('sell'));
  modal(body, { title: 'Comerciante' });
}

// ---- Lados del libro: SE VENDE (verde, ofertas de venta) y SE COMPRA (azul, pedidos de compra) ----
const SELL_LBL = '🟢 Se vende (ofertas de venta)';
const BUY_LBL = '🔵 Se compra (pedidos de compra)';
// Precio medio: últimas 24 h si hay operaciones; si no, la media de 30 días.
function avgOf(ref) {
  const since = Date.now() - 86400000;
  const t = state.trades.filter((x) => x.ref === ref && x.at >= since);
  if (t.length) { const q = t.reduce((s, x) => s + x.qty, 0); return { v: Math.round(t.reduce((s, x) => s + x.qty * x.price, 0) / q), label: '24 h' }; }
  const st = state.stats[ref];
  return st && st.avg ? { v: st.avg, label: '30 d' } : null;
}
const tier = (a) => { const r = rarityOf(a); return r ? h('span', { class: 'mk-tier r-' + r, title: rarityName(r) }, r) : ''; };
function icon(a, cls = 'mk-img') {
  return h('span', { class: 'mk-ico' + (cls === 'mk-big' ? ' big' : '') }, thumb(a, cls), tier(a), a.shiny ? h('span', { class: 'mk-spark', title: 'Variocolor' }, '✨') : '');
}

// Cantidad: −/+ , número y deslizador.
function qtyField(max, init, onChange) {
  let mx = Math.max(1, max);
  const clamp = (v) => Math.max(1, Math.min(mx, Math.floor(Number(v)) || 1));
  const num = h('input', { type: 'number', class: 'mk-num', min: 1, max: mx, value: clamp(init), inputmode: 'numeric', 'aria-label': 'Cantidad' });
  const rng = h('input', { type: 'range', class: 'mk-range', min: 1, max: mx, value: clamp(init), 'aria-label': 'Cantidad (deslizador)' });
  const set = (v) => { num.value = clamp(v); rng.value = num.value; onChange(); };
  num.addEventListener('input', () => { rng.value = clamp(num.value); onChange(); });
  num.addEventListener('change', () => set(num.value));
  rng.addEventListener('input', () => { num.value = rng.value; onChange(); });
  const step = (d) => h('button', { class: 'chip mk-step', type: 'button', 'aria-label': d < 0 ? 'Menos' : 'Más', onclick: () => set(Number(num.value) + d) }, d < 0 ? '−' : '+');
  return {
    el: h('div', { class: 'mk-qty' }, h('div', { class: 'mk-stepper' }, step(-1), num, step(1)), rng, h('button', { class: 'chip', type: 'button', onclick: () => set(mx) }, 'Máx')),
    get value() { return clamp(num.value); },
    setMax(m) { mx = Math.max(1, m); num.max = mx; rng.max = mx; num.value = clamp(num.value); rng.value = num.value; },
  };
}

// ---- Diálogo único (como el de Albion): alterna entre operar ya y crear una orden ----
// o: { side: 'buy'|'sell', mode: 'now'|'order', orderId, chart }
function itemDialog(a, o = {}) {
  const sell = o.side === 'sell';
  let mode = o.mode || 'now';
  const orderId = o.orderId || null;
  const vals = { qty: 1, price: null, days: lastDays };
  const bookOf = () => summary().get(a.ref) || { asks: [], bids: [] };
  const nowList = () => {
    const r = bookOf();
    const list = others(sell ? r.bids : r.asks);
    if (!orderId) return list;
    const one = list.find((x) => x.id === orderId);
    return one ? [one] : [];
  };
  // Avisos de operaciones arriesgadas. Devuelve false si el jugador cancela.
  // price = precio unitario efectivo; qty = unidades; lock = monedas que quedarían apartadas (solo pedidos de compra).
  async function warnTrade({ price, qty, lock = 0, topBid = null }) {
    const av = avgOf(a.ref);
    const nm = nameOf(a);
    const dealing = `${fmt(qty)}× ${nm} a ${fmt(Math.round(price))} por unidad`;
    if (!sell && av && price >= 2 * av.v && !(await confirmRisk('market-overpay', {
      title: 'Estás pagando mucho más que el precio medio', danger: 'Comprar igualmente', safe: 'Cancelar',
      text: `Vas a comprar ${dealing}, pero el precio medio (${av.label}) es ${fmt(av.v)}: pagas ${(price / av.v).toFixed(1).replace('.', ',')} veces más.`,
      details: ['Prueba a crear un pedido de compra a un precio más bajo y espera a que alguien te venda.'] }))) return false;
    if (!sell && lock >= S.me.coins * 0.5 && !(await confirmRisk('market-lock', {
      title: 'Vas a apartar casi la mitad de tus monedas', danger: 'Crear el pedido', safe: 'Cancelar',
      text: `Este pedido aparta ${fmt(lock)} de tus ${fmt(S.me.coins)} monedas (${Math.round(lock / Math.max(1, S.me.coins) * 100)} %) hasta que se cumpla, caduque o lo canceles. Mientras tanto no podrás usarlas para jugar.`,
      details: ['La comisión de publicación no se devuelve.'] }))) return false;
    if (sell && av && price <= 0.5 * av.v && !(await confirmRisk('market-underprice', {
      title: 'Estás vendiendo muy por debajo del precio medio', danger: 'Vender igualmente', safe: 'Cancelar',
      text: `Vas a vender ${dealing}, pero el precio medio (${av.label}) es ${fmt(av.v)}: cobras menos de la mitad de lo habitual.` }))) return false;
    if (sell && topBid && price < topBid.price && !(await confirmRisk('market-underprice', {
      title: 'Hay un comprador que paga más', danger: 'Publicar igualmente', safe: 'Cancelar',
      text: `Tu precio (${fmt(price)}) está por debajo del mejor pedido de compra (${fmt(topBid.price)} por unidad). Podrías ganar más vendiendo al momento o subiendo el precio.` }))) return false;
    if (sell && a.kind === 'poke') {
      const c = S.me.collection[a.pokeId];
      const buddy = S.me.buddy && S.me.buddy.id === a.pokeId;
      const last = c && c.n - qty < 1;
      if ((a.shiny || last || (buddy && last)) && !(await confirmRisk('release-precious:market', {
        title: a.shiny ? 'Vas a vender un variocolor' : 'Vas a vender tu última copia', danger: 'Vender igualmente', safe: 'Conservarlo',
        text: `${a.shiny ? `${nm} es una versión variocolor, mucho más difícil de conseguir. ` : ''}${last ? `Te quedarías sin ningún ${S.dexById.get(a.pokeId).name} en la Pokédex. ` : ''}${buddy && last ? 'Además es tu compañero actual: perderías su bonus. ' : ''}Si te arrepientes, tendrás que volver a comprarlo.`.trim() }))) return false;
    }
    return true;
  }
  const head = h('div', { class: 'mk-dhead' });
  const toggle = h('div', { class: 'mk-toggle ' + (sell ? 'buyside' : 'sellside'), role: 'tablist' });
  const panelBox = h('div', { class: 'stack mk-mbody' });
  const confirm = h('button', { class: 'btn big mk-confirm ' + (sell ? 'blue' : 'green'), type: 'button' });
  const chartBox = h('div', { class: 'mk-chartbox' });
  const chartBtn = h('button', { class: 'btn small mk-chartlink', type: 'button', 'aria-expanded': 'false', onclick: () => toggleChart() }, '📈 Historial de precios');
  const m = modal(h('div', { class: 'stack mk-dlg' }, head, toggle, panelBox, confirm, h('div', {}, chartBtn, chartBox)), { title: sell ? 'Vender' : 'Comprar' });
  let panel = null;
  let hist = null;
  let range = 0;
  let chartOpen = false;

  const paintHead = () => {
    const p = a.kind === 'poke' ? S.dexById.get(a.pokeId) : null;
    const av = avgOf(a.ref);
    head.replaceChildren(icon(a, 'mk-big'), h('div', { class: 'grow' }, h('h2', { class: 'mk-dname' }, nameOf(a)), h('div', { class: 'row gap wrap' }, tags(a), ...(p ? p.types.map(typeBadge) : [])),
      h('div', { class: 'small muted' }, `Precio medio ${av ? av.label : '24 h'}: `, av ? money(av.v) : '—', ` · Tienes ${fmt(owned(a))}`),
      ...setsNeeding(a).slice(0, 1).map((s) => h('div', { class: 'small gold-text' }, `📚 Te sirve para «${s.name}»`))));
  };
  const modes = sell
    ? [['now', 'Vender ya', 'Vende al momento a los pedidos de compra'], ['order', 'Poner en venta', 'Publica una orden de venta a tu precio']]
    : [['now', 'Comprar ya', 'Compra al momento a las ofertas de venta'], ['order', 'Pedir a un precio', 'Publica un pedido de compra a tu precio']];
  const paintToggle = () => {
    const none = !nowList().length;
    toggle.replaceChildren(...modes.map(([k, l, tip]) => h('button', { class: 'mk-mode' + (mode === k ? ' active' : ''), 'data-mode': k, type: 'button', role: 'tab', 'aria-selected': String(mode === k), title: tip, disabled: k === 'now' && none && mode !== 'now', onclick: () => { mode = k; build(); } }, l)));
  };
  const toggleChart = async () => {
    chartOpen = !chartOpen;
    chartBtn.setAttribute('aria-expanded', String(chartOpen));
    if (!chartOpen) { chartBox.replaceChildren(); return; }
    if (!hist) { hist = await act('market:history', a); if (!hist) { chartOpen = false; return; } }
    const paint = () => {
      const days = range ? hist.days.slice(-range) : hist.days;
      chartBox.replaceChildren(h('div', { class: 'seg mk-filt' }, ...[[0, 'Todo'], [7, '7 días'], [14, '14 días']].map(([v, l]) => h('button', { class: 'chip' + (range === v ? ' active' : ''), type: 'button', onclick: () => { range = v; paint(); } }, l))), chart(days));
    };
    paint();
  };

  // Modo «ya»: operar al momento con las órdenes del otro lado.
  function nowPanel() {
    const have = owned(a);
    const cap = () => Math.min(sumQty(nowList()), sell ? have : Infinity, MAXQ[a.kind]);
    const info = h('div', { class: 'mk-sum ' + (sell ? 'buyside' : 'sellside') });
    const q = qtyField(cap(), vals.qty, upd);
    const say = h('p', { class: 'mk-say small' }, sell ? 'Se vende ahora al pedido de compra más alto, hasta agotar la cantidad.' : 'Se compra ahora a la oferta más barata, hasta completar la cantidad.');
    const el = h('div', { class: 'stack' }, say, h('label', {}, 'Cantidad', q.el), info);
    function upd() {
      const list = nowList();
      q.setMax(cap());
      vals.qty = q.value;
      confirm.textContent = sell ? 'Vender' : 'Comprar';
      if (!list.length || (sell && !have)) {
        info.replaceChildren(h('div', { class: 'muted small' }, sell ? (have ? 'Nadie ha publicado pedidos de compra ahora mismo.' : 'No tienes este artículo.') : 'Nadie vende este artículo ahora mismo.'));
        confirm.disabled = true;
        return;
      }
      const w = walk(list, q.value);
      if (sell) {
        const tax = taxOf(w.total);
        info.replaceChildren(kv('Mejor pedido', money(list[0].price)), kv('Pedidos que se llenarán', fmt(w.orders)), kv('Precio medio de la venta', money(Math.round(w.avg))),
          kv('Total bruto', money(w.total)), kv(`Impuesto de venta (${pct(salesTax())} %)`, '− ' + fmt(tax)), kv('Recibirás', money(w.total - tax), 'strong'), kv('Monedas después', money(S.me.coins + w.total - tax)));
        confirm.disabled = !w.filled;
      } else {
        const after = S.me.coins - w.total;
        info.replaceChildren(kv('Precio más bajo', money(list[0].price)), kv('Órdenes que se tomarán', fmt(w.orders)), kv('Precio medio de la compra', money(Math.round(w.avg))),
          kv('Total', money(w.total), 'strong'), kv('Monedas después', after >= 0 ? money(after) : 'No te llegan', after >= 0 ? '' : 'bad'));
        confirm.disabled = after < 0 || !w.filled;
      }
    }
    return {
      el, upd,
      async run(e) {
        const w = walk(nowList(), q.value);
        if (w.filled && !(await warnTrade({ price: w.avg, qty: w.filled }))) return false;
        const res = await act(sell ? 'market:sell' : 'market:buy', { ...a, qty: w.filled, price: w.worst, instant: true, ...(orderId ? { orderId } : {}) }, e.target);
        if (!res) return false;
        sfx('win');
        toast(sell ? `Vendiste ${fmt(res.filled)}: recibes ${fmt(res.earned - taxOf(res.earned))} monedas` : `Compraste ${fmt(res.filled)} por ${fmt(res.spent)} monedas`, 'success');
        return true;
      },
    };
  }

  // Modo «orden»: precio, cantidad y duración.
  function orderPanel() {
    const have = owned(a);
    const ctx = () => { const r = bookOf(); return { lowAsk: others(r.asks)[0], topBid: others(r.bids)[0], av: avgOf(a.ref) }; };
    const startPrice = () => {
      const { lowAsk, topBid, av } = ctx();
      const avg = av && av.v;
      return sell ? (lowAsk ? Math.max(1, lowAsk.price - 1) : avg || (topBid ? topBid.price + 1 : 100)) : (topBid ? topBid.price + 1 : avg || (lowAsk ? Math.max(1, lowAsk.price - 1) : 100));
    };
    if (vals.price == null) vals.price = startPrice();
    const cap = () => (sell ? Math.min(have, MAXQ[a.kind]) : MAXQ[a.kind]);
    const price = h('input', { type: 'number', class: 'mk-num mk-price-in', min: 1, inputmode: 'numeric', value: vals.price, 'aria-label': 'Precio por unidad' });
    const setPrice = (v) => { price.value = Math.max(1, Math.round(v)); upd(); };
    const stepP = (d) => h('button', { class: 'chip mk-step', type: 'button', 'aria-label': d < 0 ? 'Bajar precio' : 'Subir precio', onclick: () => setPrice((Number(price.value) || 0) + d) }, d < 0 ? '−' : '+');
    const chips = h('div', { class: 'seg mk-quick' });
    const mkt = h('div', { class: 'small muted' });
    const days = h('select', { class: 'mk-days', 'aria-label': 'Duración' }, DURS.map((d) => h('option', { value: d }, `${d} ${d === 1 ? 'día' : 'días'}`)));
    days.value = String(vals.days);
    days.onchange = () => { vals.days = Number(days.value); lastDays = vals.days; upd(); };
    const q = qtyField(cap(), vals.qty, upd);
    const info = h('div', { class: 'mk-sum ' + (sell ? 'sellside' : 'buyside') });
    const note = h('div', { class: 'small muted' });
    const say = h('p', { class: 'mk-say small' }, sell
      ? 'Tu orden queda publicada a tu precio hasta que alguien te compre. El artículo queda en depósito; lo no vendido se te devuelve.'
      : 'Tu pedido espera hasta que alguien te venda a ese precio; las monedas quedan apartadas y se te devuelven si cancelas o caduca.');
    price.oninput = upd;
    const el = h('div', { class: 'stack' }, say, mkt,
      h('label', {}, 'Precio por unidad', h('div', { class: 'mk-priceRow' }, h('span', { class: 'coin-ico' }), stepP(-1), price, stepP(1))), chips,
      h('label', {}, 'Cantidad', q.el), h('label', {}, 'Duración', days), info, note);
    function upd() {
      const { lowAsk, topBid, av } = ctx();
      const avg = av && av.v;
      const quick = (label, v) => h('button', { class: 'chip', type: 'button', disabled: v == null, onclick: () => setPrice(v) }, label);
      chips.replaceChildren(...(sell
        ? [quick('Igualar', lowAsk && lowAsk.price), quick('−1', lowAsk && lowAsk.price - 1), quick('Precio medio', avg || null)]
        : [quick('Igualar', topBid && topBid.price), quick('+1', topBid && topBid.price + 1), quick('Precio medio', avg || null)]));
      mkt.replaceChildren('Se vende desde ', h('b', { class: 'c-sell' }, lowAsk ? fmt(lowAsk.price) : '—'), ' · Se compra hasta ', h('b', { class: 'c-buy' }, topBid ? fmt(topBid.price) : '—'), ` · Medio ${av ? av.label : '24 h'}: ${avg ? fmt(avg) : '—'}`);
      q.setMax(cap());
      vals.qty = q.value;
      const p = Math.max(0, Math.floor(Number(price.value)) || 0);
      vals.price = p || vals.price;
      const total = q.value * p;
      const fee = feeOf(total);
      confirm.textContent = sell ? 'Crear orden de venta' : 'Crear orden de compra';
      const lines = [kv('Precio unitario', money(p)), kv('Cantidad', fmt(q.value)), kv(`Comisión de publicación (${pct(marketFee())} %)`, money(fee))];
      if (sell) {
        const tax = taxOf(total);
        lines.push(kv(`Impuesto de venta (${pct(salesTax())} %)`, money(tax)), kv('Recibirás', money(total - tax), 'strong'), kv('Monedas después de publicar', S.me.coins - fee >= 0 ? money(S.me.coins - fee) : 'No te llegan', S.me.coins - fee >= 0 ? '' : 'bad'));
        confirm.disabled = !p || !have || S.me.coins < fee;
        note.textContent = have ? `El impuesto se cobra al venderse. Caduca en ${days.value} ${Number(days.value) === 1 ? 'día' : 'días'}.` : 'No tienes este artículo.';
        if (have && topBid && p && p <= topBid.price) note.textContent += ' Con ese precio parte se venderá al momento a pedidos ya publicados.';
      } else {
        const cost = total + fee;
        lines.push(kv('Total', money(cost), 'strong'), kv('Monedas después', S.me.coins - cost >= 0 ? money(S.me.coins - cost) : 'No te llegan', S.me.coins - cost >= 0 ? '' : 'bad'));
        confirm.disabled = !p || S.me.coins < cost;
        note.textContent = `Total = monedas apartadas (${fmt(total)}) + comisión (no se devuelve). Caduca en ${days.value} ${Number(days.value) === 1 ? 'día' : 'días'}.`;
        if (lowAsk && p && p >= lowAsk.price) note.textContent += ' Con ese precio parte se comprará al momento a ofertas ya publicadas.';
      }
      info.replaceChildren(...lines);
    }
    return {
      el, upd,
      async run(e) {
        const p = Math.floor(Number(price.value)) || 0;
        const { topBid } = ctx();
        if (p && !(await warnTrade({ price: p, qty: q.value, lock: sell ? 0 : q.value * p + feeOf(q.value * p), topBid }))) return false;
        const res = await act(sell ? 'market:sell' : 'market:buy', { ...a, qty: q.value, price: Math.floor(Number(price.value)), days: vals.days }, e.target);
        if (!res) return false;
        sfx('click');
        const f = res.filled ? ` (ya se ${sell ? 'vendieron' : 'compraron'} ${fmt(res.filled)})` : '';
        toast(res.order ? `${sell ? 'Orden de venta' : 'Pedido de compra'} publicado${f}` : `${sell ? 'Vendiste' : 'Compraste'} ${fmt(res.filled)} al momento`, 'success');
        return true;
      },
    };
  }

  function build() {
    paintHead();
    paintToggle();
    panel = mode === 'now' ? nowPanel() : orderPanel();
    panelBox.replaceChildren(panel.el);
    panel.upd();
  }
  confirm.onclick = async (e) => { if (panel && await panel.run(e)) m.close(); };
  if (mode === 'now' && !nowList().length) mode = 'order';
  build();
  if (o.chart) toggleChart();
  const refresh = () => { if (!document.contains(m.el)) { offs.forEach((f) => f()); return; } paintHead(); paintToggle(); panel.upd(); };
  const offs = [bus.on('market', refresh), bus.on('me', refresh)];
}

// ---- Filas de artículo (acordeón) ----
const openRows = { buy: new Set(), sell: new Set() };
// Lista de órdenes individuales. action 'buy' = botón Comprar (oferta de venta); 'sell' = botón Vender a ese pedido.
function orderList(a, orders, action) {
  if (!orders.length) return h('div', { class: 'muted small mk-none' }, action === 'buy' ? 'Nadie vende este artículo ahora mismo.' : 'Nadie ha publicado pedidos de compra.');
  const have = owned(a);
  return h('div', { class: 'mk-olist ' + (action === 'buy' ? 'sellside' : 'buyside') },
    h('div', { class: 'mk-ohead small muted' }, h('span', {}, action === 'buy' ? 'Vendedor' : 'Comprador'), h('span', {}, 'Cant.'), h('span', {}, 'Precio/ud'), h('span', {}, 'Caduca'), h('span', {})),
    ...orders.slice(0, 25).map((o) => h('div', { class: 'mk-ord' + (isMine(o) ? ' mine' : ''), 'data-order': o.id },
      who(o), h('span', {}, '×' + fmt(o.qty)), h('span', { class: 'mk-price' }, h('span', { class: 'coin-ico' }), fmt(o.price)), h('span', { class: 'small muted' }, timeLeft(o)),
      isMine(o) ? h('span', { class: 'small muted' }, 'Tu orden')
        : action === 'buy' ? h('button', { class: 'btn small green mk-order-buy', type: 'button', onclick: () => itemDialog(a, { side: 'buy', mode: 'now', orderId: o.id }) }, 'Comprar')
          : h('button', { class: 'btn small blue mk-order-sell', type: 'button', disabled: !have, title: have ? '' : 'No tienes este artículo', onclick: () => itemDialog(a, { side: 'sell', mode: 'now', orderId: o.id }) }, 'Vender'))),
    orders.length > 25 ? h('div', { class: 'small muted' }, `… y ${orders.length - 25} órdenes más`) : '');
}
// Los dos lados del libro, bien separados: izquierda se vende (verde), derecha se compra (azul).
function bookView(a, r) {
  const ask = r.asks[0];
  const bid = r.bids[0];
  return h('div', { class: 'mk-book' },
    h('div', { class: 'mk-side sellside' }, h('h4', {}, SELL_LBL), h('p', { class: 'small muted' }, 'Compra al momento al precio de la oferta (la más barata primero).'), orderList(a, r.asks, 'buy')),
    h('div', { class: 'mk-side buyside' }, h('h4', {}, BUY_LBL), h('p', { class: 'small muted' }, 'Vende al momento al precio del pedido (el más alto primero).'), orderList(a, r.bids, 'sell')),
    h('div', { class: 'mk-spread small' }, ask && bid ? ['Diferencia: ', money(ask.price - bid.price)] : 'Diferencia: — (falta alguno de los dos lados)'));
}
// mode: 'buy' (pestaña Comprar) | 'sell' (pestaña Vender). `have` = unidades que tienes (modo sell).
function itemRow(a, r, mode, have) {
  r ||= { asks: [], bids: [] };
  const ref = a.ref;
  const open = openRows[mode].has(ref);
  const rar = rarityOf(a);
  const lowAsk = r.asks[0];
  const topBid = r.bids[0];
  const av = avgOf(ref);
  const price = (o, cls, list, verb) => (o ? h('span', { class: 'mk-pricebox' }, h('b', { class: 'mk-price ' + cls }, h('span', { class: 'coin-ico' }), fmt(o.price)), byLine(list, verb)) : h('b', { class: 'muted' }, '—'));
  const col = (label, value, cls = '') => h('div', { class: 'mk-col ' + cls }, h('span', { class: 'mk-collbl' }, label), value);
  const sets = setsNeeding(a)[0];
  const el = h('div', { class: 'mk-item' + (open ? ' open' : '') + (rar ? ' r-' + rar : '') + (a.shiny ? ' shiny' : ''), 'data-ref': ref });
  const detail = h('div', { class: 'mk-orders' });
  const fill = () => {
    const rr = summary().get(ref) || { asks: [], bids: [] };
    detail.replaceChildren(bookView(a, rr), h('button', { class: 'btn small mk-chartlink', type: 'button', onclick: () => itemDialog(a, { side: mode, mode: 'now', chart: true }) }, '📈 Historial de precios'));
  };
  const expand = h('button', { class: 'mk-expand', type: 'button', 'aria-expanded': String(open), 'aria-label': `Ver órdenes de ${nameOf(a)}`, onclick: () => {
    const now = !openRows[mode].has(ref);
    openRows[mode][now ? 'add' : 'delete'](ref);
    el.classList.toggle('open', now);
    expand.setAttribute('aria-expanded', String(now));
    if (now) { fill(); el.append(detail); } else detail.remove();
  } },
  h('span', { class: 'mk-chev', 'aria-hidden': 'true' }, '▸'), icon(a),
  h('div', { class: 'mk-info' }, h('b', { class: 'mk-name' }, nameOf(a)), tags(a),
    lowAsk && isFlash(lowAsk) ? h('div', { class: 'small' }, h('span', { class: 'mk-flash' }, '🔥 Oferta'), ` termina en ${countdown(lowAsk.flash)}`) : '',
    av ? h('div', { class: 'small muted' }, `Precio medio ${av.label}: `, money(av.v)) : '', sets ? h('div', { class: 'small gold-text' }, `📚 Para «${sets.name}»`) : ''));
  const qty = mode === 'buy' ? col('Cantidad', h('b', {}, lowAsk ? fmt(sumQty(r.asks)) : '—')) : col('Cantidad', h('b', {}, fmt(have)));
  const cols = [qty,
    col('Se vende desde', price(lowAsk, 'c-sell', r.asks, 'vende'), 'sellcol' + (mode === 'buy' ? ' hl' : '')),
    col('Se compra hasta', price(topBid, 'c-buy', r.bids, 'compra'), 'buycol' + (mode === 'sell' ? ' hl' : ''))];
  const btn = mode === 'buy'
    ? h('button', { class: 'btn green mk-buy-now', type: 'button', onclick: () => itemDialog(a, { side: 'buy' }) }, 'Comprar')
    : h('button', { class: 'btn blue mk-sell-now', type: 'button', onclick: () => itemDialog(a, { side: 'sell' }) }, 'Vender');
  el.append(h('div', { class: 'mk-line' }, expand, h('div', { class: 'mk-cols' }, cols), h('div', { class: 'mk-btns' }, btn)));
  if (open) { fill(); el.append(detail); }
  return el;
}

// ---- Ficha del artículo (la usan Pokédex, Tienda y Completadas) ----
export async function openItem(a, side = 'buy') {
  a = { ...a, ref: refOf(a) };
  if (!state) { const s = await act('market:state'); if (!s) return; state = s; }
  itemDialog(a, { side: side === 'sell' ? 'sell' : 'buy' });
}

// ---- Vista principal ----
const TABS = [['browse', '🛒', 'Comprar'], ['sell', '💰', 'Vender'], ['mine', '📋', 'Órdenes'], ['history', '✅', 'Completadas']];
function helpBox() {
  let open = !matchMedia('(max-width: 640px)').matches; // en móvil empieza plegada
  try { const v = localStorage.getItem('mk:help'); if (v) open = v === '1'; } catch { /* sin almacenamiento */ }
  const d = h('details', { class: 'mk-help' }, h('summary', {}, '¿Cómo funciona el Mercado?'),
    h('ul', {},
      h('li', {}, h('span', { class: 'c-sell' }, '🟢 Se vende: '), 'ofertas de otros jugadores. Pagas ese precio: «Comprar ya» al momento o «Pedir a un precio» y esperas.'),
      h('li', {}, h('span', { class: 'c-buy' }, '🔵 Se compra: '), 'pedidos de otros jugadores. Recibes ese precio: «Vender ya» al momento o «Poner en venta» a tu precio.'),
      h('li', {}, h('b', {}, 'Costes: '), 'comisión de publicación 1,5 % al crear una orden (no se devuelve) e impuesto de venta 3 % a quien vende. Al momento no hay comisión.'),
      h('li', {}, h('b', {}, 'Caducidad: '), 'eliges 1, 3, 7 o 14 días; si caduca o la cancelas, se te devuelve lo depositado.')));
  if (open) d.open = true;
  d.addEventListener('toggle', () => { try { localStorage.setItem('mk:help', d.open ? '1' : '0'); } catch { /* nada */ } });
  return d;
}
export default {
  id: 'market', title: 'Mercado', icon: '🏪',
  async mount(root) {
    if (S.marketQuery) { F.browse = { ...DEF.browse, q: S.marketQuery }; tab = 'browse'; S.marketQuery = null; }
    const tabs = h('div', { class: 'tabs mk-tabs', role: 'tablist' });
    const body = h('div', { class: 'mk-main' });

    function go(k) { tab = k; renderTabs(); render(); }
    function renderTabs() {
      tabs.replaceChildren(...TABS.map(([k, ico, l]) =>
        h('button', { class: 'tab' + (tab === k ? ' active' : ''), 'data-tab': k, role: 'tab', 'aria-selected': String(tab === k), onclick: () => go(k) }, h('span', { class: 'tab-ico', 'aria-hidden': 'true' }, ico), h('span', { class: 'tab-lbl' }, l))));
    }

    // ---- Fila de filtros estilo Albion (plegable en móvil) ----
    // defs: [{ k, t: 'sel'|'num'|'chk'|'seg', ph, opts (o función), main, sort, rebuild, dis }]. Devuelve { el, reset, active }.
    function filterBar(st, def, defs, ph, onChange) {
      const el = h('div', { class: 'mkf' });
      const activeN = () => defs.filter((d) => !d.sort && String(st[d.k]) !== String(def[d.k])).length;
      const sortN = () => defs.filter((d) => d.sort && st[d.k] !== def[d.k]).length;
      let timer = null;
      const later = () => { clearTimeout(timer); timer = setTimeout(onChange, 150); };
      function reset() { Object.assign(st, def); build(); onChange(); }
      function build() {
        const toggle = h('button', { class: 'btn small mkf-toggle', type: 'button', 'aria-expanded': String(panelOpen), onclick: () => { panelOpen = !panelOpen; el.classList.toggle('open', panelOpen); toggle.setAttribute('aria-expanded', String(panelOpen)); } });
        const clear = h('button', { class: 'btn small mkf-reset', type: 'button', title: 'Restablecer filtros', 'aria-label': 'Restablecer filtros', onclick: reset }, '↺');
        const hasMore = defs.some((d) => !d.main);
        const sync = () => { toggle.textContent = hasMore ? `⚙ Más filtros (${activeN() + sortN()})` : `⚙ Filtros (${activeN()})`; clear.classList.toggle('dim', !activeN() && !st.q && !sortN()); };
        const q = h('input', { type: 'search', class: 'mkf-q', placeholder: ph, 'aria-label': 'Buscar artículo', autocomplete: 'off', oninput: (e) => { st.q = e.target.value; sync(); later(); } });
        q.value = st.q;
        const lab = (d, c) => h('label', { class: 'mkf-f' }, h('span', {}, d.ph), c);
        const ctrl = (d) => {
          if (d.t === 'sel') {
            const opts = typeof d.opts === 'function' ? d.opts() : d.opts;
            const s = h('select', { 'aria-label': d.ph, disabled: !!(d.dis && d.dis()), onchange: (e) => { st[d.k] = e.target.value; if (d.onset) d.onset(); sync(); if (d.rebuild) build(); onChange(); } }, opts.map(([v, l]) => h('option', { value: v }, l)));
            s.value = st[d.k];
            return lab(d, s);
          }
          if (d.t === 'num') {
            const i = h('input', { type: 'number', min: 0, inputmode: 'numeric', class: 'mkf-num', placeholder: '—', 'aria-label': d.ph, oninput: (e) => { st[d.k] = e.target.value; sync(); later(); } });
            i.value = st[d.k];
            return lab(d, i);
          }
          if (d.t === 'chk') {
            const b = h('button', { class: 'chip mkf-chk' + (st[d.k] ? ' active' : ''), type: 'button', onclick: () => { st[d.k] = st[d.k] ? '' : '1'; b.classList.toggle('active', !!st[d.k]); sync(); onChange(); } }, d.ph);
            return b;
          }
          const wrap = h('div', { class: 'seg mkf-seg' });
          const paint = () => wrap.replaceChildren(...d.opts.map(([v, l]) => h('button', { class: 'chip' + (st[d.k] === v ? ' active' : ''), type: 'button', onclick: () => { st[d.k] = st[d.k] === v ? '' : v; paint(); sync(); onChange(); } }, l)));
          paint();
          return h('div', { class: 'mkf-f wide' }, h('span', {}, d.ph), wrap);
        };
        const mainD = defs.filter((d) => d.main);
        const moreD = defs.filter((d) => !d.main);
        el.className = 'mkf' + (panelOpen ? ' open' : '') + (hasMore ? ' has-more' : '');
        el.replaceChildren(
          h('div', { class: 'mkf-row' }, q, toggle, h('div', { class: 'mkf-sels' }, mainD.map(ctrl)), clear),
          moreD.length ? h('div', { class: 'mkf-more' }, moreD.map(ctrl)) : '');
        sync();
      }
      build();
      return { el, reset, active: () => activeN() + (st.q ? 1 : 0) + sortN() };
    }

    function paintList(list, count, items, mk, fb, emptyMsg, limit = 120) {
      const n = items.length;
      count.textContent = `${fmt(n)} resultado${n === 1 ? '' : 's'}${n > limit ? ` · mostrando ${limit}` : ''}`;
      list.replaceChildren(...(n ? items.slice(0, limit).map(mk) : [h('div', { class: 'mkf-empty' },
        h('div', { class: 'mkf-empty-ico' }, '🔍'), h('p', { class: 'muted' }, emptyMsg),
        fb.active() ? h('button', { class: 'btn small', onclick: fb.reset }, 'Limpiar filtros') : '')]));
    }
    const catOf = (a) => (a.kind === 'poke' ? 'poke' : a.kind === 'dust' ? 'dust' : isCos(a) ? 'cosmetic' : 'item');
    const CATS = [['', 'Todo'], ['poke', 'Pokémon'], ['item', 'Objetos'], ['cosmetic', 'Cosméticos'], ['dust', 'Polvo estelar']];
    const SUBS = {
      poke: () => [['', 'Todos los tipos'], ...S.data.types.map((t) => [t, TYPE_ES[t]])],
      cosmetic: () => [['', 'Todos'], ['frame', 'Marco'], ['cardback', 'Dorso'], ['title', 'Título']],
      item: () => [['', 'Todos'], ['consumable', 'Consumibles'], ['special', 'Especiales']],
    };
    const RARS = [['', 'Todos'], ...[...RARITY_ORDER].reverse().map((r) => [r, `${r} · ${rarityName(r)}`])];
    const ENCH = [['', 'Todos'], ['normal', 'Normal'], ['shiny', 'Variocolor ✨']];
    function passItem(a, st) {
      if (st.sets && !setsNeeding(a).length) return false;
      if (st.cat && catOf(a) !== st.cat) return false;
      if (st.sub) {
        if (st.cat === 'poke') { if (!S.dexById.get(a.pokeId).types.includes(st.sub)) return false; }
        else if (st.cat === 'cosmetic') { if (S.data.items[a.itemId].slot !== st.sub) return false; }
        else if (st.cat === 'item') { if ((S.data.items[a.itemId].price != null) !== (st.sub === 'consumable')) return false; }
      }
      if (st.rar && rarityOf(a) !== st.rar) return false;
      if (st.ench === 'shiny' && !a.shiny) return false;
      if (st.ench === 'normal' && a.shiny) return false;
      if (st.gen) { if (a.kind !== 'poke' || S.dexById.get(a.pokeId).gen !== Number(st.gen)) return false; }
      return true;
    }
    // Filtros comunes de Comprar y Vender (fila principal estilo Albion).
    const albionDefs = (st) => [
      { k: 'cat', t: 'sel', main: true, ph: 'Categoría', opts: CATS, rebuild: true, onset: () => { st.sub = ''; } },
      { k: 'sub', t: 'sel', main: true, ph: 'Subcategoría', opts: () => (SUBS[st.cat] ? SUBS[st.cat]() : [['', 'Todas']]), dis: () => !SUBS[st.cat] },
      { k: 'rar', t: 'sel', main: true, ph: 'Nivel', opts: RARS },
      { k: 'ench', t: 'sel', main: true, ph: 'Encantamiento', opts: ENCH },
      { k: 'gen', t: 'sel', main: true, ph: 'Región', opts: [['', 'Todas'], ...REGIONS.map((r, i) => [String(i + 1), `${r} (gen. ${i + 1})`])] },
    ];
    const matchQ = (a, q) => !q || norm(nameOf(a)).includes(q);
    const byName = (x, y) => nameOf(x).localeCompare(nameOf(y), 'es');
    const rarIdx = (a) => RARITY_ORDER.indexOf(rarityOf(a) || 'C');

    function catalog(q) {
      const out = [];
      for (const p of S.data.dex) if (norm(p.name).includes(q)) out.push({ kind: 'poke', pokeId: p.id, shiny: false }, { kind: 'poke', pokeId: p.id, shiny: true });
      for (const id of Object.keys(S.data.items)) if (norm(itemName(id)).includes(q)) out.push({ kind: 'item', itemId: id });
      if ('polvo estelar'.includes(q)) out.push({ kind: 'dust' });
      return out.map((a) => ({ ...a, ref: refOf(a) }));
    }
    const thead = (mode) => h('div', { class: 'mk-thead small muted' }, h('span', {}, 'Artículo'), h('span', {}, mode === 'buy' ? 'Cantidad' : 'Cantidad'),
      h('span', { class: 'c-sell' }, '🟢 Se vende desde'), h('span', { class: 'c-buy' }, '🔵 Se compra hasta'), h('span', {}));

    function browse() {
      const st = F.browse;
      const list = h('div', { class: 'mk-list' });
      const count = h('div', { class: 'small muted mkf-count' });
      function draw() {
        const sum = summary();
        const q = norm(st.q.trim());
        let refs = [...sum.values()].map((r) => r.a);
        if (q.length >= 2) {
          const seen = new Set(refs.map((a) => a.ref));
          for (const a of catalog(q)) if (!seen.has(a.ref)) refs.push(a);
        }
        const min = st.min === '' ? null : Number(st.min);
        const max = st.max === '' ? null : Number(st.max);
        const ask = (a) => { const r = sum.get(a.ref); return r && r.asks[0] ? r.asks[0].price : null; };
        refs = refs.filter((a) => {
          if (q && !matchQ(a, q)) return false;
          if (!passItem(a, st)) return false;
          const r = sum.get(a.ref);
          if (st.side === 'asks' && !(r && r.asks.length)) return false;
          if (st.side === 'bids' && !(r && r.bids.length)) return false;
          if (min != null || max != null) {
            const p = ask(a);
            if (p == null || (min != null && p < min) || (max != null && p > max)) return false;
          }
          return true;
        });
        const qty = (a, side) => { const r = sum.get(a.ref); return r ? sumQty(r[side]) : 0; };
        const cmp = {
          cheap: (x, y) => (ask(x) ?? Infinity) - (ask(y) ?? Infinity),
          exp: (x, y) => (ask(y) ?? -1) - (ask(x) ?? -1),
          offers: (x, y) => qty(y, 'asks') - qty(x, 'asks'),
          sold: (x, y) => ((state.stats[y.ref] || {}).n || 0) - ((state.stats[x.ref] || {}).n || 0),
          name: byName,
        }[st.sort];
        refs.sort((x, y) => (cmp && cmp(x, y)) || ((sum.has(y.ref) && sum.get(y.ref).asks.length > 0) - (sum.has(x.ref) && sum.get(x.ref).asks.length > 0)) || rarIdx(x) - rarIdx(y) || byName(x, y));
        paintList(list, count, refs, (a) => itemRow(a, sum.get(a.ref), 'buy'), fb,
          q || fb.active() ? 'Nada coincide con tu búsqueda. Prueba con otro nombre o quita algún filtro.' : 'El mercado está vacío. Busca cualquier Pokémon u objeto para pedirlo a un precio, o vende algo desde «Vender».');
      }
      const fb = filterBar(st, DEF.browse, [
        ...albionDefs(st),
        { k: 'sets', t: 'chk', ph: '📚 Para mis colecciones' },
        { k: 'min', t: 'num', ph: 'Precio mín.' },
        { k: 'max', t: 'num', ph: 'Precio máx.' },
        { k: 'side', t: 'sel', ph: 'Órdenes', opts: [['', 'Con o sin órdenes'], ['asks', 'Solo con ofertas de venta'], ['bids', 'Solo con pedidos de compra']] },
        { k: 'sort', t: 'sel', sort: true, ph: 'Ordenar', opts: [['', 'Relevancia'], ['cheap', 'Más barato'], ['exp', 'Más caro'], ['offers', 'Más ofertas'], ['sold', 'Más vendidos (30 días)'], ['name', 'Nombre']] },
      ], 'Buscar artículo', draw);
      draw();
      const strip = specialStrip();
      return {
        redraw: () => { draw(); strip.update(); }, strip,
        el: h('div', { class: 'stack' }, strip.el, fb.el, count, thead('buy'), list),
      };
    }

    function sellTab() {
      const st = F.sell;
      const list = h('div', { class: 'mk-list' });
      const count = h('div', { class: 'small muted mkf-count' });
      function draw() {
        const sum = summary();
        const q = norm(st.q.trim());
        let goods = [];
        for (const [id, c] of Object.entries(S.me.collection)) {
          if (c.n - c.s > 0) goods.push({ a: { kind: 'poke', pokeId: Number(id), shiny: false }, n: c.n - c.s });
          if (c.s > 0) goods.push({ a: { kind: 'poke', pokeId: Number(id), shiny: true }, n: c.s });
        }
        for (const [id, n] of Object.entries(S.me.items)) if (n > 0) goods.push({ a: { kind: 'item', itemId: id }, n });
        if (S.me.dust > 0) goods.push({ a: { kind: 'dust' }, n: S.me.dust });
        for (const g of goods) g.a.ref = refOf(g.a);
        const bid = (g) => { const r = sum.get(g.a.ref); return r && r.bids[0] ? r.bids[0].price : 0; };
        goods = goods.filter((g) => matchQ(g.a, q) && passItem(g.a, st) && (!st.dup || g.n >= 2) && (!st.bids || bid(g) > 0));
        const cmp = {
          name: (x, y) => byName(x.a, y.a),
          rar: (x, y) => rarIdx(x.a) - rarIdx(y.a),
          qty: (x, y) => y.n - x.n,
          bid: (x, y) => bid(y) - bid(x),
        }[st.sort];
        goods.sort((x, y) => (cmp && cmp(x, y)) || (!!bid(y) - !!bid(x)) || rarIdx(x.a) - rarIdx(y.a) || byName(x.a, y.a));
        paintList(list, count, goods, (g) => itemRow(g.a, sum.get(g.a.ref), 'sell', g.n), fb,
          fb.active() ? 'Ninguno de tus artículos coincide. Prueba con otro nombre o quita algún filtro.' : 'No tienes nada que vender todavía.');
      }
      const fb = filterBar(st, DEF.sell, [
        ...albionDefs(st),
        { k: 'dup', t: 'chk', ph: 'Solo repetidos (2+)' },
        { k: 'bids', t: 'chk', ph: 'Con pedidos de compra' },
        { k: 'sort', t: 'sel', sort: true, ph: 'Ordenar', opts: [['', 'Más demandado'], ['rar', 'Rareza'], ['qty', 'Más copias'], ['bid', 'Mejor pedido'], ['name', 'Nombre']] },
      ], 'Buscar en tu inventario', draw);
      draw();
      const strip = specialStrip();
      return { redraw: () => { draw(); strip.update(); }, strip, el: h('div', { class: 'stack' }, strip.el, fb.el, count, thead('sell'), list) };
    }

    function mine() {
      const st = F.mine;
      const sells = h('div', { class: 'mk-list' });
      const buys = h('div', { class: 'mk-list' });
      const hs = h('h3', {});
      const hb = h('h3', {});
      const count = h('div', { class: 'small muted mkf-count' });
      const card = (o) => {
        const a = parseRef(o.ref);
        const sell = o.side === 'sell';
        const done = o.qty0 - o.qty;
        return h('div', { class: 'mk-ocard ' + (sell ? 'sellside' : 'buyside'), 'data-order': o.id },
          icon(a),
          h('div', { class: 'mk-oinfo' }, h('b', {}, nameOf(a)),
            h('div', { class: 'small' }, `${fmt(done)}/${fmt(o.qty0)} ${sell ? 'vendidos' : 'comprados'}`),
            h('div', { class: 'mk-prog', role: 'progressbar', 'aria-valuenow': done, 'aria-valuemax': o.qty0 }, h('i', { style: { width: Math.round((done / o.qty0) * 100) + '%' } }))),
          h('div', { class: 'mk-ometa' },
            h('span', { class: 'mk-price ' + (sell ? 'c-sell' : 'c-buy') }, h('span', { class: 'coin-ico' }), fmt(o.price), h('span', { class: 'muted small' }, '/ud')),
            h('span', { class: 'small ' + (urgent(o) ? 'bad' : 'muted') }, `Caduca en ${timeLeft(o)}`),
            sell ? '' : h('span', { class: 'small muted' }, `Apartadas: ${fmt(o.qty * o.price)}`)),
          h('button', { class: 'btn small danger mk-cancel', type: 'button', onclick: async (e) => { if (await act('market:cancel', { id: o.id }, e.target)) toast('Orden cancelada: se te devolvió lo que quedaba en depósito.', 'success'); } }, 'Cancelar'));
      };
      const empty = (cls, msg, label, to) => h('div', { class: 'mk-emptybox ' + cls }, h('p', { class: 'small muted' }, msg), h('button', { class: 'btn small ' + (cls === 'sellside' ? 'green' : 'blue'), type: 'button', onclick: () => go(to) }, label));
      function draw() {
        const q = norm(st.q.trim());
        const cmp = { old: (x, y) => x.createdAt - y.createdAt, cheap: (x, y) => x.price - y.price, exp: (x, y) => y.price - x.price, soon: (x, y) => expiryOf(x) - expiryOf(y) }[st.sort] || ((x, y) => y.createdAt - x.createdAt);
        const all = state.orders.filter((o) => isMine(o) && matchQ(parseRef(o.ref), q)).sort(cmp);
        const sl = all.filter((o) => o.side === 'sell');
        const bl = all.filter((o) => o.side === 'buy');
        const filtered = fb.active();
        hs.textContent = `🟢 Mis ofertas de venta (${sl.length})`;
        hb.textContent = `🔵 Mis pedidos de compra (${bl.length})`;
        count.replaceChildren('Monedas apartadas en pedidos de compra: ', h('b', {}, fmt(bl.reduce((s, o) => s + o.qty * o.price, 0))));
        sells.replaceChildren(...(sl.length ? sl.map(card) : [filtered ? h('div', { class: 'muted small mk-none' }, 'Ninguna coincide con los filtros.')
          : empty('sellside', 'Una oferta de venta es un artículo tuyo en depósito a tu precio: aparece en «Se vende» hasta que alguien lo compre.', 'Poner algo en venta', 'sell')]));
        buys.replaceChildren(...(bl.length ? bl.map(card) : [filtered ? h('div', { class: 'muted small mk-none' }, 'Ninguno coincide con los filtros.')
          : empty('buyside', 'Un pedido de compra aparta tus monedas a tu precio: aparece en «Se compra» hasta que alguien te venda.', 'Crear un pedido de compra', 'browse')]));
      }
      const fb = filterBar(st, DEF.mine, [
        { k: 'sort', t: 'sel', main: true, sort: true, ph: 'Ordenar', opts: [['', 'Más recientes'], ['old', 'Más antiguas'], ['soon', 'Caducan antes'], ['cheap', 'Precio: menor a mayor'], ['exp', 'Precio: mayor a menor']] },
      ], 'Buscar artículo', draw);
      draw();
      return { redraw: draw, el: h('div', { class: 'stack' }, fb.el, count, h('section', { class: 'mk-section sellside' }, hs, sells), h('section', { class: 'mk-section buyside' }, hb, buys)) };
    }

    function historyTab() {
      const st = F.history;
      const list = h('div', { class: 'mk-list' });
      const count = h('div', { class: 'small muted mkf-count' });
      function draw() {
        const q = norm(st.q.trim());
        const day = new Date(); day.setHours(0, 0, 0, 0);
        const since = st.range === 'today' ? day.getTime() : st.range ? Date.now() - Number(st.range) * 86400000 : 0;
        const me = S.me.username;
        // Mis operaciones: el historial propio (hasta 150) más las recientes del mercado, sin repetir.
        const mine = st.side ? (S.me.trades || []) : [];
        const seen = new Set(mine.map((t) => `${t.at}|${t.ref}|${t.seller}|${t.buyer}`));
        const pool = [...state.trades.filter((t) => !seen.has(`${t.at}|${t.ref}|${t.seller}|${t.buyer}`)), ...mine].sort((x, y) => y.at - x.at);
        const tr = pool.filter((t) => t.at >= since
          && (st.side !== 'mine' || t.buyer === me || t.seller === me)
          && (st.side !== 'buy' || t.buyer === me) && (st.side !== 'sell' || t.seller === me)
          && matchQ(parseRef(t.ref), q));
        paintList(list, count, tr, (t) => {
          const a = parseRef(t.ref);
          const bought = t.buyer === me;
          const sold = t.seller === me;
          const verb = bought ? 'Compra' : sold ? 'Venta' : 'Operación';
          return h('button', { class: 'mk-ocard mk-hist' + (bought ? ' bought' : sold ? ' sold' : ''), type: 'button', onclick: () => itemDialog(a, { side: 'buy', chart: true }) }, icon(a),
            h('div', { class: 'mk-oinfo' }, h('b', {}, `${t.qty > 1 ? t.qty + '× ' : ''}${nameOf(a)}`),
              h('div', { class: 'small' }, h('span', { class: bought ? 'tag-buy' : sold ? 'tag-sell' : 'mk-kind' }, verb.toUpperCase()), ' Vendió ', h('b', {}, t.seller === me ? 'tú' : t.seller), npcTag(t.sellerNpc), ' · compró ', h('b', {}, t.buyer === me ? 'tú' : t.buyer), npcTag(t.buyerNpc)),
              h('div', { class: 'small muted' }, new Date(t.at).toLocaleString('es-ES'))),
            h('div', { class: 'mk-ometa' }, h('span', { class: 'mk-price' }, h('span', { class: 'coin-ico' }), fmt(t.price), h('span', { class: 'muted small' }, '/ud')),
              t.qty > 1 ? h('span', { class: 'small muted' }, `Total ${fmt(t.qty * t.price)}`) : '', h('span', { class: 'small gold-text' }, '📈 Precios')));
        }, fb, fb.active() ? 'Ninguna operación coincide con los filtros.' : st.side === 'mine' ? 'Aún no has comprado ni vendido nada. Cuando lo hagas, aparecerá aquí.' : 'Todavía no hay ventas.');
      }
      const fb = filterBar(st, DEF.history, [
        { k: 'side', t: 'sel', main: true, ph: 'Operaciones', opts: [['mine', 'Mis operaciones'], ['', 'Todo el mercado'], ['buy', 'Solo mis compras'], ['sell', 'Solo mis ventas']] },
        { k: 'range', t: 'seg', ph: 'Fecha', opts: [['today', 'Hoy'], ['7', '7 días'], ['30', '30 días']] },
      ], 'Buscar artículo', draw);
      draw();
      return { redraw: draw, el: h('div', { class: 'stack' }, fb.el, count, h('p', { class: 'small muted' }, 'Tus operaciones terminadas. Pulsa una para ver la gráfica de precios del artículo.'), list) };
    }

    let cur = null; // pestaña activa: { el, redraw }
    function render() {
      if (!state) return;
      cur = (tab === 'browse' ? browse : tab === 'sell' ? sellTab : tab === 'mine' ? mine : historyTab)();
      body.replaceChildren(cur.el);
    }
    const ratesLine = h('p', { class: 'muted' });
    const paintRates = () => {
      ratesLine.replaceChildren(`Entre entrenadores · comisión de publicación ${pct(marketFee())} % · impuesto de venta ${pct(salesTax())} %`,
        marketFee() < S.data.marketFee ? h('span', { class: 'event-pill' }, '🏪 Viernes de Mercado') : '');
    };
    paintRates();
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🏪 Mercado'), ratesLine), helpBox(), h('div', { class: 'mk-shell' }, tabs, body));
    renderTabs();
    let meTimer = null;
    this.offs = [bus.on('market', (s) => { state = s; paintRates(); if (cur) cur.redraw(); else render(); }),
      bus.on('me', () => { if (tab !== 'sell' || !cur || !state) return; clearTimeout(meTimer); meTimer = setTimeout(() => { if (cur && tab === 'sell') cur.redraw(); }, 120); })];
    this.tick = setInterval(() => { if (cur && cur.strip) cur.strip.update(); }, 30000);
    const r = await act('market:state');
    if (r) { state = r; render(); }
  },
  unmount() { this.offs.forEach((f) => f()); clearInterval(this.tick); },
};

// El estado del mercado se mantiene actualizado aunque no esté abierta la vista (para las fichas).
bus.on('market', (s) => { state = s; });
