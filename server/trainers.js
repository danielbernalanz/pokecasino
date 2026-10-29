'use strict';
// Liga de entrenadores: rivales CPU con su clase, su tema y su fuerza. Los equipos se generan al empezar el combate
// con los conjuntos de Showdown (habilidades y movimientos reales), escalados al equipo del jugador.
const crypto = require('crypto');
const { DEX, BY_ID } = require('./pokedex');
const { shuffle, randInt, pick } = require('./rng');
const sd = require('./sdmap');

// tier: 1 novato … 4 veterano, 5 líder de gimnasio, 6 campeón. `badges`: medallas necesarias para retarle.
const TRAINERS = [
  { id: 'ramon', name: 'Ramón', cls: 'Montañero', tier: 1, badges: 0, types: ['rock', 'ground', 'fighting'], sig: [74, 95, 66], quote: '¡Las montañas me han hecho duro como la roca!' },
  { id: 'clara', name: 'Clara', cls: 'Dominguera', tier: 1, badges: 0, types: ['normal', 'fairy', 'grass'], sig: [39, 35, 16], quote: '¡Hoy toca paseo y combate!' },
  { id: 'noa', name: 'Noa', cls: 'Entrenadora Guay', tier: 1, badges: 0, types: [], sig: [133, 25, 37], quote: '¡Mis Pokémon son los más monos y los más fuertes!' },
  { id: 'hugo', name: 'Hugo', cls: 'Pescador', tier: 1, badges: 0, types: ['water'], sig: [129, 118, 120], quote: 'Llevo toda la mañana sin pescar nada. ¡Me toca desquitarme!' },
  { id: 'ivan', name: 'Iván', cls: 'Campista', tier: 2, badges: 0, types: ['bug', 'grass'], sig: [127, 123, 46], quote: 'El bosque es mi casa. ¡Cuidado donde pisas!' },
  { id: 'aitor', name: 'Aitor', cls: 'Karateka', tier: 2, badges: 0, types: ['fighting'], sig: [106, 107, 68], quote: '¡Kiai! Entreno cada día antes del amanecer.' },
  { id: 'lucia', name: 'Lucía', cls: 'Médium', tier: 3, badges: 1, types: ['psychic', 'ghost'], sig: [64, 93, 96], quote: 'Ya sabía que me retarías. Lo vi en una visión.' },
  { id: 'pablo', name: 'Pablo', cls: 'Ingeniero', tier: 3, badges: 1, types: ['electric', 'steel'], sig: [82, 81, 135], quote: 'Mis circuitos están al máximo. ¡Prepárate!' },
  { id: 'marta', name: 'Marta', cls: 'Domadora de dragones', tier: 4, badges: 3, types: ['dragon', 'flying'], sig: [148, 149, 130], quote: 'Domar un dragón requiere paciencia… y mucha fuerza.' },
  { id: 'sergio', name: 'Sergio', cls: 'Veterano', tier: 4, badges: 3, types: [], sig: [6, 9, 3], quote: 'Treinta años de combates me contemplan.' },
  { id: 'vero', name: 'Vero', cls: 'Entrenadora Élite', tier: 4, badges: 4, types: [], sig: [59, 65, 68], quote: 'No he perdido ningún combate esta semana. ¿Tú qué tal?' },
  { id: 'brock', name: 'Brock', cls: 'Líder de Gimnasio', gym: true, tier: 5, badges: 0, types: ['rock', 'ground'], sig: [95, 139, 141], quote: 'Mi determinación es sólida como una roca.' },
  { id: 'misty', name: 'Misty', cls: 'Líder de Gimnasio', gym: true, tier: 5, badges: 1, types: ['water'], sig: [121, 55, 131], quote: 'Mi política de combate es el ataque acuático total.' },
  { id: 'surge', name: 'Teniente Surge', cls: 'Líder de Gimnasio', gym: true, tier: 5, badges: 2, types: ['electric'], sig: [26, 101, 125], quote: '¡Mis Pokémon eléctricos te dejarán frito, chaval!' },
  { id: 'erika', name: 'Erika', cls: 'Líder de Gimnasio', gym: true, tier: 5, badges: 3, types: ['grass'], sig: [45, 71, 114], quote: 'Disculpa, estaba echando una cabezadita. ¿Combatimos?' },
  { id: 'koga', name: 'Koga', cls: 'Líder de Gimnasio', gym: true, tier: 5, badges: 4, types: ['poison'], sig: [110, 169, 49], quote: 'El veneno es el arte del ninja.' },
  { id: 'sabrina', name: 'Sabrina', cls: 'Líder de Gimnasio', gym: true, tier: 5, badges: 5, types: ['psychic'], sig: [65, 122, 49], quote: 'Ya sabía que vendrías. Mi mente lo ve todo.' },
  { id: 'blaine', name: 'Blaine', cls: 'Líder de Gimnasio', gym: true, tier: 5, badges: 6, types: ['fire'], sig: [78, 59, 126], quote: '¡Mis llamas arderán a cualquier rival!' },
  { id: 'giovanni', name: 'Giovanni', cls: 'Líder de Gimnasio', gym: true, tier: 5, badges: 7, types: ['ground'], sig: [112, 34, 31], quote: 'Soy el último líder. No esperes piedad.' },
  { id: 'lance', name: 'Lance', cls: 'Campeón de la Liga', gym: true, tier: 6, badges: 8, types: ['dragon'], sig: [149, 130, 142], quote: 'Soy el Campeón. Demuéstrame que mereces mi puesto.' },
];
const BY_TRAINER = new Map(TRAINERS.map((t) => [t.id, t]));

