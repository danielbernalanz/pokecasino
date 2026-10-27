'use strict';
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const hub = require('./hub');
const net = require('./netguard');
const dex = require('./pokedex');
const gacha = require('./gacha');
const slots = require('./games/slots');
const roulette = require('./games/roulette');
const voltorb = require('./games/voltorb');
const race = require('./games/race');
const duel = require('./games/duel');
const { MOVES } = require('./games/battle');
const items = require('./items');
const market = require('./market');
const blackjack = require('./games/blackjack');
const videopoker = require('./games/videopoker');
const baccarat = require('./games/baccarat');
const plinko = require('./games/plinko');
const mines = require('./games/mines');
const crash = require('./games/crash');
const holdem = require('./games/holdem');

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
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  next();
});
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

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
  softPity: gacha.SOFT_PITY, hardPity: gacha.HARD_PITY, dustRate: gacha.DUST_RATE,
  slots: { symbols: slots.SYMBOLS, lines: slots.LINES, reels: slots.REELS },
  roulette: { wheel: roulette.WHEEL, groups: roulette.GROUPS, payout: roulette.PAYOUT },
  openRegistration: config.OPEN_REGISTRATION,
  racePool: race.POOL, voltorbDivisors: voltorb.DIVISORS,
  items: items.ITEMS, marketFee: market.SETUP_FEE, salesTax: market.SALES_TAX, vpPaytable: videopoker.PAYTABLE, baccaratPayout: baccarat.PAYOUT,
  plinko: { tables: plinko.TABLES, rows: plinko.ROWS }, crashGrowth: crash.GROWTH, pokerTables: holdem.TABLES, minBet: config.MIN_BET, maxBet: config.MAX_BET, maxBetByBadges: hub.MAX_BET_BY_BADGES,
  cosmetics: items.COSMETICS,
};
app.get('/api/static', (req, res) => res.json(STATIC));

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 20000 });
hub.setIO(io);

// ---- Presencia ----
const online = new Map(); // userId -> nº de sockets
function onlineList() {
  return [...online.keys()].map((id) => db.userById(id)).filter(Boolean).map(hub.publicUser);
}
const pushOnline = () => io.emit('online', onlineList());

function today() { return new Date().toISOString().slice(0, 10); }
function yesterday() { return new Date(Date.now() - 864e5).toISOString().slice(0, 10); }

function claimDaily(user) {
  if (user.daily.last === today()) throw new Error('Ya reclamaste tu recompensa de hoy. ¡Vuelve mañana!');
  user.daily.streak = user.daily.last === yesterday() ? user.daily.streak + 1 : 1;
  user.daily.last = today();
  const reward = 1000 + 250 * (Math.min(user.daily.streak, 7) - 1);
  user.coins += reward;
  user.items.ticket = (user.items.ticket || 0) + 1;
  const charm = user.daily.streak % 7 === 0;
  if (charm) user.items['shiny-charm'] = (user.items['shiny-charm'] || 0) + 1;
  hub.track(user, 'daily');
  db.save();
  return { reward, streak: user.daily.streak, charm };
}

const HEAL_COOLDOWN = 60 * 60 * 1000;
function heal(user) {
  const locked = market.lockedIn(user) + Object.values(db.data.escrow).filter((e) => e.userId === user.id).reduce((s, e) => s + e.amount, 0);
  if (user.coins + locked >= 200) throw new Error(locked ? 'La enfermera Joy ve que tienes monedas en el Mercado o en juego.' : 'La enfermera Joy dice que aún te quedan monedas.');
  const wait = user.lastHeal + HEAL_COOLDOWN - Date.now();
  if (wait > 0) throw new Error(`Vuelve en ${Math.ceil(wait / 60000)} min.`);
  user.lastHeal = Date.now();
  user.coins += 1000;
  db.save();
  return { coins: 1000 };
}

function leaderboard() {
  const users = Object.values(db.data.users).filter((u) => !u.banned);
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
  user.buddy = { id: Number(id), shiny: !!shiny };
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
  if (!Number.isInteger(amount) || amount < 1 || amount > user.coins) throw new Error('Cantidad no válida.');
  user.coins -= amount;
  t.coins += amount;
  db.save();
  hub.emitUser(t.id, 'toast', { kind: 'gift', text: `🎁 ${user.username} te regaló ${amount.toLocaleString('es')} monedas` });
  hub.pushMe(t);
  return {};
}

