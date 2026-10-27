'use strict';
// Pokédex del casino: Kanto completo + invitados especiales de Johto y Hoenn.
// Formato: id|nombre|tipos|rareza (C común, U poco común, R rara, E épica, L legendaria, M mítica)
const RAW = `
1|Bulbasaur|grass/poison|C
2|Ivysaur|grass/poison|U
3|Venusaur|grass/poison|E
4|Charmander|fire|C
5|Charmeleon|fire|U
6|Charizard|fire/flying|E
7|Squirtle|water|C
8|Wartortle|water|U
9|Blastoise|water|E
10|Caterpie|bug|C
11|Metapod|bug|C
12|Butterfree|bug/flying|U
13|Weedle|bug/poison|C
14|Kakuna|bug/poison|C
15|Beedrill|bug/poison|U
16|Pidgey|normal/flying|C
17|Pidgeotto|normal/flying|U
18|Pidgeot|normal/flying|R
19|Rattata|normal|C
20|Raticate|normal|U
21|Spearow|normal/flying|C
22|Fearow|normal/flying|U
23|Ekans|poison|C
24|Arbok|poison|U
25|Pikachu|electric|U
26|Raichu|electric|R
27|Sandshrew|ground|C
28|Sandslash|ground|U
29|Nidoran♀|poison|C
30|Nidorina|poison|U
31|Nidoqueen|poison/ground|R
32|Nidoran♂|poison|C
33|Nidorino|poison|U
34|Nidoking|poison/ground|R
35|Clefairy|fairy|C
36|Clefable|fairy|R
37|Vulpix|fire|C
38|Ninetales|fire|R
39|Jigglypuff|normal/fairy|C
40|Wigglytuff|normal/fairy|U
41|Zubat|poison/flying|C
42|Golbat|poison/flying|U
43|Oddish|grass/poison|C
44|Gloom|grass/poison|U
45|Vileplume|grass/poison|R
46|Paras|bug/grass|C
47|Parasect|bug/grass|U
48|Venonat|bug/poison|C
49|Venomoth|bug/poison|U
50|Diglett|ground|C
51|Dugtrio|ground|U
52|Meowth|normal|C
53|Persian|normal|U
54|Psyduck|water|C
55|Golduck|water|R
56|Mankey|fighting|C
57|Primeape|fighting|U
58|Growlithe|fire|C
59|Arcanine|fire|E
60|Poliwag|water|C
61|Poliwhirl|water|U
62|Poliwrath|water/fighting|R
63|Abra|psychic|C
64|Kadabra|psychic|U
65|Alakazam|psychic|E
66|Machop|fighting|C
67|Machoke|fighting|U
68|Machamp|fighting|E
69|Bellsprout|grass/poison|C
70|Weepinbell|grass/poison|U
71|Victreebel|grass/poison|R
72|Tentacool|water/poison|C
73|Tentacruel|water/poison|R
74|Geodude|rock/ground|C
75|Graveler|rock/ground|U
76|Golem|rock/ground|R
77|Ponyta|fire|C
78|Rapidash|fire|R
79|Slowpoke|water/psychic|C
80|Slowbro|water/psychic|R
81|Magnemite|electric/steel|C
82|Magneton|electric/steel|R
83|Farfetch'd|normal/flying|U
84|Doduo|normal/flying|C
85|Dodrio|normal/flying|U
86|Seel|water|C
87|Dewgong|water/ice|U
88|Grimer|poison|C
89|Muk|poison|U
90|Shellder|water|C
91|Cloyster|water/ice|R
92|Gastly|ghost/poison|C
93|Haunter|ghost/poison|U
94|Gengar|ghost/poison|E
95|Onix|rock/ground|R
96|Drowzee|psychic|C
97|Hypno|psychic|U
98|Krabby|water|C
99|Kingler|water|U
100|Voltorb|electric|C
101|Electrode|electric|U
102|Exeggcute|grass/psychic|C
103|Exeggutor|grass/psychic|R
104|Cubone|ground|C
105|Marowak|ground|U
106|Hitmonlee|fighting|R
107|Hitmonchan|fighting|R
108|Lickitung|normal|U
109|Koffing|poison|C
110|Weezing|poison|U
111|Rhyhorn|ground/rock|C
112|Rhydon|ground/rock|R
113|Chansey|normal|R
114|Tangela|grass|U
115|Kangaskhan|normal|R
116|Horsea|water|C
117|Seadra|water|U
118|Goldeen|water|C
119|Seaking|water|U
120|Staryu|water|C
121|Starmie|water/psychic|R
122|Mr. Mime|psychic/fairy|R
123|Scyther|bug/flying|R
124|Jynx|ice/psychic|U
125|Electabuzz|electric|R
126|Magmar|fire|R
127|Pinsir|bug|R
128|Tauros|normal|R
129|Magikarp|water|C
130|Gyarados|water/flying|E
131|Lapras|water/ice|E
132|Ditto|normal|U
133|Eevee|normal|U
134|Vaporeon|water|R
135|Jolteon|electric|R
136|Flareon|fire|R
137|Porygon|normal|U
138|Omanyte|rock/water|C
139|Omastar|rock/water|R
140|Kabuto|rock/water|C
141|Kabutops|rock/water|R
142|Aerodactyl|rock/flying|E
143|Snorlax|normal|E
144|Articuno|ice/flying|L
145|Zapdos|electric/flying|L
146|Moltres|fire/flying|L
147|Dratini|dragon|U
148|Dragonair|dragon|R
149|Dragonite|dragon/flying|E
150|Mewtwo|psychic|L
151|Mew|psychic|M
196|Espeon|psychic|R
197|Umbreon|dark|R
212|Scizor|bug/steel|E
248|Tyranitar|rock/dark|E
243|Raikou|electric|L
244|Entei|fire|L
245|Suicune|water|L
249|Lugia|psychic/flying|L
250|Ho-Oh|fire/flying|L
251|Celebi|psychic/grass|M
252|Treecko|grass|C
253|Grovyle|grass|U
254|Sceptile|grass|E
255|Torchic|fire|C
256|Combusken|fire/fighting|U
257|Blaziken|fire/fighting|E
258|Mudkip|water|C
259|Marshtomp|water/ground|U
260|Swampert|water/ground|E
280|Ralts|psychic/fairy|C
281|Kirlia|psychic/fairy|U
282|Gardevoir|psychic/fairy|E
475|Gallade|psychic/fighting|E
302|Sableye|dark/ghost|R
334|Altaria|dragon/flying|R
350|Milotic|water|E
359|Absol|dark|R
371|Bagon|dragon|U
372|Shelgon|dragon|R
373|Salamence|dragon/flying|E
374|Beldum|steel/psychic|U
375|Metang|steel/psychic|R
376|Metagross|steel/psychic|E
380|Latias|dragon/psychic|L
381|Latios|dragon/psychic|L
382|Kyogre|water|L
383|Groudon|ground|L
384|Rayquaza|dragon/flying|L
385|Jirachi|steel/psychic|M
386|Deoxys|psychic|M
`;

