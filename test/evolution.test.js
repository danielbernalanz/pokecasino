'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-evo-'));

const dex = require('../server/pokedex');
const gacha = require('../server/gacha');

const byName = (n) => dex.DEX.find((p) => p.name === n);
const RANK = { C: 0, U: 1, R: 2, E: 3, L: 4, M: 5 };

test('fase evolutiva: bebé 0, base 1, evoluciones 2 y 3 (contadas desde la forma no bebé)', () => {
  const stage = (n) => byName(n).stage;
  assert.deepStrictEqual(['Bulbasaur', 'Ivysaur', 'Venusaur'].map(stage), [1, 2, 3]);
  assert.deepStrictEqual(['Pichu', 'Pikachu', 'Raichu'].map(stage), [0, 1, 2]);
  assert.deepStrictEqual(['Eevee', 'Vaporeon', 'Espeon'].map(stage), [1, 2, 2]);
  assert.deepStrictEqual(['Magikarp', 'Gyarados'].map(stage), [1, 2]);
  assert.deepStrictEqual(['Munchlax', 'Snorlax'].map(stage), [0, 1]);
  assert.strictEqual(byName('Ditto').stage, 1);
  assert.strictEqual(byName('Mewtwo').stage, 1);
});

test('evolvesFrom y chain: la cadena es la de PokeAPI y apunta a la preevolución directa', () => {
  assert.strictEqual(byName('Ivysaur').evolvesFrom, byName('Bulbasaur').id);
  assert.strictEqual(byName('Venusaur').evolvesFrom, byName('Ivysaur').id);
  assert.strictEqual(byName('Bulbasaur').evolvesFrom, null);
  assert.strictEqual(byName('Vaporeon').evolvesFrom, byName('Eevee').id);
  assert.strictEqual(byName('Venusaur').chain, byName('Bulbasaur').chain);
  assert.notStrictEqual(byName('Venusaur').chain, byName('Charmander').chain);
  assert.strictEqual(byName('Raichu').chain, byName('Pichu').chain);
  for (const p of dex.DEX) {
    assert.ok([0, 1, 2, 3].includes(p.stage), `${p.name}: fase ${p.stage}`);
    if (p.evolvesFrom) assert.ok(dex.BY_ID.get(p.evolvesFrom), `${p.name}: preevolución inexistente`);
    if (p.stage >= 2) assert.ok(p.evolvesFrom, `${p.name}: fase ${p.stage} sin preevolución`);
  }
});

test('la rareza no baja a lo largo de una cadena evolutiva (evolución ≥ preevolución)', () => {
  for (const p of dex.DEX) {
    if (!p.evolvesFrom) continue;
    const from = dex.BY_ID.get(p.evolvesFrom);
    assert.ok(RANK[p.rarity] >= RANK[from.rarity], `${p.name} (${p.rarity}) es más común que su preevolución ${from.name} (${from.rarity})`);
  }
});

test('los pesos por fase: 1 / 1 / 0,25 / 0,06 y los legendarios no se tocan', () => {
  assert.deepStrictEqual(gacha.STAGE_WEIGHT, { 0: 1, 1: 1, 2: 0.25, 3: 0.06 });
  assert.strictEqual(gacha.stageWeight(byName('Venusaur')), 0.06);
  assert.strictEqual(gacha.stageWeight(byName('Ivysaur')), 0.25);
  assert.strictEqual(gacha.stageWeight(byName('Bulbasaur')), 1);
  assert.strictEqual(gacha.stageWeight(byName('Pichu')), 1);
  // Solgaleo es fase 3 de su cadena, pero legendario: peso 1.
  assert.strictEqual(byName('Solgaleo').stage, 3);
  assert.strictEqual(gacha.stageWeight(byName('Solgaleo')), 1);
});

test('frecuencias empíricas del gacha: las fases 2 y 3 salen según su peso dentro de cada rareza', () => {
  const banner = gacha.BANNERS.find((b) => b.id === 'kanto');
  const N = 400000;
  const got = {};
  for (let i = 0; i < N; i++) {
    const r = gacha.rollRarity(banner);
    const p = gacha.rollPokemon(r, banner);
    const k = `${p.rarity}${p.stage}`;
    got[k] = (got[k] || 0) + 1;
  }
  let checked = 0;
  for (const r of ['C', 'U', 'R', 'E']) {
    const list = dex.BY_RARITY[r];
    const W = list.reduce((s, p) => s + gacha.stageWeight(p), 0);
    for (const st of [1, 2, 3]) {
      const wSt = list.filter((p) => p.stage === st).reduce((s, p) => s + gacha.stageWeight(p), 0);
      if (!wSt) continue;
      const expected = N * gacha.RATES[r] * (wSt / W);
      if (expected < 400) continue; // muestra demasiado pequeña
      const tol = 5 * Math.sqrt(expected) + 0.02 * expected;
      assert.ok(Math.abs((got[`${r}${st}`] || 0) - expected) < tol, `${r} fase ${st}: ${got[`${r}${st}`]} vs ${expected.toFixed(0)}`);
      checked++;
    }
  }
  assert.ok(checked >= 8);
  // Y lo importante: dentro de «Épica», una forma final concreta sale ≈16 veces menos que una base concreta.
  const E = dex.BY_RARITY.E;
  const base = E.find((p) => p.stage === 1);
  const final = E.find((p) => p.stage === 3);
  assert.ok(gacha.stageWeight(base) / gacha.stageWeight(final) > 15);
});

test('los destacados del banner conservan su probabilidad (50 %) con los pesos por fase', () => {
  const banner = gacha.BANNERS.find((b) => b.id === 'aves'); // Charizard (fase 3), Dragonite (3), Aerodactyl (1)
  const N = 60000;
  let featured = 0;
  for (let i = 0; i < N; i++) if (banner.featuredE.includes(gacha.rollPokemon('E', banner).id)) featured++;
  // 50 % de destacado + la parte que cae por azar entre las 134 épicas (≈ poco más del 50 %).
  assert.ok(featured / N > 0.5 && featured / N < 0.56, `${featured / N}`);
});
