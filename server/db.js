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
});

let data = empty();
try {
  data = Object.assign(empty(), JSON.parse(fs.readFileSync(FILE, 'utf8')));
} catch { /* base nueva */ }

const byName = new Map();
for (const u of Object.values(data.users)) byName.set(u.username.toLowerCase(), u);

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
  data.users[u.id] = u;
  byName.set(u.username.toLowerCase(), u);
  save();
}
const userByName = (name) => byName.get(String(name || '').toLowerCase());
const userById = (id) => data.users[id];

module.exports = { data, save, flush, addUser, userByName, userById };