const DEX = RAW.trim().split('\n').map((line) => {
  const [id, name, types, rarity] = line.split('|');
  return { id: Number(id), name, types: types.split('/'), rarity };
});
const BY_ID = new Map(DEX.map((p) => [p.id, p]));
const BY_RARITY = {};
for (const p of DEX) (BY_RARITY[p.rarity] ||= []).push(p);

const RARITY = {
  C: { name: 'Común', dust: 5, craft: 60, bst: 320, bonus: 0.01 },
  U: { name: 'Poco común', dust: 12, craft: 150, bst: 400, bonus: 0.02 },
  R: { name: 'Rara', dust: 30, craft: 400, bst: 470, bonus: 0.03 },
  E: { name: 'Épica', dust: 80, craft: 1200, bst: 540, bonus: 0.05 },
  L: { name: 'Legendaria', dust: 250, craft: 4000, bst: 600, bonus: 0.08 },
  M: { name: 'Mítica', dust: 500, craft: 8000, bst: 620, bonus: 0.10 },
};

const TYPES = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];

const CHART = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
  poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
};

function effectiveness(atkType, defTypes) {
  return defTypes.reduce((m, t) => m * (CHART[atkType][t] ?? 1), 1);
}

// Estadísticas base deterministas a partir de la rareza y el id.
const SPECIAL_BST = { 129: 200, 132: 288, 10: 195, 11: 205, 13: 195, 14: 205, 143: 540, 113: 450 };
function baseStats(id) {
  const p = BY_ID.get(id);
  const bst = SPECIAL_BST[id] || RARITY[p.rarity].bst;
  let h = (id * 2654435761) >>> 0;
  const w = [];
  for (let i = 0; i < 4; i++) {
    h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
    w.push(0.75 + (h % 1000) / 1000 * 0.6);
  }
  if (id === 113) w[0] = 3; // Chansey: tanque de PS
  if (id === 143) w[0] = 1.8;
  const sum = w.reduce((a, b) => a + b, 0);
  const [hp, atk, def, spe] = w.map((x) => Math.round((bst * x) / sum));
  return { hp, atk, def, spe };
}

module.exports = { DEX, BY_ID, BY_RARITY, RARITY, TYPES, CHART, effectiveness, baseStats };
