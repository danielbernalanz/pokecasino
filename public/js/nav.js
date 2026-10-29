// Navegación: 5 secciones (Inicio, Casino, Pokémon, Mercado, Entrenador), qué ha visitado ya el jugador
// (para el «¡Nuevo!») y la sugerencia del Profesor Oak.
import { S, h, bus, sprite, item, SPR_BADGE, monImg } from './core.js';

// Una ficha por pantalla: título, frase de una línea, Pokémon que la representa y color de la ficha.
export const META = {
  slots: { t: 'Pika-Slots', d: 'Tragaperras con bote progresivo', art: 25, tone: 'r', ico: '🎰' },
  roulette: { t: 'Ruleta de Tipos', d: 'Apuesta a un tipo… o a la Poké Ball', art: 101, tone: 'r', ico: '🎡' },
  blackjack: { t: 'Blackjack', d: 'Planta cara a Snorlax', art: 143, tone: 'g', ico: '🃏' },
  videopoker: { t: 'Video Póker', d: 'Jacks or Better', art: 65, tone: 'g', ico: '🂡' },
  baccarat: { t: 'Baccarat', d: 'Punto o Banca con Mr. Mime', art: 122, tone: 'g', ico: '🎴' },
  plinko: { t: 'Plinko', d: 'Suelta Poké Balls entre los clavos', art: 113, tone: 'r', ico: '🔻' },
  mines: { t: 'Minas Geodude', d: 'Trozos Estrella sin despertar a Geodude', art: 74, tone: 'r', ico: '💣' },
  voltorb: { t: 'Voltorb Flip', d: 'El clásico de la Esquina de Juegos', art: 100, tone: 'r', ico: '⚡' },
  poker: { t: "Texas Hold'em", d: 'Póker con tus amigos en directo', art: 94, tone: 'b', ico: '♠️' },
  crash: { t: 'Crash Rocket', d: 'Retírate antes de que el Team Rocket despegue', art: 109, tone: 'b', ico: '🚀' },
  race: { t: 'Gran Carrera', d: 'Apuesta por tu Pokémon en directo', art: 78, tone: 'b', ico: '🏁' },
  quiz: { t: 'Desafío Pokémon', d: '¿Quién es ese Pokémon? Acierta y retírate', art: 201, tone: 'y', ico: '❓' },
  gacha: { t: 'Poké Gacha', d: 'Banners legendarios y variocolores', art: 150, tone: 'p', ico: '🎁' },
  pc: { t: 'Caja PC', d: 'Tus Pokémon, en cajas como en los juegos', art: 137, tone: 'b', ico: '🖥️' },
  pokedex: { t: 'Pokédex', d: 'Colección completa y compañero', art: 479, tone: 'r', ico: '📕' },
  huerto: { t: 'Huerto de bayas', d: 'Planta bayas y haz amigos', art: 43, tone: 'g', ico: '🌱' },
  criadero: { t: 'Criadero', d: 'Huevos, eclosiones y bebés Pokémon', art: 242, tone: 'p', ico: '🥚' },
  expediciones: { t: 'Expediciones', d: 'Manda a tu equipo de paseo y vuelve con botín', art: 12, tone: 'g', ico: '🧭' },
  combates: { t: 'Combates', d: 'Combates Pokémon de verdad', art: 448, tone: 'p', ico: '⚔️' },
  duels: { t: 'Duelos rápidos', d: 'Un Pokémon a ciegas contra otro entrenador', art: 68, tone: 'r', ico: '🥊' },
  mega: { t: 'Evento Mega', d: 'Megapiedras y bote Mega', art: 6, tone: 'y', ico: '💠' },
  market: { t: 'Mercado', d: 'Compra y vende Pokémon y objetos', art: 53, tone: 'y', ico: '🏪' },
  shop: { t: 'Tienda', d: 'Objetos, bayas y reciclaje', art: 352, tone: 'g', ico: '🛍️' },
  trainer: { t: 'Mi entrenador', d: 'Medallas, misiones y mochila', art: 133, tone: 'b', ico: '🏅' },
  ranking: { t: 'Ranking', d: '¿Quién manda en el casino?', art: 149, tone: 'y', ico: '🏆' },
  news: { t: 'Novedades', d: 'Lo último que hemos añadido', art: 175, tone: 'p', ico: '📰' },
  admin: { t: 'Admin', d: 'Panel del anfitrión', art: 474, tone: 'b', ico: '🛠️' },
};

