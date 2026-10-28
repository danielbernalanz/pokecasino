'use strict';
// Arranca el servidor de verdad en un puerto libre y prueba la API, las cabeceras y los sockets.
const os = require('os');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const test = require('node:test');
const assert = require('node:assert');

let srv;
let base;
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

test.before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-srv-')), OPEN_REGISTRATION: '1', NETWORK_MODE: 'private' };
  delete env.DATABASE_URL;
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('el servidor no arrancó')), 15000);
    srv.stdout.on('data', (d) => { if (String(d).includes('Casino abierto')) { clearTimeout(t); resolve(); } });
  });
});
test.after(() => srv && srv.kill('SIGTERM'));

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('cabeceras de seguridad en la página', async () => {
  const r = await fetch(base + '/');
  assert.strictEqual(r.status, 200);
  const csp = r.headers.get('content-security-policy');
  for (const d of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'"]) assert.ok(csp.includes(d), d);
  assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(r.headers.get('x-frame-options'), 'DENY');
  assert.strictEqual(r.headers.get('x-powered-by'), null);
  assert.ok(r.headers.get('permissions-policy').includes('camera=()'));
});

test('registro, inicio de sesión y validaciones', async () => {
  assert.strictEqual((await post('/api/register', { username: 'a', password: 'secret123' })).status, 400);
  assert.strictEqual((await post('/api/register', { username: 'Ana<script>', password: 'secret123' })).status, 400);
  assert.strictEqual((await post('/api/register', { username: 'Ana', password: '123' })).status, 400);
  const ok = await post('/api/register', { username: 'Ana', password: 'secret123' });
  assert.ok(ok.body.ok && /^[0-9a-f]{64}$/.test(ok.body.token));
  assert.strictEqual((await post('/api/register', { username: 'ana', password: 'secret123' })).body.error, 'Ese nombre ya está en uso.');
  assert.strictEqual((await post('/api/login', { username: 'Ana', password: 'mala-clave' })).status, 400);
  assert.ok((await post('/api/login', { username: 'Ana', password: 'secret123' })).body.ok);
  // Cuerpo demasiado grande
  const big = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'x'.repeat(20000) }) });
  assert.strictEqual(big.status, 413);
});

test('el registro abierto limita las cuentas por conexión', async () => {
  const r = [];
  for (const n of ['Beto', 'Caro', 'Dani']) r.push((await post('/api/register', { username: n, password: 'secret123' })).body.ok);
  // Ana ya contó como 1: la 4.ª cuenta del día desde la misma IP se rechaza.
  assert.deepStrictEqual(r, [true, true, false]);
});

test('la API estática no expone datos de jugadores', async () => {
  const s = await (await fetch(base + '/api/static')).json();
  assert.ok(Array.isArray(s.dex) && s.dex.length >= 1025);
  const txt = JSON.stringify(s);
  assert.ok(!txt.includes('secret123') && !txt.includes('"hash"') && !txt.includes('"salt"'));
});

test('demasiados intentos fallidos bloquean el inicio de sesión', async () => {
  for (let i = 0; i < 10; i++) await post('/api/login', { username: 'Ana', password: 'otra-mala' });
  const r = await post('/api/login', { username: 'Ana', password: 'secret123' });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /Demasiados intentos/);
});
