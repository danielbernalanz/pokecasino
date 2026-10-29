'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-bk-'));
delete process.env.DATABASE_URL;
const test = require('node:test');
const assert = require('node:assert');
const backup = require('../server/backup');
const db = require('../server/db');
const mig = require('../scripts/migrate-db');

// Postgres falso en memoria: solo entiende las consultas del script.
function fakePg(init = {}) {
  const t = { state: init.state || null, backups: init.backups || [] };
  const q = async (sql, p = []) => {
    if (/^CREATE TABLE|^ALTER TABLE/.test(sql)) return { rows: [] };
    if (/SELECT data FROM pokecasino_state/.test(sql)) return { rows: t.state ? [{ data: t.state }] : [] };
    if (/SELECT count/.test(sql)) return { rows: [{ n: t.backups.length }] };
    if (/SELECT created_at/.test(sql)) return { rows: t.backups };
    if (/DELETE FROM pokecasino_backups/.test(sql)) { t.backups = []; return { rows: [] }; }
    if (/INSERT INTO pokecasino_state/.test(sql)) { t.state = JSON.parse(p[0]); return { rows: [] }; }
    if (/INSERT INTO pokecasino_backups/.test(sql)) { t.backups.push({ created_at: p[0], note: p[1], data: JSON.parse(p[2]) }); return { rows: [] }; }
    throw new Error('consulta inesperada: ' + sql);
  };
  return { q, t };
}
const S1 = { users: { a: { username: 'a' }, b: { username: 'b' } } };

test('migrate copia estado y copias a un destino vacío', async () => {
  const src = fakePg({ state: S1, backups: [{ created_at: 'x', note: 'diaria', data: S1 }] });
  const dst = fakePg();
  const r = await mig.migrate(src.q, dst.q);
  assert.equal(r.players, 2); assert.equal(r.backups, 1);
  assert.deepEqual(dst.t.state, S1);
  assert.equal(dst.t.backups[0].note, 'diaria');
});
test('migrate se niega a sobrescribir un destino con datos salvo --force', async () => {
  const src = fakePg({ state: S1 });
  const dst = fakePg({ state: { users: { z: { username: 'z' } } } });
  await assert.rejects(() => mig.migrate(src.q, dst.q), /--force/);
  assert.equal(Object.keys(dst.t.state.users)[0], 'z');
  await mig.migrate(src.q, dst.q, { force: true });
  assert.equal(Object.keys(dst.t.state.users).length, 2);
});
test('migrate falla si el origen está vacío', async () => {
  await assert.rejects(() => mig.migrate(fakePg().q, fakePg().q), /vacía/);
});
test('loadFile acepta la copia descargada y el JSON a pelo, y rechaza basura', async () => {
  const a = fakePg(); await mig.loadFile(JSON.stringify({ version: 1, createdAt: 'x', data: S1 }), a.q);
  assert.equal(Object.keys(a.t.state.users).length, 2);
  const b = fakePg(); await mig.loadFile(JSON.stringify(S1), b.q);
  assert.equal(Object.keys(b.t.state.users).length, 2);
  await assert.rejects(() => mig.loadFile('{"hola":1}', fakePg().q), /no es una copia/);
});

test('daysUntil cuenta los días que faltan', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  assert.equal(backup.daysUntil('2026-11-26', now), 25);
  assert.equal(backup.daysUntil('2026-11-02T12:00:00Z', now), 1);
  assert.equal(backup.daysUntil('2026-10-01', now) < 0, true);
  assert.equal(backup.daysUntil('', now), null);
  assert.equal(backup.daysUntil('basura', now), null);
});
test('status lee DB_EXPIRES y markDownload guarda la última descarga', () => {
  delete process.env.DB_EXPIRES;
  assert.equal(backup.status().expires, null);
  assert.equal(backup.status().downloadAgo, null);
  process.env.DB_EXPIRES = '2026-11-26';
  const now = Date.parse('2026-11-10T00:00:00Z');
  assert.equal(backup.status(now).daysLeft, 16);
  backup.markDownload(now - 3 * 864e5);
  assert.equal(db.data.state.lastDownload, now - 3 * 864e5);
  assert.equal(backup.status(now).downloadAgo, 3);
  delete process.env.DB_EXPIRES;
});
