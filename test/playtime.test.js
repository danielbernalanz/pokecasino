'use strict';
const test = require('node:test');
const assert = require('node:assert');
const pt = require('../server/playtime');

test('tiempo de juego: suma entre latidos con tope y sin latidos seguidos', () => {
  const u = {};
  const t0 = 1_000_000;
  pt.beat(u, t0);
  assert.strictEqual(u.playMs, 0);
  pt.beat(u, t0 + 60e3);
  assert.strictEqual(u.playMs, 60e3);
  pt.beat(u, t0 + 61e3); // latido demasiado seguido: no suma
  assert.strictEqual(u.playMs, 60e3);
  pt.beat(u, t0 + 61e3 + 3 * 3600e3); // pestaña cerrada horas: como mucho 75 s
  assert.strictEqual(u.playMs, 60e3 + pt.MAX_STEP);
});

test('tiempo de juego: público por defecto y se puede hacer privado', () => {
  const u = {};
  assert.ok(pt.isPublic(u));
  pt.privacy(u, { public: false });
  assert.ok(!pt.isPublic(u));
  pt.privacy(u, { public: true });
  assert.ok(pt.isPublic(u));
});
