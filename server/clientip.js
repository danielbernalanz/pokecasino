'use strict';
// IP real del cliente detrás de proxies de confianza.
// X-Forwarded-For llega como «falsificable..., cliente, proxy1, ...»: cada proxy de confianza añade
// la dirección de quien le habló por la DERECHA, así que se saltan `hops` entradas desde la derecha
// y las de la izquierda (que puede escribir el cliente) se ignoran.
// Con hops = 0 no se confía en la cabecera y se usa la dirección de la conexión.
function extractIp(xff, remote, hops) {
  if (!hops || hops < 1) return remote;
  const list = String(Array.isArray(xff) ? xff.join(',') : xff || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return remote;
  // Igual que Express con `trust proxy` numérico: la entrada que está `hops` posiciones desde la derecha
  // (si hay menos entradas, la primera).
  return list[Math.max(0, list.length - hops)];
}

// Cuenta de entradas de la cabecera (nunca sus valores) para verificar los saltos en los registros de producción.
let logged = false;
function logOnce(xff, hops) {
  if (logged || !hops) return;
  const n = String(Array.isArray(xff) ? xff.join(',') : xff || '').split(',').filter((s) => s.trim()).length;
  if (!n) return; // las comprobaciones de salud internas llegan sin cabecera: se espera a una petición real
  logged = true;
  console.log(`🌐 IP: cabeceras X-Forwarded-For con ${n} entradas (saltos de confianza: ${hops})`);
}

module.exports = { extractIp, logOnce };
