'use strict';
// Almacén JSON en disco con escritura diferida y atómica. Suficiente para un grupo de amigos.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

const FILE = path.join(DATA_DIR, 'db.json');

const empty = () => ({
  users: {},
  sessions: {},
  invites: {},
  chat: [],
  feed: [],
  state: { jackpot: 10000 },
  market: { orders: [], trades: [], history: {}, nextId: 1 },
  escrow: {},
});

// Campos añadidos en versiones posteriores: se rellenan al cargar cuentas antiguas.
function migrateUser(u) {
  u.items ||= {};
  u.buffs ||= { shinyCharges: 0, amuletUntil: 0, luckyUntil: 0, masterBall: false };
  u.games ||= {};
  u.stats.sold ||= 0;
  u.stats.bought ||= 0;
  u.equip ||= { frame: null, cardback: null, title: null };
  u.progress ||= { tutorial: 0, tutProg: 0, daily: null, counters: {}, badges: [], sets: [], titles: [] };
  return u;
}

// `data` es siempre el mismo objeto: los módulos guardan la referencia.
const data = empty();
const byName = new Map();

function load(raw) {
  for (const k of Object.keys(data)) delete data[k];
  Object.assign(data, empty(), raw || {});
  data.market = Object.assign({ orders: [], trades: [], history: {}, nextId: 1 }, data.market);
  data.escrow ||= {};
  byName.clear();
  for (const u of Object.values(data.users)) { migrateUser(u); byName.set(u.username.toLowerCase(), u); }
}

try { load(JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch { load(null); /* base nueva */ }

// ---- Postgres opcional (DATABASE_URL): para alojamientos sin disco persistente ----
// En un redespliegue, Render arranca la instancia nueva antes de apagar la vieja. Para que no se
// pierda nada, solo una instancia puede escribir a la vez (owner): la nueva espera a que la vieja
// guarde su último estado y libere la base, y solo entonces carga los datos.
const crypto = require('crypto');
const INSTANCE = crypto.randomUUID();
const LEASE_SECONDS = 20;
let pool = null;
let pgPending = null;
let pgDirty = false;
let pgTimer = null;
let heartbeat = null;
let lostLease = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function init() {
  if (!process.env.DATABASE_URL) return;
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL;
  const ssl = /sslmode=require/.test(url) || process.env.PGSSL === '1' ? { rejectUnauthorized: false } : false;
  pool = new Pool({ connectionString: url, ssl, max: 2 });
  await pool.query('CREATE TABLE IF NOT EXISTS pokecasino_state (id INT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  await pool.query('ALTER TABLE pokecasino_state ADD COLUMN IF NOT EXISTS owner TEXT');
  await pool.query('ALTER TABLE pokecasino_state ADD COLUMN IF NOT EXISTS heartbeat TIMESTAMPTZ');
  let waited = false;
  for (;;) {
    // Base nueva: se crea ya reservada para esta instancia.
    const ins = await pool.query(
      "INSERT INTO pokecasino_state (id, data, owner, heartbeat) VALUES (1, '{}'::jsonb, $1, now()) ON CONFLICT (id) DO NOTHING RETURNING data",
      [INSTANCE],
    );
    if (ins.rowCount) break;
    // Base existente: se reserva si está libre o si la instancia anterior dejó de dar señales.
    const r = await pool.query(
      `UPDATE pokecasino_state SET owner = $1, heartbeat = now()
       WHERE id = 1 AND (owner IS NULL OR heartbeat IS NULL OR heartbeat < now() - interval '${LEASE_SECONDS} seconds')
       RETURNING data`,
      [INSTANCE],
    );
    if (r.rowCount) { load(Object.keys(r.rows[0].data).length ? r.rows[0].data : null); break; }
    if (!waited) { console.log('  ⏳ Esperando a que la versión anterior guarde y libere los datos…'); waited = true; }
    await sleep(1000);
  }
  heartbeat = setInterval(() => {
    pool.query('UPDATE pokecasino_state SET heartbeat = now() WHERE id = 1 AND owner = $1', [INSTANCE])
      .then((r) => { if (!r.rowCount) onLostLease(); })
      .catch((e) => console.error('Postgres (latido):', e.message));
  }, 5000);
  heartbeat.unref();
  console.log(`  🐘 Datos en Postgres (${Object.keys(data.users).length} jugadores cargados)`);
}

// Otra instancia tomó el control: esta deja de escribir para no pisar sus datos.
function onLostLease() {
  if (lostLease) return;
  lostLease = true;
  console.error('Otra instancia controla ahora los datos: esta deja de guardar y se cierra.');
  setTimeout(() => process.exit(0), 1000);
}

async function pgWrite() {
  if (!pool || lostLease) return;
  if (pgPending) { pgDirty = true; return pgPending; }
  pgDirty = false;
  pgPending = pool.query(
    'UPDATE pokecasino_state SET data = $1, updated_at = now(), heartbeat = now() WHERE id = 1 AND owner = $2',
    [JSON.stringify(data), INSTANCE],
  ).then((r) => { if (!r.rowCount) onLostLease(); })
    .catch((e) => console.error('Error guardando en Postgres:', e.message)).finally(() => {
      pgPending = null;
      if (pgDirty) pgWrite();
    });
  return pgPending;
}

// Libera la base para que la siguiente instancia pueda cargarla (tras el guardado final).
async function release() {
  if (!pool || lostLease) return;
  clearInterval(heartbeat);
  await pool.query('UPDATE pokecasino_state SET owner = NULL WHERE id = 1 AND owner = $1', [INSTANCE]).catch((e) => console.error(e.message));
}

const isReadOnly = () => lostLease;

let timer = null;
function flush() {
  clearTimeout(timer);
  timer = null;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE);
}
function save() {
  if (!timer) timer = setTimeout(flush, 500);
  if (pool && !pgTimer) pgTimer = setTimeout(() => { pgTimer = null; pgWrite(); }, 700);
}
// Guardado final antes de apagar (Render envía SIGTERM al dormir o redesplegar).
async function flushAll() {
  flush();
  clearTimeout(pgTimer);
  pgTimer = null;
  if (pool) { await pgWrite(); while (pgPending) await pgPending; }
}

// ---- Depósito de monedas en juego ----
// Fichas en la mesa de póker, apuestas de carrera/Crash y retos con apuesta quedan apuntados aquí
// mientras están en juego. Si el servidor se apaga de golpe, al arrancar se devuelven.
function escrowSet(key, userId, amount) {
  if (amount > 0) data.escrow[key] = { userId, amount };
  else delete data.escrow[key];
  save();
}
function escrowDel(key) {
  if (data.escrow[key]) { delete data.escrow[key]; save(); }
}
function refundEscrow() {
  let n = 0;
  let total = 0;
  for (const { userId, amount } of Object.values(data.escrow)) {
    const u = data.users[userId];
    if (u) { u.coins += amount; n++; total += amount; require('./hub').ledger(u, amount, 'refund', 'Partida interrumpida por una actualización'); }
  }
  data.escrow = {};
  save();
  return { n, total };
}

function addUser(u) {
  migrateUser(u);
  data.users[u.id] = u;
  byName.set(u.username.toLowerCase(), u);
  save();
}
const userByName = (name) => byName.get(String(name || '').toLowerCase());
const userById = (id) => data.users[id];

module.exports = { escrowSet, escrowDel, refundEscrow, data, save, flush, flushAll, init, release, isReadOnly, addUser, userByName, userById };
