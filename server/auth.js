'use strict';
const crypto = require('crypto');
const db = require('./db');
const { ACCESS_KEY, START_COINS, OPEN_REGISTRATION } = require('./config');

const SESSION_TTL = 30 * 24 * 3600 * 1000;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function checkPassword(pw, user) {
  if (!user.salt || !user.hash) return false; // cuentas sin contraseña (comerciantes NPC)
  const h = crypto.scryptSync(pw, user.salt, 64);
  return crypto.timingSafeEqual(h, Buffer.from(user.hash, 'hex'));
}

// Limitador sencillo de intentos fallidos por IP.
const fails = new Map();
function tooMany(ip) {
  const f = fails.get(ip);
  if (!f) return false;
  if (Date.now() - f.first > 15 * 60 * 1000) { fails.delete(ip); return false; }
  return f.count >= 10;
}
// Limpieza periódica: los mapas por IP no crecen sin límite y las sesiones caducadas se borran.
setInterval(() => {
  const now = Date.now();
  for (const [ip, f] of fails) if (now - f.first > 15 * 60 * 1000) fails.delete(ip);
  for (const [ip, list] of signups) if (!list.some((t) => now - t < 24 * 3600 * 1000)) signups.delete(ip);
  let n = 0;
  for (const [k, s] of Object.entries(db.data.sessions)) if (s.expires < now) { delete db.data.sessions[k]; n++; }
  if (n) db.save();
}, 3600 * 1000).unref();

function noteFail(ip) {
  const f = fails.get(ip) || { count: 0, first: Date.now() };
  f.count++;
  fails.set(ip, f);
}

function newUser(username, password, isAdmin) {
  const { salt, hash } = hashPassword(password);
  return {
    id: crypto.randomUUID(),
    username,
    salt,
    hash,
    isAdmin,
    banned: false,
    createdAt: Date.now(),
    coins: START_COINS,
    dust: 0,
    xp: 0,
    level: 1,
    daily: { last: null, streak: 0, freePull: null },
    lastHeal: 0,
    collection: {},
    buddy: null,
    voltorb: { level: 1, game: null },
    stats: { wagered: 0, won: 0, pulls: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0, races: 0 },
  };
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  db.data.sessions[sha(token)] = { userId: user.id, expires: Date.now() + SESSION_TTL };
  db.save();
  return token;
}

function userFromToken(token) {
  if (typeof token !== 'string') return null;
  const s = db.data.sessions[sha(token)];
  if (!s) return null;
  if (s.expires < Date.now()) { delete db.data.sessions[sha(token)]; db.save(); return null; }
  const u = db.userById(s.userId);
  return u && !u.banned && !u.npc ? u : null;
}

function destroySession(token) {
  if (typeof token === 'string') { delete db.data.sessions[sha(token)]; db.save(); }
}

const NAME_RE = /^[A-Za-z0-9_\-]{3,16}$/;

// Con el registro abierto, como mucho 3 cuentas nuevas por IP cada 24 h.
const signups = new Map();
function signupAllowed(ip) {
  const now = Date.now();
  const list = (signups.get(ip) || []).filter((t) => now - t < 24 * 3600 * 1000);
  signups.set(ip, list);
  return list.length < 3;
}

function register({ username, password, invite }, ip) {
  if (tooMany(ip)) throw new Error('Demasiados intentos, espera unos minutos.');
  // Solo texto: un JSON con el nombre como lista u objeto pasaba la expresión regular (se convierte a texto) y dejaba una cuenta corrupta.
  if (typeof username !== 'string' || !NAME_RE.test(username)) throw new Error('Nombre: 3-16 caracteres (letras, números, _ o -).');
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) throw new Error('La contraseña necesita al menos 6 caracteres.');
  const code = String(invite || '').trim().toUpperCase();
  const single = db.data.invites[code];
  const master = OPEN_REGISTRATION || (code.length > 0 && code === String(ACCESS_KEY).toUpperCase());
  if (!master && !(single && !single.usedBy)) { noteFail(ip); throw new Error('Código de invitación no válido.'); }
  if (OPEN_REGISTRATION && !signupAllowed(ip)) throw new Error('Demasiadas cuentas nuevas desde tu conexión. Inténtalo mañana.');
  // Los nombres de los comerciantes NPC están reservados aunque aún no existan sus cuentas.
  if (db.userByName(username) || require('./npc').isNpcName(username)) throw new Error('Ese nombre ya está en uso.');
  const isFirst = !Object.values(db.data.users).some((x) => !x.npc);
  const user = newUser(username, password, isFirst);
  if (!master) single.usedBy = user.username;
  db.addUser(user);
  if (OPEN_REGISTRATION) signups.get(ip).push(Date.now());
  return { user, token: createSession(user) };
}

function login({ username, password }, ip) {
  if (tooMany(ip)) throw new Error('Demasiados intentos, espera unos minutos.');
  const u = typeof username === 'string' ? db.userByName(username) : null;
  if (!u || u.npc || typeof password !== 'string' || !checkPassword(password, u)) { noteFail(ip); throw new Error('Usuario o contraseña incorrectos.'); }
  if (u.banned) throw new Error('Esta cuenta está suspendida.');
  return { user: u, token: createSession(u) };
}

module.exports = { register, login, userFromToken, destroySession, hashPassword };
