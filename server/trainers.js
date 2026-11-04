'use strict';
// Liga de entrenadores: rivales CPU con su clase, su tema y su fuerza. Los equipos se generan al empezar el combate
// con los conjuntos de Showdown (habilidades y movimientos reales), escalados al equipo del jugador.
const crypto = require('crypto');
const { DEX, BY_ID } = require('./pokedex');
const { shuffle, randInt, pick } = require('./rng');
const sd = require('./sdmap');

// tier: 1 novato … 4 veterano, 5 líder de gimnasio, 6 campeón. `badges`: medallas necesarias para retarle.
const TRAINERS = [
  { id: 'ramon', pay: 24, name: 'Ramón', cls: 'Montañero', tier: 1, badges: 0, types: ['rock', 'ground', 'fighting'], sig: [74, 95, 66], quote: '¡Las montañas me han hecho duro como la roca!' },
  { id: 'clara', pay: 16, name: 'Clara', cls: 'Dominguera', tier: 1, badges: 0, types: ['normal', 'fairy', 'grass'], sig: [39, 35, 16], quote: '¡Hoy toca paseo y combate!' },
  { id: 'noa', pay: 20, name: 'Noa', cls: 'Entrenadora Guay', tier: 1, badges: 0, types: [], sig: [133, 25, 37], quote: '¡Mis Pokémon son los más monos y los más fuertes!' },
  { id: 'hugo', pay: 16, name: 'Hugo', cls: 'Pescador', tier: 1, badges: 0, types: ['water'], sig: [129, 118, 120], quote: 'Llevo toda la mañana sin pescar nada. ¡Me toca desquitarme!' },
  { id: 'ivan', pay: 16, name: 'Iván', cls: 'Campista', tier: 2, badges: 0, types: ['bug', 'grass'], sig: [127, 123, 46], quote: 'El bosque es mi casa. ¡Cuidado donde pisas!' },
  { id: 'aitor', pay: 24, name: 'Aitor', cls: 'Karateka', tier: 2, badges: 0, types: ['fighting'], sig: [106, 107, 68], quote: '¡Kiai! Entreno cada día antes del amanecer.' },
  { id: 'lucia', pay: 24, name: 'Lucía', cls: 'Médium', tier: 3, badges: 1, types: ['psychic', 'ghost'], sig: [64, 93, 96], quote: 'Ya sabía que me retarías. Lo vi en una visión.' },
  { id: 'pablo', pay: 24, name: 'Pablo', cls: 'Ingeniero', tier: 3, badges: 1, types: ['electric', 'steel'], sig: [82, 81, 135], quote: 'Mis circuitos están al máximo. ¡Prepárate!' },
  { id: 'marta', pay: 40, name: 'Marta', cls: 'Domadora de dragones', tier: 4, badges: 3, types: ['dragon', 'flying'], sig: [148, 149, 130], quote: 'Domar un dragón requiere paciencia… y mucha fuerza.' },
  { id: 'sergio', pay: 36, name: 'Sergio', cls: 'Veterano', tier: 4, badges: 3, types: [], sig: [6, 9, 3], quote: 'Treinta años de combates me contemplan.' },
  { id: 'vero', pay: 36, name: 'Vero', cls: 'Entrenadora Élite', tier: 4, badges: 4, types: [], sig: [59, 65, 68], quote: 'No he perdido ningún combate esta semana. ¿Tú qué tal?' },
  // Líderes de Kanto (equipos de Rojo Fuego / Verde Hoja, en este orden): nivel FIJO como en los juegos. `badge`: medalla que dan (1-8, ver progress.js);
  // `team`: [[Pokédex, nivel]]. Combaten siempre en Individual y a «Niveles reales», con la IA lista (sdai.js) y, desde el 4.º, con objeto.
  { id: 'brock', pay: 100, name: 'Brock', cls: 'Líder de Gimnasio', gym: true, badge: 1, tier: 5, badges: 0, types: ['rock', 'ground'], sig: [95, 139, 141], team: [[74, 12], [95, 14]], quote: 'Mi determinación es sólida como una roca.' },
  { id: 'misty', pay: 100, name: 'Misty', cls: 'Líder de Gimnasio', gym: true, badge: 2, tier: 5, badges: 1, types: ['water'], sig: [121, 55, 131], team: [[120, 18], [121, 21]], quote: 'Mi política de combate es el ataque acuático total.' },
  { id: 'surge', pay: 100, name: 'Teniente Surge', cls: 'Líder de Gimnasio', gym: true, badge: 3, tier: 5, badges: 2, types: ['electric'], sig: [26, 101, 125], team: [[100, 21], [25, 18], [26, 24]], quote: '¡Mis Pokémon eléctricos te dejarán frito, chaval!' },
  { id: 'erika', pay: 100, name: 'Erika', cls: 'Líder de Gimnasio', gym: true, badge: 4, tier: 5, badges: 3, types: ['grass'], sig: [45, 71, 114], team: [[71, 29], [114, 24], [45, 29]], quote: 'Disculpa, estaba echando una cabezadita. ¿Combatimos?' },
  { id: 'koga', pay: 100, name: 'Koga', cls: 'Líder de Gimnasio', gym: true, badge: 5, tier: 5, badges: 4, types: ['poison'], sig: [110, 169, 49], team: [[109, 37], [89, 39], [109, 37], [110, 43]], quote: 'El veneno es el arte del ninja.' },
  { id: 'sabrina', pay: 100, name: 'Sabrina', cls: 'Líder de Gimnasio', gym: true, badge: 6, tier: 5, badges: 5, types: ['psychic'], sig: [65, 122, 49], team: [[64, 38], [122, 37], [49, 38], [65, 43]], quote: 'Ya sabía que vendrías. Mi mente lo ve todo.' },
  { id: 'blaine', pay: 100, name: 'Blaine', cls: 'Líder de Gimnasio', gym: true, badge: 7, tier: 5, badges: 6, types: ['fire'], sig: [78, 59, 126], team: [[58, 42], [77, 40], [78, 42], [59, 47]], quote: '¡Mis llamas arderán a cualquier rival!' },
  { id: 'giovanni', pay: 100, name: 'Giovanni', cls: 'Líder de Gimnasio', gym: true, badge: 8, tier: 5, badges: 7, types: ['ground'], sig: [112, 34, 31], team: [[111, 45], [51, 42], [31, 44], [34, 45], [112, 50]], quote: 'Soy el último líder. No esperes piedad.' },
  // Alto Mando de Kanto y Campeón (ver elite.js): se retan seguidos, sin curar entre combates. Solo Lance se puede retar suelto (como antes).
  { id: 'lorelei', pay: 100, name: 'Lorelei', cls: 'Alto Mando', elite: 1, tier: 6, badges: 8, types: ['ice', 'water'], sig: [131, 124, 87], team: [[87, 54], [91, 53], [80, 54], [124, 56], [131, 56]], quote: 'Nadie puede con mis Pokémon de hielo. ¡Te congelaré!' },
  { id: 'bruno', pay: 100, name: 'Bruno', cls: 'Alto Mando', elite: 2, tier: 6, badges: 8, types: ['fighting', 'rock'], sig: [68, 106, 107], team: [[95, 53], [107, 55], [106, 55], [95, 56], [68, 58]], quote: 'Hemos entrenado juntos hasta el límite. ¡Muestra tu fuerza!' },
  { id: 'agatha', pay: 100, name: 'Agatha', cls: 'Alto Mando', elite: 3, tier: 6, badges: 8, types: ['ghost', 'poison'], sig: [94, 93, 24], team: [[94, 56], [42, 56], [93, 55], [24, 58], [94, 60]], quote: '¡Ja, ja! Un combate de verdad, como los de mi juventud.' },
  { id: 'lance', pay: 100, name: 'Lance', cls: 'Alto Mando', elite: 4, tier: 6, badges: 8, types: ['dragon'], sig: [149, 130, 142], team: [[130, 58], [148, 56], [148, 56], [142, 60], [149, 62]], quote: 'Soy el maestro de los dragones. Demuéstrame que mereces llegar al Campeón.' },
  { id: 'azul', pay: 150, name: 'Azul', cls: 'Campeón de la Liga', elite: 5, champion: true, tier: 6, badges: 8, types: [], sig: [18, 65, 9], team: [[18, 59], [65, 57], [112, 59], [59, 59], [103, 61], [9, 63]], quote: '¡Soy el Campeón! ¿Creías que ibas a ser tú? Voy un paso por delante, como siempre.' },
];
const BY_TRAINER = new Map(TRAINERS.map((t) => [t.id, t]));

