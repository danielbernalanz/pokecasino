'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { extractIp } = require('../server/clientip');

test('sin proxy de confianza se usa la dirección de la conexión', () => {
  assert.strictEqual(extractIp('6.6.6.6', '10.0.0.1', 0), '10.0.0.1');
});
test('un salto: se toma la última entrada y se ignoran las falsificadas a la izquierda', () => {
  assert.strictEqual(extractIp('6.6.6.6, 7.7.7.7, 203.0.113.9', '10.0.0.1', 1), '203.0.113.9');
  assert.strictEqual(extractIp('203.0.113.9', '10.0.0.1', 1), '203.0.113.9');
});
test('dos saltos (p. ej. Cloudflare + Render): se salta la entrada del último proxy', () => {
  assert.strictEqual(extractIp('6.6.6.6, 203.0.113.9, 172.70.0.1', '10.0.0.1', 2), '203.0.113.9');
});
test('cabecera ausente, vacía o con menos entradas que saltos', () => {
  assert.strictEqual(extractIp(undefined, '10.0.0.1', 1), '10.0.0.1');
  assert.strictEqual(extractIp('  , ', '10.0.0.1', 1), '10.0.0.1');
  assert.strictEqual(extractIp('1.2.3.4', '10.0.0.1', 3), '1.2.3.4');
});
test('cabecera repetida (array) se trata como una sola lista', () => {
  assert.strictEqual(extractIp(['6.6.6.6', '203.0.113.9'], '10.0.0.1', 1), '203.0.113.9');
});
