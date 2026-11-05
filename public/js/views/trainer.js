import { historyCard } from './history.js';
import { S, h, fmt, act, sfx, toast, bus, sprite, avatar, titleTag, badgeImg, itemImg, goMarket, playingCard, fmtPlay } from '../core.js';
import { openEgg } from '../rewards.js';
import { hofList } from './elite-ui.js';
import { lotteryPanel } from './lottery-ui.js';
import { showRegion } from './pokedex.js';

// Cuántos anuncios hay en el Mercado de un Pokémon (para animar a comprar la pieza que falta).
let marketCache = null;
async function marketCounts() {
  if (!marketCache) {
    const r = await act('market:state');
    marketCache = r ? r.orders.filter((o) => o.side === 'sell') : [];
    setTimeout(() => { marketCache = null; }, 30000);
  }
  const by = {};
  for (const l of marketCache) if (l.kind === 'poke') by[l.pokeId] = (by[l.pokeId] || 0) + l.qty;
  return by;
}

let trTab = 'perfil';
export default {
  id: 'trainer', title: 'Mi Entrenador', icon: '🏅',
  async mount(root) {
    const body = h('div', { class: 'stack tr-panel' });
    const hist = h('div', { class: 'tr-hist' }, h('h2', { class: 'section-title' }, 'Historial'));
    // Pestañas: todo el perfil cabe en una pantalla; cada pestaña muestra un bloque.
    const TABS = [['perfil', '🙋', 'Perfil'], ['medallas', '🏅', 'Medallas'], ['aspecto', '🎨', 'Aspecto'], ['colecciones', '📚', 'Colecciones'], ['loteria', '🎟️', 'Lotería']];
    const tabsEl = h('div', { class: 'tabs tr-tabs', role: 'tablist' });
    const paintTabs = () => tabsEl.replaceChildren(...TABS.map(([id, ico, l]) => h('button', { class: 'tab' + (trTab === id ? ' active' : ''), role: 'tab', 'aria-selected': String(trTab === id), onclick: () => { trTab = id; paintTabs(); render(); } }, `${ico} ${l}`)));
    paintTabs();
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🏅 Mi Entrenador'), h('p', { class: 'muted' }, 'Medallas, colecciones, tu aspecto y tus cuentas.')), tabsEl, body);
    historyCard().then((c) => hist.append(c));
    let counts = {};
    let lotEl = null;

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
          h('div', { class: 'muted' }, `ID ${me.tid} · Nivel ${me.level} · ${got}/8 medallas · ${pr.sets.filter((s) => s.done).length} colecciones`),
          h('div', { class: 'row gap' }, playingCard(null, { back: me.equip.cardback, cls: 'small' }), playingCard(null, { back: me.equip.cardback, cls: 'small' }),
            h('span', { class: 'muted small' }, 'Así ven tus cartas en el póker')),
          h('div', { class: 'small' }, `Límite de apuesta: `, h('b', {}, fmt(me.maxBet)), got < 8 ? h('span', { class: 'muted' }, ` → ${fmt(S.data.maxBetByBadges[got + 1])} con la próxima medalla`) : null),
          // Tiempo de juego, con interruptor público/privado.
          h('div', { class: 'small row gap wrap' }, '⏱️ Tiempo de juego: ', h('b', {}, fmtPlay(me.playMs)),
            h('button', { class: 'btn small', type: 'button', title: 'Decide si los demás pueden ver tu tiempo de juego en tu ficha y en el ranking', onclick: async (e) => {
              const btn = e.currentTarget; // (después del await ya no existe currentTarget)
              const r = await act('play:privacy', { public: !me.playPublic }, btn);
              if (r) { me.playPublic = r.playPublic; btn.textContent = r.playPublic ? '🌐 Público' : '🔒 Privado'; toast(r.playPublic ? 'Tu tiempo de juego es público' : 'Tu tiempo de juego es privado', 'info'); }
            } }, me.playPublic ? '🌐 Público' : '🔒 Privado')),
          h('div', { class: 'small' }, `Bonus de colecciones: `, h('b', { class: 'good' }, `+${(pr.setBonus * 100).toFixed(0)} %`), h('span', { class: 'muted' }, ` en cada ganancia neta · hoy has cobrado ${fmt(me.bonusPaid)} de bonus (tope ${fmt(me.bonusCap)}, ligado a lo que apuestas)`))));

      // --- Medallas ---
      const badges = h('div', { class: 'badge-grid' }, pr.badges.map((b) => {
        const [cur, max] = b.prog;
        return h('div', { class: 'badge-card' + (b.got ? ' got' : '') },
          badgeImg(b.n, b.got),
          h('div', { class: 'grow' }, h('b', {}, b.name), h('div', { class: 'muted small' }, `Líder ${b.leader} · ${b.city}`), h('div', { class: 'small', 'data-testid': 'badge-req' }, b.req),
            b.got ? h('div', { class: 'small good' }, '✔ Conseguida') : h('a', { class: 'btn small primary', href: '#/combates' }, '⚔️ Retar a ' + b.leader)));
      }));
      const perks = h('div', { class: 'small muted' },
        'Como en los juegos, las medallas se ganan venciendo a los Líderes de Gimnasio de Kanto en Combates, en orden. Cada medalla sube tu apuesta máxima, da monedas y objetos, y un título. Con 2 medallas abres la Mesa Ciudad Azulona y con 5 la Mesa Meseta Añil. Con las 8 se abre el Alto Mando: véncelo (y al Campeón) para ser Campeón de la Liga y entrar en el Salón de la Fama.');

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
          await openEgg(e.target);
        } }, `Abrir huevo (${eggs})`));

      // --- Caja con candado (solo si hay algo) ---
      const lockedIds = Object.keys(me.locked || {}).map(Number);
      const lp = me.lockedProg;
      const lockedBox = lockedIds.length ? h('div', { class: 'card stack locked-box' },
        h('h3', {}, `🔒 Caja con candado (${lockedIds.length})`),
        h('p', { class: 'small muted' }, `Pokémon guardados que no cuentan en tu Pokédex ni en el ranking. Recuperaciones disponibles: ${lp ? lp.credits : 0} · progreso ${lp ? `${fmt(lp.wager)}/${fmt(lp.step.wager)} apostadas o ${lp.pulls}/${lp.step.pulls} tiradas` : ''}. También vuelven solos si te salen en el gacha.`),
        h('div', { class: 'set-mons' }, lockedIds.map((id) => h('span', { class: 'set-mon owned locked', title: S.dexById.get(id).name },
          h('img', { class: 'pixel', src: sprite(id), alt: S.dexById.get(id).name }))))) : null;

      if (trTab === 'perfil') body.replaceChildren(h('div', { class: 'tr-profile' }, h('div', { class: 'stack' }, card, lockedBox || ''), hist));
      else if (trTab === 'medallas') body.replaceChildren(h('h2', { class: 'section-title' }, `Medallas de Kanto (${got}/8)`), perks, badges, h('h2', { class: 'section-title' }, '🏛️ Salón de la Fama'), hofList(me.hof, { limit: 20 }), got >= 8 ? h('a', { class: 'btn primary', href: '#/combates/alto-mando' }, '👑 Ir al Alto Mando') : null);
      else if (trTab === 'aspecto') body.replaceChildren(h('div', { class: 'cards3 tr-looks' }, slotBox('frame', '🖼️ Marco de avatar'), slotBox('cardback', '🂠 Dorso de carta'), slotBox('title', '🏷️ Título'), eggBox));
      else if (trTab === 'loteria') { // (el panel se crea una sola vez: cargar su estado dispara «me», que volvería a pintar esta vista)
        if (lotEl) body.replaceChildren(lotEl);
        else { body.replaceChildren(h('p', { class: 'small muted' }, 'Cargando…')); lotEl = false; lotteryPanel().then((el) => { lotEl = el; if (trTab === 'loteria') body.replaceChildren(el); }); }
      }
      else body.replaceChildren(regionsBlock(), h('h2', { class: 'section-title' }, '📚 Colecciones'), h('p', { class: 'small muted' }, 'Toca un Pokémon que te falte para buscarlo en el Mercado. 🏪 indica cuántos hay a la venta.'), sets);
    }
    // Pokédex regionales: obtenidos / total y Diploma del Game Freak (título y marco) al completarlas.
    function regionsBlock() {
      const regs = S.me.dexReg || [];
      const done = regs.filter((r) => r.diploma).length;
      return h('div', { class: 'stack' },
        h('h2', { class: 'section-title' }, `🗺️ Pokédex regionales (${done}/${regs.length} diplomas)`),
        h('p', { class: 'small muted' }, 'Como en los juegos: completa la Pokédex de una región (cuentan los Pokémon que has llegado a tener) y recibes el Diploma del Game Freak: título y marco de avatar, una sola vez.'),
        h('div', { class: 'reg-grid' }, regs.map((r) => {
          const col = (S.data.regions.find((x) => x.id === r.id) || {}).color;
          return h('button', { class: 'reg-card' + (r.diploma ? ' done' : ''), type: 'button', style: { '--rc': col }, title: `Ver la Pokédex de ${r.name}`, onclick: () => showRegion(r.gen) },
            h('div', { class: 'row between' }, h('b', {}, r.name), h('span', { class: r.diploma ? 'good' : 'muted small' }, r.diploma ? '📜 Diploma' : `${r.have}/${r.total}`)),
            h('div', { class: 'reg-bar' }, h('i', { style: { width: Math.round(100 * r.have / r.total) + '%' } })),
            h('div', { class: 'small muted' }, r.diploma ? `Completa (${r.total}) · ${new Date(r.diploma).toLocaleDateString('es-ES')}` : `Faltan ${r.total - r.have}`));
        })));
    }
    async function equip(slot, id) { if (await act('equip', { slot, id })) sfx('click'); }
    render();
    this.off = bus.on('me', render);
    counts = await marketCounts();
    render();
  },
  unmount() { this.off(); },
};
