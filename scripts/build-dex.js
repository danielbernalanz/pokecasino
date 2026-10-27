'use strict';
// Genera server/dexdata.json con los 1.025 Pokémon a partir de los CSV públicos de PokeAPI.
// Uso: node scripts/build-dex.js <carpeta-con-csv>
//   (pokemon_species, pokemon_types, types, pokemon_stats y pokemon_species_names de
//    https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv)
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) { console.error('Uso: node scripts/build-dex.js <carpeta-csv>'); process.exit(1); }

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
const species = csv('pokemon_species').filter((s) => Number(s.id) <= 1025);
const names = {};
for (const n of csv('pokemon_species_names')) {
  if (n.local_language_id === '7') names[n.pokemon_species_id] = n.name; // español
  else if (n.local_language_id === '9' && !names[n.pokemon_species_id]) names[n.pokemon_species_id] = n.name;
}
const typeOf = {};
for (const t of csv('pokemon_types')) (typeOf[t.pokemon_id] ||= [])[Number(t.slot) - 1] = types[t.type_id];
const stats = {};
for (const s of csv('pokemon_stats')) (stats[s.pokemon_id] ||= [])[Number(s.stat_id) - 1] = Number(s.base_stat);

// Rareza por defecto: legendario/mítico o por estadísticas base totales.
function rarity(s, bst) {
  if (s.is_mythical === '1') return 'M';
  if (s.is_legendary === '1') return 'L';
  if (s.is_baby === '1' || bst < 330) return 'C';
  if (bst < 440) return 'U';
  if (bst < 520) return 'R';
  return 'E';
}

const out = species.map((s) => {
  const id = Number(s.id);
  const st = stats[id];
  const bst = st.reduce((a, b) => a + b, 0);
  return [id, names[id] || s.identifier, typeOf[id].filter(Boolean), rarity(s, bst), Number(s.generation_id), st];
}).sort((a, b) => a[0] - b[0]);

const file = path.join(__dirname, '..', 'server', 'dexdata.json');
fs.writeFileSync(file, '[\n' + out.map((r) => JSON.stringify(r)).join(',\n') + '\n]\n');
const count = {};
for (const r of out) count[r[3]] = (count[r[3]] || 0) + 1;
console.log(`${out.length} Pokémon → ${path.relative(process.cwd(), file)}`, count);
