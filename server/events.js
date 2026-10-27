'use strict';
// Eventos del casino. Cada día de la semana trae uno (hora de España) y el anfitrión puede lanzar
// cualquiera durante unas horas. Ninguno regala monedas sin más: abaratan o dan rarezas, para no
// romper la economía (el que más «crea» es Misiones ×2, limitado a 3 misiones al día).
const db = require('./db');

const EVENTS = {
  duels: { icon: '⚔️', name: 'Lunes de Duelos', desc: 'Duelos sin comisión: el ganador se lleva el 100 % del bote.' },
  missions: { icon: '🎯', name: 'Miércoles de Misiones', desc: 'Las misiones diarias dan el doble de monedas.' },
  market: { icon: '🏪', name: 'Viernes de Mercado', desc: 'Sin impuesto de venta y comisión de anuncio a la mitad.' },
  shiny: { icon: '✨', name: 'Fin de semana Variocolor', desc: 'El doble de probabilidad de variocolor en el Gacha.' },
  buddy: { icon: '🤝', name: 'Fin de semana del Compañero', desc: 'El tope diario del bonus de compañero se duplica.' },
};
// 0 = domingo … 6 = sábado
const WEEK = { 0: ['shiny', 'buddy'], 1: ['duels'], 3: ['missions'], 5: ['market'], 6: ['shiny', 'buddy'] };
const TZ = 'Europe/Madrid';

// Día de la semana y medianoche siguiente en hora de España.
function madrid(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const msToday = ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000;
  return { dow, nextMidnight: now - msToday + 864e5 - (now % 1000) };
}

function forced() {
  const f = (db.data.state.events ||= {});
  const now = Date.now();
  for (const [id, until] of Object.entries(f)) if (until <= now) delete f[id];
  return f;
}

// Eventos activos ahora: [{ id, icon, name, desc, ends, forced }]
function active(now = Date.now()) {
  const { dow, nextMidnight } = madrid(now);
  const out = new Map();
  for (const id of WEEK[dow] || []) {
    // Si el evento sigue mañana (sábado → domingo), termina cuando acabe la racha.
    let ends = nextMidnight;
    for (let d = 1; d < 7 && (WEEK[(dow + d) % 7] || []).includes(id); d++) ends += 864e5;
    out.set(id, { id, ...EVENTS[id], ends, forced: false });
  }
  for (const [id, until] of Object.entries(forced())) {
    if (!EVENTS[id]) continue;
    const cur = out.get(id);
    if (!cur || cur.ends < until) out.set(id, { id, ...EVENTS[id], ends: until, forced: true });
  }
  return [...out.values()];
}
const has = (id) => active().some((e) => e.id === id);

// Próximo evento programado (para anunciarlo en el Vestíbulo).
function next(now = Date.now()) {
  const { dow, nextMidnight } = madrid(now);
  const on = new Set(active(now).map((e) => e.id));
  for (let d = 1; d <= 7; d++) {
    const ids = (WEEK[(dow + d) % 7] || []).filter((id) => !on.has(id));
    if (ids.length) return { starts: nextMidnight + (d - 1) * 864e5, events: ids.map((id) => ({ id, ...EVENTS[id] })) };
  }
  return null;
}

function force(id, hours) {
  if (!EVENTS[id]) throw new Error('Evento desconocido.');
  hours = Number(hours);
  if (!(hours >= 0 && hours <= 72)) throw new Error('Entre 0 y 72 horas (0 lo cancela).');
  const f = forced();
  if (hours === 0) delete f[id];
  else f[id] = Date.now() + hours * 3600e3;
  db.save();
}

const publicState = () => ({ active: active(), next: next(), all: Object.entries(EVENTS).map(([id, e]) => ({ id, ...e })) });

module.exports = { EVENTS, WEEK, active, has, next, force, publicState, madrid };
