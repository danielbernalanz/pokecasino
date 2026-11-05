'use strict';
// Poké Balls como en los juegos (Gen. 8/9): cada una tiene su multiplicador de captura, que depende de la situación del encuentro.
// Se compran en la Tienda Poké con monedas (≈ 0,6 × el precio en yenes de los juegos), salvo la Master Ball, que ya existía como premio
// (Tickets de nivel, Campeón, Mercado…) y aquí vale 100 % de captura. La Ball con la que se captura queda guardada en el ejemplar (`ball`)
// y se hereda en el Criadero con la regla de los juegos (ver `inherit`). Más de esto en docs/BALANCE.md («Captura de Pokémon salvajes»).
const MASTER = 'master-ball';
const DEFAULT = 'poke-ball';

// ctx: { night, turn (turnos ya jugados; 0 en el primero), types (del salvaje), level, owned (¿ya tienes la especie?) }
const BALLS = {
  'poke-ball': { name: 'Poké Ball', price: 120, sprite: 'poke-ball', desc: 'La Poké Ball de siempre. Sin bonus.', bonus: () => 1 },
  'great-ball': { name: 'Super Ball', price: 360, sprite: 'great-ball', desc: 'Más eficaz que una Poké Ball (×1,5).', bonus: () => 1.5 },
  'ultra-ball': { name: 'Ultra Ball', price: 480, sprite: 'ultra-ball', desc: 'Muy eficaz (×2).', bonus: () => 2 },
  'dusk-ball': { name: 'Ocaso Ball', price: 600, sprite: 'dusk-ball', desc: 'De noche, ×3 (hora de España, 21:00–06:00).', bonus: (c) => (c.night ? 3 : 1) },
  'quick-ball': { name: 'Rápida Ball', price: 600, sprite: 'quick-ball', desc: 'En el primer turno del encuentro, ×5.', bonus: (c) => (c.turn === 0 ? 5 : 1) },
  'timer-ball': { name: 'Turno Ball', price: 600, sprite: 'timer-ball', desc: 'Cuantos más turnos llevas, mejor: de ×1 a ×4 (tope en el turno 10).', bonus: (c) => Math.min(4, 1 + (c.turn * 1229) / 4096) },
  'net-ball': { name: 'Red Ball', price: 600, sprite: 'net-ball', desc: 'Contra tipo Agua o Bicho, ×3,5.', bonus: (c) => (c.types.includes('water') || c.types.includes('bug') ? 3.5 : 1) },
  'nest-ball': { name: 'Nido Ball', price: 600, sprite: 'nest-ball', desc: 'Mejor contra Pokémon de nivel bajo: ×(41 − nivel) / 10 hasta el nivel 29.', bonus: (c) => (c.level <= 29 ? Math.max(1, (41 - c.level) / 10) : 1) },
  'repeat-ball': { name: 'Acopio Ball', price: 600, sprite: 'repeat-ball', desc: 'Si ya tienes la especie, ×3,5.', bonus: (c) => (c.owned ? 3.5 : 1) },
  'luxury-ball': { name: 'Lujo Ball', price: 600, sprite: 'luxury-ball', desc: 'Sin bonus de captura, pero el Pokémon cogerá cariño con más facilidad (×1,5 de amistad, con los mismos topes diarios).', bonus: () => 1 },
  'friend-ball': { name: 'Amigo Ball', price: 180, sprite: 'friend-ball', desc: 'Sin bonus de captura: el Pokémon llega a tu Caja PC con 150 de amistad.', bonus: () => 1 },
  'heal-ball': { name: 'Sanación Ball', price: 180, sprite: 'heal-ball', desc: 'Sin bonus de captura: el Pokémon llega perfectamente curado (y con la Ball más bonita).', bonus: () => 1 },
  [MASTER]: { name: 'Master Ball', price: null, sprite: 'master-ball', desc: 'Captura segura (100 %). Es la misma Master Ball del Gacha: solo sale como premio o en el Mercado.', bonus: () => Infinity, master: true },
};
const IDS = Object.keys(BALLS);
const isBall = (id) => Object.prototype.hasOwnProperty.call(BALLS, id);
const nameOf = (id) => (BALLS[id] || BALLS[DEFAULT]).name;

// Objetos de la Tienda Poké para `items.js` (la Master Ball ya existe allí).
function buildItems() {
  const out = {};
  for (const [id, b] of Object.entries(BALLS)) {
    if (b.master) continue;
    out[id] = { name: b.name, sprite: b.sprite, price: b.price, cat: 'ball', ball: true, desc: `${b.desc} Se usa en «Captura».` };
  }
  return out;
}

// Multiplicador de la Ball en este encuentro (Infinity = captura segura).
const bonus = (id, ctx) => (isBall(id) ? BALLS[id].bonus(ctx) : 1);

// Herencia de la Ball en el Criadero (regla de los juegos desde la 6.ª generación): el bebé nace en la Ball de la madre; si uno de los
// padres es Ditto, en la del otro; si son de la misma especie, en la de uno de los dos al azar. La Master Ball (y las que no existan) se
// convierten en Poké Ball. Los ejemplares sin Ball (Gacha, huevos antiguos) cuentan como Poké Ball.
const ballOf = (m) => (m && isBall(m.ball) ? m.ball : DEFAULT);
function inherit({ mother, other, sameSpecies = false }, roll = Math.random()) {
  const pick = sameSpecies && other && roll < 0.5 ? other : mother;
  const b = ballOf(pick);
  return b === MASTER ? DEFAULT : b;
}

const STATIC = { balls: Object.fromEntries(Object.entries(BALLS).map(([id, b]) => [id, { name: b.name, price: b.price, desc: b.desc }])), order: IDS, master: MASTER, default: DEFAULT };

module.exports = { BALLS, IDS, MASTER, DEFAULT, isBall, nameOf, buildItems, bonus, ballOf, inherit, STATIC };