// Monedas por victoria (ver docs/BALANCE.md): 10 victorias diarias × el máximo (80) = 800 al día como mucho.
// (Las monedas por victoria antiguas, 20-80, quedan solo como referencia del tope: ahora pagan los «premios en metálico» de los juegos, ver battlemoney.js.)
const COINS = { 1: 20, 2: 30, 3: 40, 4: 50, 5: 65, 6: 80 };
const WINS_PER_DAY = 10;
const COINS_DAY = WINS_PER_DAY * COINS[6]; // tope diario de monedas de la CPU: el máximo de antes (800), aunque el premio por victoria sea el real
const LEVEL_DELTA = { 1: -3, 2: 0, 3: 2, 4: 4, 5: 6, 6: 9 };
const IV_RANGE = { 1: [8, 18], 2: [14, 24], 3: [20, 28], 4: [26, 31], 5: [31, 31], 6: [31, 31] };
const BST_MAX = { 1: 410, 2: 480, 3: 540, 4: 600, 5: 640, 6: 700 };
const BST_MIN = { 1: 150, 2: 250, 3: 330, 4: 430, 5: 450, 6: 500 };

const bst = (p) => p.stats.reduce((a, b) => a + b, 0);
const badgeCount = (u) => (u.progress && u.progress.badges ? u.progress.badges.length : 0);
const BADGE_IDS = ['roca', 'cascada', 'trueno', 'arcoiris', 'alma', 'pantano', 'volcan', 'tierra']; // en el orden de los líderes (progress.BADGES)
const owned = (u) => (u.progress && u.progress.badges) || [];
const GYMS = TRAINERS.filter((t) => t.badge).sort((a, b) => a.badge - b.badge);
// Orden de gimnasios como en los juegos: el líder k se abre con la medalla k-1. Quien ya tiene una medalla posterior (de cuando se ganaban de otra forma)
// no pierde nada: puede retar a todos los líderes anteriores a ella (para la medalla que le falte o para repetir).
function gymUnlocked(t, u) {
  const have = owned(u);
  if (t.badge === 1) return true;
  if (have.includes(BADGE_IDS[t.badge - 2])) return true;
  return have.some((id) => BADGE_IDS.indexOf(id) >= t.badge - 1);
}
const unlocked = (t, u) => (t.badge ? gymUnlocked(t, u) : badgeCount(u) >= t.badges);
const lockText = (t) => (t.badge ? `Antes tienes que vencer a ${GYMS[t.badge - 2].name} (${t.badge - 1}.ª medalla).` : `Necesitas ${t.badges} medallas.`);
// Equipos de nivel fijo (líderes y Alto Mando): combaten siempre en Individual y con los niveles reales de cada uno.
const fixed = (t) => !!t.team;
const soloOk = (t) => !t.elite || t.id === 'lance'; // los demás del Alto Mando solo se enfrentan en la carrera de elite.js
const highest = (t, bonus = 0) => Math.min(100, Math.max(...t.team.map((x) => x[1])) + bonus);

