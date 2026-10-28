'use strict';
// Progresión: Ruta del Entrenador (tutorial), misiones diarias, medallas de gimnasio y colecciones.
const db = require('./db');
const hub = require('./hub');
const { shuffle } = require('./rng');

const TABLE_GAMES = ['blackjack', 'videopoker', 'baccarat', 'roulette'];
const MULTI_GAMES = ['race', 'crash', 'poker', 'duel'];
const isMarket = (e) => e === 'market_list' || e === 'market_buy' || e === 'market_sell';

// ---- Ruta del Entrenador: de recién llegado a su primera medalla ----
const TUTORIAL = [
  { title: 'Reclama tu recompensa diaria', desc: 'Cada día te esperan monedas y un Ticket Gacha en el Vestíbulo.', link: 'lobby', match: (e) => e === 'daily', reward: { coins: 300 } },
  { title: 'Haz tu primera tirada', desc: 'Usa tu tirada gratis o el ticket en el Poké Gacha para conseguir tu primer Pokémon.', link: 'gacha', match: (e) => e === 'pull', done: (u) => u.stats.pulls > 0, reward: { items: { ticket: 1 } } },
  { title: 'Elige un compañero', desc: 'En la Pokédex, haz compañero a tu Pokémon favorito: te da un % extra en cada ganancia.', link: 'pokedex', match: (e) => e === 'buddy', done: (u) => !!u.buddy, reward: { coins: 300 } },
  { title: 'Juega 5 partidas', desc: 'Prueba cualquier juego del casino. Empieza con apuestas pequeñas.', link: 'lobby', n: 5, match: (e) => e === 'play', reward: { coins: 500 } },
  { title: 'Gana en una mesa', desc: 'Gana una mano de Blackjack, Video Póker, Baccarat o Ruleta.', link: 'blackjack', match: (e, d) => e === 'win' && TABLE_GAMES.includes(d.game), reward: { items: { 'rare-candy': 1 } } },
  { title: 'Juega con otros entrenadores', desc: 'Apuesta en la Gran Carrera o en Crash, siéntate al Hold\'em o juega un duelo.', link: 'crash', match: (e, d) => e === 'play' && MULTI_GAMES.includes(d.game), reward: { items: { 'lucky-egg': 1 } } },
  { title: 'Abre un Huevo Misterioso', desc: 'Úsalo desde la Mochila: te dará un marco, un dorso de carta o un título.', link: 'shop', match: (e, d) => e === 'item_use' && d.itemId === 'mystery-egg', reward: { coins: 300 }, grantOnStart: { 'mystery-egg': 1 } },
  { title: 'Estrena el Mercado', desc: 'Publica un anuncio (ese cosmético repetido…) o compra algo a otro jugador.', link: 'market', match: isMarket, reward: { coins: 500, items: { 'mystery-egg': 1 } } },
  { title: 'Juega un duelo PvP', desc: 'Reta a alguien con uno de tus Pokémon (puede ser amistoso, sin apuesta).', link: 'duels', match: (e) => e === 'duel_play', reward: { items: { ticket: 3 } } },
  { title: 'Consigue la Medalla Roca', desc: 'Llega a nivel 5 de entrenador. Las medallas suben tu límite de apuesta y abren mesas nuevas.', link: 'trainer', match: (e) => e === 'badge', done: (u) => u.progress.badges.length > 0, reward: { coins: 1000, items: { 'frame-poke': 1 }, title: 'novato' } },
];

// ---- Misiones diarias (3 al día) ----
const DAILY = [
  { id: 'play15', title: 'Juega 15 partidas', n: 15, match: (e) => e === 'play', reward: { coins: 400 } },
  { id: 'win5', title: 'Gana 5 veces', n: 5, match: (e) => e === 'win', reward: { coins: 300 } },
  { id: 'crash3', title: 'Retírate en Crash a ×3 o más', match: (e, d) => e === 'win' && d.game === 'crash' && d.mult >= 3, reward: { items: { ticket: 1 } } },
  { id: 'poker', title: "Gana una mano de Hold'em", match: (e, d) => e === 'win' && d.game === 'poker', reward: { items: { 'mystery-egg': 1 } } },
  { id: 'pull5', title: 'Haz 5 tiradas de gacha', n: 5, count: (d) => d.count || 1, match: (e) => e === 'pull', reward: { coins: 250 } },
  { id: 'market', title: 'Compra o vende en el Mercado', match: (e) => e === 'market_buy' || e === 'market_sell', reward: { items: { 'mystery-egg': 1 } } },
  { id: 'duel', title: 'Juega un duelo', match: (e) => e === 'duel_play', reward: { items: { ticket: 1 } } },
  { id: 'race3', title: 'Apuesta en 3 carreras', n: 3, match: (e, d) => e === 'play' && d.game === 'race', reward: { coins: 250 } },
  { id: 'x10', title: 'Consigue un premio ×10 o mayor', match: (e, d) => e === 'win' && d.mult >= 10, reward: { items: { 'mystery-egg': 1 } } },
  { id: 'tables3', title: 'Gana 3 manos de Blackjack o Baccarat', n: 3, match: (e, d) => e === 'win' && (d.game === 'blackjack' || d.game === 'baccarat'), reward: { items: { 'rare-candy': 1 } } },
  { id: 'mines5', title: 'Descubre 5 casillas seguidas en Minas', match: (e, d) => e === 'mines_safe' && d.streak >= 5, reward: { coins: 300 } },
  { id: 'item', title: 'Usa un objeto', match: (e) => e === 'item_use', reward: { coins: 200 } },
];
const DAILY_BONUS = { items: { 'mystery-egg': 1 }, coins: 250 };

