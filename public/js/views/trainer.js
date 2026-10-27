import { S, h, fmt, act, sfx, toast, bus, sprite, avatar, titleTag, badgeImg, itemImg, goMarket, RAR_NAME, playingCard } from '../core.js';

// Cuántos anuncios hay en el Mercado de un Pokémon (para animar a comprar la pieza que falta).
let marketCache = null;
async function marketCounts() {
  if (!marketCache) {
    const r = await act('market:state');
    marketCache = r ? r.listings : [];
    setTimeout(() => { marketCache = null; }, 30000);
  }
  const by = {};
  for (const l of marketCache) if (l.kind === 'poke') by[l.pokeId] = (by[l.pokeId] || 0) + 1;
  return by;
}

export default {
  id: 'trainer', title: 'Mi Entrenador', icon: '🏅',
  async mount(root) {
    const body = h('div', { class: 'stack' });
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🏅 Mi Entrenador'), h('p', { class: 'muted' }, 'Medallas, colecciones y tu aspecto ante los demás.')), body);
    let counts = {};

    function render() {
      const me = S.me;
      const pr = me.progress;
      const looks = me.looks || {};
      const got = pr.badges.filter((b) => b.got).length;

      // --- Tarjeta de presentación ---
      const card = h('div', { class: 'card trainer-card' },
        avatar(me.buddy, looks, 'big'),
        h('div', { class: 'stack' },
          h('h2', {}, me.username, ' ', titleTag(looks.title)),
          h('div', { class: 'muted' }, `Nivel ${me.level} · ${got}/8 medallas · ${pr.sets.filter((s) => s.done).length} colecciones`),
          h('div', { class: 'row gap' }, playingCard(null, { back: me.equip.cardback, cls: 'small' }), playingCard(null, { back: me.equip.cardback, cls: 'small' }),
            h('span', { class: 'muted small' }, 'Así ven tus cartas en el póker')),
          h('div', { class: 'small' }, `Límite de apuesta: `, h('b', {}, fmt(me.maxBet)), got < 8 ? h('span', { class: 'muted' }, ` → ${fmt(S.data.maxBetByBadges[got + 1])} con la próxima medalla`) : null),
          h('div', { class: 'small' }, `Bonus de colecciones: `, h('b', { class: 'good' }, `+${(pr.setBonus * 100).toFixed(0)} %`), h('span', { class: 'muted' }, ' en cada ganancia neta'))));

      // --- Medallas ---
      const badges = h('div', { class: 'badge-grid' }, pr.badges.map((b) => {
        const [cur, max] = b.prog;
        return h('div', { class: 'badge-card' + (b.got ? ' got' : '') },
          badgeImg(b.n, b.got),
          h('div', { class: 'grow' }, h('b', {}, b.name), h('div', { class: 'muted small' }, `Líder ${b.leader}`), h('div', { class: 'small' }, b.req),
            b.got ? h('div', { class: 'small good' }, '✔ Conseguida') : h('div', { class: 'pity-bar' }, h('i', { style: { width: Math.min(100, (cur / max) * 100) + '%' } }))));
      }));
      const perks = h('div', { class: 'small muted' },
        'Cada medalla sube tu apuesta máxima, da monedas y objetos, y un título. Con 2 medallas abres la Mesa Ciudad Azulona y con 5 la Mesa Meseta Añil. Con las 8 serás Campeón de la Liga.');

      // --- Colecciones ---
      const sets = h('div', { class: 'set-grid' }, pr.sets.map((s) => h('div', { class: 'set-card' + (s.done ? ' done' : '') },
        h('div', { class: 'row between' }, h('b', {}, s.name), h('span', { class: s.done ? 'good' : 'muted' }, s.done ? '✔ Completa' : `${s.have}/${s.ids.length}`)),
        h('div', { class: 'set-mons' }, s.ids.map((id) => {
          const owned = me.collection[id];
          const p = S.dexById.get(id);
          const n = counts[id] || 0;
          return h('button', { class: 'set-mon' + (owned ? ' owned' : ''), title: owned ? p.name : `Te falta ${p.name}`, onclick: () => { if (!owned) goMarket(p.name); } },
            h('img', { class: 'pixel', src: sprite(id), alt: p.name }),
            !owned && n ? h('span', { class: 'for-sale' }, `🏪 ${n}`) : null);
        })),
        h('div', { class: 'small muted' }, `Recompensa: título «${s.title}», +1 % permanente y un Huevo Misterioso`))));

      // --- Aspecto (cosméticos y títulos) ---
      const owned = (slot) => Object.keys(me.items).filter((id) => S.data.cosmetics[id] && S.data.cosmetics[id].slot === slot);
      const slotBox = (slot, label) => {
        const list = owned(slot);
        const opts = [h('button', { class: 'cos-opt' + (!me.equip[slot] ? ' active' : ''), onclick: () => equip(slot, null) }, 'Ninguno')];
        if (slot === 'title') for (const t of pr.titles) opts.push(h('button', { class: 'cos-opt' + (me.equip.title === t.id ? ' active' : ''), onclick: () => equip('title', t.id) }, `«${t.text}»`));
        for (const id of list) {
          const c = S.data.cosmetics[id];
          opts.push(h('button', { class: `cos-opt r-${c.rarity}` + (me.equip[slot] === id ? ' active' : ''), onclick: () => equip(slot, id) }, itemImg(id), c.title ? `«${c.title}»` : c.name, me.items[id] > 1 ? h('span', { class: 'muted small' }, ` ×${me.items[id]}`) : null));
        }
        return h('div', { class: 'card stack' }, h('h3', {}, label), h('div', { class: 'row gap wrap' }, opts),
          h('button', { class: 'btn small', onclick: () => goMarket(slot === 'frame' ? 'Marco' : slot === 'cardback' ? 'Dorso' : 'Título') }, '🏪 Buscar más en el Mercado'));
      };
      const eggs = me.items['mystery-egg'] || 0;
      const eggBox = h('div', { class: 'card stack egg-card' },
        h('h3', {}, '🥚 Huevos Misteriosos'),
        h('p', { class: 'small muted' }, 'Cada huevo trae un cosmético al azar: Común 40 %, Poco común 30 %, Raro 18 %, Épico 9 %, Legendario 3 %. Los repetidos puedes venderlos en el Mercado y comprar los que te gusten.'),
        h('button', { class: 'btn primary', disabled: !eggs, onclick: async (e) => {
          const r = await act('item:use', { itemId: 'mystery-egg' }, e.target);
          if (r) { const c = S.data.cosmetics[r.got]; sfx(c.rarity === 'L' || c.rarity === 'E' ? 'big' : 'shiny'); toast(`🥚 ¡${c.name}! (${RAR_NAME[c.rarity]})`, 'success', 6000); }
        } }, `Abrir huevo (${eggs})`));

      body.replaceChildren(card,
        h('h2', { class: 'section-title' }, `Medallas de Kanto (${got}/8)`), perks, badges,
        h('h2', { class: 'section-title' }, 'Aspecto'),
        h('div', { class: 'cards3' }, slotBox('frame', '🖼️ Marco de avatar'), slotBox('cardback', '🂠 Dorso de carta'), slotBox('title', '🏷️ Título'), eggBox),
        h('h2', { class: 'section-title' }, 'Colecciones'),
        h('p', { class: 'small muted' }, 'Toca un Pokémon que te falte para buscarlo en el Mercado. 🏪 indica cuántos hay a la venta.'),
        sets);
    }
    async function equip(slot, id) { if (await act('equip', { slot, id })) sfx('click'); }
    render();
    this.off = bus.on('me', render);
    counts = await marketCounts();
    render();
  },
  unmount() { this.off(); },
};
