'use strict';
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');

const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const hub = require('./hub');
const net = require('./netguard');
const dex = require('./pokedex');
const gacha = require('./gacha');
const locked = require('./locked');
const slots = require('./games/slots');
const roulette = require('./games/roulette');
const voltorb = require('./games/voltorb');
const race = require('./games/race');
const duel = require('./games/duel');
const { MOVES } = require('./games/battle');
const items = require('./items');
const healer = require('./heal');
const market = require('./market');
const events = require('./events');
const blackjack = require('./games/blackjack');
const videopoker = require('./games/videopoker');
const baccarat = require('./games/baccarat');
const plinko = require('./games/plinko');
const mines = require('./games/mines');
const quiz = require('./games/quiz');
const crash = require('./games/crash');
const holdem = require('./games/holdem');
const npc = require('./npc');
const BAL = require('./balance');
const daily = require('./daily');
const mega = require('./mega');
const news = require('./news');

const app = express();
app.set('trust proxy', config.TRUST_PROXY);
app.disable('x-powered-by');

// Comprobación de salud para plataformas de alojamiento (no expone datos).
app.get('/healthz', (req, res) => res.send('ok'));

// Mientras se cargan los datos (o durante un redespliegue) no se aceptan acciones.
let ready = false;
const BUSY = 'El casino se está actualizando, vuelve a intentarlo en unos segundos.';
app.use('/api', (req, res, next) => (ready || req.path === '/static' ? next() : res.status(503).json({ ok: false, error: BUSY })));

