'use strict';
// Centro Pokémon (enfermera Joy): préstamo de 500 monedas si te quedas sin fondos (una vez cada 12 h: es una red de seguridad,
// no un ingreso; antes eran 1.000 cada hora = 24.000 al día, 10 veces más que todas las recompensas diarias).
const LIMIT = 200;
const COOLDOWN = 12 * 60 * 60 * 1000;
const AMOUNT = 500;

// Devuelve null si puede curarse o el mensaje con el motivo. `locked` = monedas en Mercado o en juego.
function reason(user, locked = 0, now = Date.now()) {
  if (user.coins >= LIMIT) return 'La enfermera Joy dice que aún te quedan monedas.';
  const wait = (user.lastHeal || 0) + COOLDOWN - now;
  if (wait > 0) return `Vuelve en ${Math.ceil(wait / 60000)} min.`;
  if (user.coins + locked >= LIMIT) return 'La enfermera Joy ve que tienes monedas en el Mercado o en juego.';
  return null;
}

module.exports = { reason, LIMIT, COOLDOWN, AMOUNT };
