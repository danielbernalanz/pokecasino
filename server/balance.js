'use strict';
// Constantes de equilibrio del casino. Todo el razonamiento (antes → después) está en docs/BALANCE.md.
//
// RTP máximo teórico por juego con la mejor estrategia posible (cota SUPERIOR: si un juego devolviera
// más, el resto de reglas dejaría de ser seguro). test/balance.test.js comprueba que cada cifra es
// realmente una cota de lo que miden la fórmula o la simulación.
const RTP = {
  slots: 0.976, // líneas 93,7 % + 2 % del bote + semilla del bote (1,8 % con la apuesta mínima)
  roulette: 18 / 19,
  plinko: 0.976, // riesgo bajo; medio 96,4 % y alto 95,5 %
  mines: 0.97,
  quiz: 0.97, // Desafío Pokémon: un fan experto en cada dificultad y objetivo se queda en ≤ 96,8 % (docs/BALANCE.md)
  crash: 0.97,
  voltorb: 0.95, // se recalcula con test/balance.test.js (estrategia razonable)
  videopoker: 0.9954, // Jacks or Better 9/6 con juego óptimo
  blackjack: 0.9955, // estrategia básica, 6 barajas, 3:2
  baccarat: 0.9893, // Banca (1,95); Punto 98,8 %
  race: 0.9,
  duel: 0.95, // comisión del 5 % del bote
};
const edge = (game) => 1 - (RTP[game] ?? 0.95);

// ---- Experiencia ----
// La experiencia (y con ella los niveles, que dan monedas y objetos) es una «devolución» sobre lo apostado.
// Para que nunca pueda superar la ventaja de la casa se reparte según ella: cada moneda que se espera
// perder da 2,5 XP, con tope de 0,1 XP por moneda apostada. Así el Video Póker (0,46 %) da ≈0,012 XP por
// moneda y la Ruleta, Slots o la Carrera dan 0,1.
const XP_PER_EDGE = 2.5;
const XP_MAX_RATE = 0.1;
const xpRate = (game) => (game ? Math.min(XP_MAX_RATE, XP_PER_EDGE * edge(game)) : XP_MAX_RATE);
// XP «fija» (duelos…) que no depende de lo apostado: tope diario para que no se pueda cultivar con cuentas gemelas.
const FLAT_XP_DAILY = 400;

// ---- Recompensas por nivel ----
const levelCoins = (level) => 3 * level;
// Caramelo Raro cada 5 niveles desde el 10; Master Ball cada 25 (la única legendaria segura).
const levelItem = (level) => (level % 25 === 0 ? 'master-ball' : level % 5 === 0 && level >= 10 ? 'rare-candy' : null);

// ---- Bonus de compañero / colecciones / Moneda Amuleto ----
// El bonus de un día no puede superar una fracción de la ventaja de la casa de lo apostado ese día
// (además del tope fijo 300 + 50 × nivel): así ningún juego sale a favor del jugador.
// Con todo activo a la vez (Amuleto y fin de semana del Compañero) llega a 0,45 × 1,25 = 56 % de la ventaja; el
// Huevo Suerte (XP ×2) duplica la devolución por niveles (≈19 % → 38 %): en total queda por debajo del 100 %.
const BONUS_SHARE = 0.3; // fracción de la ventaja que se devuelve como bonus
const BONUS_SHARE_AMULET = 0.45; // con Moneda Amuleto activa
const BONUS_SHARE_EVENT = 1.25; // multiplicador en el fin de semana del Compañero

// ---- Recompensa diaria: 500 el primer día, +100 por día de racha hasta el 7.º (1.100) ----
const DAILY_BASE = 1000;
const DAILY_STEP = 150;
const DAILY_MAX_STREAK = 7;
const dailyReward = (streak) => DAILY_BASE + DAILY_STEP * (Math.min(streak, DAILY_MAX_STREAK) - 1);

module.exports = { DAILY_BASE, DAILY_STEP, DAILY_MAX_STREAK, dailyReward, RTP, edge, XP_PER_EDGE, XP_MAX_RATE, xpRate, FLAT_XP_DAILY, levelCoins, levelItem, BONUS_SHARE, BONUS_SHARE_AMULET, BONUS_SHARE_EVENT };
