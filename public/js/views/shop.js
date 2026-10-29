import { S, h, fmt, act, sfx, toast, sprite, rarityName, bus, RARITY_ORDER, itemImg, confirmRisk, TYPE_ES, monImg, MON, say } from '../core.js';
import { openDetail } from './pokedex.js';
import { pickPokemon } from '../picker.js';
import { openItem } from './market.js';
import { openEgg, useFx } from '../rewards.js';
import { burstAt, coinRain, centerOf } from '../fx.js';

let tab = 'items';

function timeLeft(until) {
  const ms = until - Date.now();
  return ms > 0 ? `${Math.ceil(ms / 60000)} min` : null;
}

const craftFilter = { q: '', show: 'missing', rarity: '', type: '', gen: '', sort: 'rarity' };

export default {
  id: 'shop', title: 'Tienda y Mochila', icon: '🎒',
  mount(root) {
    const body = h('div', {});
    const tabs = h('div', { class: 'tabs' });

    function renderTabs() {
      tabs.replaceChildren(...[['items', '🏬 Tienda Poké'], ['bag', '🎒 Mochila'], ['craft', '✦ Fabricar'], ['exchange', '💱 Cambio'], ['recycle', '♻️ Reciclaje']].map(([k, l]) =>
        h('button', { class: 'tab' + (tab === k ? ' active' : ''), onclick: () => { tab = k; renderTabs(); render(); } }, l)));
    }

    function itemsTab() {
      return h('div', { class: 'shop-grid wide' }, Object.entries(S.data.items).filter(([id]) => !S.data.cosmetics[id]).map(([id, it]) => {
        const qty = h('input', { type: 'number', min: 1, max: 99, value: 1, class: 'qty' });
        return h('div', { class: 'shop-item item-card' },
          itemImg(id, 'big'),
          h('div', { class: 'grow' }, h('b', {}, it.name), h('div', { class: 'small muted' }, it.desc), h('div', { class: 'small' }, `En tu mochila: ${S.me.items[id] || 0}`)),
          it.price
            ? h('div', { class: 'stack' }, h('div', { class: 'mk-price' }, h('span', { class: 'coin-ico' }), fmt(it.price)), h('div', { class: 'row gap' }, qty,
              h('button', { class: 'btn primary', onclick: async (e) => { const r = await act('item:buy', { itemId: id, qty: Number(qty.value) }, e.target); if (r) { sfx('win'); toast(`Compraste ${r.qty}× ${it.name}`, 'success'); } } }, 'Comprar')))
            : h('button', { class: 'btn', onclick: () => openItem({ kind: 'item', itemId: id }) }, 'Buscar en el Mercado'));
      }));
    }

    function bagTab() {
      const owned = Object.entries(S.me.items || {}).filter(([, n]) => n > 0);
      const b = S.me.buffs || {};
      const active = [
        timeLeft(b.amuletUntil) && `🪙 Moneda Amuleto activa (${timeLeft(b.amuletUntil)})`,
        timeLeft(b.luckyUntil) && `🥚 Huevo Suerte activo (${timeLeft(b.luckyUntil)})`,
        b.shinyCharges > 0 && `✨ Amuleto Iris: ${b.shinyCharges} tiradas potenciadas`,
        b.masterBall && '🟣 Master Ball preparada para tu próxima tirada',
      ].filter(Boolean);
      return h('div', { class: 'stack' },
        active.length ? h('div', { class: 'card' }, h('h3', {}, 'Efectos activos'), active.map((a) => h('div', {}, a))) : null,
        owned.length ? h('div', { class: 'shop-grid wide' }, owned.map(([id, n]) => {
          const it = S.data.items[id];
          const cos = S.data.cosmetics[id];
          const equipped = cos && S.me.equip[cos.slot] === id;
          const useBtn = id === 'ticket'
            ? h('a', { class: 'btn', href: '#/gacha' }, 'Usar en el Gacha')
            : cos ? h('button', { class: 'btn' + (equipped ? ' active' : ''), disabled: equipped, onclick: async (e) => { if (await act('item:use', { itemId: id }, e.target)) { sfx('click'); toast(`${it.name} equipado`, 'success'); } } }, equipped ? 'Equipado' : 'Equipar')
            : h('button', { class: 'btn primary', onclick: async (e) => {
              if (id === 'mystery-egg') return openEgg(e.target);
              if (id === 'amulet-coin' && S.me.bonusLeft === 0 && !(await confirmRisk('item-wasted', { section: 'la Mochila', title: 'El objeto se desaprovecharía',
                text: 'Hoy ya has alcanzado el tope diario de bonus de ganancias. La Moneda Amuleto dura 1 hora y se gastaría igual, así que ahora mismo no te daría nada. Mejor úsala cuando todavía te quede bonus por cobrar.', danger: 'Usarla igualmente', safe: 'Guardarla' }))) return;
              const at = centerOf(e.target);
              let payload = { itemId: id };
              if (id === 'rare-candy') {
                const p = await pickPokemon({ title: '¿A quién le das el Caramelo Raro?' });
                if (!p) return;
                payload.pokeId = p.id;
              }
              const r = await act('item:use', payload, e.target);
              if (r) { useFx(id, at); toast(`Usaste ${it.name}`, 'success'); }
            } }, id === 'mystery-egg' ? 'Abrir' : 'Usar');
          return h('div', { class: 'shop-item item-card' }, itemImg(id, 'big'), h('div', { class: 'grow' }, h('b', {}, `${it.name} ×${n}`), h('div', { class: 'small muted' }, it.desc)),
            h('div', { class: 'stack' }, useBtn, h('button', { class: 'btn small', onclick: () => openItem({ kind: 'item', itemId: id }, 'sell') }, 'Vender')));
        })) : h('p', { class: 'muted' }, 'Tu mochila está vacía. Consigue objetos en la Tienda Poké, subiendo de nivel, con la recompensa diaria o en el Mercado.'));
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
          if (f.rarity && p.rarity !== f.rarity) return false;
          if (f.type && !p.types.includes(f.type)) return false;
          if (f.gen && p.gen !== Number(f.gen)) return false;
          if (q && !(norm(p.name).includes(q) || String(p.id) === q.replace(/^#?0*/, ''))) return false;
          return true;
        }).sort(f.sort === 'id' ? (a, b) => a.id - b.id
          : f.sort === 'cheap' ? (a, b) => S.data.rarity[a.rarity].craft - S.data.rarity[b.rarity].craft || a.id - b.id
            : f.sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'es') || a.id - b.id
              : (a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity) || a.id - b.id);
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
      const REG = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Teselia', 'Kalos', 'Alola', 'Galar', 'Paldea'];
      draw();
      return h('div', { class: 'stack' },
        h('div', { class: 'filters' }, search,
          sel('show', [['missing', 'Me faltan'], ['all', 'Todos'], ['owned', 'Los tengo'], ['affordable', 'Puedo fabricarlos ahora']]),
          sel('rarity', [['', 'Cualquier rareza'], ...['M', 'L', 'E', 'R', 'U', 'C'].map((x) => [x, rarityName(x)])]),
          sel('type', [['', 'Cualquier tipo'], ...S.data.types.map((t) => [t, TYPE_ES[t]])]),
          sel('gen', [['', 'Todas las regiones'], ...REG.map((x, i) => [String(i + 1), x])]),
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
        h('div', { class: 'shop-grid wide' }, rows.map(([id, dust, have]) => {
          const it = S.data.items[id];
          const qty = h('input', { type: 'number', min: 1, max: Math.max(1, have), value: 1, class: 'qty' });
          return h('div', { class: 'shop-item item-card' }, itemImg(id, 'big'),
            h('div', { class: 'grow' }, h('b', {}, it.name), h('div', { class: 'small muted' }, `En tu mochila: ${have}`), h('div', { class: 'small' }, `${dust} ✦ cada uno`)),
            h('div', { class: 'row gap' }, qty, h('button', { class: 'btn primary', disabled: have < 1, onclick: async (e) => {
              const n = Math.min(have, Math.max(1, Math.floor(Number(qty.value) || 1)));
              if (!(await confirmRisk('item-recycle', { section: 'la Tienda', title: `¿Reciclar ${n} × ${it.name}?`, danger: 'Reciclar', safe: 'Cancelar',
                text: `Recibirás ${fmt(dust * n)} ✦ de polvo estelar. Los objetos se pierden y no se puede deshacer.` }))) return;
              const r = await act('shop:recycle', { item: id, qty: n }, e.target);
              if (r) { sfx('win'); toast(`Reciclaste ${n}× ${it.name}: +${fmt(r.dust)} ✦`, 'success'); }
            } }, 'Reciclar')));
        })));
    }

    function render() {
      body.replaceChildren(tab === 'items' ? itemsTab() : tab === 'bag' ? bagTab() : tab === 'craft' ? craftTab() : tab === 'recycle' ? recycleTab() : exchangeTab());
    }
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🎒 Tienda y Mochila'), h('div', { class: 'pill dust' }, '✦ ', h('b', {}, fmt(S.me.dust)))), say({ mon: MON.kecleon, who: 'Kecleon', text: '¡Bienvenido! Mira sin miedo… aunque no me veas.', cls: 'compact' }), tabs, body);
    renderTabs();
    render();
    this.off = bus.on('me', () => { if (!document.activeElement || document.activeElement.tagName !== 'INPUT') render(); });
  },
  unmount() { this.off(); },
};
