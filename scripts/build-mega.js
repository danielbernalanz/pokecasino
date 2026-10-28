'use strict';
// Genera server/megadata.json con las megaevoluciones (formas «-mega») y sus megapiedras a partir de los CSV de PokeAPI.
// Uso: node scripts/build-mega.js <carpeta-con-csv>
//   (pokemon, pokemon_species_names, pokemon_stats, pokemon_types, types, items y item_names de
//    https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv)
// Decisiones:
//  - Se excluyen las formas Primigenias (Kyogre/Groudon: no son «-mega»).
//  - Una piedra por forma: de las formas duplicadas (Meowstic ♀, Magearna original, Tatsugiri estirado/lánguido) solo se
//    conserva la principal, porque comparten piedra en PokeAPI.
//  - Mega-Rayquaza no usa piedra en los juegos: aquí usa el «Meteorito» (stone-meteorite).
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) { console.error('Uso: node scripts/build-mega.js <carpeta-csv>'); process.exit(1); }

function csv(name) {
  const text = fs.readFileSync(path.join(dir, name + '.csv'), 'utf8').trim();
  const rows = [];
  for (const line of text.split('\n')) {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur.replace(/\r$/, ''));
    rows.push(out);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const types = Object.fromEntries(csv('types').map((t) => [t.id, t.identifier]));
const speciesName = {};
for (const n of csv('pokemon_species_names')) {
  if (n.local_language_id === '7') speciesName[n.pokemon_species_id] = n.name;
  else if (n.local_language_id === '9' && !speciesName[n.pokemon_species_id]) speciesName[n.pokemon_species_id] = n.name;
}
const typeOf = {};
for (const t of csv('pokemon_types')) (typeOf[t.pokemon_id] ||= [])[Number(t.slot) - 1] = types[t.type_id];
const stats = {};
for (const s of csv('pokemon_stats')) (stats[s.pokemon_id] ||= [])[Number(s.stat_id) - 1] = Number(s.base_stat);
const itemName = {};
for (const n of csv('item_names')) {
  if (n.local_language_id === '7') itemName[n.item_id] = n.name;
  else if (n.local_language_id === '9' && !itemName[n.item_id]) itemName[n.item_id] = n.name;
}
// Megapiedras: categoría 44 de PokeAPI.
const stones = csv('items').filter((i) => i.category_id === '44').map((i) => ({ id: i.id, ident: i.identifier, name: itemName[i.id] }));

const DUP = new Set(['meowstic-female-mega', 'magearna-original-mega', 'tatsugiri-droopy-mega', 'tatsugiri-stretchy-mega']);
const forms = csv('pokemon').filter((p) => /-mega(-[xyz])?$/.test(p.identifier) && !DUP.has(p.identifier));

const suffixOf = (s) => (/-([xyz])$/.exec(s) || [])[1] || '';
const stem = (s) => s.replace(/-[xyz]$/, '');
const lcp = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };

const used = new Set();
const out = [];
for (const f of forms) {
  const formName = f.identifier.replace(/-mega(-[xyz])?$/, '');
  const suf = suffixOf(f.identifier);
  let stone = null;
  if (f.identifier === 'rayquaza-mega') stone = { ident: 'meteorite', name: itemName['537'] || 'Meteorito' };
  else {
    // La piedra cuyo nombre comparte el prefijo más largo con la especie y la misma letra X/Y/Z.
    let best = -1;
    for (const s of stones) {
      if (used.has(s.ident) || suffixOf(s.ident) !== suf) continue;
      const score = lcp(stem(s.ident), formName);
      if (score > best) { best = score; stone = s; }
    }
    if (!stone || best < 4) throw new Error('Sin megapiedra para ' + f.identifier);
    used.add(stone.ident);
  }
  const sid = Number(f.species_id);
  const base = speciesName[sid];
  const letter = suf ? ' ' + suf.toUpperCase() : '';
  if (!stats[f.id] || !typeOf[f.id]) throw new Error('Faltan datos de ' + f.identifier);
  out.push({
    formId: Number(f.id), species: sid, name: `Mega-${base}${letter}`, stone: 'stone-' + stone.ident, stoneName: stone.name || ('Megapiedra de ' + base),
    types: typeOf[f.id].filter(Boolean), stats: stats[f.id],
  });
}
out.sort((a, b) => a.species - b.species || a.formId - b.formId);
fs.writeFileSync(path.join(__dirname, '..', 'server', 'megadata.json'), '[\n' + out.map((o) => JSON.stringify(o)).join(',\n') + '\n]\n');
console.log(`${out.length} megaevoluciones, ${used.size} megapiedras + Meteorito`);
