'use strict';
const crypto = require('crypto');
const db = require('./db');
const { ACCESS_KEY, START_COINS } = require('./config');

const SESSION_TTL = 30 * 24 * 3600 * 1000;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function checkPassword(pw, user) {
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
    pity: {},
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
  return u && !u.banned ? u : null;
}

function destroySession(token) {
  if (typeof token === 'string') { delete db.data.sessions[sha(token)]; db.save(); }
}

const NAME_RE = /^[A-Za-z0-9_\-]{3,16}$/;

function register({ username, password, invite }, ip) {
  if (tooMany(ip)) throw new Error('Demasiados intentos, espera unos minutos.');
  if (!NAME_RE.test(username || '')) throw new Error('Nombre: 3-16 caracteres (letras, números, _ o -).');
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) throw new Error('La contraseña necesita al menos 6 caracteres.');
  const code = String(invite || '').trim().toUpperCase();
  const single = db.data.invites[code];
  const master = code.length > 0 && code === String(ACCESS_KEY).toUpperCase();
  if (!master && !(single && !single.usedBy)) { noteFail(ip); throw new Error('Código de invitación no válido.'); }
  if (db.userByName(username)) throw new Error('Ese nombre ya está en uso.');
  const isFirst = Object.keys(db.data.users).length === 0;
  const user = newUser(username, password, isFirst);
  if (!master) single.usedBy = user.username;
  db.addUser(user);
  return { user, token: createSession(user) };
}

function login({ username, password }, ip) {
  if (tooMany(ip)) throw new Error('Demasiados intentos, espera unos minutos.');
  const u = db.userByName(username);
  if (!u || typeof password !== 'string' || !checkPassword(password, u)) { noteFail(ip); throw new Error('Usuario o contraseña incorrectos.'); }
  if (u.banned) throw new Error('Esta cuenta está suspendida.');
  return { user: u, token: createSession(u) };
}

module.exports = { register, login, userFromToken, destroySession, hashPassword };