// Monedas por victoria (ver docs/BALANCE.md): 10 victorias diarias × el máximo (80) = 800 al día como mucho.
const COINS = { 1: 20, 2: 30, 3: 40, 4: 50, 5: 65, 6: 80 };
const WINS_PER_DAY = 10;
const LEVEL_DELTA = { 1: -3, 2: 0, 3: 2, 4: 4, 5: 6, 6: 9 };
const IV_RANGE = { 1: [8, 18], 2: [14, 24], 3: [20, 28], 4: [26, 31], 5: [31, 31], 6: [31, 31] };
const BST_MAX = { 1: 410, 2: 480, 3: 540, 4: 600, 5: 640, 6: 700 };
const BST_MIN = { 1: 150, 2: 250, 3: 330, 4: 430, 5: 450, 6: 500 };

const bst = (p) => p.stats.reduce((a, b) => a + b, 0);
const badgeCount = (u) => (u.progress && u.progress.badges ? u.progress.badges.length : 0);
const unlocked = (t, u) => badgeCount(u) >= t.badges;

function listFor(u) {
  return TRAINERS.map((t) => ({ id: t.id, name: t.name, cls: t.cls, tier: t.tier, gym: !!t.gym, sig: t.sig, quote: t.quote, badges: t.badges, locked: !unlocked(t, u), coins: COINS[t.tier], types: t.types, dl: LEVEL_DELTA[t.tier] }));
}

function candidatePool(t) {
  const maxR = t.tier >= 6 ? ['C', 'U', 'R', 'E'] : ['C', 'U', 'R', 'E'];
  let pool = DEX.filter((p) => sd.canBattle(p.id) && maxR.includes(p.rarity) && bst(p) <= BST_MAX[t.tier] && bst(p) >= BST_MIN[t.tier]);
  // Los entrenadores fuertes llevan Pokémon evolucionados.
  if (t.tier >= 3) pool = pool.filter((p) => !DEX.some((q) => q.evolvesFrom === p.id));
  const themed = t.types.length ? pool.filter((p) => p.types.some((x) => t.types.includes(x))) : pool;
  return { themed: themed.length >= 6 ? themed : pool, all: pool };
}

/**
 * Equipo del rival: `n` Pokémon (sigue al tamaño del equipo del jugador).
 * @param {object} t entrenador
 * @param {number} n tamaño
 * @param {{level: 'fair'|'real', avgLevel: number, doubles: boolean}} o
 * @returns {{ sets: object[], roster: object[] }}
 */
function buildTeam(t, n, { level = 'fair', avgLevel = 50, doubles = false } = {}) {
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
  const sets = [];
  const roster = [];
  const [lo, hi] = IV_RANGE[t.tier];
  const lvl = level === 'real' ? Math.max(5, Math.min(100, Math.round(avgLevel + LEVEL_DELTA[t.tier]))) : 50;
  for (const p of chosen) {
    const m = {
      uid: crypto.randomBytes(4).toString('hex'), nature: pick(require('./specimen').NATURES).name,
      ivs: Array.from({ length: 6 }, () => randInt(lo, hi)), level: lvl, friendship: 70 + (t.tier >= 5 ? 150 : 40), gender: Math.random() < 0.5 ? 'M' : 'F', shiny: false,
    };
    sd.ensureSd(p.id, m);
    if (t.tier >= 2) m.sdMoves = sd.defaultMoves(p.id, doubles); // conjuntos de Showdown
    const { set, roster: r } = sd.toSet(p.id, m, { level: 'real', usedNames, doubles });
    sets.push(set);
    roster.push(r);
  }
  return { sets, roster };
}

module.exports = { TRAINERS, BY_TRAINER, COINS, WINS_PER_DAY, listFor, unlocked, buildTeam, badgeCount };
