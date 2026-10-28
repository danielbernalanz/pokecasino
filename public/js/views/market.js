import { S, h, fmt, act, sfx, toast, bus, sprite, modal, typeBadge, TYPE_ES, rarityName, itemImg, itemName, RARITY_ORDER } from '../core.js';

// Mercado estilo Albion Online: libro de órdenes por artículo (ventas y pedidos de compra).
let tab = 'browse';
const REGIONS = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Teselia', 'Kalos', 'Alola', 'Galar', 'Paldea'];
// Filtros por pestaña: se conservan al cambiar de pestaña durante la sesión.
const DEF = {
  browse: { q: '', cat: '', rar: '', type: '', gen: '', min: '', max: '', side: '', sort: '' },
  sell: { q: '', cat: '', rar: '', dup: '', bids: '', sort: '' },
  mine: { q: '', side: '', sort: '' },
  history: { q: '', side: '', range: '' },
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
const levels = (orders) => {
  const m = new Map();
  for (const o of orders) m.set(o.price, (m.get(o.price) || 0) + o.qty);
  return [...m.entries()];
};
// Recorre el libro para saber cuánto cuesta/rinde operar ya `qty` unidades.
function walk(orders, qty) {
  let left = qty;
  let total = 0;
  let worst = 0;
  for (const o of orders) {
    if (!left) break;
    if (o.username === S.me.username) continue;
    const q = Math.min(left, o.qty);
    total += q * o.price;
    worst = o.price;
    left -= q;
  }
  return { filled: qty - left, total, worst };
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

// ---- Ficha del artículo ----
export async function openItem(a, side = 'buy') {
  a = { ...a, ref: refOf(a) };
  if (!state) { const s = await act('market:state'); if (!s) return; state = s; }
  const body = h('div', { class: 'mk-detail' });
  const m = modal(body, { title: 'Mercado', wide: true });
  const histRes = await act('market:history', a);
  let range = 0; // días de la gráfica (0 = todo)
  let hideMine = false; // ocultar mis órdenes del libro
  const render = () => {
    const r = summary().get(a.ref) || { a, asks: [], bids: [] };
    const have = owned(a);
    const rar = rarityOf(a);
    const p = a.kind === 'poke' ? S.dexById.get(a.pokeId) : null;
    const avg = state.stats[a.ref] ? state.stats[a.ref].avg : null;
    const bestAsk = r.asks.find((o) => o.username !== S.me.username);
    const bestBid = r.bids.find((o) => o.username !== S.me.username);

    // Panel de compra
    const bQty = h('input', { type: 'number', min: 1, value: 1 });
    const bPrice = h('input', { type: 'number', min: 1, value: bestBid ? bestBid.price + 1 : avg || (bestAsk ? Math.max(1, bestAsk.price - 1) : 100) });
    const bInfo = h('div', { class: 'small' });
    const bNow = h('button', { class: 'btn primary', onclick: async (e) => {
      const w = walk(r.asks, Number(bQty.value));
      if (!w.filled) return;
      const res = await act('market:buy', { ...a, qty: w.filled, price: w.worst, instant: true }, e.target);
      if (res) { sfx('win'); toast(`Compraste ${res.filled} por ${fmt(res.spent)} monedas`, 'success'); }
    } });
    const bOrder = h('button', { class: 'btn', onclick: async (e) => {
      const res = await act('market:buy', { ...a, qty: Number(bQty.value), price: Number(bPrice.value) }, e.target);
      if (res) { sfx('click'); toast(res.order ? `Pedido de compra publicado${res.filled ? ` (ya se llenaron ${res.filled})` : ''}` : `Compraste ${res.filled} al momento`, 'success'); }
    } });
    const updB = () => {
      const q = Math.max(1, Number(bQty.value) || 1);
      const w = walk(r.asks, q);
      bNow.disabled = !w.filled;
      bNow.textContent = w.filled ? `Comprar ya ${w.filled} por ${fmt(w.total)}` : 'No hay ofertas de venta';
      const total = q * (Number(bPrice.value) || 0);
      bOrder.textContent = `Crear pedido: ${q} × ${fmt(bPrice.value)}`;
      bInfo.textContent = `El pedido deja ${fmt(total)} monedas en depósito + ${fmt(feeOf(total))} de comisión de publicación.`;
    };
    bQty.oninput = updB; bPrice.oninput = updB; updB();

    // Panel de venta
    const sQty = h('input', { type: 'number', min: 1, max: have, value: Math.min(1, have) });
    const sPrice = h('input', { type: 'number', min: 1, value: bestAsk ? Math.max(1, bestAsk.price - 1) : avg || (bestBid ? bestBid.price + 1 : 100) });
    const sInfo = h('div', { class: 'small' });
    const sNow = h('button', { class: 'btn gold', onclick: async (e) => {
      const w = walk(r.bids, Number(sQty.value));
      if (!w.filled) return;
      const res = await act('market:sell', { ...a, qty: w.filled, price: w.worst, instant: true }, e.target);
      if (res) { sfx('win'); toast(`Vendiste ${res.filled} por ${fmt(res.earned)} (antes de impuestos)`, 'success'); }
    } });
    const sOrder = h('button', { class: 'btn', onclick: async (e) => {
      const res = await act('market:sell', { ...a, qty: Number(sQty.value), price: Number(sPrice.value) }, e.target);
      if (res) { sfx('click'); toast(res.order ? `Orden de venta publicada${res.filled ? ` (ya se vendieron ${res.filled})` : ''}` : `Vendiste ${res.filled} al momento`, 'success'); }
    } });
    const updS = () => {
      const q = Math.max(1, Number(sQty.value) || 1);
      const w = walk(r.bids, q);
      sNow.disabled = !w.filled || !have;
      sNow.textContent = w.filled ? `Vender ya ${w.filled} por ${fmt(w.total - taxOf(w.total))}` : 'No hay pedidos de compra';
      const total = q * (Number(sPrice.value) || 0);
      sOrder.disabled = !have;
      sOrder.textContent = `Crear orden: ${q} × ${fmt(sPrice.value)}`;
      sInfo.textContent = `Cobrarías ${fmt(total - taxOf(total))} tras el ${Math.round(salesTax() * 100)} % de impuesto · comisión de publicación ${fmt(feeOf(total))}.`;
    };
    sQty.oninput = updS; sPrice.oninput = updS; updS();

    const vis = (list) => (hideMine ? list.filter((o) => o.username !== S.me.username) : list);
    const bookCol = (title, all, cls) => { const list = vis(all); return h('div', { class: 'ob-col ' + cls },
      h('div', { class: 'ob-head' }, h('b', {}, title), h('span', { class: 'muted small' }, 'precio · uds')),
      list.length ? levels(list).slice(0, 8).map(([price, qty]) => h('div', { class: 'ob-row' }, h('span', { class: 'mk-price' }, h('span', { class: 'coin-ico' }), fmt(price)), h('span', {}, fmt(qty))))
        : h('div', { class: 'muted small' }, 'Vacío')); };
    const days = histRes ? (range ? histRes.days.slice(-range) : histRes.days) : [];
    const chips = h('div', { class: 'seg mk-filt' },
      ...[[0, 'Todo'], [7, '7 días'], [14, '14 días']].map(([v, l]) => h('button', { class: 'chip' + (range === v ? ' active' : ''), type: 'button', onclick: () => { range = v; render(); } }, l)),
      h('button', { class: 'chip' + (hideMine ? ' active' : ''), type: 'button', onclick: () => { hideMine = !hideMine; render(); } }, 'Ocultar mis órdenes'));

    body.replaceChildren(
      h('div', { class: 'mk-head' }, thumb(a, 'mk-big'),
        h('div', { class: 'grow' },
          h('h2', {}, nameOf(a)),
          h('div', { class: 'row gap wrap' }, rar ? h('span', { class: 'rar r-' + rar }, rarityName(rar)) : '', ...(p ? p.types.map(typeBadge) : [])),
          h('div', { class: 'small muted' }, `Tienes ${fmt(have)} · Media 30 días: ${avg ? fmt(avg) : '—'}`),
          ...setsNeeding(a).map((s) => h('div', { class: 'small gold-text' }, `📚 Te sirve para «${s.name}» (${s.have}/${s.ids.length})`)))),
      chips,
      chart(days),
      h('div', { class: 'orderbook' }, bookCol('Ofertas de venta', r.asks, 'asks'), bookCol('Pedidos de compra', r.bids, 'bids')),
      h('div', { class: 'cards3' },
        h('div', { class: 'card stack' }, h('h3', {}, '🛒 Comprar'), h('label', {}, 'Cantidad', bQty), bNow, h('label', {}, 'Precio por unidad (pedido)', bPrice), bOrder, bInfo),
        h('div', { class: 'card stack' + (have ? '' : ' disabled-card') }, h('h3', {}, '💰 Vender'), have ? '' : h('div', { class: 'small muted' }, 'No tienes este artículo.'),
          h('label', {}, `Cantidad (tienes ${have})`, sQty), sNow, h('label', {}, 'Precio por unidad (orden)', sPrice), sOrder, sInfo)));
    if (side === 'sell' && have) sPrice.focus();
  };
  render();
  const off = bus.on('market', () => { if (document.contains(body)) render(); else off(); });
  void m;
}

// ---- Vista principal ----
export default {
  id: 'market', title: 'Mercado', icon: '🏪',
  async mount(root) {
    if (S.marketQuery) { F.browse = { ...DEF.browse, q: S.marketQuery }; tab = 'browse'; S.marketQuery = null; }
    const tabs = h('div', { class: 'tabs' });
    const body = h('div', {});

    function renderTabs() {
      tabs.replaceChildren(...[['browse', '🛒 Mercado'], ['sell', '💰 Vender'], ['mine', '📋 Mis órdenes'], ['history', '📈 Historial']].map(([k, l]) =>
        h('button', { class: 'tab' + (tab === k ? ' active' : ''), onclick: () => { tab = k; renderTabs(); render(); } }, l)));
    }

    const row = (a, r, extra) => {
      const bestAsk = r && r.asks[0];
      const bestBid = r && r.bids[0];
      const askQty = r ? r.asks.reduce((s, o) => s + o.qty, 0) : 0;
      const bidQty = r ? r.bids.reduce((s, o) => s + o.qty, 0) : 0;
      const rar = rarityOf(a);
      return h('button', { class: 'mk-row' + (rar ? ' r-' + rar : '') + (a.shiny ? ' shiny' : ''), onclick: () => openItem(a, tab === 'sell' ? 'sell' : 'buy') },
        thumb(a),
        h('div', { class: 'grow' }, h('b', {}, nameOf(a)), extra || '',
          ...setsNeeding(a).slice(0, 1).map((s) => h('div', { class: 'small gold-text' }, `📚 Para «${s.name}»`))),
        h('div', { class: 'mk-quote ask' }, h('span', { class: 'muted small' }, 'Venta desde'), bestAsk ? h('b', {}, fmt(bestAsk.price)) : h('span', { class: 'muted' }, '—'), askQty ? h('span', { class: 'small muted' }, `${fmt(askQty)} uds`) : ''),
        h('div', { class: 'mk-quote bid' }, h('span', { class: 'muted small' }, 'Compra hasta'), bestBid ? h('b', {}, fmt(bestBid.price)) : h('span', { class: 'muted' }, '—'), bidQty ? h('span', { class: 'small muted' }, `${fmt(bidQty)} uds`) : ''));
    };

    // ---- Barra de filtros compacta (búsqueda + filtros plegables en móvil) ----
    // defs: [{ k, t: 'sel'|'num'|'chk'|'seg', ph, opts, sort }]. Devuelve { el, reset }.
    function filterBar(st, def, defs, ph, onChange) {
      const el = h('div', { class: 'mkf' });
      const activeN = () => defs.filter((d) => !d.sort && String(st[d.k]) !== String(def[d.k])).length;
      let timer = null;
      const later = () => { clearTimeout(timer); timer = setTimeout(onChange, 150); };
      function reset() { Object.assign(st, def); build(); onChange(); }
      function build() {
        const toggle = h('button', { class: 'btn small mkf-toggle', type: 'button', 'aria-expanded': String(panelOpen), onclick: () => { panelOpen = !panelOpen; panel.classList.toggle('open', panelOpen); toggle.setAttribute('aria-expanded', String(panelOpen)); } });
        const clear = h('button', { class: 'btn small mkf-clear', type: 'button', onclick: reset }, 'Limpiar');
        const sync = () => { toggle.textContent = `⚙ Filtros (${activeN()})`; clear.classList.toggle('hidden', !activeN() && !st.q && !defs.some((d) => d.sort && st[d.k] !== def[d.k])); };
        const q = h('input', { type: 'search', class: 'mkf-q', placeholder: ph, 'aria-label': 'Buscar', autocomplete: 'off', oninput: (e) => { st.q = e.target.value; sync(); later(); } });
        q.value = st.q;
        const ctrl = (d) => {
          if (d.t === 'sel') {
            const s = h('select', { 'aria-label': d.ph, onchange: (e) => { st[d.k] = e.target.value; sync(); onChange(); } }, d.opts.map(([v, l]) => h('option', { value: v }, l)));
            s.value = st[d.k];
            return s;
          }
          if (d.t === 'num') {
            const i = h('input', { type: 'number', min: 0, inputmode: 'numeric', class: 'mkf-num', placeholder: d.ph, 'aria-label': d.ph, oninput: (e) => { st[d.k] = e.target.value; sync(); later(); } });
            i.value = st[d.k];
            return i;
          }
          if (d.t === 'chk') {
            const b = h('button', { class: 'chip' + (st[d.k] ? ' active' : ''), type: 'button', onclick: () => { st[d.k] = st[d.k] ? '' : '1'; b.classList.toggle('active', !!st[d.k]); sync(); onChange(); } }, d.ph);
            return b;
          }
          // seg: chips excluyentes (pulsar el activo lo desactiva)
          const wrap = h('div', { class: 'seg mkf-seg' });
          const paint = () => wrap.replaceChildren(...d.opts.map(([v, l]) => h('button', { class: 'chip' + (st[d.k] === v ? ' active' : ''), type: 'button', onclick: () => { st[d.k] = st[d.k] === v ? '' : v; paint(); sync(); onChange(); } }, l)));
          paint();
          return wrap;
        };
        const panel = h('div', { class: 'mkf-panel' + (panelOpen ? ' open' : '') }, defs.map(ctrl));
        sync();
        el.replaceChildren(h('div', { class: 'mkf-top' }, q, toggle, clear), panel);
      }
      build();
      return { el, reset, active: () => activeN() + (st.q ? 1 : 0) + defs.filter((d) => d.sort && st[d.k] !== def[d.k]).length };
    }

    // Pinta la lista, el contador y el estado vacío (no toca la barra: así no se pierde el foco al teclear).
    function paintList(list, count, items, mk, fb, emptyMsg, limit = 120) {
      const n = items.length;
      count.textContent = `${fmt(n)} resultado${n === 1 ? '' : 's'}${n > limit ? ` · mostrando ${limit}` : ''}`;
      list.replaceChildren(...(n ? items.slice(0, limit).map(mk) : [h('div', { class: 'mkf-empty' },
        h('div', { class: 'mkf-empty-ico' }, '🔍'), h('p', { class: 'muted' }, emptyMsg),
        fb.active() ? h('button', { class: 'btn small', onclick: fb.reset }, 'Limpiar filtros') : '')]));
    }
    const kindOf = (a) => (a.kind === 'poke' ? (a.shiny ? 'shiny' : 'poke') : a.kind === 'dust' ? 'dust' : isCos(a) ? 'cosmetic' : 'item');
    const KINDS = [['', 'Todo'], ['poke', 'Pokémon'], ['shiny', 'Variocolor'], ['item', 'Objetos'], ['cosmetic', 'Cosméticos'], ['dust', 'Polvo estelar']];
    const RARS = [['', 'Cualquier rareza'], ...RARITY_ORDER.map((r) => [r, rarityName(r)])];
    // Cumple tipo de artículo, rareza, tipo Pokémon y región (los dos últimos solo aplican a Pokémon).
    function passItem(a, st) {
      if (st.cat && st.cat !== 'sets' && kindOf(a) !== st.cat && !(st.cat === 'poke' && a.kind === 'poke')) return false;
      if (st.cat === 'sets' && !setsNeeding(a).length) return false;
      if (st.rar && rarityOf(a) !== st.rar) return false;
      if (st.type || st.gen) {
        if (a.kind !== 'poke') return false;
        const p = S.dexById.get(a.pokeId);
        if (st.type && !p.types.includes(st.type)) return false;
        if (st.gen && p.gen !== Number(st.gen)) return false;
      }
      return true;
    }
    const matchQ = (a, q) => !q || norm(nameOf(a)).includes(q);
    const byName = (x, y) => nameOf(x).localeCompare(nameOf(y), 'es');
    const rarIdx = (a) => RARITY_ORDER.indexOf(rarityOf(a) || 'C');

    // Todo lo que se puede buscar aunque no tenga órdenes (para crear pedidos de compra).
    function catalog(q) {
      const out = [];
      for (const p of S.data.dex) if (norm(p.name).includes(q)) out.push({ kind: 'poke', pokeId: p.id, shiny: false }, { kind: 'poke', pokeId: p.id, shiny: true });
      for (const id of Object.keys(S.data.items)) if (norm(itemName(id)).includes(q)) out.push({ kind: 'item', itemId: id });
      if ('polvo estelar'.includes(q)) out.push({ kind: 'dust' });
      return out.map((a) => ({ ...a, ref: refOf(a) }));
    }

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
        const qty = (a, side) => { const r = sum.get(a.ref); return r ? r[side].reduce((s, o) => s + o.qty, 0) : 0; };
        const cmp = {
          cheap: (x, y) => (ask(x) ?? Infinity) - (ask(y) ?? Infinity),
          exp: (x, y) => (ask(y) ?? -1) - (ask(x) ?? -1),
          offers: (x, y) => qty(y, 'asks') - qty(x, 'asks'),
          sold: (x, y) => ((state.stats[y.ref] || {}).n || 0) - ((state.stats[x.ref] || {}).n || 0),
          name: byName,
        }[st.sort];
        refs.sort((x, y) => (cmp && cmp(x, y)) || (sum.has(y.ref) - sum.has(x.ref)) || rarIdx(x) - rarIdx(y) || byName(x, y));
        paintList(list, count, refs, (a) => row(a, sum.get(a.ref)), fb,
          q || fb.active() ? 'Nada coincide con tu búsqueda. Prueba con otro nombre o quita algún filtro.' : 'El mercado está vacío. Busca cualquier Pokémon u objeto para publicar un pedido de compra, o vende algo desde «Vender».');
      }
      const def = DEF.browse;
      const fb = filterBar(st, def, [
        { k: 'cat', t: 'sel', ph: 'Tipo de artículo', opts: [...KINDS, ['sets', 'Para mis colecciones']] },
        { k: 'rar', t: 'sel', ph: 'Rareza', opts: RARS },
        { k: 'type', t: 'sel', ph: 'Tipo Pokémon', opts: [['', 'Cualquier tipo'], ...S.data.types.map((t) => [t, TYPE_ES[t]])] },
        { k: 'gen', t: 'sel', ph: 'Región', opts: [['', 'Todas las regiones'], ...REGIONS.map((r, i) => [String(i + 1), `${r} (gen. ${i + 1})`])] },
        { k: 'min', t: 'num', ph: 'Precio mín.' },
        { k: 'max', t: 'num', ph: 'Precio máx.' },
        { k: 'side', t: 'sel', ph: 'Órdenes', opts: [['', 'Con o sin órdenes'], ['asks', 'Solo con ofertas de venta'], ['bids', 'Solo con pedidos de compra']] },
        { k: 'sort', t: 'sel', sort: true, ph: 'Orden', opts: [['', 'Orden: relevancia'], ['cheap', 'Más barato'], ['exp', 'Más caro'], ['offers', 'Más ofertas'], ['sold', 'Más vendidos (30 días)'], ['name', 'Nombre']] },
      ], 'Busca cualquier Pokémon u objeto…', draw);
      draw();
      return {
        redraw: draw,
        el: h('div', { class: 'stack' }, fb.el, count,
          h('p', { class: 'small muted' }, 'Como en Albion: «Comprar ya» toma las ofertas más baratas y «Vender ya» llena los pedidos más altos. Si no te convence el precio, publica tu propia orden y espera a que alguien la acepte. El precio mín./máx. se aplica a la oferta de venta más barata.'),
          list),
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
        paintList(list, count, goods, (g) => row(g.a, sum.get(g.a.ref), h('div', { class: 'small muted' }, `Tienes ${fmt(g.n)}`)), fb,
          fb.active() ? 'Ninguno de tus artículos coincide. Prueba con otro nombre o quita algún filtro.' : 'No tienes nada que vender todavía.');
      }
      const fb = filterBar(st, DEF.sell, [
        { k: 'cat', t: 'sel', ph: 'Tipo de artículo', opts: KINDS },
        { k: 'rar', t: 'sel', ph: 'Rareza', opts: RARS },
        { k: 'dup', t: 'chk', ph: 'Solo repetidos (2+)' },
        { k: 'bids', t: 'chk', ph: 'Con pedidos de compra' },
        { k: 'sort', t: 'sel', sort: true, ph: 'Orden', opts: [['', 'Orden: más demandado'], ['rar', 'Rareza'], ['qty', 'Más copias'], ['bid', 'Mejor pedido'], ['name', 'Nombre']] },
      ], 'Busca en tu inventario…', draw);
      draw();
      return { redraw: draw, el: h('div', { class: 'stack' }, fb.el, count, h('p', { class: 'small muted' }, 'Tu inventario. Arriba lo que alguien quiere comprar ahora mismo.'), list) };
    }

    function mine() {
      const st = F.mine;
      const list = h('div', { class: 'mk-list' });
      const count = h('div', { class: 'small muted mkf-count' });
      function draw() {
        const q = norm(st.q.trim());
        const cmp = { old: (x, y) => x.createdAt - y.createdAt, cheap: (x, y) => x.price - y.price, exp: (x, y) => y.price - x.price }[st.sort] || ((x, y) => y.createdAt - x.createdAt);
        const orders = state.orders.filter((o) => o.username === S.me.username && (!st.side || o.side === st.side) && matchQ(parseRef(o.ref), q)).sort(cmp);
        paintList(list, count, orders, (o) => {
          const a = parseRef(o.ref);
          return h('div', { class: 'mk-row static' },
            thumb(a),
            h('div', { class: 'grow' }, h('b', {}, nameOf(a)),
              h('div', { class: 'small' }, h('span', { class: o.side === 'sell' ? 'tag-sell' : 'tag-buy' }, o.side === 'sell' ? 'VENTA' : 'COMPRA'), ` ${fmt(o.qty0 - o.qty)}/${fmt(o.qty0)} llenado · ${new Date(o.createdAt).toLocaleDateString('es-ES')}`)),
            h('div', { class: 'mk-price' }, h('span', { class: 'coin-ico' }), fmt(o.price), h('span', { class: 'muted small' }, '/ud')),
            h('button', { class: 'btn small', onclick: () => openItem(a, o.side === 'sell' ? 'sell' : 'buy') }, 'Ver'),
            h('button', { class: 'btn small danger', onclick: async (e) => { if (await act('market:cancel', { id: o.id }, e.target)) toast('Orden cancelada: se te devolvió lo que quedaba en depósito.', 'success'); } }, 'Cancelar'));
        }, fb, fb.active() ? 'Ninguna de tus órdenes coincide con los filtros.' : 'No tienes órdenes activas. Publica una desde «Mercado» o «Vender».');
      }
      const fb = filterBar(st, DEF.mine, [
        { k: 'side', t: 'sel', ph: 'Tipo de orden', opts: [['', 'Compra y venta'], ['buy', 'Solo compra'], ['sell', 'Solo venta']] },
        { k: 'sort', t: 'sel', sort: true, ph: 'Orden', opts: [['', 'Más recientes'], ['old', 'Más antiguas'], ['cheap', 'Precio: menor a mayor'], ['exp', 'Precio: mayor a menor']] },
      ], 'Busca por artículo…', draw);
      draw();
      return { redraw: draw, el: h('div', { class: 'stack' }, fb.el, count, list) };
    }

    function historyTab() {
      const st = F.history;
      const list = h('div', { class: 'mk-list' });
      const count = h('div', { class: 'small muted mkf-count' });
      function draw() {
        const q = norm(st.q.trim());
        const day = new Date(); day.setHours(0, 0, 0, 0);
        const since = st.range === 'today' ? day.getTime() : st.range ? Date.now() - Number(st.range) * 86400000 : 0;
        const tr = state.trades.filter((t) => t.at >= since
          && (st.side !== 'buy' || t.buyer === S.me.username) && (st.side !== 'sell' || t.seller === S.me.username)
          && matchQ(parseRef(t.ref), q));
        paintList(list, count, tr, (t) => {
          const a = parseRef(t.ref);
          const me = t.buyer === S.me.username ? 'compraste' : t.seller === S.me.username ? 'vendiste' : null;
          return h('button', { class: 'mk-row' + (me ? ' mine' : ''), onclick: () => openItem(a) }, thumb(a),
            h('div', { class: 'grow' }, h('b', {}, `${t.qty > 1 ? t.qty + '× ' : ''}${nameOf(a)}`),
              h('div', { class: 'muted small' }, `${t.seller} → ${t.buyer}${me ? ` (${me})` : ''} · ${new Date(t.at).toLocaleString('es-ES')}`)),
            h('div', { class: 'mk-price' }, h('span', { class: 'coin-ico' }), fmt(t.price), h('span', { class: 'muted small' }, '/ud')));
        }, fb, fb.active() ? 'Ninguna operación coincide con los filtros.' : 'Todavía no hay ventas.');
      }
      const fb = filterBar(st, DEF.history, [
        { k: 'side', t: 'sel', ph: 'Operaciones', opts: [['', 'Todas las operaciones'], ['buy', 'Mis compras'], ['sell', 'Mis ventas']] },
        { k: 'range', t: 'seg', ph: 'Fecha', opts: [['today', 'Hoy'], ['7', '7 días'], ['30', '30 días']] },
      ], 'Busca por artículo…', draw);
      draw();
      return { redraw: draw, el: h('div', { class: 'stack' }, fb.el, count, h('p', { class: 'small muted' }, 'Se muestran las últimas 40 operaciones del mercado.'), list) };
    }

    let cur = null; // pestaña activa: { el, redraw }
    function render() {
      if (!state) return;
      cur = (tab === 'browse' ? browse : tab === 'sell' ? sellTab : tab === 'mine' ? mine : historyTab)();
      body.replaceChildren(cur.el);
      paintRates();
    }
    const ratesLine = h('p', { class: 'muted' });
    const paintRates = () => {
      const fee = String(Math.round(marketFee() * 10000) / 100).replace('.', ',');
      const tax = Math.round(salesTax() * 100);
      ratesLine.replaceChildren(`Órdenes de compra y venta entre entrenadores · comisión de publicación ${fee} % · impuesto de venta ${tax} %`,
        marketFee() < S.data.marketFee ? h('span', { class: 'event-pill' }, '🏪 Viernes de Mercado') : '');
    };
    paintRates();
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🏪 Mercado'), ratesLine), tabs, body);
    renderTabs();
    this.offs = [bus.on('market', (s) => { state = s; if (cur) cur.redraw(); else render(); })];
    const r = await act('market:state');
    if (r) { state = r; render(); }
  },
  unmount() { this.offs.forEach((f) => f()); },
};

// El estado del mercado se mantiene actualizado aunque no esté abierta la vista (para las fichas).
bus.on('market', (s) => { state = s; });