// ---- Medallas de Kanto ----
const BADGE_COINS = 500; // la medalla n paga 500 × n (total 18.000)
const CHAMPION_COINS = 10000;
const dexCount = (u) => Object.keys(u.collection).length;
const hasShiny = (u) => Object.values(u.collection).some((c) => c.s > 0);
const C = (u, k) => u.progress.counters[k] || 0;
const BADGES = [
  { id: 'roca', name: 'Medalla Roca', leader: 'Brock', req: 'Llega a nivel 5', check: (u) => u.level >= 5, prog: (u) => [u.level, 5] },
  { id: 'cascada', name: 'Medalla Cascada', leader: 'Misty', req: 'Ten 20 especies en la Pokédex', check: (u) => dexCount(u) >= 20, prog: (u) => [dexCount(u), 20] },
  { id: 'trueno', name: 'Medalla Trueno', leader: 'Lt. Surge', req: 'Gana 40 veces en el casino', check: (u) => C(u, 'win') >= 40, prog: (u) => [C(u, 'win'), 40] },
  { id: 'arcoiris', name: 'Medalla Arcoíris', leader: 'Erika', req: 'Completa una colección', check: (u) => u.progress.sets.length >= 1, prog: (u) => [u.progress.sets.length, 1] },
  { id: 'alma', name: 'Medalla Alma', leader: 'Koga', req: 'Vende 3 cosas en el Mercado', check: (u) => C(u, 'market_sell') >= 3, prog: (u) => [C(u, 'market_sell'), 3] },
  { id: 'pantano', name: 'Medalla Pantano', leader: 'Sabrina', req: "Gana 5 duelos o 10 manos de Hold'em", check: (u) => C(u, 'duel_win') >= 5 || C(u, 'poker_win') >= 10, prog: (u) => [Math.max(C(u, 'duel_win') * 2, C(u, 'poker_win')), 10] },
  { id: 'volcan', name: 'Medalla Volcán', leader: 'Blaine', req: 'Consigue un Pokémon variocolor', check: hasShiny, prog: (u) => [hasShiny(u) ? 1 : 0, 1] },
  { id: 'tierra', name: 'Medalla Tierra', leader: 'Giovanni', req: 'Nivel 20 y 80 especies en la Pokédex', check: (u) => u.level >= 20 && dexCount(u) >= 80, prog: (u) => [Math.min(u.level, 20) + Math.min(dexCount(u), 80), 100] },
];

