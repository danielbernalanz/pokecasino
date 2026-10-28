'use strict';
// Genera server/dexdata.json con los 1.025 Pokémon a partir de los CSV públicos de PokeAPI.
// Cada fila: [id, nombre, tipos, rareza, generación, stats, fase, evoluciona de, cadena evolutiva]. Los campos de
// evolución van al final: pokedex.js sigue leyendo bien un dexdata.json antiguo (sin ellos).
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

// Fase evolutiva: 0 = bebé, 1 = forma base (sin preevolución, o que viene de un bebé), 2 = primera
// evolución, 3 = segunda evolución.
const byId = new Map(species.map((s) => [Number(s.id), s]));
const stageOf = (s) => {
  if (s.is_baby === '1') return 0;
  const parent = s.evolves_from_species_id && byId.get(Number(s.evolves_from_species_id));
  if (!parent || parent.is_baby === '1') return 1;
  return stageOf(parent) + 1;
};

const out = species.map((s) => {
  const id = Number(s.id);
  const st = stats[id];
  const bst = st.reduce((a, b) => a + b, 0);
  const from = s.evolves_from_species_id ? Number(s.evolves_from_species_id) : null;
  // Formato: [id, nombre, tipos, rareza, generación, stats, fase, evoluciona de, cadena evolutiva]
  return [id, names[id] || s.identifier, typeOf[id].filter(Boolean), rarity(s, bst), Number(s.generation_id), st, stageOf(s), from, Number(s.evolution_chain_id)];
}).sort((a, b) => a[0] - b[0]);

const file = path.join(__dirname, '..', 'server', 'dexdata.json');
fs.writeFileSync(file, '[\n' + out.map((r) => JSON.stringify(r)).join(',\n') + '\n]\n');
const count = {};
for (const r of out) count[r[3]] = (count[r[3]] || 0) + 1;
console.log(`${out.length} Pokémon → ${path.relative(process.cwd(), file)}`, count);