export const SECTIONS = [
  { id: 'lobby', label: 'Inicio', ico: { item: 'town-map' }, groups: [] },
  { id: 'casino', label: 'Casino', ico: { item: 'amulet-coin' }, say: { mon: 52, who: 'Meowth', text: '¡Miau! Pasen y vean: mesas, máquinas y mucho más.' }, groups: [
    { name: 'Mesas', items: ['blackjack', 'videopoker', 'baccarat', 'roulette'] },
    { name: 'Máquinas', items: ['slots', 'plinko', 'mines', 'voltorb'] },
    { name: 'Multijugador', items: ['poker', 'crash', 'race'] },
    { name: 'Desafíos', items: ['quiz'] }] },
  { id: 'pokemon', label: 'Pokémon', ico: { item: 'poke-ball' }, say: { emoji: '🧑‍🔬', who: 'Prof. Oak', text: 'Aquí cuidas de tu equipo: captura, entrena y presume.' }, groups: [
    { name: 'Tu equipo', items: ['gacha', 'pc', 'pokedex', 'huerto', 'criadero'] },
    { name: 'Aventura', items: ['combates', 'expediciones', 'duels', 'mega'] }] },
  { id: 'mercado', label: 'Mercado', ico: { item: 'nugget' }, say: { mon: 352, who: 'Kecleon', text: 'Compra, vende y haz buenos negocios con otros entrenadores.' }, groups: [
    { name: 'Comercio', items: ['market', 'shop'] }] },
  { id: 'entrenador', label: 'Entrenador', ico: { badge: 1 }, say: { mon: 25, who: 'Pikachu', text: '¡Pika! Tus medallas, tu ranking y las novedades.' }, groups: [
    { name: 'Tú', items: ['trainer', 'ranking', 'news', 'admin'] }] },
];
export const HUB_IDS = SECTIONS.filter((s) => s.id !== 'lobby').map((s) => s.id);
export const secOf = (viewId) => SECTIONS.find((s) => s.id === viewId || s.groups.some((g) => g.items.includes(viewId)));
export const leafIds = (sec) => sec.groups.flatMap((g) => g.items);
// ¿Aparece en los menús? (Admin solo para anfitriones; Mega solo con el evento activo.)
export const available = (id) => (id === 'admin' ? !!(S.me && S.me.isAdmin) : id === 'mega' ? !!(S.mega && S.mega.active) : true);
export const groupsOf = (sec) => sec.groups.map((g) => ({ ...g, items: g.items.filter(available) })).filter((g) => g.items.length);

// ---- Visitados («¡Nuevo!») ----
const vKey = () => 'visited:' + (S.me ? S.me.username : '');
let visited = null;
function load() {
  if (visited) return visited;
  visited = new Set();
  try { JSON.parse(localStorage.getItem(vKey()) || '[]').forEach((x) => visited.add(x)); } catch { /* sin almacenamiento */ }
  return visited;
}
// Pantallas que cuentan para el «¡Nuevo!»: todas las de los menús salvo Novedades (tiene su propio punto) y Admin.
const trackable = (id) => !!META[id] && id !== 'news' && id !== 'admin' && available(id);
export const isNew = (id) => trackable(id) && !load().has(id);
export const sectionNew = (sec) => leafIds(sec).some(isNew);
export const newCount = () => SECTIONS.reduce((n, s) => n + leafIds(s).filter(isNew).length, 0);
export function markVisited(id) {
  if (!trackable(id) || load().has(id)) return false;
  visited.add(id);
  try { localStorage.setItem(vKey(), JSON.stringify([...visited])); } catch { /* sin almacenamiento */ }
  bus.emit('visited', id);
  return true;
}
export const resetVisited = () => { visited = new Set(); try { localStorage.removeItem(vKey()); } catch { /* nada */ } bus.emit('visited', null); };

// ---- Iconos de sección ----
export function secIcon(sec) {
  const i = sec.ico;
  return h('img', { class: 'pixel', src: i.item ? item(i.item) : SPR_BADGE(i.badge), alt: '', width: 32, height: 32 });
}