// ---- Colecciones: completarlas da +1 % permanente a las ganancias y un título ----
const SETS = [
  { id: 'starters', name: 'Iniciales de Kanto', ids: [1, 4, 7], title: 'Profesor en Prácticas' },
  { id: 'finals', name: 'Iniciales evolucionados', ids: [3, 6, 9], title: 'Veterano de Kanto' },
  { id: 'eevee', name: 'Eeveelutions', ids: [133, 134, 135, 136, 196, 197], title: 'Amante de Eevee' },
  { id: 'fossils', name: 'Fósiles', ids: [138, 139, 140, 141, 142], title: 'Paleontólogo' },
  { id: 'dragons', name: 'Línea Dratini', ids: [147, 148, 149], title: 'Domador de Dragones' },
  { id: 'rocket', name: 'Equipo Rocket', ids: [23, 24, 52, 53, 109, 110], title: 'Recluta Rocket' },
  { id: 'dojo', name: 'Dojo Karate', ids: [56, 57, 66, 67, 68, 106, 107], title: 'Cinturón Negro' },
  { id: 'tower', name: 'Torre Pokémon', ids: [92, 93, 94, 104, 105], title: 'Médium' },
  { id: 'birds', name: 'Aves Legendarias', ids: [144, 145, 146], title: 'Domador de Leyendas' },
  { id: 'beasts', name: 'Bestias Legendarias', ids: [243, 244, 245], title: 'Rastreador' },
  { id: 'mew', name: 'Mewtwo y Mew', ids: [150, 151], title: 'Genetista' },
  { id: 'johto', name: 'Guardianes de Johto', ids: [248, 249, 250, 251], title: 'Guardián de Johto' },
  { id: 'ralts', name: 'Línea de Ralts', ids: [280, 281, 282, 475], title: 'Caballero de Gardevoir' },
  { id: 'hoenn-starters', name: 'Iniciales de Hoenn', ids: [252, 255, 258], title: 'Explorador de Hoenn' },
  { id: 'weather', name: 'Trío del Tiempo', ids: [382, 383, 384], title: 'Señor del Clima' },
  { id: 'sinnoh-starters', name: 'Iniciales de Sinnoh', ids: [387, 390, 393], title: 'Explorador de Sinnoh' },
  { id: 'lakes', name: 'Trío del Lago', ids: [480, 481, 482], title: 'Guardián de los Lagos' },
  { id: 'unova-starters', name: 'Iniciales de Teselia', ids: [495, 498, 501], title: 'Explorador de Teselia' },
  { id: 'swords', name: 'Espadachines Místicos', ids: [638, 639, 640, 647], title: 'Caballero Justiciero' },
  { id: 'kalos-starters', name: 'Iniciales de Kalos', ids: [650, 653, 656], title: 'Explorador de Kalos' },
  { id: 'alola-starters', name: 'Iniciales de Alola', ids: [722, 725, 728], title: 'Explorador de Alola' },
  { id: 'tapus', name: 'Tapus de Alola', ids: [785, 786, 787, 788], title: 'Protegido de los Tapus' },
  { id: 'galar-starters', name: 'Iniciales de Galar', ids: [810, 813, 816], title: 'Explorador de Galar' },
  { id: 'paldea-starters', name: 'Iniciales de Paldea', ids: [906, 909, 912], title: 'Explorador de Paldea' },
  { id: 'eevee-all', name: 'Todas las Eeveelutions', ids: [133, 134, 135, 136, 196, 197, 470, 471, 700], title: 'Maestro Eevee' },
];

// Títulos ganados (no se pueden comerciar).
const TITLES = { novato: 'Entrenador de Kanto', campeon: 'Campeón de la Liga' };
for (const s of SETS) TITLES['set-' + s.id] = s.title;
for (const b of BADGES) TITLES['badge-' + b.id] = `Vencedor de ${b.leader}`;

const today = () => new Date().toISOString().slice(0, 10);

function grant(user, reward, reason) {
  const parts = [];
  if (reward.coins) { user.coins += reward.coins; hub.ledger(user, reward.coins, 'reward', reason); parts.push(`${reward.coins.toLocaleString('es')} monedas`); }
  for (const [id, n] of Object.entries(reward.items || {})) {
    user.items[id] = (user.items[id] || 0) + n;
    parts.push(`${n}× ${require('./items').ITEMS[id].name}`);
  }
  if (reward.title && !user.progress.titles.includes(reward.title)) { user.progress.titles.push(reward.title); parts.push(`título «${TITLES[reward.title]}»`); }
  hub.emitUser(user.id, 'toast', { kind: 'quest', text: `🎯 ${reason}: ${parts.join(', ')}` });
}

function ensureDaily(user) {
  const p = user.progress;
  if (!p.daily || p.daily.date !== today()) {
    p.daily = { date: today(), missions: shuffle(DAILY).slice(0, 3).map((m) => ({ id: m.id, prog: 0, done: false })), bonus: false };
  }
  return p.daily;
}

function startStep(user) {
  const step = TUTORIAL[user.progress.tutorial];
  if (step && step.grantOnStart && !user.progress.stepGranted) {
    for (const [id, n] of Object.entries(step.grantOnStart)) user.items[id] = (user.items[id] || 0) + n;
    user.progress.stepGranted = true;
  }
}

function completeStep(user) {
  const p = user.progress;
  const step = TUTORIAL[p.tutorial];
  grant(user, step.reward, `Ruta del Entrenador · ${step.title}`);
  p.tutorial++;
  p.tutProg = 0;
  p.stepGranted = false;
  if (p.tutorial === TUTORIAL.length) hub.feed('level', `🎓 ${user.username} completó la Ruta del Entrenador`);
  // Si el siguiente paso ya está cumplido (p. ej. ya tenía compañero) se completa solo.
  const next = TUTORIAL[p.tutorial];
  if (next && next.done && next.done(user)) completeStep(user);
  else startStep(user);
}