function giftPoke(user, { to, id, shiny }) {
  canGift(user);
  const t = db.userByName(to);
  if (!t || t.id === user.id) throw new Error('Destinatario no válido.');
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
  const msg = { user: user.username, buddy: user.buddy, admin: user.isAdmin, ...hub.looks(user), text, at: Date.now() };
  db.data.chat.push(msg);
  if (db.data.chat.length > 100) db.data.chat.splice(0, db.data.chat.length - 100);
  db.save();
  io.emit('chat', msg);
  return {};
}

// ---- Administración ----
function requireAdmin(user) { if (!user.isAdmin) throw new Error('Solo administradores.'); }
const admin = {
  users(user) {
    requireAdmin(user);
    return {
      users: Object.values(db.data.users).map((u) => ({
        username: u.username, coins: u.coins, dust: u.dust, level: u.level, banned: u.banned, isAdmin: u.isAdmin,
        dex: Object.keys(u.collection).length, createdAt: u.createdAt, online: online.has(u.id),
      })),
      invites: Object.entries(db.data.invites).map(([code, i]) => ({ code, ...i })),
      accessKey: config.ACCESS_KEY,
      jackpot: db.data.state.jackpot,
    };
  },
  invite(user) {
    requireAdmin(user);
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    db.data.invites[code] = { createdBy: user.username, createdAt: Date.now(), usedBy: null };
    db.save();
    return { code };
  },
  coins(user, { username, delta }) {
    requireAdmin(user);
    const t = db.userByName(username);
    delta = Number(delta);
    if (!t || !Number.isInteger(delta) || Math.abs(delta) > 1e9) throw new Error('Datos no válidos (máximo ±1.000.000.000).');
    t.coins = Math.min(1e12, Math.max(0, t.coins + delta));
    db.save();
    hub.pushMe(t);
    return {};
  },
  ban(user, { username, banned }) {
    requireAdmin(user);
    const t = db.userByName(username);
    if (!t || t.id === user.id) throw new Error('Jugador no válido.');
    t.banned = !!banned;
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
    if (!t || typeof password !== 'string' || password.length < 6) throw new Error('Datos no válidos.');
    Object.assign(t, auth.hashPassword(password));
    for (const [k, s] of Object.entries(db.data.sessions)) if (s.userId === t.id) delete db.data.sessions[k];
    io.in('u:' + t.id).disconnectSockets(true);
    db.save();
    return {};
  },
  admin(user, { username, isAdmin }) {
    requireAdmin(user);
    const t = db.userByName(username);
    if (!t || t.id === user.id) throw new Error('Jugador no válido.');
    t.isAdmin = !!isAdmin;
    db.save();
    hub.pushMe(t);
    return {};
  },
};

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
      try {
        const res = fn(user, payload && typeof payload === 'object' ? payload : {}) || {};
        ack({ ok: true, ...res, me: hub.privateUser(user) });
        if (push) socket.to('u:' + uid).emit('me', hub.privateUser(user));
      } catch (e) {
        ack({ ok: false, error: e.message || 'Error' });
      }
    });
  }

  on('hello', () => ({
    chat: db.data.chat.slice(-50), feed: db.data.feed.slice(-30), online: onlineList(),
    jackpot: db.data.state.jackpot, race: race.publicState(), raceBets: race.myBets(db.userById(uid)),
    duels: duel.listPublic(), duelHistory: duel.recent(),
    crash: crash.publicState(), poker: holdem.lobby(),
  }), { push: false });
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
  on('shop:craft', gacha.craft);
  on('shop:exchange', gacha.exchangeDust);
  on('shop:release', gacha.release);
  on('buddy:set', setBuddy);
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
  const back = db.refundEscrow();
  if (back.n) console.log(`  ↩️  Devueltas ${back.total} monedas en juego a ${back.n} apuesta(s)/mesa(s) pendientes`);
  ready = true;
  race.start();
  crash.start();
  console.log('  ✅ Casino abierto');
  if (!Object.keys(db.data.users).length) console.log('  👑 El primer jugador que se registre será administrador.');
}).catch((e) => { console.error('No se pudo arrancar:', e); process.exit(1); });

function onListen() {
  console.log(`\n  🎰 PokéCasino escuchando en http://${config.HOST}:${config.PORT}`);
  console.log(`  🔒 Modo de red: ${config.NETWORK_MODE}${config.ALLOW_CIDRS.length ? ' + ' + config.ALLOW_CIDRS.join(', ') : ''}`);
  console.log(config.OPEN_REGISTRATION ? '  🔓 Registro abierto (sin código de invitación)' : `  🔑 Código de invitación maestro: ${config.ACCESS_KEY}`);
  console.log('');
}
