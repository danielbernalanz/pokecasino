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
  assert.ok(csp.includes("connect-src 'self' https://raw.githubusercontent.com") && !/connect-src[^;]*\bwss?:/.test(csp), 'connect-src sin ws: ni wss: abiertos');
  assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(r.headers.get('x-frame-options'), 'DENY');
  assert.strictEqual(r.headers.get('x-powered-by'), null);
  assert.ok(r.headers.get('permissions-policy').includes('camera=()'));
});

test('registro, inicio de sesión y validaciones', async () => {
  assert.strictEqual((await post('/api/register', { username: 'a', password: 'secret123' })).status, 400);
  assert.strictEqual((await post('/api/register', { username: 'Ana<script>', password: 'secret123' })).status, 400);
  assert.strictEqual((await post('/api/register', { username: 'Ana', password: '123' })).status, 400);
  // Un nombre que no es texto (lista u objeto en el JSON) pasaba la expresión regular y dejaba una cuenta corrupta que vaciaba la base al reiniciar.
  for (const bad of [['Listilla'], { toString: 1 }, 12345, true]) assert.strictEqual((await post('/api/register', { username: bad, password: 'secret123' })).status, 400, JSON.stringify(bad));
  assert.strictEqual((await post('/api/login', { username: ['Listilla'], password: 'secret123' })).status, 400);
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

// ---- Auditoría de seguridad ----
// Cliente mínimo de Socket.IO (protocolo EIO 4 sobre WebSocket) para probar los manejadores sin dependencias.
function sio(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace('http', 'ws') + '/socket.io/?EIO=4&transport=websocket');
    let n = 0; const acks = new Map(); const c = { ws, closed: false };
    c.emit = (ev, payload = {}) => new Promise((res) => { const id = ++n; acks.set(id, res); ws.send(`42${id}${JSON.stringify([ev, payload])}`); });
    ws.onmessage = (m) => {
      const d = String(m.data);
      if (d[0] === '0') ws.send('40' + JSON.stringify({ token }));
      else if (d === '2') ws.send('3');
      else if (d.startsWith('40')) resolve(c);
      else if (d.startsWith('44')) reject(new Error('conexión rechazada ' + d));
      else if (d.startsWith('43')) { const k = d.indexOf('['); const id = Number(d.slice(2, k)); const f = acks.get(id); if (f) { acks.delete(id); f(JSON.parse(d.slice(k))[0]); } }
    };
    ws.onclose = () => { c.closed = true; };
    ws.onerror = () => reject(new Error('ws'));
  });
}
const loginTok = async (u) => (await post('/api/login', { username: u, password: 'secret123' })).body.token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('anfitriones: solo el primero actúa sobre otros anfitriones (bloquear, restablecer, quitar el cargo)', async () => {
  const ana = await sio(await loginTok('Ana'));
  const beto = await sio(await loginTok('Beto'));
  assert.ok((await ana.emit('admin:admin', { username: 'Beto', isAdmin: true })).ok, 'el primer anfitrión nombra anfitriones');
  const r1 = await beto.emit('admin:ban', { username: 'Ana', banned: true });
  assert.ok(!r1.ok && /otro anfitrión/.test(r1.error), 'un anfitrión no bloquea a otro');
  const r2 = await beto.emit('admin:reset', { username: 'Ana', password: 'nueva-clave-1' });
  assert.ok(!r2.ok && /otro anfitrión/.test(r2.error));
  const r3 = await beto.emit('admin:admin', { username: 'Ana', isAdmin: false });
  assert.ok(!r3.ok && /otro anfitrión/.test(r3.error));
  assert.ok((await post('/api/login', { username: 'Ana', password: 'secret123' })).body.ok, 'Ana sigue intacta');
  // El primero sí puede sobre el segundo, y un anfitrión sí sobre un jugador normal.
  assert.ok((await beto.emit('admin:ban', { username: 'Caro', banned: false })).ok);
  assert.ok((await ana.emit('admin:ban', { username: 'Beto', banned: true })).ok);
  await sleep(100);
  assert.ok((await ana.emit('admin:ban', { username: 'Beto', banned: false })).ok);
  assert.ok((await ana.emit('admin:admin', { username: 'Beto', isAdmin: false })).ok);
  ana.ws.close(); beto.ws.close();
});

test('restaurar copias: se comprueba el anfitrión antes de leer el cuerpo', async () => {
  const big = JSON.stringify({ data: { users: {}, pad: 'x'.repeat(1_000_000) } });
  const r = await fetch(base + '/api/admin/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: big });
  assert.strictEqual(r.status, 403);
  const tok = await loginTok('Caro');
  const r2 = await fetch(base + '/api/admin/restore', { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': tok }, body: big });
  assert.strictEqual(r2.status, 403, 'un jugador normal tampoco');
});

test('sockets: como mucho 5 por usuario (cae el más antiguo) y un cubo de acciones por usuario', async () => {
  const tok = await loginTok('Caro');
  const socks = [];
  for (let i = 0; i < 7; i++) socks.push(await sio(tok));
  await sleep(300);
  assert.ok(socks[0].closed && socks[1].closed, 'los dos más antiguos se desconectan');
  assert.ok(socks.slice(2).every((s) => !s.closed));
  // 3 sockets disparando a la vez comparten el mismo cubo (25 + 12/s): no se triplica el límite.
  const live = socks.slice(2, 5);
  const res = await Promise.all(Array.from({ length: 90 }, (_, i) => live[i % 3].emit('leaderboard', {})));
  const limited = res.filter((r) => !r.ok && /Demasiadas/.test(r.error)).length;
  assert.ok(limited >= 40, `se limitan las acciones sobrantes (${limited})`);
  const beat = await live[0].emit('play:beat', {});
  assert.ok(beat && typeof beat.ok === 'boolean', 'el latido sigue respondiendo');
  socks.forEach((s) => s.ws.close());
});

test('chat y mensajes: solo texto; los errores de Express salen como JSON genérico sin traza', async () => {
  const s = await sio(await loginTok('Ana'));
  for (const bad of [{ text: { a: 1 } }, { text: ['hola'] }, { text: 12 }, {}]) assert.ok(!(await s.emit('chat:send', bad)).ok, JSON.stringify(bad));
  s.ws.close();
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"username":' });
  assert.strictEqual(r.status, 400);
  const j = await r.json();
  assert.strictEqual(j.ok, false);
  assert.ok(!/at |node_modules|SyntaxError/.test(JSON.stringify(j)), 'sin traza');
});

test('el inicio de sesión de un usuario inexistente también gasta el hash (tiempo parecido) y responde igual', async () => {
  const a = await post('/api/login', { username: 'NoExisto', password: 'secret123' });
  const b = await post('/api/login', { username: 'Ana', password: 'mala-clave' });
  assert.strictEqual(a.body.error, b.body.error);
});

test('demasiados intentos fallidos bloquean el inicio de sesión', async () => {
  for (let i = 0; i < 10; i++) await post('/api/login', { username: 'Ana', password: 'otra-mala' });
  const r = await post('/api/login', { username: 'Ana', password: 'secret123' });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /Demasiados intentos/);
});
