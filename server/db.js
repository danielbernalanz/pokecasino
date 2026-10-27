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

let data = empty();
try {
  data = Object.assign(empty(), JSON.parse(fs.readFileSync(FILE, 'utf8')));
} catch { /* base nueva */ }

data.market = Object.assign({ listings: [], sales: [], nextId: 1 }, data.market);
const byName = new Map();
for (const u of Object.values(data.users)) { migrateUser(u); byName.set(u.username.toLowerCase(), u); }

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
}

function addUser(u) {
  migrateUser(u);
  data.users[u.id] = u;
  byName.set(u.username.toLowerCase(), u);
  save();
}
const userByName = (name) => byName.get(String(name || '').toLowerCase());
const userById = (id) => data.users[id];

module.exports = { data, save, flush, addUser, userByName, userById };