function listFor(u) {
  const have = owned(u);
  return TRAINERS.filter(soloOk).map((t) => ({
    id: t.id, name: t.name, cls: t.cls, tier: t.tier, gym: !!t.gym, elite: !!t.elite, sig: t.sig, quote: t.quote, badges: t.badges, locked: !unlocked(t, u), lock: unlocked(t, u) ? null : lockText(t),
    coins: COINS[t.tier], pay: t.pay, types: t.types, dl: LEVEL_DELTA[t.tier],
    badge: t.badge ? { n: t.badge, id: BADGE_IDS[t.badge - 1], got: have.includes(BADGE_IDS[t.badge - 1]) } : null,
    fixed: fixed(t) ? { lv: [Math.min(...t.team.map((x) => x[1])), highest(t)], n: t.team.length } : null,
  }));
}

function candidatePool(t) {
  const maxR = t.tier >= 6 ? ['C', 'U', 'R', 'E'] : ['C', 'U', 'R', 'E'];
  let pool = DEX.filter((p) => sd.canBattle(p.id) && maxR.includes(p.rarity) && bst(p) <= BST_MAX[t.tier] && bst(p) >= BST_MIN[t.tier]);
  // Los entrenadores fuertes llevan Pokémon evolucionados.
  if (t.tier >= 3) pool = pool.filter((p) => !DEX.some((q) => q.evolvesFrom === p.id));
  const themed = t.types.length ? pool.filter((p) => p.types.some((x) => t.types.includes(x))) : pool;
  return { themed: themed.length >= 6 ? themed : pool, all: pool };
}

// Objetos que puede llevar la CPU (solo los que la IA maneja bien: nada de «Elección» ni de «Chaleco»), uno distinto por Pokémon.
const CPU_ITEMS = { 3: ['leftovers', 'focussash', 'expertbelt', 'scopelens', 'oranberry'], 4: ['leftovers', 'lifeorb', 'focussash', 'rockyhelmet', 'expertbelt', 'sitrusberry'], 5: ['leftovers', 'lifeorb', 'focussash', 'rockyhelmet', 'weaknesspolicy', 'sitrusberry', 'lumberry'], 6: ['leftovers', 'lifeorb', 'focussash', 'rockyhelmet', 'weaknesspolicy', 'sitrusberry', 'lumberry'] };
function pickItem(seen, tier, always = false) {
  const list = (CPU_ITEMS[tier] || []).filter((x) => !seen.has(x));
  if (!list.length || (!always && Math.random() < 0.25)) return null;
  const it = pick(list);
  seen.add(it);
  return it;
}

