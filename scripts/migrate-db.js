#!/usr/bin/env node
'use strict';
// Copia la base de PokéCasino entre dos Postgres, o carga una copia descargada (.json) en una base nueva.
//   node scripts/migrate-db.js <ORIGEN_DATABASE_URL> <DESTINO_DATABASE_URL> [--force]
//   node scripts/migrate-db.js --from-file copia.json <DESTINO_DATABASE_URL> [--force]
// Sin --force se niega a escribir sobre un destino que ya tenga datos.

const STATE_DDL = 'CREATE TABLE IF NOT EXISTS pokecasino_state (id INT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())';
const BACKUP_DDL = 'CREATE TABLE IF NOT EXISTS pokecasino_backups (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), note TEXT, data JSONB NOT NULL)';

const asObj = (d) => (typeof d === 'string' ? JSON.parse(d) : d);
const countUsers = (d) => (d && d.users ? Object.keys(d.users).length : 0);

// Acepta el archivo de «Descargar copia» ({version, createdAt, data}) o el JSON de estado a pelo.
function parseBackupFile(text) {
  const parsed = JSON.parse(text);
  const data = parsed && parsed.data && parsed.data.users ? parsed.data : parsed;
  if (!data || typeof data.users !== 'object' || !data.users) throw new Error('El archivo no es una copia de PokéCasino.');
  return data;
}

async function createTables(q) { await q(STATE_DDL); await q(BACKUP_DDL); }

// ¿Tiene ya datos el destino? (jugadores en el estado o copias guardadas)
async function targetInfo(q) {
  await createTables(q);
  const s = await q('SELECT data FROM pokecasino_state WHERE id = 1');
  const b = await q('SELECT count(*)::int AS n FROM pokecasino_backups');
  return { players: s.rows[0] ? countUsers(asObj(s.rows[0].data)) : 0, hasState: !!s.rows[0], backups: b.rows[0] ? Number(b.rows[0].n) : 0 };
}

async function readSource(q) {
  const s = await q('SELECT data FROM pokecasino_state WHERE id = 1');
  if (!s.rows[0]) throw new Error('El origen no tiene datos (tabla pokecasino_state vacía).');
  let backups = [];
  try { backups = (await q('SELECT created_at, note, data FROM pokecasino_backups ORDER BY id ASC')).rows; } catch { /* sin tabla de copias */ }
  return { state: asObj(s.rows[0].data), backups };
}

// Escribe el estado (y copias) en el destino. `owner` queda libre para que el servidor lo reclame.
async function writeTarget(q, { state, backups = [] }, { force = false } = {}) {
  const info = await targetInfo(q);
  if ((info.players > 0 || info.backups > 0) && !force) {
    throw new Error(`El destino ya tiene datos (${info.players} jugadores, ${info.backups} copias). Usa --force para sobrescribir.`);
  }
  if (force) await q('DELETE FROM pokecasino_backups');
  await q(
    `INSERT INTO pokecasino_state (id, data, owner, heartbeat) VALUES (1, $1::jsonb, NULL, NULL)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now(), owner = NULL, heartbeat = NULL`,
    [JSON.stringify(state)],
  );
  for (const b of backups) await q('INSERT INTO pokecasino_backups (created_at, note, data) VALUES ($1, $2, $3::jsonb)', [b.created_at, b.note, JSON.stringify(asObj(b.data))]);
  return { players: countUsers(state), bytes: Buffer.byteLength(JSON.stringify(state)), backups: backups.length };
}

// Antes de escribir se prepara la columna owner/heartbeat (la usa server/db.js).
async function prepareLease(q) {
  await q('ALTER TABLE pokecasino_state ADD COLUMN IF NOT EXISTS owner TEXT');
  await q('ALTER TABLE pokecasino_state ADD COLUMN IF NOT EXISTS heartbeat TIMESTAMPTZ');
}

async function migrate(srcQ, dstQ, opts = {}) {
  const src = await readSource(srcQ);
  await createTables(dstQ); await prepareLease(dstQ);
  return writeTarget(dstQ, src, opts);
}
async function loadFile(text, dstQ, opts = {}) {
  await createTables(dstQ); await prepareLease(dstQ);
  return writeTarget(dstQ, { state: parseBackupFile(text), backups: [] }, opts);
}

const summary = (r) => `Listo: ${r.players} jugadores, ${(r.bytes / 1024).toFixed(0)} KB de estado, ${r.backups} copias traspasadas.`;

function poolFor(url) {
  const { Pool } = require('pg');
  const ssl = /sslmode=require/.test(url) || process.env.PGSSL === '1' ? { rejectUnauthorized: false } : false;
  const pool = new Pool({ connectionString: url, ssl, max: 1 });
  return { q: (sql, params) => pool.query(sql, params), end: () => pool.end() };
}

async function main(argv) {
  const force = argv.includes('--force');
  const args = argv.filter((a) => a !== '--force');
  const fileMode = args[0] === '--from-file';
  const need = fileMode ? 3 : 2;
  if (args.length !== need) {
    console.error('Uso:\n  node scripts/migrate-db.js <ORIGEN_DATABASE_URL> <DESTINO_DATABASE_URL> [--force]\n  node scripts/migrate-db.js --from-file copia.json <DESTINO_DATABASE_URL> [--force]');
    return 1;
  }
  const dst = poolFor(args[need - 1]);
  let src = null;
  try {
    let r;
    if (fileMode) r = await loadFile(require('fs').readFileSync(args[1], 'utf8'), dst.q, { force });
    else { src = poolFor(args[0]); r = await migrate(src.q, dst.q, { force }); }
    console.log(summary(r));
    console.log('Ahora pon DATABASE_URL (la del destino) en el servicio web y reinicia.');
    return 0;
  } catch (e) { console.error('Error: ' + e.message); return 1; }
  finally { await dst.end().catch(() => {}); if (src) await src.end().catch(() => {}); }
}

module.exports = { parseBackupFile, targetInfo, readSource, writeTarget, migrate, loadFile, summary };
if (require.main === module) main(process.argv.slice(2)).then((c) => process.exit(c));
