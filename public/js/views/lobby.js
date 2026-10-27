import { S, h, fmt, act, sfx, toast, art, item, pokeImg } from '../core.js';

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
  { id: 'gacha', name: 'Poké Gacha', desc: 'Banners legendarios, pity y variocolores.', art: 150, ico: 'great-ball' },
  { id: 'market', name: 'Mercado', desc: 'Compra y vende Pokémon y objetos.', art: 52, ico: 'amulet-coin' },
];

export default {
  id: 'lobby', title: 'Vestíbulo', icon: '🏠',
  mount(root) {
    const me = S.me;
    const today = new Date().toISOString().slice(0, 10);
    const dailyDone = me.daily.last === today;
    const freeDone = me.daily.freePull === today;
    const streak = dailyDone ? me.daily.streak : (me.daily.last === new Date(Date.now() - 864e5).toISOString().slice(0, 10) ? me.daily.streak + 1 : 1);
    const nextReward = 1000 + 250 * (Math.min(streak, 7) - 1);

    const dailyBtn = h('button', { class: 'btn primary', disabled: dailyDone, onclick: async (e) => {
      const r = await act('daily:claim', {}, e.target);
      if (r) { sfx('win'); toast(`+${fmt(r.reward)} monedas y 1 Ticket Gacha · racha de ${r.streak} días${r.charm ? ' · ¡+1 Amuleto Iris!' : ''}`, 'success', 6000); this.remount(root); }
    } }, dailyDone ? 'Reclamado hoy ✓' : `Reclamar ${fmt(nextReward)}`);

    const healBtn = h('button', { class: 'btn', onclick: async (e) => {
      const r = await act('center:heal', {}, e.target);
      if (r) { sfx('win'); toast('La enfermera Joy te prestó 1.000 monedas. ¡Suerte!', 'success'); }
    } }, 'Pedir ayuda');

    const days = h('div', { class: 'streak' }, [1, 2, 3, 4, 5, 6, 7].map((d) => h('span', { class: 'sday' + (d <= (dailyDone ? me.daily.streak : streak - 1) ? ' on' : '') }, d)));

    root.append(
      h('section', { class: 'hero' },
        h('div', { class: 'hero-text' },
          h('h1', {}, `¡Hola, ${me.username}!`),
          h('p', {}, 'Bienvenido al PokéCasino de Ciudad Azulona. Juega, colecciona y presume de tus variocolores.'),
          h('div', { class: 'row gap wrap' },
            h('a', { class: 'btn primary big', href: '#/gacha' }, freeDone ? '🎁 Ir al Gacha' : '🎁 ¡Tirada gratis disponible!'),
            h('a', { class: 'btn big', href: '#/race' }, '🏁 Carrera en directo'))),
        h('div', { class: 'hero-mons' }, me.buddy ? pokeImg(me.buddy.id, me.buddy.shiny, 'hero-buddy float') : h('img', { class: 'hero-buddy float', src: art(52), alt: 'Meowth' }))),
      h('div', { class: 'cards3' },
        h('div', { class: 'card' },
          h('h3', {}, '📅 Recompensa diaria'),
          h('p', { class: 'muted' }, 'Monedas + 1 Ticket Gacha cada día. Cada 7 días seguidos, un Amuleto Iris.'),
          days, dailyBtn),
        h('div', { class: 'card' },
          h('h3', {}, '🏥 Centro Pokémon'),
          h('p', { class: 'muted' }, '¿Sin fondos? Si tienes menos de 200 monedas, la enfermera Joy te presta 1.000 (una vez por hora).'),
          healBtn),
        h('div', { class: 'card' },
          h('h3', {}, '🤝 Compañero'),
          me.buddy
            ? h('p', {}, h('b', {}, S.dexById.get(me.buddy.id).name + (me.buddy.shiny ? ' ✨' : '')), ` te da +${(me.buddyBonus * 100).toFixed(1)}% en cada ganancia neta.`)
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
  remount(root) { root.replaceChildren(); this.mount(root); },
};
const st = (l, v) => h('div', { class: 'stat' }, h('span', { class: 'muted small' }, l), h('b', {}, v));