/**
 * Equipo del rival: `n` Pokémon (sigue al tamaño del equipo del jugador).
 * @param {object} t entrenador
 * @param {number} n tamaño
 * @param {{level: 'fair'|'real', avgLevel: number, doubles: boolean}} o
 * @returns {{ sets: object[], roster: object[] }}
 */
function buildTeam(t, n, { level = 'fair', avgLevel = 50, doubles = false, bonus = 0 } = {}) {
  if (t.team) return buildFixed(t, bonus, doubles);
  const used = new Set();
  const chosen = [];
  const usedChain = new Set();
  const add = (p) => {
    if (!p || used.has(p.id) || usedChain.has(p.chain) || !sd.canBattle(p.id)) return false;
    used.add(p.id); usedChain.add(p.chain); chosen.push(p);
    return true;
  };
  // 2 «firmas» del entrenador (si no desbordan la fuerza) y el resto del tema.
  const sig = shuffle(t.sig).map((id) => BY_ID.get(id)).filter(Boolean);
  for (const p of sig) if (chosen.length < Math.min(n, 2) && (t.tier >= 3 || bst(p) <= BST_MAX[t.tier] + 60)) add(p);
  const { themed, all } = candidatePool(t);
  for (const p of shuffle(themed)) { if (chosen.length >= n) break; add(p); }
  for (const p of shuffle(all)) { if (chosen.length >= n) break; add(p); }
  const usedNames = new Set();
  const heldSeen = new Set();
  const sets = [];
  const roster = [];
  const [lo, hi] = IV_RANGE[t.tier];
  const lvl = level === 'real' ? Math.max(5, Math.min(100, Math.round(avgLevel + LEVEL_DELTA[t.tier]))) : 50;
  for (const p of chosen) {
    const m = {
      uid: crypto.randomBytes(4).toString('hex'), nature: pick(require('./specimen').NATURES).name,
      ivs: Array.from({ length: 6 }, () => randInt(lo, hi)), level: lvl, friendship: 70 + (t.tier >= 5 ? 150 : 40), gender: Math.random() < 0.5 ? 'M' : 'F', shiny: false,
    };
    // Los de la Liga básica llevan los movimientos por nivel que tocan al nivel del equipo del jugador; los fuertes, conjuntos de Showdown.
    const mvLevel = Math.max(5, Math.min(100, Math.round(avgLevel + LEVEL_DELTA[t.tier])));
    m.mv = 2; m.learned = require('./moves').reachable(p.id, mvLevel).map((x) => x.move); m.pending = [];
    m.sdMoves = t.tier >= 2 ? sd.defaultMoves(p.id, doubles) : require('./moves').equipAt(p.id, mvLevel);
    sd.ensureSd(p.id, m);
    if (t.tier >= 3) { const it = pickItem(heldSeen, t.tier); if (it) m.item = it; } // la CPU también lleva objetos (sin repetir)
    const { set, roster: r } = sd.toSet(p.id, m, { level: 'real', usedNames, doubles });
    sets.push(set);
    roster.push(r);
  }
  return { sets, roster };
}

// Equipo de nivel fijo de un líder / del Alto Mando (+`bonus` niveles en las revanchas de la Liga). Objeto en todos desde el 4.º líder, como se pidió.
function buildFixed(t, bonus, doubles) {
  const usedNames = new Set();
  const heldSeen = new Set();
  const sets = [];
  const roster = [];
  const items = t.badge >= 4 || t.elite;
  for (const [id, base] of t.team) {
    const lvl = Math.min(100, base + bonus);
    const m = {
      uid: crypto.randomBytes(4).toString('hex'), nature: pick(require('./specimen').NATURES).name,
      ivs: Array(6).fill(31), level: lvl, friendship: 220, gender: Math.random() < 0.5 ? 'M' : 'F', shiny: false,
    };
    m.mv = 2; m.learned = require('./moves').reachable(id, lvl).map((x) => x.move); m.pending = [];
    m.sdMoves = sd.defaultMoves(id, doubles);
    sd.ensureSd(id, m);
    if (items) { const it = pickItem(heldSeen, 5, true); if (it) m.item = it; }
    const { set, roster: r } = sd.toSet(id, m, { level: 'real', usedNames, doubles });
    sets.push(set);
    roster.push(r);
  }
  return { sets, roster };
}

module.exports = { TRAINERS, GYMS, BADGE_IDS, COINS_DAY, fixed, soloOk, highest, lockText, BY_TRAINER, COINS, WINS_PER_DAY, listFor, unlocked, buildTeam, badgeCount };
