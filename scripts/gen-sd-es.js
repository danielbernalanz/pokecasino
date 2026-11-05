'use strict';
// Genera server/sd-es.json: nombres en español (España) de movimientos, habilidades y objetos del simulador de
// Pokémon Showdown, más una ficha compacta de cada movimiento (tipo, categoría, potencia, precisión, PP).
// Los nombres salen de los CSV de PokeAPI (local_language_id 7 = español, 9 = inglés). Se ejecuta a mano:
//   node scripts/gen-sd-es.js [carpeta-con-los-csv]
// El resultado se sube al repositorio: el servidor no descarga nada al arrancar.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Dex, toID } = require('pokemon-showdown');

const BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/';
const FILES = ['move_names', 'moves', 'ability_names', 'abilities', 'item_names', 'items'];
const dir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'pokeapi-csv-'));
for (const f of FILES) {
  const p = path.join(dir, f + '.csv');
  if (!fs.existsSync(p)) execFileSync('curl', ['-sSf', '-o', p, BASE + f + '.csv']);
}

function csv(name) {
  const text = fs.readFileSync(path.join(dir, name + '.csv'), 'utf8').replace(/\r/g, '').trim().split('\n');
  const head = text.shift().split(',');
  return text.map((line) => {
    // Los nombres pueden llevar comas entre comillas.
    const cells = [];
    let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { cells.push(cur); cur = ''; } else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(head.map((k, i) => [k, cells[i]]));
  });
}

// id de PokeAPI → { es, en } y su identificador (vise-grip → visegrip).
function names(namesFile, baseFile, idKey) {
  const ident = new Map(csv(baseFile).map((r) => [r.id, r.identifier]));
  const out = new Map();
  for (const r of csv(namesFile)) {
    const o = out.get(r[idKey]) || {};
    if (r.local_language_id === '7') o.es = r.name;
    if (r.local_language_id === '9') o.en = r.name;
    out.set(r[idKey], o);
  }
  const byId = {};
  for (const [id, o] of out) {
    if (!o.es) continue;
    if (o.en) byId[toID(o.en)] ??= o.es;
    if (ident.get(id)) byId[toID(ident.get(id))] ??= o.es;
  }
  return byId;
}
const moveEs = names('move_names', 'moves', 'move_id');
const abilityEs = names('ability_names', 'abilities', 'ability_id');
const itemEs = names('item_names', 'items', 'item_id');

const out = { moves: {}, abilities: {}, items: {}, meta: {} };
const missing = { moves: [], abilities: [] };
for (const m of Dex.moves.all()) {
  if (m.isNonstandard && m.isNonstandard !== 'Past' && m.isNonstandard !== 'Unobtainable') continue;
  if (m.isZ || m.isMax) continue;
  out.moves[m.id] = moveEs[m.id] || m.name;
  if (!moveEs[m.id]) missing.moves.push(m.name);
  out.meta[m.id] = [m.type.toLowerCase(), m.category === 'Physical' ? 'p' : m.category === 'Special' ? 's' : 'x', m.basePower || 0, m.accuracy === true ? 0 : m.accuracy, m.pp];
}
for (const a of Dex.abilities.all()) {
  if (a.isNonstandard && a.isNonstandard !== 'Past') continue;
  out.abilities[a.id] = abilityEs[a.id] || a.name;
  if (!abilityEs[a.id]) missing.abilities.push(a.name);
}
// Megapiedras: nombre español de nuestros datos (siempre al día con el resto del casino).
for (const f of require('../server/megadata.json')) out.items[toID(f.stone.replace(/^stone-/, ''))] = f.stoneName;
// Objetos de la Tienda de Combate (server/bp.js) y bayas del Huerto que se pueden llevar en combate.
const itemsWanted = ['leftovers', 'lifeorb', 'choicescarf', 'choiceband', 'choicespecs', 'sitrusberry', 'focussash', 'assaultvest', 'rockyhelmet', 'blacksludge', 'whiteherb', 'mentalherb',
  'weaknesspolicy', 'expertbelt', 'scopelens', 'eviolite', 'heavydutyboots', 'oranberry', 'lumberry', 'chestoberry', 'leppaberry'];
for (const id of itemsWanted) if (itemEs[id]) out.items[id] = itemEs[id];

fs.writeFileSync(path.join(__dirname, '..', 'server', 'sd-es.json'), JSON.stringify(out));
console.log(`movimientos ${Object.keys(out.moves).length} (sin traducir ${missing.moves.length}), habilidades ${Object.keys(out.abilities).length} (sin traducir ${missing.abilities.length}), objetos ${Object.keys(out.items).length}`);
if (missing.moves.length) console.log('Sin traducir (movimientos):', missing.moves.slice(0, 40).join(', '));
if (missing.abilities.length) console.log('Sin traducir (habilidades):', missing.abilities.slice(0, 40).join(', '));
