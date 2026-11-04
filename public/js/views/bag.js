// Mochila: tus objetos (Usar / Equipar / Enseñar / Abrir / Vender) y los efectos activos. Ruta #/bag.
import { S, h, bus, act, sfx, toast, confirmRisk, itemImg } from '../core.js';
import { pickPokemon } from '../picker.js';
import { openItem } from './market.js';
import { openEgg, useFx } from '../rewards.js';
import { centerOf } from '../fx.js';
import { useTmDialog } from './tm-ui.js';

function timeLeft(until) {
  const ms = until - Date.now();
  return ms > 0 ? `${Math.ceil(ms / 60000)} min` : null;
}

export function bagTab() {
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
        : it.tm ? h('button', { class: 'btn primary', onclick: () => useTmDialog(id) }, 'Enseñar')
          : it.shard ? h('a', { class: 'btn', href: '#/pc' }, 'Tutor (Caja PC)')
          : it.bp || it.ev || it.evo ? h('a', { class: 'btn', href: '#/pc' }, 'Usar en la Caja PC')
          : it.material ? h('a', { class: 'btn', href: '#/workshop/tm' }, 'Máquina MT (Taller)')
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


export default {
  id: 'bag', title: 'Mochila', icon: '🎒',
  mount(root) {
    // Misma maquetación a pantalla completa que la Tienda (fit.css).
    root.classList.add('view-shop');
    const body = h('div', {});
    const render = () => body.replaceChildren(bagTab());
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🎒 Mochila'), h('div', { class: 'row gap wrap' },
      h('a', { class: 'btn small', href: '#/shop' }, '🏬 Tienda Poké'), h('a', { class: 'btn small', href: '#/workshop/recycle' }, '♻️ Reciclar'))), body);
    render();
    this.off = bus.on('me', () => { if (!document.activeElement || document.activeElement.tagName !== 'INPUT') render(); });
  },
  unmount() { if (this.off) this.off(); },
};
