import { S, h, fmt, act, sfx, toast, art, item, pokeImg, badgeImg, bus } from '../core.js';
import { canInstall, installApp } from '../main.js';
import { dailyChest } from '../rewards.js';

function rewardText(r) {
  const parts = [];
  if (r.coins) parts.push(`${fmt(r.coins)} monedas`);
  for (const [id, n] of Object.entries(r.items || {})) parts.push(`${n}× ${S.data.items[id].name}`);
  if (r.title) parts.push('un título');
  return parts.join(' + ');
}

const GAMES = [
  { id: 'poker', name: "Texas Hold'em", desc: 'Póker No-Limit contra tus amigos, en mesas en directo.', art: 94, ico: 'nugget', tag: 'MULTIJUGADOR' },
  { id: 'crash', name: 'Crash Rocket', desc: '¡Retírate antes de que el Team Rocket salga volando!', art: 52, ico: 'dire-hit', tag: 'MULTIJUGADOR' },
  { id: 'race', name: 'Gran Carrera', desc: 'Apuesta con todos en carreras en directo.', art: 78, ico: 'rare-candy', tag: 'MULTIJUGADOR' },
  { id: 'duels', name: 'Duelos PvP', desc: 'Reta a otros entrenadores con tus Pokémon.', art: 68, ico: 'ultra-ball', tag: 'MULTIJUGADOR' },
  { id: 'blackjack', name: 'Blackjack', desc: 'Planta cara a Snorlax: 3:2, doblar y dividir.', art: 143, ico: 'big-nugget' },
  { id: 'videopoker', name: 'Video Póker', desc: 'Jacks or Better, el de mejor RTP.', art: 65, ico: 'pearl' },
  { id: 'baccarat', name: 'Baccarat', desc: 'Punto o Banca con Mr. Mime de crupier.', art: 122, ico: 'star-piece' },
  { id: 'roulette', name: 'Ruleta de Tipos', desc: '18 tipos y la temida casilla Poké Ball.', art: 137, ico: 'poke-ball' },
  { id: 'slots', name: 'Pika-Slots', desc: '5 líneas, Ditto comodín y bote progresivo.', art: 25, ico: 'master-ball' },
  { id: 'plinko', name: 'Plinko', desc: 'Suelta Poké Balls entre los clavos.', art: 113, ico: 'great-ball' },
  { id: 'mines', name: 'Minas Geodude', desc: 'Descubre Trozos Estrella sin despertar a Geodude.', art: 74, ico: 'star-piece' },
  { id: 'voltorb', name: 'Voltorb Flip', desc: 'El clásico de la Esquina de Juegos.', art: 100, ico: 'nugget' },
  { id: 'gacha', name: 'Poké Gacha', desc: 'Banners legendarios, Master Balls y variocolores.', art: 150, ico: 'great-ball' },
  { id: 'market', name: 'Mercado', desc: 'Compra y vende Pokémon y objetos.', art: 52, ico: 'amulet-coin' },
];

