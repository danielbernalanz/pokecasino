'use strict';
// Genera server/expdata.json: grupo de experiencia y EXP base de cada especie, y la tabla de EXP por nivel de cada grupo,
// a partir de los CSV públicos de PokeAPI (pokemon_species, pokemon, experience).
// Uso: node scripts/build-exp.js <carpeta-csv>
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
if (!dir) { console.error('Uso: node scripts/build-exp.js <carpeta-csv>'); process.exit(1); }
const csv = (n) => fs.readFileSync(path.join(dir, n + '.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.replace(/\r$/, '').split(','));
const { DEX } = require('../server/pokedex');
const growth = new Map(csv('pokemon_species').map((r) => [Number(r[0]), Number(r[14])]));
const base = new Map(csv('pokemon').filter((r) => r[7] === '1').map((r) => [Number(r[2]), Number(r[5])]));
const table = {};
for (const [g, lv, xp] of csv('experience')) (table[g] ||= [])[Number(lv)] = Number(xp);
for (const g of Object.keys(table)) { table[g] = table[g].slice(1); if (table[g].length !== 100) throw new Error('grupo ' + g); }
// [grupo, exp base] por id de especie.
const sp = {};
for (const p of DEX) { if (!growth.has(p.id) || !base.get(p.id)) throw new Error('falta ' + p.id); sp[p.id] = [growth.get(p.id), base.get(p.id)]; }
fs.writeFileSync(path.join(__dirname, '../server/expdata.json'), JSON.stringify({ table, sp }));
console.log('ok', Object.keys(sp).length, Object.keys(table));
