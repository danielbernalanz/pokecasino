'use strict';
// Constantes de equilibrio del casino. Todo el razonamiento (antes → después) está en docs/BALANCE.md.
//
// RTP máximo teórico por juego con la mejor estrategia posible (cota SUPERIOR: si un juego devolviera
// más, el resto de reglas dejaría de ser seguro). test/balance.test.js comprueba que cada cifra es
// realmente una cota de lo que miden la fórmula o la simulación, y que
//   RTP + devolución por XP/niveles + bonus máximo + otras  <  100 % − margen      (returnMax, más abajo).
// Política (docs/BALANCE.md, «Máxima ventaja para el jugador»): el RTP de cada juego sube hasta donde esa suma deja
// al menos 0,3 puntos de margen; los juegos que ya estaban por encima de esa línea (heredados) no se tocan ni se
// empeoran: se documenta su margen real en MARGIN_MIN y el test impide que baje.
const RTP = {
  slots: 0.976, // líneas ≈ 95,0 % + 2 % del bote + semilla del bote (0,46 % con la apuesta mínima): 97,5 % como máximo
  roulette: 18.2 / 19, // 95,79 % en TODAS las apuestas: tipo ×18,2; grupo ×3 y par/impar ×2 con «La Partage» (la Poké Ball devuelve el 20 %)
  plinko: 0.976, // los tres riesgos entre 97,45 % y 97,52 %
  mines: 0.97,
  quiz: 0.97, // Desafío Pokémon: un fan experto en cada dificultad y objetivo se queda en ≤ 96,8 % (docs/BALANCE.md)
  crash: 0.97,
  voltorb: 0.957, // cota; la mejor estrategia encontrada (inferencia exacta + parada óptima) recupera ≈ 93 % (docs/BALANCE.md)
  videopoker: 0.9954, // Jacks or Better 9/6 con juego óptimo
  blackjack: 0.997, // estrategia básica, 6 barajas, se planta en 17, 3:2, doblar tras dividir, re-dividir hasta 4 manos (Ases incluidos): ventaja ≈ 0,32 %
  baccarat: 0.9895, // Banca (1,95): 98,94 % exacto; Punto 98,76 %
  race: 0.957, // cuotas = 0,957 / probabilidad
  duel: 0.95, // comisión del 5 % del bote (entre jugadores: no se toca)
};
const edge = (game) => 1 - (RTP[game] ?? 0.95);

// ---- Experiencia ----
// La experiencia (y con ella los niveles, que dan monedas y objetos) es una «devolución» sobre lo apostado.
// Antes se calculaba a partir de la ventaja (2,5 XP por moneda de ventaja, tope 0,1 por moneda apostada), de modo que
// bajar la ventaja habría hecho subir de nivel más despacio. Ahora la XP por moneda es FIJA por juego (los mismos
// valores de siempre): la seguridad no sale de recortar la XP sino de que la ventaja mínima de cada juego cubra la
// devolución por XP + bonus + margen (minEdge, más abajo; lo comprueba test/balance.test.js).
const XP_PER_EDGE = 2.5; // origen de la tabla (2,5 × la ventaja que tenía cada juego), ya no se usa en ejecución
const XP_MAX_RATE = 0.1;
const XP_RATE = {
  slots: 0.06, roulette: 0.1, plinko: 0.06, mines: 0.075, quiz: 0.075, crash: 0.075, voltorb: 0.1,
  videopoker: 0.0115, blackjack: 0.0075, baccarat: 0.02675, race: 0.1, duel: 0.1,
};
const xpRate = (game) => (game ? (XP_RATE[game] ?? XP_MAX_RATE) : XP_MAX_RATE);
// XP «fija» (duelos…) que no depende de lo apostado: tope diario para que no se pueda cultivar con cuentas gemelas.
const FLAT_XP_DAILY = 400;

// ---- Recompensas por nivel ----
const levelCoins = (level) => 3 * level;
// Caramelo Raro cada 5 niveles desde el 10; Master Ball cada 25 (la única legendaria segura).
const levelItem = (level) => (level % 25 === 0 ? 'master-ball' : level % 5 === 0 && level >= 10 ? 'rare-candy' : null);