// Eventos activos y el siguiente, con la cuenta atrás en palabras.
const left = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} días`; };
const WEEKDAY = (t) => new Date(t).toLocaleDateString('es-ES', { weekday: 'long', timeZone: 'Europe/Madrid' });
export function eventsCard() {
  const ev = S.events;
  if (!ev) return '';
  if (!ev.active.length) {
    return ev.next ? h('div', { class: 'card event-card soon' }, h('span', { class: 'event-ico' }, ev.next.events[0].icon),
      h('div', { class: 'grow' }, h('b', {}, `Próximo evento: ${ev.next.events.map((e) => e.name).join(' y ')}`),
        h('div', { class: 'small muted' }, `Empieza el ${WEEKDAY(ev.next.starts)} (en ${left(ev.next.starts - Date.now())}). ${ev.next.events.map((e) => e.desc).join(' ')}`))) : '';
  }
  return h('div', { class: 'card event-card' }, h('div', { class: 'event-title' }, '🎉 Evento activo'),
    ev.active.map((e) => h('div', { class: 'row gap event-row' }, h('span', { class: 'event-ico' }, e.icon),
      h('div', { class: 'grow' }, h('b', {}, e.name), h('div', { class: 'small' }, e.desc)),
      h('span', { class: 'muted small nowrap' }, `quedan ${left(e.ends - Date.now())}`))));
}

export default {
  id: 'lobby', title: 'Vestíbulo', icon: '🏠',
  mount(root) {
    const me = S.me;
    const today = new Date().toISOString().slice(0, 10);
    const dailyDone = me.daily.last === today;
    const freeDone = me.daily.freePull === today;
    const streak = dailyDone ? me.daily.streak : (me.daily.last === new Date(Date.now() - 864e5).toISOString().slice(0, 10) ? me.daily.streak + 1 : 1);
    const dl = S.data.daily;
    const nextReward = dl.base + dl.step * (Math.min(streak, dl.max) - 1);

    const dailyBtn = h('button', { class: 'btn primary', disabled: dailyDone, onclick: async (e) => {
      const r = await act('daily:claim', {}, e.target);
      if (r) {
        toast(`+${fmt(r.reward)} monedas y 1 Ticket Gacha · racha de ${r.streak} días${r.charm ? ' · ¡+1 Amuleto Iris!' : ''}`, 'success', 6000);
        await dailyChest({ reward: r.reward, streak: r.streak, charm: !!r.charm });
        this.remount(root);
      }
    } }, dailyDone ? 'Reclamado hoy ✓' : `Reclamar ${fmt(nextReward)}`);

    // Motivo por el que Joy no puede ayudar ahora, con los datos que ya tiene el cliente (el servidor decide al final).
    const hl = S.data.heal;
    const healWhy = () => {
      if (S.me.coins >= hl.limit) return `Tienes ${fmt(S.me.coins)} monedas: Joy ayuda con menos de ${hl.limit}.`;
      const wait = (S.me.lastHeal || 0) + hl.cooldown - Date.now();
      if (wait > 0) return `Joy ya te ayudó hace poco. Vuelve en ${Math.ceil(wait / 60000)} min.`;
      if (S.me.coins + (S.me.locked || 0) >= hl.limit) return `Tienes ${fmt(S.me.locked)} monedas apartadas en pedidos del Mercado o en una mesa/apuesta en curso. Cancela el pedido o levántate de la mesa para recuperarlas.`;
      return '';
    };
    const healNote = h('p', { class: 'small muted' });
    const healBtn = h('button', { class: 'btn', onclick: async (e) => {
      const r = await act('center:heal', {}, e.target);
      if (r) { sfx('win'); toast(`La enfermera Joy te prestó ${fmt(S.data.heal.amount)} monedas. ¡Suerte!`, 'success'); }
      else healNote.textContent = 'Joy no pudo ayudarte: revisa que no tengas monedas en el Mercado o en una partida.';
      refreshHeal();
    } }, 'Pedir ayuda');
    function refreshHeal() {
      const why = healWhy();
      healBtn.disabled = !!why;
      if (why) healNote.textContent = why;
      else if (!healNote.textContent.startsWith('Joy no pudo')) healNote.textContent = '';
    }
    refreshHeal();
    // Se reevalúa si cambian las monedas (otra pestaña, un regalo) o cuando termina la espera.
    if (this.offHeal) this.offHeal();
    const offMe = bus.on('me', refreshHeal);
    const healTimer = setInterval(refreshHeal, 30000);
    this.offHeal = () => { offMe(); clearInterval(healTimer); };

    const days = h('div', { class: 'streak' }, [1, 2, 3, 4, 5, 6, 7].map((d) => h('span', { class: 'sday' + (d <= (dailyDone ? me.daily.streak : streak - 1) ? ' on' : '') }, d)));

    const pr = me.progress;
    const tut = pr.tutorial;
    const route = tut.done
      ? h('div', { class: 'card route done' }, h('h3', {}, '🎓 Ruta del Entrenador completada'), h('p', { class: 'muted' }, 'Ahora a por las 8 medallas, las colecciones y el Mercado. ¡Suerte, entrenador!'), h('a', { class: 'btn', href: '#/trainer' }, '🏅 Mi Entrenador'))
      : h('div', { class: 'card route' },
        h('div', { class: 'row between' }, h('h3', {}, `🧭 Ruta del Entrenador · paso ${tut.index + 1}/${tut.total}`), h('span', { class: 'muted small' }, `Premio: ${rewardText(tut.reward)}`)),
        h('div', { class: 'route-steps' }, Array.from({ length: tut.total }, (_, k) => h('i', { class: k < tut.index ? 'done' : k === tut.index ? 'now' : '' }))),
        h('b', { class: 'route-title' }, tut.title), h('p', {}, tut.desc),
        tut.n > 1 ? h('div', { class: 'pity-bar' }, h('i', { style: { width: (tut.prog / tut.n) * 100 + '%' } })) : null,
        h('a', { class: 'btn primary', href: '#/' + tut.link }, '¡Vamos!'));
    const daily = h('div', { class: 'card' },
      h('h3', {}, '📋 Misiones de hoy'),
      ...pr.daily.missions.map((m) => h('div', { class: 'mission' + (m.done ? ' done' : '') },
        h('span', {}, m.done ? '✅' : '⬜'), h('div', { class: 'grow' }, h('div', {}, m.title), h('div', { class: 'muted small' }, rewardText(m.reward))),
        m.n > 1 ? h('span', { class: 'small' }, `${Math.min(m.prog, m.n)}/${m.n}`) : null)),
      h('div', { class: 'muted small' }, pr.daily.bonus ? '🎁 Bonus diario conseguido' : 'Completa las 3 para un Huevo Misterioso extra.'));
    const badgeStrip = h('a', { class: 'card badge-strip', href: '#/trainer' },
      h('div', { class: 'row between' }, h('h3', {}, `🏅 Medallas ${pr.badges.filter((b) => b.got).length}/8`), h('span', { class: 'muted small' }, `Apuesta máxima ${fmt(me.maxBet)}`)),
      h('div', { class: 'row gap wrap' }, pr.badges.map((b) => badgeImg(b.n, b.got))),
      (() => { const next = pr.badges.find((b) => !b.got); return next ? h('div', { class: 'small' }, `Siguiente: ${next.name} — ${next.req}`) : h('div', { class: 'small good' }, '👑 Campeón de la Liga'); })());

    root.append(
      h('section', { class: 'hero' },
        h('div', { class: 'hero-text' },
          h('h1', {}, `¡Hola, ${me.username}!`),
          h('p', {}, 'Bienvenido al PokéCasino de Ciudad Azulona. Juega, colecciona y presume de tus variocolores.'),
          h('div', { class: 'row gap wrap' },
            h('a', { class: 'btn primary big', href: '#/gacha' }, freeDone ? '🎁 Ir al Gacha' : '🎁 ¡Tirada gratis disponible!'),
            h('a', { class: 'btn big', href: '#/race' }, '🏁 Carrera en directo'))),
        h('div', { class: 'hero-mons' }, me.buddy ? pokeImg(me.buddy.id, me.buddy.shiny, 'hero-buddy float') : h('img', { class: 'hero-buddy float', src: art(52), alt: 'Meowth' }))),
      canInstall() && (() => { try { return !localStorage.getItem('installHidden'); } catch { return true; } })() ? h('div', { class: 'card install-card' },
        h('img', { src: '/icons/icon-192.png', alt: '' }),
        h('div', { class: 'grow' }, h('b', {}, 'Instala PokéCasino en tu móvil'), h('div', { class: 'small muted' }, 'Ábrelo desde la pantalla de inicio a pantalla completa, como una app.')),
        h('button', { class: 'btn primary', onclick: () => installApp() }, 'Instalar'),
        h('button', { class: 'icon-btn', 'aria-label': 'Ocultar', onclick: (e) => { try { localStorage.setItem('installHidden', '1'); } catch { /* nada */ } e.target.closest('.install-card').remove(); } }, '✕')) : '',
      (() => { if (this.offEv) this.offEv(); this.offEv = bus.on('events', () => this.remount(root)); return eventsCard(); })(),
      h('div', { class: 'cards3 progress-row' }, route, daily, badgeStrip),
      h('div', { class: 'cards3' },
        h('div', { class: 'card' },
          h('h3', {}, '📅 Recompensa diaria'),
          h('p', { class: 'muted' }, 'Monedas + 1 Ticket Gacha cada día. Cada 7 días seguidos, un Amuleto Iris.'),
          days, dailyBtn),
        h('div', { class: 'card' },
          h('h3', {}, '🏥 Centro Pokémon'),
          h('p', { class: 'muted' }, `¿Sin fondos? Si tienes menos de ${fmt(hl.limit)} monedas, la enfermera Joy te presta ${fmt(hl.amount)} (una vez cada ${Math.round(hl.cooldown / 3600e3)} h).`),
          healBtn, healNote),
        h('div', { class: 'card' },
          h('h3', {}, '🤝 Compañero'),
          me.buddy
            ? h('p', {}, h('b', {}, S.dexById.get(me.buddy.id).name + (me.buddy.shiny ? ' ✨' : '')), ` te da +${(me.buddyBonus * 100).toFixed(1)}% en cada ganancia neta (hoy te quedan ${fmt(me.bonusLeft)} de bonus: crece con lo que apuestas y llega como mucho a ${fmt(me.bonusCap)} al día).`)
            : h('p', { class: 'muted' }, 'Elige un compañero en tu Pokédex: aumenta tus ganancias según su rareza y estrellas.'),
          h('a', { class: 'btn', href: '#/pokedex' }, 'Elegir compañero'))),
      h('h2', { class: 'section-title' }, `Juegos (${GAMES.length - 2} + Gacha y Mercado)`),
      h('div', { class: 'game-grid' }, GAMES.map((g) => h('a', { class: 'game-card', href: '#/' + g.id },
        h('img', { class: 'game-art', src: art(g.art), alt: '', loading: 'lazy' }),
        h('img', { class: 'pixel game-ico', src: item(g.ico), alt: '' }),
        g.tag ? h('span', { class: 'game-tag' }, g.tag) : null,
        h('h3', {}, g.name), h('p', {}, g.desc)))),
      h('h2', { class: 'section-title' }, 'Tus estadísticas'),
      h('div', { class: 'stat-row big' },
        st('Apostado', fmt(me.stats.wagered)), st('Ganado', fmt(me.stats.won)), st('Mayor premio', fmt(me.stats.biggestWin)),
        st('Tiradas gacha', fmt(me.stats.pulls)), st('Pokédex', `${Object.keys(me.collection).length}/${S.data.dex.length}`),
        st('Duelos', `${me.stats.duelsWon}V/${me.stats.duelsLost}D`)),
    );
  },
  // Solo se repinta si el jugador sigue en el Vestíbulo (las respuestas pueden llegar tarde).
  remount(root) { if (S.view !== 'lobby') return; root.replaceChildren(); this.mount(root); },
  unmount() { if (this.offEv) this.offEv(); this.offEv = null; if (this.offHeal) this.offHeal(); this.offHeal = null; },
};
const st = (l, v) => h('div', { class: 'stat' }, h('span', { class: 'muted small' }, l), h('b', {}, v));