// ---- Filtro de red y cabeceras ----
app.use((req, res, next) => {
  if (!net.isAllowed(req.ip)) return res.status(403).send('Acceso restringido a la red privada.');
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data: https://raw.githubusercontent.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "connect-src 'self' ws: wss: https://raw.githubusercontent.com",
      "manifest-src 'self'",
      "worker-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  });
  // Detrás de HTTPS (Render, proxy inverso) se pide al navegador que use siempre HTTPS.
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(compression());
// Restaurar una copia de seguridad (solo anfitriones). Va antes del límite de 10 kB del resto de la API.
const backup = require('./backup');
const adminFromReq = (req) => { const u = auth.userFromToken(req.get('x-token')); return u && u.isAdmin && !u.banned ? u : null; };
app.get('/api/admin/backup', (req, res) => {
  const u = adminFromReq(req);
  if (!u) return res.status(403).json({ ok: false, error: 'Solo anfitriones.' });
  res.set('Content-Disposition', `attachment; filename="pokecasino-${new Date().toISOString().slice(0, 10)}.json"`);
  backup.markDownload();
  res.type('application/json').send(backup.snapshot());
});
app.post('/api/admin/restore', express.json({ limit: '20mb' }), async (req, res) => {
  const u = adminFromReq(req);
  if (!u) return res.status(403).json({ ok: false, error: 'Solo anfitriones.' });
  const raw = req.body && req.body.data;
  if (!raw || typeof raw !== 'object' || !raw.users || typeof raw.users !== 'object') return res.status(400).json({ ok: false, error: 'El archivo no es una copia de PokéCasino.' });
  try {
    await backup.backupNow('antes de restaurar');
    await db.replaceAll(raw);
    console.log(`  ♻️  Copia restaurada por ${u.username} (${Object.keys(raw.users).length} cuentas). Reiniciando…`);
    res.json({ ok: true });
    // Se reinicia para que todo (mesas, mercado, sesiones) arranque limpio con los datos restaurados.
    setTimeout(async () => { await db.release().catch(() => {}); process.exit(0); }, 800);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.use(express.json({ limit: '10kb' }));
// El service worker nunca se guarda en caché: así cada despliegue llega a los móviles.
app.get('/sw.js', (req, res, next) => { res.set('Cache-Control', 'no-cache'); next(); });
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders(res, file) {
    // Los iconos no cambian: caché larga. El resto se revalida siempre (respuestas 304 rápidas)
    // para que cada actualización llegue al momento.
    if (/[\\/]icons[\\/]/.test(file)) res.set('Cache-Control', 'public, max-age=604800');
    else if (/changelog\.json$/.test(file)) res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    else res.set('Cache-Control', 'no-cache');
  },
}));

app.post('/api/register', (req, res) => {
  try {
    const { user, token } = auth.register(req.body || {}, req.ip);
    hub.feed('join', `🎉 ${user.username} se unió al PokéCasino`);
    res.json({ ok: true, token });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.post('/api/login', (req, res) => {
  try {
    const { token } = auth.login(req.body || {}, req.ip);
    res.json({ ok: true, token });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.post('/api/logout', (req, res) => {
  auth.destroySession(req.body && req.body.token);
  res.json({ ok: true });
});

const STATIC = {
  dex: dex.DEX, rarity: dex.RARITY, types: dex.TYPES, chart: dex.CHART, moves: MOVES,
  banners: gacha.BANNERS, gachaCost: gacha.COST, gachaRates: gacha.RATES, shinyRate: gacha.SHINY_RATE,
  dustRate: gacha.DUST_RATE,
  slots: { symbols: slots.SYMBOLS, lines: slots.LINES, reels: slots.REELS },
  roulette: { wheel: roulette.WHEEL, groups: roulette.GROUPS, payout: roulette.PAYOUT },
  openRegistration: config.OPEN_REGISTRATION,
  racePool: race.POOL, voltorbDivisors: voltorb.DIVISORS, voltorbCap: voltorb.SCORE_CAP,
  items: items.ITEMS, marketFee: market.SETUP_FEE, salesTax: market.SALES_TAX, vpPaytable: videopoker.PAYTABLE, baccaratPayout: baccarat.PAYOUT,
  plinko: { tables: plinko.TABLES, rows: plinko.ROWS }, crashGrowth: crash.GROWTH, pokerTables: holdem.TABLES, minBet: config.MIN_BET, maxBet: config.MAX_BET, maxBetByBadges: hub.MAX_BET_BY_BADGES,
  cosmetics: items.COSMETICS,
  heal: { limit: healer.LIMIT, cooldown: healer.COOLDOWN, amount: healer.AMOUNT },
  daily: { base: BAL.DAILY_BASE, step: BAL.DAILY_STEP, max: BAL.DAILY_MAX_STREAK },
  mega: mega.STATIC,
  quiz: quiz.STATIC,
};
// Imágenes del Desafío: el token no revela el número del Pokémon (la URL del sprite sí lo haría).
app.get('/api/quiz/img/:token', quiz.imgHandler);
app.get('/api/static', (req, res) => res.json(STATIC));

const server = http.createServer(app);
// Compresión de mensajes grandes (estado del mercado, mesas de póker…).
const io = new Server(server, { maxHttpBufferSize: 20000, perMessageDeflate: { threshold: 2048 } });
hub.setIO(io);

// ---- Presencia ----
const online = new Map(); // userId -> nº de sockets
function onlineList() {
  return [...online.keys()].map((id) => db.userById(id)).filter((u) => u && !u.npc).map(hub.publicUser);
}
const pushOnline = () => io.emit('online', onlineList());

function claimDaily(user) {
  if (user.npc) throw new Error('Los comerciantes NPC no reclaman recompensas.');
  return daily.claim(user);
}

function heal(user) {
  if (user.npc) throw new Error('Los comerciantes NPC no usan el Centro Pokémon.');
  const locked = hub.lockedCoins(user);
  const why = healer.reason(user, locked);
  if (why) throw new Error(why);
  user.lastHeal = Date.now();
  user.coins += healer.AMOUNT;
  hub.ledger(user, healer.AMOUNT, 'heal');
  db.save();
  return { coins: healer.AMOUNT };
}

function leaderboard() {
  const users = Object.values(db.data.users).filter((u) => !u.banned && !u.npc);
  const top = (fn) => users.map((u) => ({ username: u.username, level: u.level, buddy: u.buddy, ...hub.looks(u), value: fn(u) }))
    .sort((a, b) => b.value - a.value).slice(0, 10);
  return {
    coins: top((u) => u.coins),
    dex: top((u) => Object.keys(u.collection).length),
    shinies: top((u) => Object.values(u.collection).reduce((s, c) => s + (c.s > 0 ? 1 : 0), 0)),
    badges: top((u) => (u.progress ? u.progress.badges.length * 1000 + u.progress.sets.length : 0)),
    biggestWin: top((u) => u.stats.biggestWin),
    duels: top((u) => u.stats.duelsWon),
  };
}

function viewPlayer(_user, { username }) {
  const u = db.userByName(username);
  if (!u) throw new Error('Jugador no encontrado.');
  return {
    player: {
      ...hub.publicUser(u), createdAt: u.createdAt, collection: u.collection,
      progress: { badges: u.progress.badges, sets: u.progress.sets },
      stats: { pulls: u.stats.pulls, duelsWon: u.stats.duelsWon, duelsLost: u.stats.duelsLost, biggestWin: u.stats.biggestWin },
    },
  };
}

function setBuddy(user, { id, shiny }) {
  if (id === null) { user.buddy = null; db.save(); return {}; }
  const c = user.collection[Number(id)];
  if (!c) throw new Error('No tienes ese Pokémon.');
  if (shiny && !c.s) throw new Error('No tienes la versión variocolor.');
  // Al volver a elegir al mismo Pokémon se conserva su megaevolución (si sigue desbloqueada).
  const keep = user.buddy && user.buddy.id === Number(id) && user.buddy.mega ? { mega: user.buddy.mega } : {};
  user.buddy = { id: Number(id), shiny: !!shiny, ...keep };
  hub.track(user, 'buddy');
  db.save();
  pushOnline();
  return {};
}

// Con el registro abierto, las cuentas recién creadas no pueden regalar (evita granjear cuentas).
function canGift(user) {
  if (user.isAdmin) return;
  if (user.level < 3 || Date.now() - user.createdAt < 24 * 3600 * 1000) throw new Error('Para regalar necesitas nivel 3 y una cuenta de al menos 1 día.');
}

function giftCoins(user, { to, amount }) {
  canGift(user);
  const t = db.userByName(to);
  amount = Number(amount);
  if (!t || t.id === user.id) throw new Error('Destinatario no válido.');
  if (t.npc) throw new Error('Los comerciantes NPC no aceptan regalos.');
  if (!Number.isInteger(amount) || amount < 1 || amount > user.coins) throw new Error('Cantidad no válida.');
  user.coins -= amount;
  t.coins += amount;
  hub.ledger(user, -amount, 'gift_out', t.username);
  hub.ledger(t, amount, 'gift_in', user.username);
  db.save();
  hub.emitUser(t.id, 'toast', { kind: 'gift', text: `🎁 ${user.username} te regaló ${amount.toLocaleString('es')} monedas` });
  hub.pushMe(t);
  return {};
}

function giftPoke(user, { to, id, shiny }) {
  canGift(user);
  const t = db.userByName(to);
  if (!t || t.id === user.id) throw new Error('Destinatario no válido.');
  if (t.npc) throw new Error('Los comerciantes NPC no aceptan regalos.');
  const p = gacha.takePoke(user, id, !!shiny);
  gacha.grant(t, p.id, !!shiny);
  hub.track(t, 'gift_recv');
  db.save();
  hub.emitUser(t.id, 'toast', { kind: 'gift', text: `🎁 ${user.username} te envió un ${shiny ? p.name + ' variocolor' : p.name}` });
  hub.feed('trade', `🤝 ${user.username} le regaló ${shiny ? 'un ' + p.name + ' variocolor' : p.name} a ${t.username}`);
  hub.pushMe(t);
  return {};
}

// ---- Chat ----
const lastMsg = new Map();
function chat(user, { text }) {
  text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!text) throw new Error('Mensaje vacío.');
  const last = lastMsg.get(user.id) || 0;
  if (Date.now() - last < 800) throw new Error('Más despacio, entrenador.');
  lastMsg.set(user.id, Date.now());
  // Mensaje privado: «/w nombre texto» (también /md o /msg).
  const dm = text.match(/^\/(?:w|md|msg)\s+(\S+)\s+(.+)$/i);
  if (dm) return privateMessage(user, dm[1], dm[2]);
  if (/^\/(?:w|md|msg)\b/i.test(text)) throw new Error('Para un mensaje privado escribe: /w nombre mensaje');
  const msg = { user: user.username, buddy: user.buddy, admin: user.isAdmin, ...hub.looks(user), text, at: Date.now() };
  db.data.chat.push(msg);
  if (db.data.chat.length > 100) db.data.chat.splice(0, db.data.chat.length - 100);
  db.save();
  io.emit('chat', msg);
  return {};
}

// Mensajes privados: solo los ven emisor y destinatario. Se guardan los últimos 400 en total.
function privateMessage(user, toName, text) {
  const t = db.userByName(toName);
  if (!t) throw new Error(`No existe el entrenador «${toName}».`);
  if (t.id === user.id) throw new Error('No puedes escribirte a ti mismo.');
  if (t.npc) throw new Error('Los comerciantes NPC no leen mensajes privados.');
  const msg = { user: user.username, to: t.username, buddy: user.buddy, admin: user.isAdmin, ...hub.looks(user), text, at: Date.now(), private: true };
  db.data.dms ||= [];
  db.data.dms.push(msg);
  if (db.data.dms.length > 400) db.data.dms.splice(0, db.data.dms.length - 400);
  db.save();
  io.to('u:' + user.id).to('u:' + t.id).emit('chat', msg);
  return {};
}
const myDms = (user) => (db.data.dms || []).filter((m) => m.user === user.username || m.to === user.username).slice(-30);

// ---- Administración ----
const ADMIN_GRANT_MAX = 10000;
const ADMIN_GRANT_DAY = 50000;
function requireAdmin(user) { if (!user.isAdmin) throw new Error('Solo administradores.'); }
// Registro de lo que hacen los anfitriones (últimas 200 acciones).
function adminLog(user, action, target, detail) {
  db.data.adminLog ||= [];
  db.data.adminLog.push({ at: Date.now(), by: user.username, action, target: target || null, detail: detail || null });
  if (db.data.adminLog.length > 200) db.data.adminLog.splice(0, db.data.adminLog.length - 200);
}
// Foto de la economía: monedas en circulación, de dónde salen y a dónde van, y actividad por día.
function economy() {
  // Los comerciantes NPC no cuentan como jugadores: su tesorería va aparte.
  const users = Object.values(db.data.users).filter((u) => !u.npc);
  const wallets = users.reduce((s, u) => s + u.coins, 0);
  const escrow = Object.values(db.data.escrow).reduce((s, e) => s + e.amount, 0);
  const listed = users.reduce((s, u) => s + market.lockedIn(u), 0);
  const days = Object.entries((db.data.econ || { days: {} }).days).sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, d]) => ({ date, src: d.src, sink: d.sink, bet: d.bet, paid: d.paid, rounds: d.rounds, active: d.active.length }));
  const week = Date.now() - 7 * 864e5;
  const rich = [...users].sort((a, b) => b.coins - a.coins);
  return {
    total: wallets + escrow + listed + (db.data.mega ? db.data.mega.bote || 0 : 0), wallets, escrow, market: listed, bote: db.data.mega ? db.data.mega.bote || 0 : 0,
    players: users.length, active7: users.filter((u) => (u.lastSeen || u.createdAt) > week).length,
    top10share: wallets ? rich.slice(0, Math.max(1, Math.ceil(users.length / 10))).reduce((s, u) => s + u.coins, 0) / wallets : 0,
    median: rich.length ? rich[Math.floor(rich.length / 2)].coins : 0,
    npc: npc.treasury(), suspicious: require('./suspicious').flagged(),
    days, names: hub.GAME_LABELS, log: (db.data.adminLog || []).slice(-60).reverse(),
  };
}
const admin = {
  economy(user) {
    requireAdmin(user);
    return { economy: economy() };
  },
  users(user) {
    requireAdmin(user);
    return {
      users: Object.values(db.data.users).filter((u) => !u.npc).map((u) => ({
        username: u.username, coins: u.coins, dust: u.dust, level: u.level, banned: u.banned, isAdmin: u.isAdmin,
        dex: Object.keys(u.collection).length, createdAt: u.createdAt, online: online.has(u.id),
      })),
      invites: Object.entries(db.data.invites).map(([code, i]) => ({ code, ...i })),
      accessKey: config.ACCESS_KEY,
      jackpot: db.data.state.jackpot,
    };
  },
  async backups(user) {
    requireAdmin(user);
    return { backups: await backup.list(), last: db.data.state.lastBackup || 0, ...backup.status() };
  },
  async backupNow(user) {
    requireAdmin(user);
    await backup.backupNow(`manual (${user.username})`);
    adminLog(user, 'backup', null, 'copia manual');
    return { backups: await backup.list() };
  },
  invite(user) {
    requireAdmin(user);
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    db.data.invites[code] = { createdBy: user.username, createdAt: Date.now(), usedBy: null };
    adminLog(user, 'invite', null, code);
    db.save();
    return { code };
  },
  coins(user, { username, delta }) {
    requireAdmin(user);
    const t = db.userByName(username);
    delta = Number(delta);
    if (!t || !Number.isInteger(delta) || Math.abs(delta) > 1e9) throw new Error('Datos no válidos (máximo ±1.000.000.000).');
    // Topes contra abusos: como mucho +10.000 por ajuste y +50.000 al día por anfitrión (quitar no tiene tope).
    if (delta > ADMIN_GRANT_MAX) throw new Error(`Como mucho ${ADMIN_GRANT_MAX.toLocaleString('es')} monedas por ajuste.`);
    if (delta > 0) {
      const day = new Date().toISOString().slice(0, 10);
      const rec = ((db.data.adminDaily ||= {})[user.id] ||= { day, given: 0 });
      if (rec.day !== day) { rec.day = day; rec.given = 0; }
      if (rec.given + delta > ADMIN_GRANT_DAY) throw new Error(`Límite diario de anfitrión: te quedan ${(ADMIN_GRANT_DAY - rec.given).toLocaleString('es')} monedas por dar hoy.`);
      rec.given += delta;
      // Darse monedas a uno mismo se anuncia a todos.
      if (t.id === user.id) hub.feed('admin', `🛠️ ${user.username} (anfitrión) se ha dado ${delta.toLocaleString('es')} monedas`);
    }
    const before = t.coins;
    t.coins = Math.min(1e12, Math.max(0, t.coins + delta));
    hub.ledger(t, t.coins - before, 'admin', user.username);
    adminLog(user, 'coins', t.username, `${delta > 0 ? '+' : ''}${delta.toLocaleString('es')} monedas`);
    db.save();
    hub.pushMe(t);
    return {};
  },
  ban(user, { username, banned }) {
    requireAdmin(user);
    const t = db.userByName(username);
    if (!t || t.npc || t.id === user.id) throw new Error('Jugador no válido.');
    t.banned = !!banned;
    adminLog(user, banned ? 'ban' : 'unban', t.username);
    if (t.banned) {
      for (const [k, s] of Object.entries(db.data.sessions)) if (s.userId === t.id) delete db.data.sessions[k];
      io.in('u:' + t.id).disconnectSockets(true);
    }
    db.save();
    return {};
  },
  reset(user, { username, password }) {
    requireAdmin(user);
    const t = db.userByName(username);
    if (!t || t.npc || typeof password !== 'string' || password.length < 6) throw new Error('Datos no válidos.');
    Object.assign(t, auth.hashPassword(password));
    adminLog(user, 'reset', t.username);
    for (const [k, s] of Object.entries(db.data.sessions)) if (s.userId === t.id) delete db.data.sessions[k];
    io.in('u:' + t.id).disconnectSockets(true);
    db.save();
    return {};
  },
  event(user, { id, hours }) {
    requireAdmin(user);
    events.force(id, hours);
    adminLog(user, 'event', events.EVENTS[id].name, Number(hours) ? `${hours} h` : 'cancelado');
    checkEvents();
    return {};
  },
  mega(user, p) {
    requireAdmin(user);
    mega.admin(p.op, p);
    adminLog(user, 'mega', p.op, p.username ? `${p.username} ${p.frags} 💠` : p.days ? `${p.days} días` : null);
    return { mega: mega.publicState() };
  },
  admin(user, { username, isAdmin }) {
    requireAdmin(user);
    const t = db.userByName(username);
    if (!t || t.npc || t.id === user.id) throw new Error('Jugador no válido.');
    t.isAdmin = !!isAdmin;
    adminLog(user, isAdmin ? 'admin' : 'unadmin', t.username);
    db.save();
    hub.pushMe(t);
    return {};
  },
};

// ---- Eventos: se avisa a todos cuando empieza o termina alguno ----
let eventsSig = null;
function checkEvents() {
  const st = events.publicState();
  const sig = st.active.map((e) => `${e.id}:${e.ends}`).join(',');
  if (sig === eventsSig) return;
  const before = new Set((eventsSig || '').split(',').filter(Boolean).map((x) => x.split(':')[0]));
  const first = eventsSig === null;
  eventsSig = sig;
  io.emit('events', st);
  if (first) return;
  for (const e of st.active) if (!before.has(e.id)) hub.feed('event', `¡Empieza ${e.icon} ${e.name}! ${e.desc}`);
}
setInterval(checkEvents, 60 * 1000).unref();

// ---- Sockets ----
function clientIp(socket) {
  if (config.TRUST_PROXY) {
    const xff = socket.handshake.headers['x-forwarded-for'];
    if (xff) return xff.split(',')[0].trim();
  }
  return socket.handshake.address;
}

io.use((socket, next) => {
  if (!ready) return next(new Error('starting'));
  if (!net.isAllowed(clientIp(socket))) return next(new Error('red'));
  const user = auth.userFromToken(socket.handshake.auth && socket.handshake.auth.token);
  if (!user) return next(new Error('auth'));
  socket.data.userId = user.id;
  next();
});

io.on('connection', (socket) => {
  const uid = socket.data.userId;
  socket.join('u:' + uid);
  online.set(uid, (online.get(uid) || 0) + 1);
  const meNow = db.userById(uid);
  if (meNow) { meNow.lastSeen = Date.now(); hub.econActive(meNow); }
  pushOnline();

  // Limitador de eventos por socket.
  let tokens = 25;
  const refill = setInterval(() => { tokens = Math.min(25, tokens + 12); }, 1000);

  function on(name, fn, { push = true } = {}) {
    socket.on(name, (payload, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      if (--tokens < 0) return ack({ ok: false, error: 'Demasiadas acciones, respira un momento.' });
      if (!ready) return ack({ ok: false, error: BUSY });
      const user = db.userById(uid);
      if (!user || user.banned) return ack({ ok: false, error: 'Sesión no válida.' });
      const done = (res) => {
        ack({ ok: true, ...(res || {}), me: hub.privateUser(user) });
        if (push) socket.to('u:' + uid).emit('me', hub.privateUser(user));
      };
      const fail = (e) => ack({ ok: false, error: (e && e.message) || 'Error' });
      try {
        const res = fn(user, payload && typeof payload === 'object' ? payload : {});
        // Las acciones asíncronas (copias de seguridad) devuelven una promesa.
        if (res && typeof res.then === 'function') res.then(done, fail);
        else done(res);
      } catch (e) { fail(e); }
    });
  }

  on('hello', (u) => ({
    chat: [...db.data.chat.slice(-50), ...myDms(u)].sort((a, b) => a.at - b.at), feed: db.data.feed.slice(-30), online: onlineList(),
    jackpot: db.data.state.jackpot, race: race.publicState(), raceBets: race.myBets(db.userById(uid)),
    duels: duel.listPublic(), duelHistory: duel.recent(),
    crash: crash.publicState(), poker: holdem.lobby(), events: events.publicState(), mega: mega.publicState(),
    newsSeen: u.newsSeen || null, createdAt: u.createdAt || 0,
  }), { push: false });
  on('news:seen', (u, p) => { const r = news.markSeen(u, p); db.save(); return r; }, { push: false });
  on('daily:claim', claimDaily);
  on('center:heal', heal);
  on('slots:spin', slots.spin);
  on('roulette:spin', roulette.spin);
  on('voltorb:state', (u) => voltorb.view(u), { push: false });
  on('voltorb:start', voltorb.start);
  on('voltorb:flip', voltorb.flip);
  on('voltorb:cashout', voltorb.cashout);
  on('race:bet', race.placeBet);
  on('duel:create', duel.create);
  on('duel:accept', duel.accept);
  on('duel:cancel', duel.cancel);
  on('duel:replay', (u, { id }) => ({ record: duel.getRecord(id) || null }), { push: false });
  on('gacha:pull', gacha.pull);
  on('gacha:banners', () => gacha.bannersInfo(), { push: false });
  on('shop:craft', gacha.craft);
  on('shop:exchange', gacha.exchangeDust);
  on('shop:release', gacha.release);
  on('locked:unlock', locked.unlock);
  on('locked:state', (u) => locked.view(u) || { box: {}, prog: null }, { push: false });
  on('me:history', (u) => ({ history: hub.history(u) }), { push: false });
  on('buddy:set', setBuddy);
  on('buddy:mega', mega.setBuddyMega);
  on('mega:state', (u) => mega.full(u), { push: false });
  on('mega:checkin', mega.checkin);
  on('mega:claim', mega.claim);
  on('mega:craft', mega.craft);
  on('mega:spin', mega.spin);
  on('mega:pick', mega.pickStone);
  on('mega:use', (u, { stone }) => mega.useStone(u, stone));
  on('item:buy', items.buy);
  on('item:use', items.use);
  on('equip', items.equip);
  on('market:state', () => market.state(), { push: false });
  on('market:sell', market.sell);
  on('market:buy', market.buy);
  on('market:cancel', market.cancel);
  on('market:history', market.history, { push: false });
  on('bj:state', (u) => blackjack.view(u), { push: false });
  on('bj:deal', blackjack.deal);
  on('bj:act', blackjack.act);
  on('vp:deal', videopoker.deal);
  on('vp:draw', videopoker.draw);
  on('baccarat:play', baccarat.play);
  on('plinko:drop', plinko.drop);
  on('mines:state', mines.state, { push: false });
  on('mines:start', mines.start);
  on('mines:pick', mines.pick);
  on('mines:cashout', mines.cashout);
  on('quiz:state', quiz.state, { push: false });
  on('quiz:start', quiz.start);
  on('quiz:answer', quiz.answer);
  on('quiz:next', quiz.next);
  on('quiz:cashout', quiz.cashout);
  on('quiz:board', quiz.board, { push: false });
  if (process.env.NODE_ENV === 'test') on('quiz:peek', quiz.peek, { push: false }); // solo para pruebas automáticas
  on('crash:bet', crash.bet);
  on('crash:cashout', crash.cashout);
  on('poker:watch', (u, p) => holdem.watch(socket, p), { push: false });
  on('poker:sit', holdem.sit);
  on('poker:stand', holdem.stand);
  on('poker:sitout', holdem.setSitOut);
  on('poker:rebuy', holdem.rebuy);
  on('poker:action', holdem.action);
  on('gift:coins', giftCoins);
  on('gift:poke', giftPoke);
  on('chat:send', chat, { push: false });
  on('leaderboard', leaderboard, { push: false });
  on('player:view', viewPlayer, { push: false });
  for (const [k, fn] of Object.entries(admin)) on('admin:' + k, fn);

  socket.on('disconnect', () => {
    clearInterval(refill);
    const n = (online.get(uid) || 1) - 1;
    if (n <= 0) online.delete(uid); else online.set(uid, n);
    pushOnline();
  });
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  // Si aún no había cargado los datos no tiene nada que guardar (ni debe pisar los de otra instancia).
  if (!ready) process.exit(0);
  ready = false;
  race.refundAll();
  duel.refundAll();
  crash.refundAll();
  holdem.refundAll();
  await db.flushAll().catch((e) => console.error(e));
  await db.release();
  console.log('  💾 Datos guardados y liberados.');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Se escucha enseguida (Render comprueba /healthz) pero el juego se abre al cargar los datos.
server.listen(config.PORT, config.HOST, onListen);
db.init().then(() => {
  if (stopping) return;
  // Lo que quedó en juego si la versión anterior se apagó de golpe vuelve a sus dueños.
  market.init();
  npc.start();
  const back = db.refundEscrow();
  if (back.n) console.log(`  ↩️  Devueltas ${back.total} monedas en juego a ${back.n} apuesta(s)/mesa(s) pendientes`);
  ready = true;
  checkEvents();
  race.start();
  crash.start();
  mega.start();
  console.log('  ✅ Casino abierto');
  if (!Object.keys(db.data.users).length) console.log('  👑 El primer jugador que se registre será administrador.');
}).catch((e) => { console.error('No se pudo arrancar:', e); process.exit(1); });

function onListen() {
  console.log(`\n  🎰 PokéCasino escuchando en http://${config.HOST}:${config.PORT}`);
  console.log(`  🔒 Modo de red: ${config.NETWORK_MODE}${config.ALLOW_CIDRS.length ? ' + ' + config.ALLOW_CIDRS.join(', ') : ''}`);
  console.log(config.OPEN_REGISTRATION ? '  🔓 Registro abierto (sin código de invitación)' : `  🔑 Código de invitación maestro: ${config.ACCESS_KEY}`);
  console.log('');
}
