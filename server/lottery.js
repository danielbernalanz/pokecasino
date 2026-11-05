'use strict';
// Lotería ID, como el Centro Pokémon / la Lotería de los juegos. Cada entrenador tiene un ID de 5 dígitos estable (`u.tid`) y cada ejemplar
// recuerda el ID de su entrenador original (`m.ot`, y `m.otn` con su nombre si no es el tuyo). Una vez al día (día UTC) el servidor sortea un
// número de 5 dígitos, el mismo para todos, y el jugador puede comprobarlo GRATIS una vez: se compara con el ID del entrenador original de
// cada uno de sus Pokémon y el premio depende de cuántas cifras coinciden, contadas desde el final (como en los juegos).
//
//  · ID: si la cuenta ya tiene `tid` se respeta; si no, sale del id de usuario (determinista) y se reserva sin repetirse con otra cuenta.
//  · Sorteo: sha256(semilla del servidor + fecha UTC) mod 100000. La semilla (`db.data.state.lotSeed`) se genera una vez y no sale del servidor,
//    así que nadie puede conocer el número de mañana. El número de hoy solo se enseña a quien ya lo ha comprobado.
//  · Ejemplares: los nuevos nacen con el ID de quien los obtiene; los antiguos (sin `ot`) cuentan como del propio jugador; los regalados
//    conservan el ID (y el nombre) del entrenador original, que es lo que hace interesante intercambiar.
//  · Anti-abuso: solo cuentan los ejemplares que ya tenías antes de las 00:00 UTC de hoy (conocer el número de hoy no sirve para fabricar un
//    premio con regalos de última hora). Hay UN premio al día: el del mejor ejemplar. Sin monedas.
const crypto = require('crypto');
const db = require('./db');
const hub = require('./hub');

const DIGITS = 5;
const MOD = 10 ** DIGITS;
// Premios por cifras coincidentes (desde el final). Solo objetos que ya existen; nunca monedas.
const PRIZES = {
  2: { item: 'exp-xs', qty: 1, label: 'Caramelo Exp. XS' },
  3: { item: 'exp-m', qty: 1, label: 'Caramelo Exp. M' },
  4: { item: 'ultra-ball', qty: 5, label: '5 Ultra Ball' },
  5: { item: 'master-ball', qty: 1, label: 'Master Ball' },
};
const pad = (n) => String(n).padStart(DIGITS, '0');
const validTid = (t) => typeof t === 'string' && /^\d{5}$/.test(t);
const dayStart = (key) => Date.parse(key + 'T00:00:00Z');

// ---- ID de Entrenador ----
const hashOf = (s) => crypto.createHash('sha256').update(String(s)).digest().readUInt32BE(0);
function tidOf(u) {
  if (validTid(u.tid)) return u.tid;
  if (typeof u.tid === 'number' && Number.isInteger(u.tid) && u.tid >= 0 && u.tid < MOD) { u.tid = pad(u.tid); return u.tid; }
  const taken = new Set(Object.values(db.data.users).map((x) => x && x.tid).filter(validTid));
  let n = hashOf('tid:' + u.id) % MOD;
  for (let i = 0; i < MOD && taken.has(pad(n)); i++) n = (n + 1) % MOD;
  u.tid = pad(n);
  return u.tid;
}
// ID del entrenador original de un ejemplar: los antiguos (sin `ot`) son del propio jugador.
const otOf = (u, m) => (validTid(m && m.ot) ? m.ot : tidOf(u));
const otNameOf = (u, m) => (m && validTid(m.ot) && m.ot !== tidOf(u) ? m.otn || null : null);

// ---- Sorteo diario ----
const dayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
function seed() {
  const st = db.data.state;
  if (typeof st.lotSeed !== 'string' || st.lotSeed.length < 16) { st.lotSeed = crypto.randomBytes(16).toString('hex'); db.save(); }
  return st.lotSeed;
}
const numberFor = (key, sd = seed()) => pad(crypto.createHash('sha256').update(`${sd}:lottery:${key}`).digest().readUInt32BE(0) % MOD);

// Cifras iguales contando desde el final (0–5).
function matchDigits(a, b) {
  let n = 0;
  for (let i = DIGITS - 1; i >= 0 && a[i] === b[i]; i--) n++;
  return n;
}

