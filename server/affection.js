'use strict';
// «Afecto» (como los juegos de las generaciones 6 y 7): un Pokémon que te quiere mucho a veces aguanta un golpe, esquiva,
// se cura de un estado o da un golpe crítico "con todas sus fuerzas". SOLO en combates contra la CPU (y los duelos rápidos
// contra la casa): en PvP no actúa, igual que en los juegos no funciona en los combates por cable, para que sea justo.
//
// Cómo se engancha al simulador de Showdown: es una regla («Affection») registrada en `Dex.data.Rulesets` que los combates de
// la CPU añaden al formato (`...@@@Species Clause,Terastal Clause,Affection`). Showdown convierte cada regla con manejadores
// de eventos en un pseudo-clima del campo, así que `onDamage`, `onTryHit`, `onModifyCritRatio` y `onResidual` se ejecutan como
// los de Robustez o la Banda Focus. Todo el azar sale del PRNG del simulador (`this.randomChance`), por lo que el combate
// sigue siendo reproducible con la semilla y el registro de entradas (reinicios y repeticiones). La amistad viaja en el
// propio conjunto (`happiness` = amistad del ejemplar). Solo actúa sobre el lado p1 (el jugador) y nunca sobre la CPU.
// Este archivo no depende del simulador ni de la base de datos: lo cargan el simulador (vía sdmap.js), bond.js y las pruebas.

const LOVE_MIN = 220;

// Probabilidades (%) por nivel de vínculo. `survive` = aguantar con 1 PS un golpe que lo debilitaría (una vez por combate y Pokémon),
// `evade` = esquivar un ataque que podía fallar, `cure` = curarse de un estado al final del turno, `crit` = golpe crítico seguro.
const TIERS = [
  { min: 255, id: 'max', label: 'Vínculo máximo', survive: 20, evade: 12, cure: 25, crit: 8 },
  { min: 220, id: 'love', label: 'Te adora', survive: 15, evade: 10, cure: 20, crit: 5 },
  { min: 200, id: 'loyal', label: 'Compañero fiel', survive: 10, evade: 8, cure: 15, crit: 3 },
  { min: 150, id: 'close', label: 'Muy amistoso', survive: 5, evade: 5, cure: 10, crit: 0 },
  { min: 100, id: 'friendly', label: 'Amistoso', survive: 0, evade: 0, cure: 0, crit: 0 },
  { min: 0, id: 'cold', label: 'Indiferente', survive: 0, evade: 0, cure: 0, crit: 0 },
];
const FRIEND_MAX = 255;
const clampF = (f) => Math.max(0, Math.min(FRIEND_MAX, Number.isFinite(f) ? Math.floor(f) : 70));
const tierOf = (f) => { f = clampF(f); return TIERS.find((t) => f >= t.min); };
const chancesOf = (f) => { const t = tierOf(f); return { survive: t.survive, evade: t.evade, cure: t.cure, crit: t.crit }; };

// Retribución y Frustración (potencia según la amistad, igual que en los juegos).
const returnPower = (f) => Math.floor((clampF(f) * 10) / 25) || 1;
const frustrationPower = (f) => Math.floor(((FRIEND_MAX - clampF(f)) * 10) / 25) || 1;

// Solo para pruebas del navegador: AFFECTION_FORCE=1 (o una lista, p. ej. `survive,cure`) fuerza el 100 % en los niveles con
// efectos (nunca en producción).
const forced = (kind) => { const f = process.env.AFFECTION_FORCE; return !!f && (f === '1' || f.split(',').includes(kind)); };
const roll = (battle, pct, kind) => pct > 0 && (forced(kind) || battle.randomChance(pct, 100));
const isPlayer = (pokemon) => !!pokemon && !!pokemon.side && pokemon.side.n === 0;
const STATUSES = new Set(['brn', 'par', 'psn', 'tox', 'slp', 'frz']);

// Definición de la regla para `Dex.data.Rulesets`. Los manejadores usan `this` = Battle del simulador.
const RULE = {
  effectType: 'Rule',
  name: 'Affection',
  desc: 'Efectos de afecto de las generaciones 6 y 7 para el Pokémon del jugador (solo contra la CPU).',
  // Aguantar el golpe: como Robustez/Banda Focus pero con probabilidad; se ejecuta después de los demás (prioridad baja).
  onDamagePriority: -50,
  onDamage(damage, target, source, effect) {
    if (!isPlayer(target) || !effect || effect.effectType !== 'Move' || !source || source.side === target.side) return;
    if (damage < target.hp || target.hp <= 1 || target.m.affSurvive) return;
    if (!roll(this, chancesOf(target.happiness).survive, 'survive')) return;
    target.m.affSurvive = true;
    this.add('-activate', target, 'affection', 'survive');
    return target.hp - 1;
  },
  // Esquivar: el ataque rival ni llega a tocarle (solo si el movimiento podía fallar).
  onTryHitPriority: 10,
  onTryHit(target, source, move) {
    if (!isPlayer(target) || !source || source.side === target.side || !move || move.accuracy === true) return;
    if (move.target === 'self' || move.target === 'allySide' || move.target === 'foeSide' || move.target === 'all') return;
    if (!roll(this, chancesOf(target.happiness).evade, 'evade')) return;
    this.add('-activate', target, 'affection', 'evade');
    return this.NOT_FAIL;
  },
  // Crítico "con todas sus fuerzas": solo con movimientos de daño del jugador.
  onModifyCritRatio(critRatio, source, target, move) {
    if (!isPlayer(source) || !move || move.category === 'Status' || !move.basePower && !move.basePowerCallback) return;
    if (!roll(this, chancesOf(source.happiness).crit, 'crit')) return;
    this.add('-activate', source, 'affection', 'crit');
    return 5;
  },
  // Curarse del estado al final del turno (después del daño de quemadura o veneno).
  onResidualOrder: 28,
  onResidual(pokemon) {
    if (!isPlayer(pokemon) || !pokemon.hp || !STATUSES.has(pokemon.status)) return;
    if (!roll(this, chancesOf(pokemon.happiness).cure, 'cure')) return;
    this.add('-activate', pokemon, 'affection', 'cure');
    pokemon.cureStatus();
  },
};

// Registra la regla en el Dex del simulador (idempotente).
function install(Dex) {
  const R = Dex.data.Rulesets;
  if (!R.affection) R.affection = RULE;
  return RULE;
}

module.exports = { LOVE_MIN, FRIEND_MAX, TIERS, tierOf, chancesOf, returnPower, frustrationPower, RULE, install };
