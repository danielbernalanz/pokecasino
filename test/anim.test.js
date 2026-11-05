'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { DEX } = require('../server/pokedex');

const load = () => import('../public/js/slug.js');

test('showdownSlug: nombres difíciles', async () => {
  const { showdownSlug: s } = await load();
  const cases = {
    'Mr. Mime': 'mrmime', 'Mr. Rime': 'mrrime', 'Mime Jr.': 'mimejr', 'Nidoran♀': 'nidoranf', 'Nidoran♂': 'nidoranm',
    'Farfetch’d': 'farfetchd', "Farfetch'd": 'farfetchd', 'Type: Null': 'typenull', 'Ho-Oh': 'ho-oh', 'Porygon-Z': 'porygon-z',
    'Porygon2': 'porygon2', 'Flabébé': 'flabebe', 'Tapu Koko': 'tapukoko', 'Jangmo-o': 'jangmo-o', 'Wo-Chien': 'wo-chien',
    'Mega-Venusaur': 'venusaur-mega', 'Mega-Charizard X': 'charizard-megax', 'Mega-Charizard Y': 'charizard-megay',
    'Mega-Mr. Mime': 'mrmime-mega', Pikachu: 'pikachu',
  };
  for (const [name, slug] of Object.entries(cases)) assert.strictEqual(s(name), slug, name);
});

test('el Pokédex trae el slug de Showdown de los 1.025', () => {
  assert.strictEqual(DEX.length, 1025);
  for (const p of DEX) assert.match(p.slug, /^[a-z0-9]+(-[a-z0-9]+)?$/, `#${p.id} ${p.name}`);
  const by = (n) => DEX.find((p) => p.name === n).slug;
  assert.strictEqual(by('Mr. Mime'), 'mrmime');
  assert.strictEqual(by('Nidoran♀'), 'nidoranf');
  assert.strictEqual(by('Ho-Oh'), 'ho-oh');
  assert.strictEqual(DEX[771].slug, 'typenull'); // «Código Cero» en español
  assert.strictEqual(DEX[1005].slug, 'ironvaliant');
});
