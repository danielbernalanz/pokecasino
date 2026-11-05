'use strict';
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { markSeen } = require('../server/news');

const list = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'changelog.json'), 'utf8'));

test('changelog.json es válido, con la más reciente primero y versiones únicas', () => {
  assert.ok(Array.isArray(list) && list.length > 0);
  for (const r of list) {
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!Number.isNaN(Date.parse(r.date)), 'fecha válida');
    assert.ok(typeof r.version === 'string' && r.version.length > 0 && r.version.length <= 40, 'versión ≤ 40');
    assert.ok(typeof r.title === 'string' && r.title.trim());
    assert.ok(Array.isArray(r.items) && r.items.length > 0 && r.items.every((t) => typeof t === 'string' && t.trim()));
  }
  assert.strictEqual(new Set(list.map((r) => r.version)).size, list.length, 'versiones únicas');
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].date >= list[i].date, 'orden: más reciente primero');
});

test('news:seen valida la versión (texto, no vacío, ≤ 40)', () => {
  const u = {};
  markSeen(u, { version: '2026.10.28-c' });
  assert.strictEqual(u.newsSeen, '2026.10.28-c');
  for (const bad of [undefined, null, 5, {}, [], '', '   ', 'x'.repeat(41)]) {
    assert.throws(() => markSeen(u, { version: bad }), /no válida/);
  }
  assert.throws(() => markSeen(u, null), /no válida/);
  assert.strictEqual(u.newsSeen, '2026.10.28-c');
  markSeen(u, { version: 'x'.repeat(40) });
});