// Probabilidad de acertar EXACTAMENTE k cifras con un único ID, y valor esperado en «Poké Balls equivalentes» (documentado en BALANCE.md).
const probExact = (k) => (k === DIGITS ? 1 / MOD : 9 / 10 ** (k + 1));
const probAtLeast = (k) => 1 / 10 ** k;

// ---- Estado del jugador ----
function stateOf(u) {
  const l = (u.lot ||= { day: '', num: null, match: 0, prize: null, best: null, st: { checks: 0, wins: {} } });
  l.st ||= { checks: 0, wins: {} };
  l.st.wins ||= {};
  return l;
}
// Ejemplares que cuentan hoy: los que tenías antes de las 00:00 UTC de hoy y que no están fuera.
function eligible(u, key) {
  const t0 = dayStart(key);
  const out = [];
  for (const [id, arr] of Object.entries(u.mons || {})) for (const m of arr) if ((m.at || 0) < t0) out.push({ id: Number(id), m });
  return out;
}
// Los ID distintos de tus Pokémon: `n` los que ya cuentan hoy y `wait` los obtenidos hoy (cuentan desde mañana).
function otList(u, key = dayKey()) {
  require('./specimen').syncAll(u);
  const t0 = dayStart(key);
  const by = new Map();
  for (const arr of Object.values(u.mons || {})) {
    for (const m of arr) {
      const ot = otOf(u, m);
      const o = by.get(ot) || { ot, n: 0, wait: 0, name: otNameOf(u, m) };
      if ((m.at || 0) < t0) o.n++; else o.wait++;
      by.set(ot, o);
    }
  }
  return [...by.values()].sort((a, b) => b.n - a.n || b.wait - a.wait);
}

function view(u, now = Date.now()) {
  const key = dayKey(now);
  const l = stateOf(u);
  const done = l.day === key;
  return {
    tid: tidOf(u), day: key, checked: done, number: done ? l.num : null, match: done ? l.match : 0, prize: done ? l.prize : null, best: done ? l.best : null,
    ids: otList(u, key).slice(0, 12), prizes: Object.fromEntries(Object.entries(PRIZES).map(([k, p]) => [k, { item: p.item, qty: p.qty, label: p.label }])),
    odds: Object.fromEntries([2, 3, 4, 5].map((k) => [k, probExact(k)])), stats: l.st, next: dayStart(key) + 864e5,
  };
}

// Comprueba el número de hoy (una vez al día por jugador).
function check(u, now = Date.now()) {
  if (u.npc) throw new Error('Los comerciantes NPC no juegan a la lotería.');
  const key = dayKey(now);
  const l = stateOf(u);
  if (l.day === key) throw new Error('Ya has comprobado el número de hoy: vuelve mañana (a las 00:00 UTC, 01:00 o 02:00 en España).');
  const num = numberFor(key);
  require('./specimen').syncAll(u);
  let best = null;
  for (const { id, m } of eligible(u, key)) {
    const ot = otOf(u, m);
    const k = matchDigits(num, ot);
    if (!best || k > best.k) best = { k, id, uid: m.uid, ot, name: m.nick || undefined };
  }
  const k = best ? best.k : 0;
  const prize = PRIZES[k] || null;
  l.day = key; l.num = num; l.match = k; l.prize = prize ? { item: prize.item, qty: prize.qty, label: prize.label } : null;
  l.best = best && k >= 2 ? { id: best.id, uid: best.uid, ot: best.ot } : null;
  l.st.checks++;
  if (prize) {
    l.st.wins[k] = (l.st.wins[k] || 0) + 1;
    require('./items').give(u, prize.item, prize.qty, `Lotería ID (${k} cifras)`);
    if (k === DIGITS) hub.feed('lottery', `🎟️ ¡${u.username} ha acertado las 5 cifras de la Lotería ID y gana una Master Ball!`);
  }
  hub.track(u, 'lottery');
  db.save();
  return view(u, now);
}

const STATIC = { digits: DIGITS, prizes: PRIZES };

module.exports = { DIGITS, PRIZES, tidOf, otOf, otNameOf, numberFor, matchDigits, probExact, probAtLeast, view, check, stateOf, eligible, otList, dayKey, validTid, STATIC };