// ---- Bonus de compañero / colecciones / Moneda de la Suerte ----
// El bonus de un día no puede superar una fracción de la ventaja de la casa de lo apostado ese día
// (además del tope fijo 300 + 50 × nivel): así ningún juego sale a favor del jugador.
// Con todo activo a la vez (Amuleto y fin de semana del Compañero) llega a 0,45 × 1,25 = 56 % de la ventaja; el
// Huevo Suerte (XP ×2) duplica la devolución por niveles (≈19 % → 38 %): en total queda por debajo del 100 %.
const BONUS_SHARE = 0.3; // fracción de la ventaja que se devuelve como bonus
const BONUS_SHARE_AMULET = 0.45; // con Moneda de la Suerte activa
const BONUS_SHARE_EVENT = 1.25; // multiplicador en el fin de semana del Compañero

// ---- Recompensa diaria: 500 el primer día, +100 por día de racha hasta el 7.º (1.100) ----
const DAILY_BASE = 1000;
const DAILY_STEP = 150;
const DAILY_MAX_STREAK = 7;
const dailyReward = (streak) => DAILY_BASE + DAILY_STEP * (Math.min(streak, DAILY_MAX_STREAK) - 1);

// ---- Devolución máxima por moneda apostada (todo activo a la vez) y ventaja mínima ----
// Valor en monedas de las recompensas por nivel a precio de compra de los PNJ (lo máximo que se puede «cobrar»).
const LEVEL_CASH = { 'rare-candy': 450, 'master-ball': 2000 };
const xpForLevel = (l) => 100 * (l - 1) * (l - 1);
// Monedas de recompensa por XP ganada, en el peor nivel (acumulado desde el nivel 1; hoy el nivel 10, ≈ 0,0756).
function levelRebatePerXp(maxLevel = 300) {
  let worst = 0;
  let cum = 0;
  for (let l = 2; l <= maxLevel; l++) {
    cum += levelCoins(l) + (LEVEL_CASH[levelItem(l)] || 0);
    worst = Math.max(worst, cum / xpForLevel(l));
  }
  return worst;
}
const XP_BOOST = 2; // Huevo Suerte (XP ×2) permanente: peor caso
const BONUS_SHARE_MAX = BONUS_SHARE_AMULET * BONUS_SHARE_EVENT; // Amuleto + fin de semana del Compañero: 56,25 % de la ventaja
// Devoluciones proporcionales a lo apostado que NO son monedas del juego (todas con test, ver docs/BALANCE.md):
//  · Criadero (1 paso por 100 monedas): el bebé nunca vale más que la tarifa; · Vínculo del compañero: solo amistad;
//  · Candado: créditos para recuperar lo que ya era tuyo; · 💠 Mega: objetos, tope diario y por edición.
// En monedas por moneda apostada no suman nada, así que valen 0 aquí.
const OTHER_RETURN = {};
const rakebackMax = (game) => XP_BOOST * xpRate(game) * levelRebatePerXp();
const bonusMax = (game) => BONUS_SHARE_MAX * edge(game);
// Retorno total esperado máximo por moneda apostada con la mejor estrategia y todo el rakeback/bonus a la vez.
const returnMax = (game) => RTP[game] + rakebackMax(game) + bonusMax(game) + (OTHER_RETURN[game] || 0);
// Ventaja mínima para dejar `margin` de margen: edge ≥ (rakeback + otras + margen) / (1 − fracción máxima de bonus).
const minEdge = (game, margin = 0.003) => (rakebackMax(game) + (OTHER_RETURN[game] || 0) + margin) / (1 - BONUS_SHARE_MAX);
// Margen mínimo (1 − returnMax) que debe conservar cada juego. 0,003 es la política; los heredados que ya estaban más
// justos (no se empeoran para cumplirla) llevan su margen real redondeado a la baja.
const MARGIN_POLICY = 0.003;
const MARGIN_MIN = { slots: 0.0013, plinko: 0.0013, mines: 0.0017, quiz: 0.0017, crash: 0.0017, videopoker: 0.0002, blackjack: 0.00015, baccarat: 0.0005 };
const marginMin = (game) => MARGIN_MIN[game] ?? MARGIN_POLICY;

module.exports = { DAILY_BASE, DAILY_STEP, DAILY_MAX_STREAK, dailyReward, RTP, edge, XP_PER_EDGE, XP_MAX_RATE, xpRate, XP_RATE, FLAT_XP_DAILY, levelCoins, levelItem, BONUS_SHARE, BONUS_SHARE_AMULET, BONUS_SHARE_EVENT, LEVEL_CASH, XP_BOOST, BONUS_SHARE_MAX, levelRebatePerXp, rakebackMax, bonusMax, returnMax, minEdge, MARGIN_POLICY, MARGIN_MIN, marginMin };
