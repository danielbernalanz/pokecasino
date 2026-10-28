'use strict';
// Copias de seguridad automáticas y auditoría al arrancar.
// - Con Postgres: una copia completa al día en la tabla pokecasino_backups (se guardan las 14 últimas).
// - Sin Postgres: archivos en DATA_DIR/backups (también 14).
// - Auditoría: al arrancar se escribe en el log un resumen por jugador (monedas, ajustes del anfitrión,
//   apostado/ganado…) para poder detectar saldos que no salen de jugar.
const fs = require('fs');
const path = require('path');
const db = require('./db');

const KEEP = 14;
const EVERY = 24 * 3600 * 1000;
const DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'backups');

const snapshot = () => JSON.stringify({ version: 1, createdAt: new Date().toISOString(), data: db.data });

async function pgSetup(pool) {
  await pool.query('CREATE TABLE IF NOT EXISTS pokecasino_backups (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), note TEXT, data JSONB NOT NULL)');
}

// Hace una copia ahora. `note` explica el motivo (diaria, manual, antes de restaurar…).
async function backupNow(note = 'diaria') {
  const pool = db.getPool();
  const json = snapshot();
  if (pool) {
    await pgSetup(pool);
    await pool.query('INSERT INTO pokecasino_backups (note, data) VALUES ($1, $2::jsonb)', [note, json]);
    await pool.query(`DELETE FROM pokecasino_backups WHERE id NOT IN (SELECT id FROM pokecasino_backups ORDER BY id DESC LIMIT ${KEEP})`);
  } else {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, `copia-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), json);
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP))) fs.unlinkSync(path.join(DIR, f));
  }
  db.data.state.lastBackup = Date.now();
  db.save();
  console.log(`  💾 Copia de seguridad guardada (${note}, ${(json.length / 1024).toFixed(0)} KB)`);
}

async function list() {
  const pool = db.getPool();
  if (pool) {
    await pgSetup(pool);
    const r = await pool.query('SELECT id, created_at, note, octet_length(data::text) AS size FROM pokecasino_backups ORDER BY id DESC');
    return r.rows.map((x) => ({ id: x.id, at: new Date(x.created_at).getTime(), note: x.note, size: Number(x.size) }));
  }
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort().reverse()
    .map((f) => { const st = fs.statSync(path.join(DIR, f)); return { id: f, at: st.mtimeMs, note: 'archivo', size: st.size }; });
}

// Legendarias y míticas que tiene el jugador (por rareza de la Pokédex).
function legendaries(u) {
  const { BY_ID } = require('./pokedex');
  return Object.keys(u.collection || {}).filter((id) => { const p = BY_ID.get(Number(id)); return p && (p.rarity === 'L' || p.rarity === 'M'); }).length;
}

// Resumen por jugador en el log (sin contraseñas ni sesiones).
function audit() {
  const users = Object.values(db.data.users).filter((u) => !u.npc);
  const adminLog = db.data.adminLog || [];
  const rows = users.map((u) => {
    const log = (u.hist && u.hist.log) || [];
    const sum = (r) => log.filter((m) => m.r === r).reduce((s, m) => s + m.d, 0);
    const grants = adminLog.filter((l) => l.action === 'coins' && l.target === u.username);
    const games = Object.values((u.hist && u.hist.games) || {}).reduce((s, g) => s + g.won - g.bet, 0);
    return {
      u: u.username, admin: !!u.isAdmin, coins: u.coins, dust: u.dust, lvl: u.level,
      wagered: (u.stats && u.stats.wagered) || 0, won: (u.stats && u.stats.won) || 0, pulls: (u.stats && u.stats.pulls) || 0,
      dex: Object.keys(u.collection || {}).length, adminLedger: sum('admin'), adminLogN: grants.length,
      adminBy: [...new Set(grants.map((g) => g.by))].join('|'), giftIn: sum('gift_in'), giftOut: sum('gift_out'),
      gamesNet: games, days: Math.round((Date.now() - (u.createdAt || Date.now())) / 864e5 * 10) / 10,
      // Lo que no se ve en las monedas: objetos, medallas, rarezas y lo apartado en el Mercado.
      items: u.items || {}, badges: (u.progress && u.progress.badges) || [], titles: (u.progress && u.progress.titles) || [],
      equip: u.equip || {}, legend: legendaries(u), shinies: Object.values(u.collection || {}).filter((c) => c.s > 0).length,
      stars5: Object.values(u.collection || {}).filter((c) => c.n >= 5).length, xp: u.xp,
      orders: ((db.data.market && db.data.market.orders) || []).filter((o) => o.userId === u.id).map((o) => `${o.side}:${o.ref}x${o.qty}@${o.price}`),
      stats: u.stats || {}, daily: u.daily && u.daily.streak, lastHeal: u.lastHeal || 0,
    };
  }).sort((a, b) => b.coins - a.coins);
  // Una línea por jugador: los logs cortan las líneas muy largas.
  console.log('  🔎 AUDITORIA ' + JSON.stringify({ at: new Date().toISOString(), adminLog: adminLog.slice(-50) }));
  for (const r of rows) console.log('  🔎 AUDITORIA-JUGADOR ' + JSON.stringify(r));
}

let timer = null;
function start() {
  // Correcciones de datos pendientes (con copia previa) y después la auditoría.
  require('./fixes').run(backupNow).catch((e) => console.error('Correcciones:', e.message)).finally(() => {
    try { audit(); } catch (e) { console.error('Auditoría:', e.message); }
  });
  const tick = () => {
    const last = db.data.state.lastBackup || 0;
    if (Date.now() - last >= EVERY && !db.isReadOnly()) backupNow('diaria').catch((e) => console.error('Copia de seguridad:', e.message));
  };
  setTimeout(tick, 15000).unref();
  timer = setInterval(tick, 3600 * 1000);
  timer.unref();
}

module.exports = { start, backupNow, list, snapshot, audit };