function track(user, event, data = {}) {
  if (!user || !user.progress) return;
  const p = user.progress;
  p.counters[event] = (p.counters[event] || 0) + 1;
  if (event === 'win' && data.game === 'poker') p.counters.poker_win = (p.counters.poker_win || 0) + 1;

  // Tutorial
  const step = TUTORIAL[p.tutorial];
  if (step && step.match(event, data)) {
    p.tutProg++;
    if (p.tutProg >= (step.n || 1)) completeStep(user);
  }

  // Misiones diarias
  const daily = ensureDaily(user);
  for (const m of daily.missions) {
    const def = DAILY.find((d) => d.id === m.id);
    if (m.done || !def || !def.match(event, data)) continue;
    m.prog += def.count ? def.count(data) : 1;
    if (m.prog >= (def.n || 1)) {
      m.done = true;
      const x2 = def.reward.coins && require('./events').has('missions');
      grant(user, x2 ? { ...def.reward, coins: def.reward.coins * 2 } : def.reward, `Misión diaria · ${def.title}${x2 ? ' (×2)' : ''}`);
    }
  }
  if (!daily.bonus && daily.missions.length && daily.missions.every((m) => m.done)) {
    daily.bonus = true;
    grant(user, DAILY_BONUS, '¡Las 3 misiones del día completadas!');
  }

  evaluate(user);
  db.save();
}

// Comprueba medallas y colecciones (llamado tras cualquier evento).
function evaluate(user) {
  const p = user.progress;
  for (const s of SETS) {
    if (!p.sets.includes(s.id) && s.ids.every((id) => user.collection[id])) {
      p.sets.push(s.id);
      grant(user, { items: { 'mystery-egg': 1 }, title: 'set-' + s.id }, `Colección «${s.name}» completada (+1 % permanente)`);
      hub.feed('set', `📚 ${user.username} completó la colección «${s.name}»`);
    }
  }
  let newBadge = false;
  BADGES.forEach((b, k) => {
    if (!p.badges.includes(b.id) && b.check(user)) {
      p.badges.push(b.id);
      newBadge = true;
      grant(user, { coins: BADGE_COINS * (k + 1), items: k % 2 ? { 'mystery-egg': 1 } : { ticket: 2 }, title: 'badge-' + b.id }, `¡${b.name}!`);
      hub.feed('badge', `🏅 ${user.username} consiguió la ${b.name} (${p.badges.length}/8)`, { badge: k + 1 });
      if (p.badges.length === BADGES.length) {
        grant(user, { coins: CHAMPION_COINS, items: { 'master-ball': 1, 'frame-rainbow': 1 }, title: 'campeon' }, '👑 ¡Campeón de la Liga Pokémon!');
        hub.feed('badge', `👑 ¡${user.username} es Campeón de la Liga Pokémon!`);
      }
    }
  });
  if (newBadge) track(user, 'badge');
  const step = TUTORIAL[p.tutorial];
  if (step && step.done && step.done(user)) { completeStep(user); db.save(); }
}

const setBonus = (user) => Math.min(0.08, (user.progress ? user.progress.sets.length : 0) * 0.01);

function view(user) {
  const p = user.progress;
  if (!p) return null;
  ensureDaily(user);
  startStep(user);
  const step = TUTORIAL[p.tutorial];
  return {
    tutorial: step ? { index: p.tutorial, total: TUTORIAL.length, title: step.title, desc: step.desc, link: step.link, prog: p.tutProg, n: step.n || 1, reward: step.reward } : { index: TUTORIAL.length, total: TUTORIAL.length, done: true },
    daily: {
      bonus: p.daily.bonus,
      // Se ignoran misiones guardadas que ya no existan en la lista actual.
      missions: p.daily.missions.map((m) => [m, DAILY.find((x) => x.id === m.id)]).filter(([, d]) => d)
        .map(([m, d]) => ({ ...m, title: d.title, n: d.n || 1, reward: d.reward })),
    },
    badges: BADGES.map((b, k) => ({ id: b.id, n: k + 1, name: b.name, leader: b.leader, req: b.req, got: p.badges.includes(b.id), prog: b.prog(user) })),
    sets: SETS.map((s) => ({ id: s.id, name: s.name, ids: s.ids, title: s.title, done: p.sets.includes(s.id), have: s.ids.filter((id) => user.collection[id]).length })),
    titles: p.titles.map((id) => ({ id, text: TITLES[id] })),
    setBonus: setBonus(user),
  };
}

const titleText = (id) => TITLES[id] || (require('./items').COSMETICS[id] || {}).title || null;

module.exports = { BADGE_COINS, CHAMPION_COINS, track, evaluate, view, setBonus, titleText, BADGES, SETS, TUTORIAL, DAILY, TITLES };
