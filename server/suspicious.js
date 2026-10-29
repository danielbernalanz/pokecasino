'use strict';
// Saldos sospechosos: compara las monedas de cada jugador con lo que el seguimiento de ingresos (hub.ledger →
// `hist.income`) puede explicar. Solo se juzga con datos que existen desde que empezó el seguimiento: la base
// es el saldo de la primera anotación, así que las cuentas antiguas no dan falsos positivos por su pasado.
const db = require('./db');

const MARGIN = 20000; // monedas por encima de lo explicado que se toleran
const ADMIN_WEEK = 20000; // dado por anfitriones en 7 días
const DAY_GAIN = 50000; // ganancia neta en un día

const sumObj = (o) => Object.values(o || {}).reduce((s, v) => s + v, 0);

// `lockedFn(u)`: monedas apartadas (Mercado y mesas). Devuelve [{ username, coins, locked, explained, excess, reasons: [] }].
function flagPlayers(users, lockedFn = () => 0, now = Date.now()) {
  const out = [];
  const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
  const week = new Set(Array.from({ length: 7 }, (_, i) => dayKey(now - i * 864e5)));
  for (const u of users) {
    if (u.npc) continue;
    const h = u.hist;
    if (!h || !h.income || typeof h.incomeBase !== 'number') continue; // sin datos de seguimiento
    const locked = lockedFn(u) || 0;
    const explained = h.incomeBase + sumObj(h.income);
    const have = u.coins + locked;
    const reasons = [];
    const excess = have - explained;
    if (excess > MARGIN) reasons.push(`tiene ${excess.toLocaleString('es')} monedas más de las que se explican`);
    const flow = h.flow || {};
    const admin = Object.entries(flow).filter(([k]) => week.has(k)).reduce((s, [, f]) => s + (f.admin || 0), 0);
    if (admin > ADMIN_WEEK) reasons.push(`${admin.toLocaleString('es')} monedas dadas por anfitriones en 7 días`);
    const best = Object.entries(flow).reduce((m, [k, f]) => (f.net > m.net ? { k, net: f.net } : m), { k: null, net: 0 });
    if (best.net > DAY_GAIN) reasons.push(`+${best.net.toLocaleString('es')} monedas netas en un día (${best.k})`);
    if (reasons.length) out.push({ username: u.username, coins: u.coins, locked, explained, excess, admin7: admin, bestDay: best.net, since: h.incomeSince || null, reasons });
  }
  return out.sort((a, b) => b.excess - a.excess);
}

function flagged() {
  const hub = require('./hub');
  return flagPlayers(Object.values(db.data.users), hub.lockedCoins);
}

module.exports = { flagPlayers, flagged, MARGIN, ADMIN_WEEK, DAY_GAIN };
