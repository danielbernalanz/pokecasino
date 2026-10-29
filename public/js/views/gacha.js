import { S, h, fmt, emit, act, sfx, toast, art, item, pokeImg, rarityName, typeBadge, sleep, itemImg, confirmRisk } from '../core.js';
import { useFx } from '../rewards.js';
import { centerOf } from '../fx.js';
import { reveal } from './gacha-reveal.js';

let selected = 'kanto';
const pct = (x) => (x * 100).toFixed(1).replace('.', ',') + ' %';

export default {
  id: 'gacha', title: 'Poké Gacha', icon: '🎁',
  mount(root) {
    const byId = new Map(S.data.banners.map((b) => [b.id, b]));
    let rot = null; // rotación que manda el servidor: { permanent, promo, ends, next, now }
    let skew = 0; // desfase reloj servidor - cliente
    let timer = null;
    let gone = false;
    const tabs = h('div', { class: 'banner-tabs banner-duo' });
    const nextLine = h('p', { class: 'small muted banner-next' });
    const stage = h('div', { class: 'banner-stage' });
    const nowS = () => Date.now() + skew;
    const left = (ms) => {
      const m = Math.max(1, Math.ceil(ms / 60000));
      if (m >= 1440) { const d = Math.floor(m / 1440); const hh = Math.floor((m % 1440) / 60); return `${d} d${hh ? ' ' + hh + ' h' : ''}`; }
      return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
    };

    async function loadRotation() {
      try {
        const r = await emit('gacha:banners');
        rot = r; skew = r.now - Date.now();
      } catch { /* sin conexión: se reintenta en el siguiente minuto */ }
      if (gone) return;
      if (!rot) rot = { permanent: 'kanto', promo: null, ends: 0, next: null };
      if (selected !== rot.permanent && selected !== rot.promo) selected = rot.permanent;
      renderTabs(); renderStage();
    }

    // Cada minuto se actualiza la cuenta atrás; al terminar la promoción se pide la nueva al servidor.
    function tick() {
      if (rot && rot.promo && nowS() >= rot.ends) { loadRotation(); return; }
      renderTabs();
    }

    function renderTabs() {
      if (!rot) return;
      const cards = [[rot.permanent, 'Permanente', 'siempre disponible']];
      if (rot.promo) cards.push([rot.promo, 'Promocional', `termina en ${left(rot.ends - nowS())}`]);
      tabs.replaceChildren(...cards.map(([id, kind, sub]) => {
        const b = byId.get(id);
        return h('button', { class: 'banner-tab' + (id === selected ? ' active' : ''), style: { '--c': b.theme }, onclick: () => { selected = id; sfx('click'); renderTabs(); renderStage(); } },
          h('img', { src: art(b.art), alt: '' }),
          h('span', {}, h('b', {}, kind), h('small', {}, b.name), h('small', { class: 'muted' }, sub)));
      }));
      nextLine.replaceChildren(rot.next ? `Próximo banner: ${rot.next.name} (dentro de ${left(rot.next.starts - nowS())})` : '');
    }

    function renderStage() {
      if (!rot) return;
      const b = byId.get(selected);
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
          h('table', {}, h('tbody', {}, Object.entries(S.data.gachaRates).map(([r, p]) => h('tr', {}, h('td', {}, h('span', { class: 'rar r-' + r }, rarityName(r))), h('td', {}, `${String(parseFloat((p * 100).toFixed(2))).replace('.', ',')} %`), h('td', { class: 'muted' }, `${S.data.rarity[r].dust} ✦ por duplicado extra`))))),
          h('p', { class: 'small muted' }, `Variocolor: 1/${Math.round(1 / S.data.shinyRate)} en cualquier tirada. Cada copia (hasta 5) da una estrella al Pokémon: más fuerza en duelos y más bonus como compañero. A partir de la 5ª copia se convierte en polvo estelar. Dentro de cada rareza, las formas evolucionadas salen mucho menos: una primera evolución con un cuarto de probabilidad y una evolución final con un 6 % de la de una forma básica (legendarios y míticos no cambian).`)));
    }

    // Objetos que afectan a las tiradas.
    function buffsRow() {
      const b = S.me.buffs || {};
      const parts = [];
      if (b.masterBall) parts.push(h('span', { class: 'chip active' }, itemImg('master-ball'), ' Master Ball preparada: tu próxima tirada será legendaria'));
      else if (S.me.items['master-ball']) parts.push(h('button', { class: 'chip', onclick: async (e) => { const at = centerOf(e.currentTarget); if (await act('item:use', { itemId: 'master-ball' })) { useFx('master-ball', at); renderStage(); } } }, itemImg('master-ball'), ` Preparar Master Ball (${S.me.items['master-ball']})`));
      if (b.shinyCharges > 0) parts.push(h('span', { class: 'chip active' }, itemImg('shiny-charm'), ` Amuleto Iris: ${b.shinyCharges} tiradas ×4 variocolor`));
      else if (S.me.items['shiny-charm']) parts.push(h('button', { class: 'chip', onclick: async (e) => { const at = centerOf(e.currentTarget); if (await act('item:use', { itemId: 'shiny-charm' })) { useFx('shiny-charm', at); renderStage(); } } }, itemImg('shiny-charm'), ` Activar Amuleto Iris (${S.me.items['shiny-charm']})`));
      return parts.length ? h('div', { class: 'row gap wrap buffs' }, parts) : '';
    }

    async function pull(count, free, btn, ticket = false) {
      if (!free && !ticket) {
        const cost = S.data.gachaCost[count];
        const coins = S.me.coins;
        const left = coins - cost;
        const limit = S.data.heal?.limit ?? 200;
        if (cost >= coins * 0.5 || (left < limit && coins >= limit)) {
          const ok = await confirmRisk('gacha-spend', {
            title: 'Gasto grande en el Gacha', danger: 'Tirar igualmente', safe: 'Cancelar',
            text: `Esta tirada ×${count} cuesta ${fmt(cost)} de tus ${fmt(coins)} monedas (${Math.round(cost / Math.max(1, coins) * 100)} %).${left < limit ? ` Te quedarías con ${fmt(Math.max(0, left))}: la enfermera Joy solo presta con menos de ${fmt(limit)} monedas y una vez por hora.` : ''}`,
            details: ['El Gacha no garantiza ninguna rareza concreta: cada tirada es independiente.'] });
          if (!ok) return;
        }
      }
      const cur = byId.get(selected);
      const promoB = rot && rot.promo ? byId.get(rot.promo) : null;
      if ((S.me.buffs || {}).masterBall && cur && !cur.featuredL.length && promoB && promoB.featuredL.length && !(await confirmRisk('masterball-banner', {
        title: 'Master Ball en el banner permanente', danger: 'Usarla aquí', safe: 'Cambiar de banner',
        text: `Tienes la Master Ball preparada y estás tirando en «${cur.name}», que no tiene legendarias destacadas. Solo en banners promocionales asegura una destacada: ahora mismo «${promoB.name}» tiene ${promoB.featuredL.map((id) => S.dexById.get(id).name).join(', ')}.` }))) return;
      if (btn) btn.disabled = true;
      let res;
      try { res = await emit('gacha:pull', { banner: selected, count, free, ticket }); } catch (e) { toast(e.message, 'error'); sfx('error'); if (btn) btn.disabled = false; if (/disponible/.test(e.message)) loadRotation(); return; }
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
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🎁 Poké Gacha'), h('p', { class: 'muted' }, 'Lanza Poké Balls y descubre qué Pokémon atrapas.', ev ? h('span', { class: 'event-pill' }, `${ev.icon} ${ev.name}: variocolor ×2`) : null)), tabs, nextLine, stage);
    loadRotation();
    timer = setInterval(tick, 60000);
    this.stopTimer = () => { gone = true; clearInterval(timer); };
  },
  unmount() { if (this.stopTimer) this.stopTimer(); this.stopTimer = null; },
};

