'use strict';
// Añade a cada fila de server/dexdata.json el «slug» de Pokémon Showdown (décimo campo), que sirve para
// pedir los sprites animados. Se saca del identificador de PokeAPI (pokemon_species.csv).
// Uso: node scripts/add-slugs.js <pokemon_species.csv>
const fs = require('fs');
const path = require('path');

// Los únicos que conservan el guion en los archivos de Showdown.
const KEEP_HYPHEN = new Set(['ho-oh', 'porygon-z', 'jangmo-o', 'hakamo-o', 'kommo-o', 'wo-chien', 'chien-pao', 'ting-lu', 'chi-yu']);
const slugOf = (ident) => (KEEP_HYPHEN.has(ident) ? ident : ident.replace(/[^a-z0-9]/g, ''));

const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
const ident = new Map(rows.map((r) => [Number(r[0]), r[1]]));
const file = path.join(__dirname, '..', 'server', 'dexdata.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const r of data) r[9] = slugOf(ident.get(r[0]));
fs.writeFileSync(file, '[\n' + data.map((r) => JSON.stringify(r)).join(',\n') + '\n]\n');
console.log(data.length, 'filas con slug');
