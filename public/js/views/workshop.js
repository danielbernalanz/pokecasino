// Taller: fabricar Pokémon con polvo estelar, Máquina MT, cambio de polvo por monedas y reciclaje de objetos.
// Rutas #/workshop/craft, /tm, /exchange y /recycle.
import { S, h, multiSelect, fmt, act, sfx, toast, sprite, rarityName, bus, RARITY_ORDER, itemImg, confirmRisk, TYPE_ES, say } from '../core.js';
import { openDetail } from './pokedex.js';
import { burstAt, coinRain, centerOf } from '../fx.js';
import { machineTab } from './tm-ui.js';
import { berryImg, berryCount, berryIds } from './huerto.js';

export const craftFilter = { q: '', show: 'missing', rarity: [], type: [], gen: [], sort: 'rarity' };
const TABS = [['craft', '✦ Fabricar Pokémon'], ['tm', '💿 Máquina MT'], ['exchange', '💱 Cambio de polvo'], ['recycle', '♻️ Reciclaje']];
const subOf = () => { const m = location.hash.match(/^#\/workshop\/(\w+)/); return m && TABS.some(([k]) => k === m[1]) ? m[1] : 'craft'; };

export default {
  id: 'workshop', title: 'Taller', icon: '🔨',
  mount(root) {
    root.classList.add('view-shop'); // misma maquetación a pantalla completa que la Tienda (fit.css)
    let tab = subOf();
    const body = h('div', {});
    const tabs = h('div', { class: 'tabs' });
    function renderTabs() {
      tabs.replaceChildren(...TABS.map(([k, l]) => h('button', { class: 'tab' + (tab === k ? ' active' : ''), type: 'button', onclick: () => {
        tab = k; try { history.replaceState(null, '', '#/workshop/' + k); } catch { /* nada */ }
        renderTabs(); render();
      } }, l)));
    }

    // Fabricar: buscador y filtros (se conservan al cambiar de pestaña) y lista por tandas para que cargue rápido.
    function craftTab() {
      const f = craftFilter;
      const list = h('div', { class: 'shop-grid' });
      const count = h('div', { class: 'small muted' });
      let observer = null;
      const norm = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const card = (p) => {
        const cost = S.data.rarity[p.rarity].craft;
        const c = S.me.collection[p.id];
        return h('div', { class: `shop-item r-${p.rarity}` },
          h('img', { class: 'pixel' + (c ? '' : ' silhouette'), src: sprite(p.id), alt: '', loading: 'lazy', onclick: () => openDetail(p.id) }),
          h('div', { class: 'grow' }, h('b', {}, `${p.name}`), h('div', { class: 'small muted' }, `#${String(p.id).padStart(3, '0')} · ${rarityName(p.rarity)}` + (c ? ` · ${'★'.repeat(Math.min(5, c.n))}` : ' · no lo tienes'))),
          h('button', { class: 'btn', disabled: S.me.dust < cost || (c && c.n >= 5), onclick: async (e) => {
            const at = centerOf(e.target);
            const r = await act('shop:craft', { id: p.id }, e.target);
            if (r) { sfx('win'); sfx('shiny'); burstAt(...at, '#a5b4fc', 26, { spread: 170, stars: 0.8 }); toast(`¡Fabricaste ${r.name}!`, 'success'); }
          } }, `${fmt(cost)} ✦`));
      };
      const draw = () => {
        if (observer) observer.disconnect();
        const q = norm(f.q.trim());
        const items = S.data.dex.filter((p) => {
          const c = S.me.collection[p.id];
          if (f.show === 'missing' && c) return false;
          if (f.show === 'owned' && !c) return false;
          if (f.show === 'affordable' && (S.me.dust < S.data.rarity[p.rarity].craft || (c && c.n >= 5))) return false;
          if (f.rarity.length && !f.rarity.includes(p.rarity)) return false;
          if (f.type.length && !p.types.some((t) => f.type.includes(t))) return false;
          if (f.gen.length && !f.gen.includes(String(p.gen))) return false;
          if (q && !(norm(p.name).includes(q) || String(p.id) === q.replace(/^#?0*/, ''))) return false;
          return true;
        }).sort(f.sort === 'id' ? (a, b) => a.id - b.id
          : f.sort === 'cheap' ? (a, b) => S.data.rarity[a.rarity].craft - S.data.rarity[b.rarity].craft || a.id - b.id
            : f.sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'es') || a.id - b.id
              : (a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || a.id - b.id);
        count.textContent = `${fmt(items.length)} Pokémon`;
        let shown = Math.min(60, items.length);
        list.replaceChildren(...items.slice(0, shown).map(card));
        if (!items.length) list.append(h('p', { class: 'muted' }, 'Ningún Pokémon coincide con la búsqueda.'));
        if (shown < items.length) {
          const more = h('div', { class: 'dex-more muted small' }, 'Cargando más…');
          list.append(more);
          observer = new IntersectionObserver((en) => {
            if (!en.some((e) => e.isIntersecting)) return;
            const next = items.slice(shown, shown + 60);
            more.before(...next.map(card));
            shown += next.length;
            if (shown >= items.length) { observer.disconnect(); more.remove(); }
          }, { rootMargin: '500px' });
          observer.observe(more);
        }
      };
      let timer = null;
      const search = h('input', { type: 'search', placeholder: 'Buscar por nombre o número…', value: f.q, autocomplete: 'off',
        oninput: (e) => { f.q = e.target.value; clearTimeout(timer); timer = setTimeout(draw, 150); } });
      const sel = (key, opts) => h('select', { onchange: (e) => { f[key] = e.target.value; draw(); } }, opts.map(([v, l]) => h('option', { value: v, selected: f[key] === v }, l)));
      const ms = (key, label, opts, allLabel, plural) => multiSelect({ label, options: opts, value: f[key], allLabel, plural, onChange: (v) => { f[key] = v; draw(); } }).el;
      const REG = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Teselia', 'Kalos', 'Alola', 'Galar', 'Paldea'];
      draw();
      return h('div', { class: 'stack' },
        h('div', { class: 'filters' }, search,
          sel('show', [['missing', 'Me faltan'], ['all', 'Todos'], ['owned', 'Los tengo'], ['affordable', 'Puedo fabricarlos ahora']]),
          ms('rarity', 'Rareza', ['M', 'L', 'E', 'R', 'U', 'C'].map((x) => [x, rarityName(x)]), 'Todas', 'seleccionadas'),
          ms('type', 'Tipo', S.data.types.map((t) => [t, TYPE_ES[t]]), 'Todos', 'seleccionados'),
          ms('gen', 'Región', REG.map((x, i) => [String(i + 1), x]), 'Todas', 'seleccionadas'),
          sel('sort', [['rarity', 'Orden: rareza'], ['cheap', 'Orden: más barato'], ['id', 'Orden: número'], ['name', 'Orden: nombre']])),
        count, list);
    }


    function exchangeTab() {
      const amount = h('input', { type: 'number', min: 1, value: 100 });
      return h('div', { class: 'cards3' },
        h('div', { class: 'card stack' }, h('h3', {}, '💱 Polvo estelar → monedas'),
          h('p', { class: 'muted small' }, `1 ✦ = ${S.data.dustRate} monedas. Tienes ${fmt(S.me.dust)} ✦.`),
          h('div', { class: 'row gap' }, amount, h('button', { class: 'btn primary', onclick: async (e) => {
            const at = centerOf(e.target);
            const r = await act('shop:exchange', { amount: Number(amount.value) }, e.target);
            if (r) { sfx('win'); coinRain(r.coins, { from: at }); toast(`+${fmt(r.coins)} monedas`, 'success'); }
          } }, 'Cambiar'))),
        h('div', { class: 'card' }, h('h3', {}, '✦ ¿Cómo consigo polvo?'),
          h('p', { class: 'small' }, 'Los duplicados más allá de la 5ª copia y los variocolor repetidos se convierten en polvo estelar. También puedes liberar copias desde la Pokédex o comprarlo en el Mercado.')));
    }


    // Reciclaje: objetos de la mochila → polvo estelar (40 % del precio de tienda a la tasa del Cambio: siempre sale a pérdida).
    function recycleTab() {
      const rows = S.data.recycle.map(([id, dust]) => [id, dust, S.me.items[id] || 0]);
      return h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h3', {}, '♻️ Máquina de reciclaje'),
          h('p', { class: 'small muted' }, `Convierte objetos que no uses en polvo estelar. Recibes el 40 % de su precio de tienda (a ${S.data.dustRate} monedas por ✦ de Cambio, así que nunca sale a cuenta). Tope: ${fmt(S.data.recycleDaily)} ✦ al día. Los cosméticos y las megapiedras no se reciclan.`)),
        h('div', { class: 'card stack' }, h('h3', {}, '🌱 Bayas'),
          h('p', { class: 'small muted' }, `1 ✦ por baya (hasta ${S.data.recycleBerry.daily} ✦ al día). Suele ser mejor dárselas a tus Pokémon en la Caja PC.`),
          h('div', { class: 'row gap wrap' }, berryIds().map((id) => {
            const b = S.data.berries[id];
            const n = berryCount(id);
            return h('button', { class: 'btn', type: 'button', disabled: n < 1, title: `Reciclar 1 ${b.name}: +${S.data.recycleBerry.dust} ✦`, onclick: async (e) => {
              const r = await act('shop:recycle', { item: id, qty: 1 }, e.currentTarget);
              if (r) { sfx('click'); toast(`Reciclada: +${r.dust} ✦`, 'success'); }
            } }, berryImg(id), ` ${b.name} ×${n}`);
          }))),
        h('div', { class: 'shop-grid wide' }, rows.map(([id, dust, have]) => {
          const it = S.data.items[id];
          const qty = h('input', { type: 'number', min: 1, max: Math.max(1, have), value: 1, class: 'qty' });
          return h('div', { class: 'shop-item item-card' }, itemImg(id, 'big'),
            h('div', { class: 'grow' }, h('b', {}, it.name), h('div', { class: 'small muted' }, `En tu mochila: ${have}`), h('div', { class: 'small' }, `${dust} ✦ cada uno`)),
            h('div', { class: 'row gap' }, qty, h('button', { class: 'btn primary', disabled: have < 1, onclick: async (e) => {
              const n = Math.min(have, Math.max(1, Math.floor(Number(qty.value) || 1)));
              if (!(await confirmRisk('item-recycle', { section: 'el Taller', title: `¿Reciclar ${n} × ${it.name}?`, danger: 'Reciclar', safe: 'Cancelar',
                text: `Recibirás ${fmt(dust * n)} ✦ de polvo estelar. Los objetos se pierden y no se puede deshacer.` }))) return;
              const r = await act('shop:recycle', { item: id, qty: n }, e.target);
              if (r) { sfx('win'); toast(`Reciclaste ${n}× ${it.name}: +${fmt(r.dust)} ✦`, 'success'); }
            } }, 'Reciclar')));
        })));
    }


    function render() {
      body.replaceChildren(tab === 'craft' ? craftTab() : tab === 'tm' ? machineTab() : tab === 'recycle' ? recycleTab() : exchangeTab());
    }
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🔨 Taller'), h('div', { class: 'row gap wrap' }, h('div', { class: 'pill dust' }, '✦ ', h('b', {}, fmt(S.me.dust))), h('a', { class: 'btn small', href: '#/market' }, '← Mercado'))),
      say({ mon: 66, who: 'Machop', text: 'Aquí se transforma el polvo estelar y los materiales en Pokémon y MT.', cls: 'compact' }), tabs, body);
    renderTabs();
    render();
    this.off = bus.on('me', () => { if (tab !== 'tm' && (!document.activeElement || document.activeElement.tagName !== 'INPUT')) render(); }); // la Máquina MT se refresca sola
  },
  unmount() { if (this.off) this.off(); },
};
