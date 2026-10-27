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
  market: { listings: [], sales: [], nextId: 1 },
});

// Campos añadidos en versiones posteriores: se rellenan al cargar cuentas antiguas.
function migrateUser(u) {
  u.items ||= {};
  u.buffs ||= { shinyCharges: 0, amuletUntil: 0, luckyUntil: 0, masterBall: false };
  u.games ||= {};
  u.stats.sold ||= 0;
  u.stats.bought ||= 0;
  return u;
}

// `data` es siempre el mismo objeto: los módulos guardan la referencia.
const data = empty();
const byName = new Map();

function load(raw) {
  for (const k of Object.keys(data)) delete data[k];
  Object.assign(data, empty(), raw || {});
  data.market = Object.assign({ listings: [], sales: [], nextId: 1 }, data.market);
  byName.clear();
  for (const u of Object.values(data.users)) { migrateUser(u); byName.set(u.username.toLowerCase(), u); }
}

try { load(JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch { load(null); /* base nueva */ }

// ---- Postgres opcional (DATABASE_URL): para alojamientos sin disco persistente ----
let pool = null;
let pgPending = null;
let pgDirty = false;
let pgTimer = null;

async function init() {
  if (!process.env.DATABASE_URL) return;
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL;
  const ssl = /sslmode=require/.test(url) || process.env.PGSSL === '1' ? { rejectUnauthorized: false } : false;
  pool = new Pool({ connectionString: url, ssl, max: 2 });
  await pool.query('CREATE TABLE IF NOT EXISTS pokecasino_state (id INT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const r = await pool.query('SELECT data FROM pokecasino_state WHERE id = 1');
  if (r.rows[0]) load(r.rows[0].data);
  console.log(`  🐘 Datos en Postgres (${Object.keys(data.users).length} jugadores cargados)`);
}

async function pgWrite() {
  if (!pool) return;
  if (pgPending) { pgDirty = true; return pgPending; }
  pgDirty = false;
  pgPending = pool.query(
    'INSERT INTO pokecasino_state (id, data, updated_at) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()',
    [JSON.stringify(data)],
  ).catch((e) => console.error('Error guardando en Postgres:', e.message)).finally(() => {
    pgPending = null;
    if (pgDirty) pgWrite();
  });
  return pgPending;
}

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
  if (pool && !pgTimer) pgTimer = setTimeout(() => { pgTimer = null; pgWrite(); }, 2000);
}
// Guardado final antes de apagar (Render envía SIGTERM al dormir o redesplegar).
async function flushAll() {
  flush();
  clearTimeout(pgTimer);
  pgTimer = null;
  if (pool) { await pgWrite(); while (pgPending) await pgPending; }
}

function addUser(u) {
  migrateUser(u);
  data.users[u.id] = u;
  byName.set(u.username.toLowerCase(), u);
  save();
}
const userByName = (name) => byName.get(String(name || '').toLowerCase());
const userById = (id) => data.users[id];

module.exports = { data, save, flush, flushAll, init, addUser, userByName, userById };
