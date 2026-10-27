'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

// Base de datos aislada para las pruebas.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-test-'));
process.env.NETWORK_MODE = 'private';

const { rand } = require('../server/rng');
const slots = require('../server/games/slots');
const roulette = require('../server/games/roulette');
const voltorb = require('../server/games/voltorb');
const gacha = require('../server/gacha');
const { simulate } = require('../server/games/battle');
const { inCidr, isAllowed } = require('../server/netguard');
const dex = require('../server/pokedex');

test('rand devuelve valores en [0, 1)', () => {
  for (let i = 0; i < 10000; i++) {
    const r = rand();
    assert.ok(r >= 0 && r < 1);
  }
});

test('el RTP de Pika-Slots está entre 90 % y 98 %', () => {
  const rtp = slots.computeRTP();
  assert.ok(rtp > 0.9 && rtp < 0.98, `RTP ${rtp}`);
});

test('tres Master Ball en la línea central dan bote', () => {
  const g = [['berry', 'master', 'poke'], ['great', 'master', 'poke'], ['ultra', 'master', 'pika']];
  const r = slots.evaluate(g);
  assert.ok(r.jackpot);
  assert.ok(r.wins.some((w) => w.sym === 'master'));
});

test('Ditto no sustituye a la Master Ball', () => {
  assert.equal(slots.evaluate([['x', 'master', 'x'], ['y', 'ditto', 'y'], ['z', 'master', 'z']]).wins.length, 0);
});

test('el RTP de cada apuesta de la ruleta es < 100 %', () => {
  const n = roulette.WHEEL.length;
  const bets = [{ kind: 'type', value: 'fire' }, { kind: 'group', value: 'mistico' }, { kind: 'parity', value: 'par' }, { kind: 'parity', value: 'impar' }];
  for (const b of bets) {
    let ret = 0;
    for (let i = 0; i < n; i++) if (roulette.wins(b, i)) ret += roulette.PAYOUT[b.kind];
    assert.ok(ret / n < 1, `${b.kind}:${b.value} → ${ret / n}`);
  }
});

test('las pistas de Voltorb Flip cuadran con el tablero', () => {
  for (let level = 1; level <= 8; level++) {
    const board = voltorb.makeBoard(level);
    assert.equal(board.length, 25);
    const hs = voltorb.hints(board);
    const total = hs.rows.reduce((s, r) => s + r.sum, 0);
    assert.equal(total, board.reduce((a, b) => a + b, 0));
    assert.equal(hs.cols.reduce((s, c) => s + c.volt, 0), board.filter((v) => v === 0).length);
  }
});

test('el pity duro garantiza legendaria en 80 tiradas', () => {
  const banner = gacha.BANNERS[0];
  for (let run = 0; run < 50; run++) {
    const p = { sinceL: 0, sinceR: 0, guaranteed: false };
    let got = false;
    for (let i = 0; i < gacha.HARD_PITY; i++) {
      const r = gacha.rollRarity(p, banner);
      if (r === 'L' || r === 'M') { got = true; break; }
    }
    assert.ok(got);
  }
});

test('cada 10 tiradas hay al menos una rara', () => {
  const banner = gacha.BANNERS[0];
  const p = { sinceL: 0, sinceR: 0, guaranteed: false };
  let since = 0;
  for (let i = 0; i < 5000; i++) {
    const r = gacha.rollRarity(p, banner);
    since = ['R', 'E', 'L', 'M'].includes(r) ? 0 : since + 1;
    assert.ok(since < 10);
  }
});

test('las copias por encima de 5 se convierten en polvo', () => {
  const user = { collection: {}, dust: 0 };
  for (let i = 0; i < 7; i++) gacha.grant(user, 25, false);
  assert.equal(user.collection[25].n, 5);
  assert.equal(user.dust, dex.RARITY.U.dust * 2);
});

test('la tabla de tipos se aplica en combate', () => {
  // Un Pokémon de agua debería ganar casi siempre a uno de fuego de la misma rareza.
  let wins = 0;
  for (let i = 0; i < 200; i++) {
    const r = simulate({ id: 7, shiny: false, stars: 1, owner: 'a' }, { id: 4, shiny: false, stars: 1, owner: 'b' });
    if (r.winner === 0) wins++;
  }
  assert.ok(wins > 150, `Squirtle ganó ${wins}/200`);
});

test('filtro de red: privadas sí, públicas no', () => {
  assert.ok(inCidr('192.168.1.20', '192.168.0.0/16'));
  assert.ok(!inCidr('8.8.8.8', '10.0.0.0/8'));
  assert.ok(isAllowed('127.0.0.1'));
  assert.ok(isAllowed('::ffff:192.168.1.5'));
  assert.ok(isAllowed('100.101.102.103'));
  assert.ok(isAllowed('::1'));
  assert.ok(!isAllowed('8.8.8.8'));
  assert.ok(!isAllowed('2001:4860:4860::8888'));
});
