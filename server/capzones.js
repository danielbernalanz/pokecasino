'use strict';
// Rutas de captura por región (empezamos por Kanto; para añadir una región basta con otra entrada en REGIONS).
// Cada zona tiene una tabla de encuentros como la de los juegos: `[especie, nivel mínimo, nivel máximo, peso, hora]`, donde el peso es el
// porcentaje de la tabla de los juegos (aproximado) y `hora` es 'day' | 'night' | null (todo el día; ver daytime.js, hora de España).
// Los niveles y las especies siguen las rutas de Kanto de Rojo Fuego / Verde Hoja con las variantes nocturnas de Oro HeartGold / Plata SoulSilver.
// Las especies de aquí salen con su ratio de captura REAL (catchdata.json). Ningún Pokémon de estas tablas evoluciona por nivel dentro de su
// rango de encuentro hacia algo más valioso que lo que cuesta capturarlo (lo comprueba test/capture.test.js).
//
// Los legendarios de encuentro (`legend`) son encuentros únicos: se pueden capturar UNA sola vez por jugador, a su nivel real, con su ratio real (3).
const DAY = 'day';
const NIGHT = 'night';

const REGIONS = [
  {
    id: 'kanto', name: 'Kanto',
    zones: [
      { id: 'ruta1', name: 'Ruta 1', kind: 'grass', tone: 'g', hostId: 16, desc: 'Hierba alta entre Pueblo Paleta y Ciudad Verde.', open: 0, enc: [
        [16, 2, 5, 40, DAY], [19, 2, 4, 50, null], [161, 2, 4, 10, DAY], [163, 2, 4, 35, NIGHT], [16, 2, 5, 15, NIGHT]] },
      { id: 'verde', name: 'Bosque Verde', kind: 'forest', tone: 'g', hostId: 10, desc: 'Un bosque enorme lleno de Bichos.', open: 0, enc: [
        [10, 3, 5, 30, null], [13, 3, 5, 30, null], [11, 4, 6, 10, DAY], [14, 4, 6, 10, DAY], [25, 3, 5, 5, null], [16, 4, 6, 10, NIGHT], [46, 5, 6, 5, NIGHT]] },
      { id: 'ruta3', name: 'Ruta 3', kind: 'grass', tone: 'y', hostId: 21, desc: 'El camino al Monte Moon, con muchos Spearow.', open: 0, enc: [
        [21, 5, 8, 35, null], [16, 6, 8, 20, DAY], [29, 6, 8, 15, null], [32, 6, 8, 15, null], [39, 3, 5, 5, null], [56, 7, 9, 10, DAY], [41, 6, 8, 20, NIGHT]] },
      { id: 'moon', name: 'Monte Moon', kind: 'cave', tone: 'b', hostId: 35, desc: 'Cueva oscura con Zubat, Geodude y, de noche, Clefairy.', open: 0, enc: [
        [41, 6, 11, 50, null], [74, 6, 10, 25, null], [46, 8, 11, 10, DAY], [35, 8, 12, 15, NIGHT], [35, 8, 12, 5, DAY]] },
      { id: 'ruta24', name: 'Rutas 24 y 25', kind: 'grass', tone: 'g', hostId: 63, desc: 'Cabo Celeste: Abra, Oddish y Bellsprout.', open: 1, enc: [
        [43, 12, 14, 20, NIGHT], [69, 12, 14, 20, DAY], [63, 8, 12, 10, null], [16, 11, 14, 15, DAY], [10, 7, 10, 15, DAY], [13, 7, 10, 15, DAY], [48, 12, 14, 20, NIGHT], [52, 10, 14, 15, NIGHT]] },
      { id: 'ruta7', name: 'Rutas 7 y 8', kind: 'grass', tone: 'r', hostId: 58, desc: 'Entre Azulona y Azafrán: Growlithe, Vulpix y Meowth.', open: 2, enc: [
        [58, 15, 18, 15, null], [37, 15, 18, 15, null], [56, 15, 18, 15, DAY], [52, 15, 18, 20, NIGHT], [16, 15, 18, 20, DAY], [43, 13, 16, 15, null], [69, 13, 16, 15, null], [63, 15, 18, 5, null]] },
      { id: 'tunel', name: 'Túnel Roca', kind: 'cave', tone: 'y', hostId: 74, desc: 'Un túnel oscuro: Zubat, Geodude, Machop y algún Onix.', open: 3, enc: [
        [41, 15, 17, 30, null], [74, 15, 17, 30, null], [66, 15, 17, 25, null], [95, 13, 17, 10, null], [41, 15, 18, 5, NIGHT]] },
      { id: 'diglett', name: 'Cueva Diglett', kind: 'cave', tone: 'r', hostId: 50, desc: 'Túneles de Diglett y, muy de vez en cuando, Dugtrio.', open: 1, enc: [
        [50, 15, 22, 95, null], [51, 29, 31, 5, null]] },
      { id: 'torre', name: 'Torre Pokémon', kind: 'tower', tone: 'p', hostId: 92, desc: 'Un cementerio Pokémon: aquí solo hay Gastly… y alguna sorpresa.', open: 3, enc: [
        [92, 13, 17, 55, NIGHT], [92, 13, 17, 25, DAY], [104, 13, 18, 15, null], [93, 15, 19, 5, NIGHT]] },
      { id: 'arroyo', name: 'Arroyo de Cabo Celeste', kind: 'water', tone: 'b', hostId: 129, desc: 'Pesca de Magikarp, Goldeen y compañía.', open: 1, enc: [
        [129, 5, 14, 30, null], [118, 5, 12, 25, null], [60, 8, 14, 20, DAY], [98, 8, 14, 15, null], [54, 14, 18, 5, null], [79, 15, 18, 5, null], [72, 10, 18, 15, NIGHT]] },
      { id: 'ruta12', name: 'Rutas 11 a 13', kind: 'grass', tone: 'b', hostId: 96, desc: 'La Ruta de la Costa: Drowzee, Ekans y Sandshrew.', open: 4, enc: [
        [96, 12, 15, 25, null], [21, 14, 17, 15, DAY], [23, 12, 15, 15, null], [27, 12, 15, 15, null], [43, 20, 25, 15, NIGHT], [69, 20, 25, 15, DAY], [48, 22, 26, 15, NIGHT]] },
      { id: 'safari', name: 'Camino de la Safari', kind: 'grass', tone: 'y', hostId: 84, desc: 'Las llanuras de Fucsia: Doduo, Rhyhorn y Exeggcute.', open: 5, enc: [
        [84, 20, 26, 25, null], [111, 21, 27, 20, null], [102, 24, 28, 20, null], [29, 22, 26, 10, DAY], [32, 22, 26, 10, DAY], [30, 25, 29, 5, null], [33, 25, 29, 5, null], [113, 23, 28, 5, null]] },
      { id: 'cueva', name: 'Cueva Celeste', kind: 'cave', tone: 'p', hostId: 132, desc: 'La cueva del Alto Mando: Pokémon muy fuertes.', open: 8, enc: [
        [42, 46, 55, 25, null], [64, 49, 56, 15, null], [132, 46, 58, 15, null], [113, 49, 55, 10, null], [101, 50, 60, 10, null], [57, 46, 52, 10, null], [24, 46, 52, 15, null]] },
    ],
    // Legendarios de encuentro: [id, nivel, zona donde aparecen, medallas necesarias (y `champ`: ser Campeón de la Liga)].
    legend: [
      { id: 144, level: 50, zone: 'arroyo', badges: 5, spot: 'Islas Espuma' },
      { id: 145, level: 50, zone: 'tunel', badges: 5, spot: 'Central Energía' },
      { id: 146, level: 50, zone: 'ruta7', badges: 5, spot: 'Camino Victoria' },
      { id: 150, level: 70, zone: 'cueva', badges: 8, champ: true, spot: 'Cueva Celeste (guarida)' },
    ],
  },
];
// `open`: medallas necesarias para entrar a la zona (los jugadores nuevos empiezan por Ruta 1, Bosque Verde, Ruta 3 y Monte Moon).

const ZONES = [];
for (const r of REGIONS) {
  for (const z of r.zones) {
    ZONES.push({ ...z, region: r.id, regionName: r.name, enc: z.enc.map(([id, min, max, w, t]) => ({ id, min, max, w, t })), legend: r.legend.filter((l) => l.zone === z.id) });
  }
}
const ZONE_BY_ID = new Map(ZONES.map((z) => [z.id, z]));
const LEGENDS = REGIONS.flatMap((r) => r.legend.map((l) => ({ ...l, region: r.id })));
const LEGEND_BY_ID = new Map(LEGENDS.map((l) => [l.id, l]));

module.exports = { REGIONS, ZONES, ZONE_BY_ID, LEGENDS, LEGEND_BY_ID };