// ---- Barra lateral (escritorio) ----
const open = new Set(['casino']);
export function buildSidebar(nav) {
  nav.replaceChildren();
  for (const sec of SECTIONS) {
    const head = sec.id === 'lobby'
      ? h('a', { class: 'nav-sec', href: '#/lobby', 'data-sec': 'lobby' }, h('span', { class: 'nav-ico' }, secIcon(sec)), h('span', { class: 'grow' }, sec.label))
      : h('div', { class: 'nav-head' },
        h('a', { class: 'nav-sec', href: '#/' + sec.id, 'data-sec': sec.id }, h('span', { class: 'nav-ico' }, secIcon(sec)), h('span', { class: 'grow' }, sec.label), h('i', { class: 'new-dot hidden' })),
        h('button', { class: 'nav-toggle', type: 'button', 'aria-label': 'Desplegar ' + sec.label, onclick: (e) => {
          // Acordeón: abrir una sección cierra las demás.
          const g = e.currentTarget.closest('.nav-group');
          const o = !g.classList.contains('open');
          document.querySelectorAll('.nav-group.open').forEach((x) => x.classList.remove('open'));
          open.clear();
          if (o) { g.classList.add('open'); open.add(sec.id); }
        } }, '▶'));
    const sub = h('div', { class: 'nav-sub' }, groupsOf(sec).map((g) => [
      h('div', { class: 'nav-label' }, g.name),
      g.items.map((id) => h('a', { href: '#/' + id, class: 'nav-link', 'data-view': id }, h('span', { class: 'nav-ico' }, META[id].ico), h('span', { class: 'grow' }, META[id].t), h('i', { class: 'new-dot hidden', title: '¡Nuevo!' })))]).flat(2));
    nav.append(h('div', { class: 'nav-group' + (open.has(sec.id) ? ' open' : ''), 'data-group': sec.id }, head, sec.id === 'lobby' ? '' : sub));
  }
  refreshNew();
}
// Pinta/quita los «¡Nuevo!» y puntos de la barra lateral, la barra inferior y los centros.
export function refreshNew() {
  document.querySelectorAll('.nav-link[data-view]').forEach((a) => a.querySelector('.new-dot')?.classList.toggle('hidden', !isNew(a.dataset.view)));
  for (const sec of SECTIONS) {
    if (sec.id === 'lobby') continue;
    const n = sectionNew(sec);
    document.querySelector(`.nav-sec[data-sec=${sec.id}] .new-dot`)?.classList.toggle('hidden', !n);
    document.querySelector(`.tab-btn[data-tab=${sec.id}]`)?.classList.toggle('has-new', n);
  }
}
export function markNav(viewId) {
  const sec = secOf(viewId);
  document.querySelectorAll('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.view === viewId));
  document.querySelectorAll('.nav-group').forEach((g) => {
    const cur = !!sec && g.dataset.group === sec.id;
    g.classList.toggle('current', cur);
    if (cur && g.dataset.group !== 'lobby') { document.querySelectorAll('.nav-group.open').forEach((x) => x.classList.remove('open')); open.clear(); g.classList.add('open'); open.add(sec.id); }
  });
  document.querySelector('.nav-sec[data-sec=lobby]')?.classList.toggle('active', viewId === 'lobby');
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', !!sec && b.dataset.tab === sec.id));
}

// ---- Barra inferior (móvil): las mismas 5 secciones ----
export function buildTabbar(bar) {
  bar.classList.remove('hidden');
  bar.replaceChildren(...SECTIONS.map((sec) => h('button', { class: 'tab-btn', type: 'button', 'data-tab': sec.id, onclick: () => {
    document.body.classList.remove('social-open', 'nav-open');
    location.hash = '#/' + sec.id;
  } }, h('span', { class: 'tab-ico' }, secIcon(sec)), h('span', { class: 'tab-lbl' }, sec.label))));
  refreshNew();
}

// ---- Profesor Oak: una sola sugerencia ----
const TIPS = [
  { id: 'gacha', text: 'Una tirada del Gacha y tendrás tu primer Pokémon. ¡A ver qué sale!', go: 'Al Gacha' },
  { id: 'pc', text: 'Tus Pokémon están en la Caja PC. ¿Les echas un vistazo? Puedes subirlos de nivel y evolucionarlos.', go: 'Abrir la Caja' },
  { id: 'huerto', text: '¿Aún no has probado el Huerto? ¡Planta tu primera baya!', go: 'Ir al Huerto' },
  { id: 'pokedex', text: 'Elige un compañero en la Pokédex: te dará un extra en cada ganancia.', go: 'Ver Pokédex' },
  { id: 'slots', text: 'Pika-Slots: tres rodillos, cinco líneas y Ditto de comodín. ¡Suerte!', go: 'Jugar' },
  { id: 'blackjack', text: '¿Una partida de Blackjack contra Snorlax? Recuerda: nunca se rinde… ni se levanta.', go: 'Jugar' },
  { id: 'market', text: 'En el Mercado puedes vender tus repetidos a otros entrenadores.', go: 'Ir al Mercado' },
  { id: 'quiz', text: '¿Sabes quién es ese Pokémon? Demuéstralo en el Desafío.', go: 'Probar' },
  { id: 'criadero', text: 'En el Criadero, dos Pokémon compatibles te dejan un huevo. ¡Juega para que eclosione!', go: 'Ir al Criadero' },
  { id: 'expediciones', text: 'Tus Pokémon pueden salir de expedición mientras no estás: vuelven con caramelos, bayas y niveles.', go: 'Explorar' },
  { id: 'combates', text: '¡Combates de verdad! Prepara tu equipo y reta a un entrenador.', go: 'A combatir' },
  { id: 'shop', text: 'En la Tienda hay objetos que te vendrán de maravilla.', go: 'Ir a la Tienda' },
  { id: 'roulette', text: 'La Ruleta de Tipos tiene una casilla Poké Ball… ¡cuidado!', go: 'Jugar' },
  { id: 'plinko', text: 'Plinko: suelta una Poké Ball y que ruede la suerte.', go: 'Jugar' },
  { id: 'mines', text: 'Minas Geodude: descubre Trozos Estrella, pero sin despertar a nadie.', go: 'Jugar' },
  { id: 'voltorb', text: 'Voltorb Flip, el clásico de Johto. ¿Te sabes los números?', go: 'Jugar' },
  { id: 'baccarat', text: 'Baccarat: Punto, Banca o Empate. Mr. Mime reparte.', go: 'Jugar' },
  { id: 'videopoker', text: 'Video Póker: la máquina con mejor retorno de la casa.', go: 'Jugar' },
  { id: 'poker', text: 'Hay mesas de Hold\'em en directo. ¿Te sientas?', go: 'Jugar' },
  { id: 'crash', text: 'Crash Rocket: retírate antes de que el cohete explote.', go: 'Jugar' },
  { id: 'race', text: 'Gran Carrera: elige a tu favorito y a gritar.', go: 'Ver carrera' },
  { id: 'duels', text: 'Los Duelos PvP: reta a otro entrenador con tus Pokémon.', go: 'Retar' },
  { id: 'mega', text: '¡Evento Megaevolución en marcha! Hay megapiedras en juego.', go: 'Ver evento' },
  { id: 'trainer', text: 'Mira tus medallas: cada una sube tu apuesta máxima.', go: 'Mi entrenador' },
  { id: 'ranking', text: '¿Dónde estás tú en el ranking? Echa un vistazo.', go: 'Ver ranking' },
];
export function suggestion() {
  const me = S.me;
  if (me) {
    const today = new Date().toISOString().slice(0, 10);
    if (me.daily && me.daily.last !== today) return { text: '¡Buenos días! Hoy todavía no has reclamado tu regalo diario: monedas y un Ticket Gacha.', go: null, id: 'daily' };
  }
  const tut = me && me.progress && me.progress.tutorial;
  if (tut && !tut.done && tut.link && tut.link !== 'lobby') return { text: `${tut.title}. ${tut.desc}`, go: '¡Vamos!', link: '#/' + tut.link, id: 'route' };
  const t = TIPS.find((x) => isNew(x.id));
  if (t) return { ...t, link: '#/' + t.id };
  const quips = ['¡Lo has probado casi todo, entrenador! Ahora a por las 8 medallas.', 'Recuerda: juega con cabeza. Las apuestas altas siempre piden confirmación.', 'La Caja PC guarda tus Pokémon: ¿has probado a entrenarlos con caramelos?'];
  return { text: quips[new Date().getDate() % quips.length], go: null, id: 'quip' };
}
export function oakSay() {
  const s = suggestion();
  return h('div', { class: 'say oak' }, h('span', { class: 'say-av emoji', 'aria-hidden': 'true' }, '🧑‍🔬'),
    h('div', { class: 'say-box' }, h('span', { class: 'say-who' }, 'Prof. Oak'), h('div', { class: 'say-text' }, s.text),
      s.go && s.link ? h('div', { class: 'say-actions' }, h('a', { class: 'btn primary small', href: s.link }, s.go)) : null));
}
