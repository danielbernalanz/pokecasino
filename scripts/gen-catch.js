'use strict';
// Genera server/catchdata.json: ratio de captura y amistad base de cada especie, sacados del CSV pokemon_species de PokeAPI
// (columnas capture_rate y base_happiness). pokemon-showdown no trae ninguno de los dos. Se ejecuta a mano y el resultado se sube:
//   node scripts/gen-catch.js [carpeta-con-los-csv]
// Formato: { "sp": { "<id>": [capture_rate, base_happiness] } } para los 1.025 Pokémon del Pokédex del casino.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/';
const dir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'pokeapi-csv-'));
const file = path.join(dir, 'pokemon_species.csv');
if (!fs.existsSync(file)) execFileSync('curl', ['-sSf', '-o', file, BASE + 'pokemon_species.csv']);

const lines = fs.readFileSync(file, 'utf8').replace(/\r/g, '').split('\n').filter(Boolean);
const head = lines.shift().split(',');
const col = (n) => head.indexOf(n);
const [iId, iRate, iHappy] = [col('id'), col('capture_rate'), col('base_happiness')];
const { DEX } = require('../server/pokedex');
const have = new Set(DEX.map((p) => p.id));
const sp = {};
for (const l of lines) {
  const c = l.split(',');
  const id = Number(c[iId]);
  if (!have.has(id)) continue;
  sp[id] = [Number(c[iRate]), Number(c[iHappy])];
}
const missing = DEX.filter((p) => !sp[p.id]);
if (missing.length) throw new Error('Faltan especies: ' + missing.map((p) => p.id).join(','));
fs.writeFileSync(path.join(__dirname, '..', 'server', 'catchdata.json'), JSON.stringify({ sp }));
console.log(`catchdata.json: ${Object.keys(sp).length} especies.`);
