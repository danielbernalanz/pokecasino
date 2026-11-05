'use strict';
// La carga de la base no puede perder a todos los jugadores por culpa de una cuenta rara.
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const test = require('node:test');
const assert = require('node:assert');

const dbFile = path.join(__dirname, '..', 'server', 'db.js');
const names = (dir) => JSON.parse(execFileSync(process.execPath, ['-e', `const db = require(${JSON.stringify(dbFile)}); console.log(JSON.stringify(Object.values(db.data.users).map((u) => u.username)));`], { env: { ...process.env, DATA_DIR: dir, DATABASE_URL: '' }, encoding: 'utf8' }).trim().split('\n').pop());
const user = (id, username) => ({ id, username, coins: 5, dust: 0, items: {}, games: {}, collection: {}, stats: {}, progress: {} });

test('una cuenta sin nombre de texto se descarta y las demás se conservan', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-dbload-'));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: { a: user('a', 'Buena'), b: user('b', ['rota']), c: user('c', 'Otra') } }));
  assert.deepStrictEqual(names(dir).sort(), ['Buena', 'Otra']);
});

test('un db.json ilegible se aparta en una copia antes de empezar de cero', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-dbload-'));
  fs.writeFileSync(path.join(dir, 'db.json'), '{ esto no es json');
  assert.deepStrictEqual(names(dir), []);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('db.json.corrupta-')), 'queda la copia del archivo dañado');
});

test('sin db.json es una primera ejecución: base nueva y sin copias', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-dbload-'));
  assert.deepStrictEqual(names(dir), []);
  assert.ok(!fs.readdirSync(dir).some((f) => f.includes('corrupta')));
});
