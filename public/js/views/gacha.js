import { S, h, fmt, emit, act, sfx, toast, art, item, pokeImg, rarityName, typeBadge, sleep, itemImg } from '../core.js';

const BALL = { C: 'poke-ball', U: 'poke-ball', R: 'great-ball', E: 'ultra-ball', L: 'master-ball', M: 'master-ball' };
const RANK = { C: 0, U: 1, R: 2, E: 3, L: 4, M: 5 };
let selected = 'kanto';

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
      const pity = S.me.pity[b.id] || { sinceL: 0, sinceR: 0, guaranteed: false };
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
              h('div', {}, 'Pity legendario: ', h('b', {}, `${pity.sinceL}/${S.data.hardPity}`), h('div', { class: 'pity-bar' }, h('i', { style: { width: (pity.sinceL / S.data.hardPity) * 100 + '%' } }))),
              h('div', { class: 'small muted' }, `Rara o mejor garantizada cada 10 tiradas (${pity.sinceR}/10). Desde la ${S.data.softPity}ª tirada la probabilidad legendaria sube rápidamente.`),
              b.featuredL.length ? h('div', { class: 'small ' + (pity.guaranteed ? 'good' : 'muted') }, pity.guaranteed ? '✔ Tu próxima legendaria será destacada.' : '50 % de que tu legendaria sea destacada; si no, la siguiente lo será.') : null)),
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
      btn.disabled = true;
      let res;
      try { res = await emit('gacha:pull', { banner: selected, count, free, ticket }); } catch (e) { toast(e.message, 'error'); sfx('error'); btn.disabled = false; return; }
      await reveal(res.results);
      for (const it of res.bonus || []) toast(`🎁 ¡Regalo de la tirada ×10: ${S.data.items[it].name}!`, 'success', 6000);
      renderStage();
    }

    const ev = S.events && S.events.active.find((e) => e.id === 'shiny');
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🎁 Poké Gacha'), h('p', { class: 'muted' }, 'Lanza Poké Balls y descubre qué Pokémon atrapas.', ev ? h('span', { class: 'event-pill' }, `${ev.icon} ${ev.name}: variocolor ×2`) : null)), tabs, stage);
    renderTabs(); renderStage();
  },
};

// Animación de apertura.
function reveal(results) {
  return new Promise((resolve) => {
    const top = results.reduce((m, r) => (RANK[r.rarity] > RANK[m] ? r.rarity : m), 'C');
    const anyShiny = results.some((r) => r.shiny);
    let skip = false;
    const ball = h('img', { class: 'pixel reveal-ball', src: item(BALL[top === 'M' ? 'L' : top]), alt: '' });
    const flash = h('div', { class: 'reveal-flash r-' + top });
    const cards = h('div', { class: 'reveal-cards' + (results.length > 1 ? ' multi' : '') });
    const hint = h('div', { class: 'reveal-hint' }, 'Toca para saltar');
    const done = h('button', { class: 'btn primary big hidden', onclick: () => { ov.remove(); resolve(); } }, 'Continuar');
    const ov = h('div', { class: 'reveal' + (anyShiny ? ' has-shiny' : ''), onclick: (e) => { if (e.target !== done) skip = true; } }, flash, ball, cards, hint, done);
    document.body.append(ov);
    (async () => {
      sfx('click');
      ball.classList.add('shake');
      await sleep(skip ? 0 : top === 'C' || top === 'U' ? 1200 : 2000);
      ball.classList.add('open');
      flash.classList.add('go');
      sfx(RANK[top] >= 4 ? 'big' : RANK[top] >= 2 ? 'win' : 'flip');
      await sleep(skip ? 0 : 450);
      ball.remove();
      for (const r of results) {
        const p = S.dexById.get(r.id);
        cards.append(h('div', { class: `pcard r-${r.rarity}${r.shiny ? ' shiny' : ''} pop` },
          r.isNew ? h('span', { class: 'new-tag' }, '¡NUEVO!') : null,
          r.newShiny ? h('span', { class: 'new-tag shiny-tag' }, '✨ VARIOCOLOR') : null,
          pokeImg(r.id, r.shiny, 'pcard-art'),
          h('b', {}, p.name), h('div', { class: 'types' }, p.types.map(typeBadge)),
          h('span', { class: 'rar r-' + r.rarity }, rarityName(r.rarity)),
          h('span', { class: 'stars' }, '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars)),
          r.dust ? h('span', { class: 'small dust' }, `+${r.dust} ✦`) : null));
        if (r.shiny) sfx('shiny');
        if (!skip) await sleep(results.length > 1 ? (RANK[r.rarity] >= 3 ? 700 : 220) : 300);
      }
      hint.remove();
      done.classList.remove('hidden');
    })();
  });
}
