'use strict';
// Un error de sintaxis en cualquier módulo del cliente deja la web en blanco (la app no llega a arrancar):
// se comprueba cada archivo de public/js como módulo ES, sin navegador.
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', 'public');
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? files(p) : d.name.endsWith('.js') ? [p] : [];
  });
}

test('todos los módulos del cliente (public/**/*.js) tienen sintaxis válida', () => {
  const list = files(ROOT);
  assert.ok(list.length > 20, 'se encontraron los archivos del cliente');
  const bad = [];
  for (const f of list) {
    try {
      execFileSync(process.execPath, ['--experimental-default-type=module', '--check', f], { stdio: 'pipe' });
    } catch (e) {
      bad.push(`${path.relative(ROOT, f)}: ${String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 4).join(' | ')}`);
    }
  }
  assert.deepStrictEqual(bad, [], 'errores de sintaxis en el cliente');
});
