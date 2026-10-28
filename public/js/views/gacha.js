import { S, h, fmt, emit, act, sfx, toast, art, item, pokeImg, rarityName, typeBadge, sleep, itemImg } from '../core.js';
import { reveal } from './gacha-reveal.js';

let selected = 'kanto';
const pct = (x) => (x * 100).toFixed(1).replace('.', ',') + ' %';

export default {
  id: 'gacha', title: 'Poké Gacha', icon: '🎁',
  mount(root) {
    const banners = S.data.banners;
    const tabs = h('div', { class: 'banner-tabs' });
    const stage = h('div', { class: 'banner-stage' });

    function renderTabs() {
      tabs.replaceChildren(...banners.map((b) => h('button', { class: 'banner-tab' + (b.id === selected ? ' active' : ''), style: { '--c': b.theme }, onclick: () => { selected = b.id; sfx('click'); renderTabs(); renderStage(); } },
        h('img', { src: art(b.art), alt: '' }), h('span', {}, b.name))));
    }

    function renderStage() {
      const b = banners.find((x) => x.id === selected);
      const today = new Date().toISOString().slice(0, 10);
      const freeAvail = S.me.daily.freePull !== today;
      const featured = [...b.featuredL, ...b.featuredE];
      stage.style.setProperty('--c', b.theme);
      stage.replaceChildren(
        h('div', { class: 'banner-hero' },
          h('div', { class: 'banner-info' },
            h('h2', {}, b.name), h('p', {}, b.desc),
            featured.length ? h('div', { class: 'featured' }, featured.map((id) => h('div', { class: 'feat' }, pokeImg(id, false), h('span', {}, S.dexById.get(id).name)))) : null,
            h('div', { class: 'pity' },
              h('div', {}, 'Legendaria o mítica: ', h('b', {}, pct(S.data.gachaRates.L + S.data.gachaRates.M * (b.mythicBoost || 1))), ' en cada tirada · sin pity'),
              h('div', { class: 'small muted' }, 'Cada tirada es independiente. Los sobres ×10 traen al menos una Rara.'),
              h('div', { class: 'small' }, itemImg('master-ball'), b.featuredL.length
                ? ' La Master Ball asegura una legendaria destacada de este banner (sin ella, 50 % de destacada).'
                : ' La Master Ball asegura una legendaria.'))),
          h('img', { class: 'banner-art float', src: art(b.art), alt: '' })),
        buffsRow(),
        h('div', { class: 'pull-row' },
          h('button', { class: 'btn big gold', disabled: !freeAvail, onclick: (e) => pull(1, true, e.target) }, freeAvail ? '🎁 Tirada gratis' : 'Gratis mañana'),
          h('button', { class: 'btn big primary', onclick: (e) => pull(1, false, e.target) }, h('img', { class: 'pixel', src: item('poke-ball'), alt: '' }), ` ×1 · ${fmt(S.data.gachaCost[1])}`),
          h('button', { class: 'btn big primary', onclick: (e) => pull(10, false, e.target) }, h('img', { class: 'pixel', src: item('master-ball'), alt: '' }), ` ×10 · ${fmt(S.data.gachaCost[10])}`)),
        (S.me.items.ticket || 0) > 0 ? h('div', { class: 'pull-row' },
          h('button', { class: 'btn big', onclick: (e) => pull(1, false, e.target, true) }, itemImg('ticket'), ` Ticket ×1 (tienes ${S.me.items.ticket})`),
          S.me.items.ticket >= 10 ? h('button', { class: 'btn big', onclick: (e) => pull(10, false, e.target, true) }, itemImg('ticket'), ' Tickets ×10') : null) : '',
        h('details', { class: 'rates' }, h('summary', {}, 'Probabilidades y reglas'),
          h('table', {}, h('tbody', {}, Object.entries(S.data.gachaRates).map(([r, p]) => h('tr', {}, h('td', {}, h('span', { class: 'rar r-' + r }, rarityName(r))), h('td', {}, (p * 100).toFixed(1) + ' %'), h('td', { class: 'muted' }, `${S.data.rarity[r].dust} ✦ por duplicado extra`))))),
          h('p', { class: 'small muted' }, `Variocolor: 1/${Math.round(1 / S.data.shinyRate)} en cualquier tirada. Cada copia (hasta 5) da una estrella al Pokémon: más fuerza en duelos y más bonus como compañero. A partir de la 5ª copia se convierte en polvo estelar.`)));
    }

    // Objetos que afectan a las tiradas.
    function buffsRow() {
      const b = S.me.buffs || {};
      const parts = [];
      if (b.masterBall) parts.push(h('span', { class: 'chip active' }, itemImg('master-ball'), ' Master Ball preparada: tu próxima tirada será legendaria'));
      else if (S.me.items['master-ball']) parts.push(h('button', { class: 'chip', onclick: async () => { if (await act('item:use', { itemId: 'master-ball' })) { sfx('shiny'); renderStage(); } } }, itemImg('master-ball'), ` Preparar Master Ball (${S.me.items['master-ball']})`));
      if (b.shinyCharges > 0) parts.push(h('span', { class: 'chip active' }, itemImg('shiny-charm'), ` Amuleto Iris: ${b.shinyCharges} tiradas ×4 variocolor`));
      else if (S.me.items['shiny-charm']) parts.push(h('button', { class: 'chip', onclick: async () => { if (await act('item:use', { itemId: 'shiny-charm' })) { sfx('shiny'); renderStage(); } } }, itemImg('shiny-charm'), ` Activar Amuleto Iris (${S.me.items['shiny-charm']})`));
      return parts.length ? h('div', { class: 'row gap wrap buffs' }, parts) : '';
    }

    async function pull(count, free, btn, ticket = false) {
      if (btn) btn.disabled = true;
      let res;
      try { res = await emit('gacha:pull', { banner: selected, count, free, ticket }); } catch (e) { toast(e.message, 'error'); sfx('error'); if (btn) btn.disabled = false; return; }
      // Al terminar se puede volver a tirar sin salir de la animación (con monedas o con tickets).
      const again = await reveal(res.results, {
        bonus: res.bonus || [],
        again: (n) => ticket ? (S.me.items.ticket || 0) >= n : S.me.coins >= S.data.gachaCost[n],
        againLabel: (n) => ticket ? `Otra vez ×${n} (ticket${n > 1 ? 's' : ''})` : `Otra vez ×${n} · ${fmt(S.data.gachaCost[n])}`,
      });
      renderStage();
      if (again) pull(again, false, null, ticket);
    }

    const ev = S.events && S.events.active.find((e) => e.id === 'shiny');
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🎁 Poké Gacha'), h('p', { class: 'muted' }, 'Lanza Poké Balls y descubre qué Pokémon atrapas.', ev ? h('span', { class: 'event-pill' }, `${ev.icon} ${ev.name}: variocolor ×2`) : null)), tabs, stage);
    renderTabs(); renderStage();
  },
};

