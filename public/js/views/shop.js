import { S, h, fmt, act, sfx, toast, sprite, rarityName, bus, RARITY_ORDER, itemImg } from '../core.js';
import { openDetail } from './pokedex.js';
import { pickPokemon } from '../picker.js';
import { openItem } from './market.js';

let tab = 'items';

function timeLeft(until) {
  const ms = until - Date.now();
  return ms > 0 ? `${Math.ceil(ms / 60000)} min` : null;
}

export default {
  id: 'shop', title: 'Tienda y Mochila', icon: '🎒',
  mount(root) {
    const body = h('div', {});
    const tabs = h('div', { class: 'tabs' });
    let onlyMissing = true;

    function renderTabs() {
      tabs.replaceChildren(...[['items', '🏬 Tienda Poké'], ['bag', '🎒 Mochila'], ['craft', '✦ Fabricar'], ['exchange', '💱 Cambio']].map(([k, l]) =>
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
              let payload = { itemId: id };
              if (id === 'rare-candy') {
                const p = await pickPokemon({ title: '¿A quién le das el Caramelo Raro?' });
                if (!p) return;
                payload.pokeId = p.id;
              }
              const r = await act('item:use', payload, e.target);
              if (r && r.got) { const c = S.data.cosmetics[r.got]; sfx('big'); toast(`🥚 ¡${c.name}! Equípalo en «Mi Entrenador» o véndelo en el Mercado.`, 'success', 6000); }
              else if (r) { sfx('shiny'); toast(`Usaste ${it.name}`, 'success'); }
            } }, id === 'mystery-egg' ? 'Abrir' : 'Usar');
          return h('div', { class: 'shop-item item-card' }, itemImg(id, 'big'), h('div', { class: 'grow' }, h('b', {}, `${it.name} ×${n}`), h('div', { class: 'small muted' }, it.desc)),
            h('div', { class: 'stack' }, useBtn, h('button', { class: 'btn small', onclick: () => openItem({ kind: 'item', itemId: id }, 'sell') }, 'Vender')));
        })) : h('p', { class: 'muted' }, 'Tu mochila está vacía. Consigue objetos en la Tienda Poké, subiendo de nivel, con la recompensa diaria o en el Mercado.'));
    }

    function craftTab() {
      const list = h('div', { class: 'shop-grid' });
      const items = S.data.dex.filter((p) => !onlyMissing || !S.me.collection[p.id])
        .sort((a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity) || a.id - b.id);
      list.replaceChildren(...items.map((p) => {
        const cost = S.data.rarity[p.rarity].craft;
        const c = S.me.collection[p.id];
        return h('div', { class: `shop-item r-${p.rarity}` },
          h('img', { class: 'pixel' + (c ? '' : ' silhouette'), src: sprite(p.id), alt: '', loading: 'lazy', onclick: () => openDetail(p.id) }),
          h('div', { class: 'grow' }, h('b', {}, c ? p.name : '???'), h('div', { class: 'small muted' }, rarityName(p.rarity) + (c ? ` · ${'★'.repeat(Math.min(5, c.n))}` : ''))),
          h('button', { class: 'btn', disabled: S.me.dust < cost || (c && c.n >= 5), onclick: async (e) => {
            const r = await act('shop:craft', { id: p.id }, e.target);
            if (r) { sfx('win'); toast(`¡Fabricaste ${r.name}!`, 'success'); }
          } }, `${fmt(cost)} ✦`));
      }));
      return h('div', { class: 'stack' },
        h('label', { class: 'row gap' }, h('input', { type: 'checkbox', checked: onlyMissing, onchange: (e) => { onlyMissing = e.target.checked; render(); } }), 'Solo los que me faltan'),
        list);
    }

    function exchangeTab() {
      const amount = h('input', { type: 'number', min: 1, value: 100 });
      return h('div', { class: 'cards3' },
        h('div', { class: 'card stack' }, h('h3', {}, '💱 Polvo estelar → monedas'),
          h('p', { class: 'muted small' }, `1 ✦ = ${S.data.dustRate} monedas. Tienes ${fmt(S.me.dust)} ✦.`),
          h('div', { class: 'row gap' }, amount, h('button', { class: 'btn primary', onclick: async (e) => {
            const r = await act('shop:exchange', { amount: Number(amount.value) }, e.target);
            if (r) { sfx('win'); toast(`+${fmt(r.coins)} monedas`, 'success'); }
          } }, 'Cambiar'))),
        h('div', { class: 'card' }, h('h3', {}, '✦ ¿Cómo consigo polvo?'),
          h('p', { class: 'small' }, 'Los duplicados más allá de la 5ª copia y los variocolor repetidos se convierten en polvo estelar. También puedes liberar copias desde la Pokédex o comprarlo en el Mercado.')));
    }

    function render() {
      body.replaceChildren(tab === 'items' ? itemsTab() : tab === 'bag' ? bagTab() : tab === 'craft' ? craftTab() : exchangeTab());
    }
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🎒 Tienda y Mochila'), h('div', { class: 'pill dust' }, '✦ ', h('b', {}, fmt(S.me.dust)))), tabs, body);
    renderTabs();
    render();
    this.off = bus.on('me', () => { if (!document.activeElement || document.activeElement.tagName !== 'INPUT') render(); });
  },
  unmount() { this.off(); },
};
