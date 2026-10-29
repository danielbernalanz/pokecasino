# Equilibrio del juego: auditoría y ajustes

Respuesta a dos comentarios de los jugadores:

1. «Si puedes evolucionar Pokémon no tiene sentido que en el gacha te den un Pokémon evolucionado con tanta facilidad».
2. «Balancea todo el juego, todas las mecánicas y todos los ítems».

Todo lo que sigue se puede reproducir:

| Qué | Cómo |
|---|---|
| RTP de cada juego, tres arquetipos de jugador durante 30 días, coste de la Pokédex y de una legendaria | `node scripts/simulate-economy.js` (`--days 30 --players 12 --rtp 1000000 --dex 6`) |
| Divisores de Voltorb Flip | `node scripts/calibrate-voltorb.js` |
| Invariantes (RTP, devolución < ventaja de la casa, bucles sin valor esperado positivo) | `npm test` → `test/balance.test.js`, `test/evolution.test.js` |
| Constantes | `server/balance.js` (RTP, XP, bonus, recompensas por nivel y recompensa diaria) |

El simulador usa el código **real** del servidor (hub, gacha, progreso, juegos) con un reloj falso, así que mide lo que ocurre de verdad.
Las estrategias (Video Póker casi óptimo, Blackjack básico, Voltorb con inferencia exacta) están en `scripts/strategies.js`.

## Resumen: lo más importante

| # | Hallazgo / cambio | Antes | Después |
|---|---|---|---|
| 1 | Formas evolucionadas en el gacha | mismo peso que las básicas | dentro de cada rareza: fase 0-1 × 1, fase 2 × 0,25, fase 3 × 0,06 (legendarios y míticos × 1) |
| 2 | **Voltorb Flip** con la mejor estrategia | devolvía **155 % (nv. 1) … 1.300 % (nv. 8)**: los puntos se multiplican sin tope | puntos con tope (12) y divisores calibrados: **≈92 %** con inferencia exacta, 55-70 % con una heurística sencilla |
| 3 | **Devolución por niveles** (rakeback) | XP = apuesta ÷ 10; Caramelo Raro cada nivel + Master Ball cada 5 → **24 % de lo apostado en el nivel 5, 10 % en el 10, 5 % en el 20** (más que la ventaja de cualquier juego de mesa) | XP proporcional a la ventaja de la casa y recompensas mucho menores: **< 0,5 % de lo apostado**, ≈ 19 % de la ventaja como máximo |
| 4 | **Bonus de compañero / colecciones / Amuleto** | tope fijo 300 + 50 × nivel al día: con 10 % de bonus y ≥ 28.000 apostados al día en Video Póker/Blackjack **sobraban ≈ +1.000 monedas al día** | además un tope ligado a lo apostado: ≤ 30 % de la ventaja de la casa (45 % con Amuleto) |
| 5 | **XP cultivable** | crear y cancelar un duelo de 10.000 daba 1.000 XP gratis; dos cuentas gemelas con duelos amistosos, 70 XP por duelo sin límite | la XP de un duelo solo cuenta al jugarse; la XP fija tiene tope de 400 al día |
| 6 | **Caramelo Raro → liberar** | 900 monedas de tienda → +1 copia de una legendaria/mítica → liberar da 250/500 de polvo = **1.000/2.000 monedas** (y copias de cualquier especie a ≈900 en el Mercado) | las estrellas de Caramelo Raro están **ligadas** (no se venden, regalan ni liberan) |
| 7 | **Enfermera Joy** | 1.000 monedas cada hora = **24.000 al día** (≈ 5 × todos los ingresos de un casual) | 500 cada 12 h (≤ 1.000 al día) |
| 8 | Ingresos de un casual con todo hecho (racha ≥ 7) | ≈ 4.500 monedas/día (+ Joy) | ≈ 2.500 monedas/día |
| 9 | Regalos del ×10 | Master Ball 5 % (≈ 60 % de lo gastado en ×10 devuelto), Amuleto Iris 10 %, Huevo 30 % | Master Ball 0,5 %, Amuleto Iris 5 %, Huevo 20 % |
| 10 | Tasas del gacha | L 1,8 % · M 0,3 % | L 1,75 % · M 0,25 % (y una legendaria concreta con 3 destacadas ≈ 51.000 monedas ≈ 3-4 semanas de ingresos) |
| 11 | Master Ball | cada 5 niveles | cada 25 niveles, al ser Campeón y 0,5 % de los ×10 |
| 12 | Precios de la tienda | Huevo Suerte 1.200, Moneda Amuleto 2.500 | 300 y 400 (valen mucho menos de lo que costaban) |

## Parte A · Fases evolutivas en el gacha

`scripts/build-dex.js` calcula para cada especie (a partir de `pokemon_species.csv` de PokeAPI):

* `stage`: 0 = bebé (`is_baby`), 1 = forma base (sin preevolución, o que evoluciona de un bebé), 2 = primera evolución, 3 = segunda evolución. Pichu 0 · Pikachu 1 · Raichu 2; Bulbasaur 1 · Ivysaur 2 · Venusaur 3; Eevee 1 · Vaporeon 2; Magikarp 1 · Gyarados 2; Munchlax 0 · Snorlax 1.
* `evolvesFrom`: id de la preevolución directa (o `null`) y `chain`: `evolution_chain_id`.

`server/dexdata.json` añade los tres campos **al final** de cada fila (formato compatible: `pokedex.js` los lee con valores por defecto si faltan) y `DEX` los expone, también en `/api/static`.

Reparto de las 1.025 especies: 19 bebés, 543 de fase 1, 352 de fase 2 y 111 de fase 3.

**Gacha** (`rollPokemon`): dentro de la rareza que toca, cada especie pesa

| Fase | 0 (bebé) | 1 | 2 | 3 | Legendarios y míticos |
|---|---|---|---|---|---|
| Peso | 1 | 1 | 0,25 | 0,06 | 1 |

Una evolución final concreta sale ≈ 16 veces menos que una forma básica de su misma rareza. Los destacados del banner (`featuredL`, `featuredE`) mantienen su 50 % exacto. La rareza de cada tirada no cambia.

**Rareza monótona a lo largo de la cadena.** Se auditaron todas las cadenas con las reglas de `build-dex.js` y los ajustes manuales de `pokedex.js` (`RAW`): hoy **no hay ninguna evolución más común que su preevolución** (una «Poco común → Rara» por BST nunca se invierte). Aun así `pokedex.js` aplica una pasada de seguridad (si una evolución quedara por debajo de su preevolución se sube a su rareza; nunca se baja una base, así ninguna colección pierde valor) y `test/evolution.test.js` lo comprueba en las 1.025 especies.

Efecto en la Pokédex: completarla solo con tiradas pasa de ≈ 13.800 a ≈ 14.400 tiradas (véase más abajo), porque las fases 2 y 3 son ahora las últimas que caen. Cuando llegue la evolución con caramelos, estas formas se conseguirán evolucionando y habrá que revisar este coste.

## Parte B · Juegos de casino

### RTP máximo con la mejor estrategia (antes → después)

| Juego | RTP máximo antes | RTP máximo después | Medido (1.000.000 de rondas, estrategia del simulador) |
|---|---|---|---|
| Pika-Slots | 95,7 % (apuesta alta) – 97,5 % (mínima) | igual | 95,89 % ± 1,29 |
| Ruleta de Tipos | 94,7 % | 94,7 % | 94,65 % ± 0,20 |
| Plinko | 95,5 % (alto) – 97,5 % (bajo) | igual | 97,51 % ± 0,07 (bajo) |
| Minas | 97 % | 97 % | 96,56 % ± 0,16 (3 Geodude, retirada tras 4 aciertos) |
| Desafío Pokémon | (nuevo) | 97 % para un fan experto en cada dificultad (≤ 96,8 %) | ver «Desafío Pokémon» al final |
| Crash | 97 % | 97 % | 97 % (P(explota ≥ x) = 0,97 / x; `test/balance.test.js` lo comprueba) |
| Baccarat (Banca / Punto / Empate) | 98,9 / 98,8 / 85,8 % | igual | 99,12 % ± 0,18 (Banca) |
| Video Póker 9/6 | 99,54 % (óptimo) | 99,54 % | 99,18 % ± 0,84 (jerarquía casi óptima) |
| Blackjack | 99,45 % | 99,45 % | 99,55 % ± 0,20 (1 M); 99,45 % ± 0,08 (2 M manos) |
| Voltorb Flip (inferencia exacta) | **155-1.310 %** según nivel | **≈ 92 %** | heurística sencilla: 55-70 % |
| Gran Carrera | ≤ 90 % | ≤ 90 % | |
| Duelos | 95 % (comisión 5 %) | igual | |
| Hold'em | 100 % (suma cero) | igual | |

`BAL.RTP` en `server/balance.js` guarda una **cota superior** del RTP de cada juego; `test/balance.test.js` comprueba que fórmula o simulación no la superan. De esa cota salen la XP y el bonus (siguiente sección).

Notas por juego:

* **Pika-Slots**: líneas 93,7 % (exacto con `computeRTP`) + 2 % de cada apuesta que va al bote + semilla de 10.000 (que pesa 1,8 % con la apuesta mínima y casi nada con apuestas altas): 95,7 %-97,5 %. Sin cambios.
* **Ruleta**: 18/19 = 94,7 % en todas las apuestas. Sin cambios.
* **Plinko**: bajo 97,5 %, medio 96,4 %, alto 95,5 % (exacto). Sin cambios.
* **Minas, Crash**: 97 % por construcción (`EDGE = 0,97`). Sin cambios.
* **Baccarat**: Banca 98,9 %, Punto 98,8 %, Empate 85,8 %. Sin cambios.
* **Video Póker** 9/6: 99,54 % con juego óptimo (cifra clásica); con el simulador, que usa una jerarquía casi óptima, el resultado está dentro del ruido (la varianza de un Póker es enorme: ±1 % con un millón de manos).
* **Blackjack**: 99,45 % ± 0,08 con estrategia básica (2.000.000 de manos simuladas).
* **Carrera**: `EDGE = 0,9`; con los pagos mínimo 1,2 y máximo 60 nunca se supera el 90 % apostando a cualquier corredor, ni a los seis a la vez.
* **Duelos**: comisión del 5 % del bote (0 el lunes de Duelos). **Hold'em**: sin comisión (suma cero entre jugadores); no da XP ni bonus.

### Voltorb Flip: el agujero más grande

El pago original era `apuesta × puntos ÷ divisor` (divisores 16-38 «calibrados para una estrategia razonable»). Los puntos son el producto de todas las cartas ×2/×3 giradas, así que un tablero de nivel 8 vale 2⁷·3³ = 3.456 puntos. Un jugador que **deduce las pistas** (se enumeran todos los tableros compatibles con las sumas y el número de Voltorb de cada fila y columna, y se gira la casilla más segura) limpia el 45-80 % de los tableros (según el nivel) y recupera, medido con ese jugador:

| Nivel | 1 | 2 | 3 | 5 | 8 |
|---|---|---|---|---|---|
| RTP antes | 155 % | 220 % | 350 % | 680 % | 1.310 % |

Ahora los puntos cuentan hasta 12 (`SCORE_CAP`) y los divisores se calibran con `scripts/calibrate-voltorb.js` (600 partidas por nivel, 3 umbrales de riesgo; el máximo está siempre entre 0,25 y 0,35) para que esa mejor estrategia recupere ≈ 92 %:

| Nivel | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| E[puntos ≤ 12] (mejor estrategia) | 10,1 | 9,8 | 9,6 | 9,0 | 8,9 | 9,2 | 9,4 | 9,7 |
| Divisor antes | 16 | 21 | 21 | 20 | 16 | 21 | 19 | 38 |
| Divisor después | 11 | 10,7 | 10,5 | 9,8 | 9,7 | 10 | 10,2 | 10,5 |
| RTP con inferencia exacta | ≈ 92 % | ≈ 92 % | ≈ 92 % | ≈ 92 % | ≈ 92 % | ≈ 92 % | ≈ 92 % | ≈ 92 % |

Una heurística sencilla (probabilidad por fila y columna) recupera 55-70 %; un jugador humano estará entre ambas. Es el juego de más habilidad, y por eso el que más castiga jugar mal.

### Devolución por niveles (rakeback) y bonus: cómo se garantiza que ningún juego sea +EV

Hay tres flujos que devuelven monedas a quien apuesta mucho:

1. **Niveles**. `xp = apuesta ÷ 10` y cada nivel *n* cuesta 100·(2n−3) XP.
2. **Bonus** de compañero (0-10 % + estrellas), colecciones (+1 % cada una, máx. 8 %) y Moneda Amuleto (+10 %) sobre las **ganancias netas**.
3. **Objetos** de recompensa por nivel.

**Antes**, valorando los objetos a lo que pagan los PNJ (Caramelo 450, Master Ball 2.000):

| Nivel | 5 | 10 | 20 | 30 | 50 | 100 |
|---|---|---|---|---|---|---|
| Devolución acumulada (% de lo apostado) | 24 % | 10,3 % | 4,9 % | 3,3 % | 2,0 % | 1,1 % |

Ventaja de la casa: Video Póker 0,46 %, Blackjack 0,45-0,55 %, Baccarat ≈ 1,1 %. Es decir, con un nivel medio **toda la mesa era rentable**. El bonus empeoraba la situación: aplicado sin límite devolvería `bonus × E[ganancia positiva]` ≈ 5 % de lo apostado en Video Póker con un 10 % de bonus; el tope diario fijo de 300 + 50 × nivel solo frenaba a los que apostaban muchísimo (para 1.300 monedas de tope bastaban ≈ 25.000 apostadas al día, con solo ≈ 120 monedas de pérdida esperada).

**Ahora** (todo en `server/balance.js` y `server/hub.js`):

* **La XP es proporcional a la ventaja de la casa**: `xp = apuesta × min(0,1; 2,5 × ventaja)`. Cada moneda que la casa espera ganar da 2,5 XP, de modo que la devolución por XP nunca puede pasar de una fracción fija de la ventaja *en ningún juego*.

  | Juego | Ventaja | XP por moneda apostada |
  |---|---|---|
  | Video Póker | 0,46 % | 0,0115 |
  | Blackjack | 0,45 % | 0,0112 |
  | Baccarat | 1,07 % | 0,0268 |
  | Slots, Plinko | 2,4 % | 0,06 |
  | Minas, Crash | 3 % | 0,075 |
  | Ruleta, Voltorb, Carrera, duelos | ≥ 5 % | 0,1 (tope) |

* **Recompensas por nivel**: 3 × nivel monedas (antes 5 ×); Caramelo Raro **cada 5 niveles desde el 10** (antes cada nivel) y Master Ball **cada 25** (antes cada 5). Devolución acumulada por XP ganada, en el peor nivel: 0,076 monedas por XP = **19 % de la ventaja** (≈ 0,03-0,45 % de lo apostado según el juego). Con el Huevo Suerte (XP ×2) llega al 38 %.
* **Bonus con tope «de sala»**: cada apuesta suma a una bolsa diaria `apuesta × ventaja × 0,30` (0,45 con Moneda Amuleto, ×1,25 el fin de semana del Compañero); el bonus pagado en un día no supera esa bolsa ni el tope fijo. En el peor caso (Amuleto + fin de semana + Huevo Suerte permanentes) la devolución total es 0,56 + 0,38 = **94 % de la ventaja**: por debajo del 100 % en todos los juegos. `test/balance.test.js` lo calcula juego a juego.
* **XP no cultivable**: `takeBet(..., { noXp })` para duelos (la XP se concede al aceptarse el duelo, no al crear el reto), y la XP «fija» de los duelos (50/20) tiene un tope de 400 al día.

Consecuencia visible: el compañero ya no da «+X % hasta 300 + 50 × nivel al día» sino «+X % mientras quede bolsa de bonus». El texto del Vestíbulo y de Mi Entrenador lo dice.

## Fuentes de monedas (faucets)

| Fuente | Antes | Después | Comentario |
|---|---|---|---|
| Monedas iniciales | 5.000 | 5.000 | sin cambios (33 tiradas) |
| Recompensa diaria | 1.000 + 250 × (racha − 1), 1.000-2.500, + Ticket | 500 + 100 × (racha − 1), 500-1.100, + Ticket | media de una semana de racha 1.750 → 800 |
| Tirada gratis diaria | 1 | 1 | |
| Enfermera Joy | 1.000 cada hora (si < 200) | 500 cada 12 h (si < 200) | de 24.000 a ≤ 1.000 al día |
| Ruta del Entrenador (única vez) | 2.900 monedas + objetos | sin cambios | |
| Misiones diarias (3) | 300-600 monedas o 1-2 Tickets / Huevo / Caramelo; bonus 500 + Huevo | 200-400 monedas, 1 Ticket / Huevo / Caramelo; bonus 250 + Huevo | valor medio por misión 350 → 242 |
| Medallas (única vez) | 1.000 × n (36.000) + Campeón 25.000 | 500 × n (18.000) + Campeón 10.000 | 61.000 → 28.000 |
| Subir de nivel | 5 × nivel + Caramelo/nivel + Master Ball/5 | 3 × nivel + Caramelo/5 niveles (desde el 10) + Master Ball/25 | ver sección anterior |
| Colecciones | Huevo + título + 1 % | igual | el 1 % cae bajo el tope de bonus |
| Bonus de compañero | tope fijo | tope fijo + bolsa | |
| Evento Misiones ×2 | ×2 monedas de las 3 misiones | igual | hasta +750/día el miércoles |
| Comerciantes NPC | ver README | sin cambios (invariantes intactos) | solo cambia el precio del Amuleto Iris (cap 1.500 → 500) |

Ingreso diario máximo de un casual (racha ≥ 7, 3 misiones, tirada gratis y Ticket valorados a 150): **≈ 4.500 → ≈ 2.500 monedas/día** (`test/balance.test.js` lo calcula).

## Sumideros (sinks)

| Sumidero | Valor | Comentario |
|---|---|---|
| Ventaja de la casa | 0,5-10 % según el juego | |
| Gacha | 150 / 1.350 (×10 = −10 %) | una tirada devuelve como mucho ≈ 66 % en polvo+regalos si todas fueran repetidas (imposible: los duplicados llegan tarde), en la práctica mucho menos |
| Tienda | Ticket 150, Caramelo 900, Huevo Suerte 300, Amuleto 400 | ver Objetos |
| Mercado | comisión 1,5 % al publicar + 3 % de impuesto de venta | el viernes sin impuesto y comisión a la mitad |
| Duelos | 5 % del bote | |
| Fabricar con polvo | 60 / 150 / 400 / 1.200 / 4.000 / 8.000 polvo | ≥ 12 × el polvo de liberar esa especie |
| Hold'em | ninguno (suma cero) | solo mueve monedas entre jugadores |

## Objetos (precios frente a lo que dan)

| Objeto | Efecto | Antes | Después | Razonamiento |
|---|---|---|---|---|
| Ticket Gacha | 1 tirada | 150 | 150 | = coste de una tirada |
| Caramelo Raro | +1 estrella (ligada) a un Pokémon que ya tengas | 900 | 900 | ya no se puede revender ni liberar; una estrella da ≈ +4 % de fuerza en duelos y +0,5 % de bonus |
| Huevo Suerte | XP ×2 durante 1 h | 1.200 | **300** | extra de recompensas por nivel: ≈ 20 % de la ventaja de lo apostado en esa hora (≈ 0-80 monedas); solo vale por la velocidad de subida de nivel |
| Moneda Amuleto | +10 % de ganancias netas y bolsa de bonus del 45 % en lugar del 30 % durante 1 h | 2.500 | **400** | beneficio máximo ≈ 0,15 × ventaja × lo apostado en la hora: con 100.000 apostados en Slots ≈ 360 monedas |
| Amuleto Iris | las 10 próximas tiradas tienen ×4 de variocolor | solo premio | solo premio (NPC compra a ≤ 500, antes 1.500) | ≈ 0,5 variocolor de más |
| Master Ball | próxima tirada legendaria (la destacada del banner) | cada 5 niveles | cada 25, Campeón, 0,5 % de los ×10 | vale ≈ 17.000 monedas de tiradas |
| Huevo Misterioso | un cosmético al azar | sin cambios | sin cambios | abrir uno vale de media ≈ 370 en PNJ frente a 900 que piden por él |
| Cosméticos | marco / dorso / título por rareza | | | sin cambios |

## Gacha

* **Tasas** (antes → después): C 49,5 → 49,6 %, U 28,2 → 28,3 %, R 15 → 15 %, E 5,2 → 5,1 %, L **1,8 → 1,75 %**, M **0,3 → 0,25 %**. Una legendaria o mítica cada 50 tiradas (7.500 monedas); una concreta con 3 destacadas, 341 tiradas de media (51.000 monedas), mediana 234 y percentil 90 ≈ 790.
* **Polvo**: 5 / 12 / 30 / 80 / 250 / 500 por duplicado, fabricar 60 / 150 / 400 / 1.200 / 4.000 / 8.000, 4 monedas por polvo. Sin cambios: fabricar cuesta 12-16 × lo que da liberar y 1 polvo vale 4 monedas, de modo que ni fabricar → liberar ni tirar → liberar → cambiar da dinero.
* **×10**: 1.350 (−10 %) y al menos una Rara. Los regalos (por sobre): Master Ball 5 → **0,5 %**, Amuleto Iris 10 → **5 %**, Huevo Misterioso 30 → **20 %**. Antes devolvían (a precio de PNJ o de tiradas) ≈ 62 % + 11 % + 3 % de lo gastado en ×10; ahora ≈ 6 % + 6 % + 2 %.
* **Master Ball**: como no hay pity, es la única garantía. Pasa de caer cada 5 niveles (y 5 % de cada ×10) a cada 25 niveles, al ser Campeón y 0,5 % por ×10: una por ≈ 200 ×10 (270.000 monedas) en el mejor caso.

## Resto de mecánicas

* **Apuesta máxima por medallas** (10.000 → 100.000): sin cambios. Con 5.000 monedas iniciales y ≈ 800 al día no se puede arruinar de golpe en las primeras medallas, y quien llega a 100.000 ya tiene reservas de sobra. Las mesas de póker (400-4.000, 2.000-20.000, 10.000-100.000) ya están ligadas a medallas.
* **Mercado y NPC**: comisión 1,5 % + impuesto 3 % y todos los invariantes de `server/npc.js` (tope de compra < suelo de venta, límites diarios, tesorería finita, sin operaciones entre NPC) se conservan; los tests pasan sin tocarlos salvo donde cambió un precio de tienda (Huevo Suerte 600 → 150 de tope de compra).
* **Eventos**: «Fin de semana del Compañero» sube un 25 % la bolsa de bonus (además de duplicar el tope fijo), porque con la bolsa nueva duplicar solo el tope fijo no cambiaba nada.

## Simulación de 30 días

`node scripts/simulate-economy.js --days 30 --players 12` (el grinder con 40 jugadores para ver el error). Cada arquetipo juega al día: **casual** 30 partidas con apuestas de 10-50, **regular** 120 con 20-250, **grinder** 1.500 manos de Video Póker/Blackjack con estrategia óptima y apuestas de 100-3.000; todos reclaman la recompensa diaria (90 %, 97 % y 100 % de los días), la tirada gratis y los Tickets, usan Caramelos y Huevos, piden ayuda a Joy cuando se quedan sin fondos, **gastan en el gacha todo lo que supera su reserva** (300 / 1.500 / 3.000) en el banner promocional activo y fabrican con el polvo.

| | Casual | Regular | Grinder |
|---|---|---|---|
| Monedas que tendría sin tirar en el gacha: día 7 | 13.600 | 13.200 | 16.300 |
| … día 14 | 19.600 | 20.600 | 30.300 |
| … día 30 | **34.900** | **37.900** | **47.100** |
| Nivel de entrenador al día 30 | 8,1 | 10,3 | 16,8 |
| Medallas (de 8) al día 30 | 4,7 | 4,8 | 4,8 |
| Pokédex al día 30 | 27 % | 28 % | 28 % |
| Legendarios/míticos al día 30 | 6,7 | 8,8 | 7,7 |
| Variocolores | 9 | 11 | 12 |
| Tiradas | 362 | 378 | 455 |
| Apostado en 30 días | 8.800 | 73.300 | 1.861.000 |
| Resultado neto de los juegos (con bonus) | −860 | −5.500 | **+500 ± 7.700** (≈ 0) |
| Ingresos: recompensa diaria / misiones, ruta y medallas / niveles | 22.800 / 16.200 / 100 | 29.300 / 17.000 / 170 | 30.900 / 16.400 / 460 |

* El **casual** termina el mes +30.000 monedas por encima del inicio, casi todo de la recompensa diaria y de las misiones, y no se puede permitir todo: lo que ahorra equivale a ≈ 230 tiradas, y con ellas ≈ 4 legendarias o míticas, pero una concreta le sigue costando semanas.
* El **grinder** apuesta 1,9 M de monedas por jugador en el mes y el resultado neto de los juegos es indistinguible de cero (+500 ± 7.700; la esperanza teórica es −0,5 % a −0,7 % de lo apostado ≈ −10.000, con la desviación del Póker real, que no se resuelve con 74 M apostados). Sus ingresos reales son los mismos 30.900 de recompensa diaria que los demás: **jugar no crea monedas**. Lo que sí hace es subir de nivel (16,8 frente a 8,1), pero los niveles devuelven < 0,5 % de lo apostado.
* Pokédex: ≈ 27 % del total en un mes para cualquiera de los tres, porque lo que limita es la recompensa diaria, no el juego.
* Una legendaria concreta con 3 destacadas (sin Master Ball): **341 tiradas de media (51.150 monedas), mediana 234, percentil 90: 790**. Con los ingresos de un casual perfecto (≈ 2.500/día) son ≈ 20 días; con los de la simulación (≈ 1.500/día, entra el 90 % de los días) ≈ 5 semanas.
* Completar la Pokédex solo con tiradas ×10 (banner permanente y promocional al 50 %, fabricando con polvo), media de 6 partidas: **50 % → 940 tiradas, 90 % → 5.450, 99 % → 11.000, 100 % → 14.400** (antes 860 / 4.200 / 10.100 / 13.800, con ingresos el doble de altos).

Cada ejecución es aleatoria (los números varían unos pocos %).

## Bucles de monedas revisados (todos con test)

| Bucle | Resultado | Test |
|---|---|---|
| Fabricar → liberar | fabricar cuesta ≥ 10 × el polvo que devuelve liberar | `bucle crear → liberar` |
| Tienda → vender al PNJ | los PNJ compran a ≤ 50 % del precio de tienda y venden a ≥ el 100 % | `bucle tienda → PNJ` |
| Tirar → liberar o vender al PNJ | ≤ ≈ 66 % del coste en el caso imposible de que todas sean repetidas | `bucle gacha → liberar/vender` |
| Caramelo Raro → copia → liberar/vender | imposible: las estrellas de caramelo están ligadas | `bucle Caramelo Raro` |
| Huevo Misterioso → cosméticos → vender al PNJ | abrir vale ≈ 370, el PNJ pide ≥ 900 por un huevo | `bucle Huevo Misterioso` |
| Crear/cancelar duelos para ganar XP | 0 XP | `los duelos no dan XP` |
| Duelos amistosos entre cuentas gemelas | XP fija ≤ 400 al día | `los duelos no dan XP` |
| Jugar a un juego de baja ventaja con bonus y niveles | devolución total < ventaja en todos los juegos | `la XP es proporcional…`, `el bonus de un día…` |
| Joy | ≤ 1.000 monedas al día | `Joy` |
| Regalos del ×10 | ≤ 20 % del coste (Master Ball ≤ 0,5 %) | `regalos del ×10` |
| Ningún PNJ compra más caro de lo que vende | cap < suelo en todos los artículos | `ningún PNJ compra…` |

## Decisiones y límites

* **Video Póker y Blackjack se quedan en ≈ 99,5 %** (como se pidió) y, en cambio, se recortó todo lo que les devolvía dinero (niveles y bonus). Es la decisión con más consecuencias para el jugador: el compañero ya no regala dinero cuando apuestas poco en una mesa de baja ventaja.
* **La Pokédex completa son ≈ 14.400 tiradas (≈ 2,2 M de monedas)**, es decir, más de dos años con los ingresos de un jugador casual perfecto (≈ 4 con los de la simulación). El objetivo «meses» solo se cumple para el 50 % (≈ 940 tiradas, 2-3 meses) y el 90 % (≈ 5.400, un año). Se mantiene: son los pesos pedidos (fases 2 y 3 × 0,25 y × 0,06) y los jugadores intercambiarán duplicados en el Mercado; cuando exista la evolución con caramelos habrá que revisarlo.
* **Un casual realista** (entra el 90 % de los días y completa las misiones que le salen) gana ≈ 1.500 monedas/día en la simulación, no las 2.500 del máximo teórico: una legendaria concreta le cuesta ≈ 5 semanas, un jugador perfecto la consigue en ≈ 3.
* **Voltorb**: la calibración está hecha con la mejor estrategia que se ha podido programar (inferencia exacta); un jugador aún mejor (un solver con planificación completa) podría pasar del 92 %, aunque por debajo del 100 % con margen.
* **Límites de la simulación**: los arquetipos solo juegan los juegos de un jugador; no hacen misiones de Mercado, duelos, póker ni Crash, ni usan el Mercado entre jugadores. Las 3 misiones del día se completan solo si el juego del día las cumple.


## Evento «Megaevolución» (server/mega.js, test/mega.test.js)

Reglas de diseño: **no se crea ninguna moneda** y cada fuente nueva está acotada.

| Pieza | Valor | Por qué es segura |
|---|---|---|
| 💠 por jugar | 1 por 200 monedas apostadas (cualquier juego salvo duelos y póker; también Gacha y Máquina con monedas) | tope **150 💠/día** ya con multiplicadores (combo ×2 máx., Hora Mega ×2, Ráfaga ×2); duelos y póker se excluyen porque se podrían granjear sin riesgo contra una cuenta gemela |
| Misiones | 3 × 15 + 25 de bonus = 70 💠/día | cantidades fijas |
| Racha de entrada | 10, 10, 15, 15, 20, 25, 40 (135 en la semana) | fija |
| Máximo teórico de la edición | ≈ 1.675 💠 ganados (7 × 220 + 135) | hitos del pase: 40, 120, 250, 400, 600, 850, 1.200 |
| Pase | Tickets (6), Huevos (2), Marco, Dorso, título, 1 Master Ball, 1 megapiedra a elegir | **solo objetos, nunca monedas**; valorados a precio de liquidación (NPC) ≈ 2.000-3.000, frente a ≥ 7 días de jugar con pérdida esperada |
| Fabricar | 100 💠 | un jugador al tope consigue ≈ 1,5 megapiedras al día |
| Máquina | 10 💠 o 300 monedas | tabla única, 10.000 pesos: Nada 39,55 %, Pareja 30 % (+6 💠), Trío 16 % (+18 💠), Ráfaga 7 % (+8 💠 y ×2 en 15 jugadas), Ticket 3 %, Huevo 2,5 %, Súper Mega 1,2 % (+50 💠), Cosmético 0,5 %, Megapiedra 0,15 %, **Bote 0,1 %** |
| Fragmentos devueltos por la Máquina | EV = 5,84 💠 por 10 (58 %) en fragmentos puros | los 💠 que da la Máquina **no cuentan** para hitos ni ranking: girar no los hace crecer |
| Tirada con monedas | 300: 150 al Bote, 150 se queman | sumidero del 100 % del coste menos lo que vuelve por el Bote |
| Bote Mega | solo lo financian tiradas con monedas; tope 60.000 (el exceso se quema); sin semilla | EV en monedas por tirada = 0,001 × bote ≤ **60 < 300**: nunca es +EV; conservación: carteras + Bote + quemado = constante (test aleatorio de 4.000 giros) |
| 💠 → monedas | **única vía: el Bote** (que sale de monedas de otros jugadores) | no hay conversión directa ni NPC que compre fragmentos |
| Megapiedras en el Mercado | cap 1.500 / suelo 9.000 en `npc.bounds` (cap < suelo), pero **inertes**: los NPC no las compran ni venden | un NPC que comprara una piedra de 100 💠 (≈ 600 monedas de pérdida esperada jugando, ≈ 150 con ×4 de multiplicadores) pagaría más de lo que cuesta producirla: por eso no las tocan |
| Cosméticos del evento | `event: true`: no salen de Huevos Misteriosos ni los comercian los NPC | |
| Compañero Mega | +1 % al bonus | cae bajo los mismos topes diarios (fijo y «de sala») |

Podio final (≥ 100 💠 ganados): 1.º Marco Mega + título + megapiedra a elegir; 2.º Dorso Megapiedra + megapiedra al azar; 3.º Marco Mega + megapiedra al azar. Los hitos alcanzados y sin reclamar se entregan solos al terminar.


## Desafío Pokémon (server/games/quiz.js, test/quiz.test.js)

Juego de habilidad con apuesta progresiva (como Minas): cada acierto sube el multiplicador, un fallo o quedarse sin tiempo pierde la apuesta y te retiras entre pregunta y pregunta. El RTP depende de **cuánto aciertas**, así que el multiplicador se calcula para una precisión supuesta de un fan **experto** en cada dificultad (`DIFFS[d].acc`).

**Escalera.** Tras `k` aciertos seguidos: `multiplicador(k) = máx(1, ⌊100 × 0,94 / acc^k⌋ / 100)`, con tope ×50. Un experto que se retira tras `k` aciertos devuelve `acc^k × multiplicador(k) ≤ 0,94`; con **objetivo de racha** (3/5/10/15, cobro automático al alcanzarlo) el multiplicador lleva un +3 %: `0,94 × 1,03 = 0,968 < 0,97`. El único valor de `k` donde el máximo se queda en `0,95` (Fácil, `k = 1`) es porque el multiplicador no baja de ×1. `test/balance.test.js` y `test/quiz.test.js` comprueban que **ningún** `k` ni objetivo supera `BAL.RTP.quiz = 0,97` y simulan partidas con el código real (peek de la respuesta con probabilidad `acc`).

| Dificultad | Tiempo | Opciones | Precisión supuesta | Racha máx. | Escalera ×(k) | Mejor retirada del experto | Casual (−15 pts) |
|---|---|---|---|---|---|---|---|
| Fácil | 20 s | 4 | 95 % | 10 | 1,00 · 1,04 · 1,09 · 1,21 (k=5) · 1,56 (k=10) | 95,0 % (k=1); 96,0 % (objetivo 3) | 80,0 % |
| Normal | 15 s | 4 | 85 % | 15 | 1,10 · 1,30 · 1,53 · 2,11 (k=5) · 4,77 (k=10) · 10,76 (k=15) | 94,0 % (k=15); 96,8 % (objetivo 15) | 77,0 % |
| Difícil | 12 s | 6 | 70 % | 12 | 1,34 · 1,91 · 2,74 · 5,59 (k=5) · 33,27 (k=10) · ×50 (k=12) | 94,0 % (k=9); 96,8 % (objetivo 10) | 73,7 % |
| Maestro | 10 s | 6 | 50 % | 6 | 1,88 · 3,76 · 7,52 · 15,04 · 30,08 · ×50 (k=6) | 94,0 % (k=1); 96,8 % (objetivo 5) | 65,8 % |

* **Tope de pago**: ×50 como máximo y, por ronda, `20 × maxBetFor(user)` (`capped` en la respuesta). La racha máxima por dificultad corta la escalera donde Difícil y Maestro ya rozan ×50 (y Fácil/Normal no superan ×1,56/×10,76): al llegar a ella se cobra solo.
* **XP y bonus**: `BAL.RTP.quiz = 0,97` → ventaja ≥ 3 %: XP = 2,5 × 0,03 = **0,075 por moneda** apostada (`hub.takeBet`), y el bonus de compañero entra en los mismos topes diarios que Minas (`accrueBonus` usa la ventaja de `quiz`). `test/balance.test.js` incluye `quiz` en los invariantes de XP y de bonus.
* **Preguntas**: 12 generadores sobre la Pokédex real (tipo, tipo secundario, «cuál NO es de tipo», comparar estadísticas, región/generación, evoluciones en los dos sentidos, número de Pokédex, línea de estadísticas, doble tipo, eficacia de tipos con `CHART`, inmunidades, ×4) + un banco de ~75 curiosidades de fans escritas a mano (`quizdata.js`, 4 niveles de dificultad). Cada pregunta se **construye con una sola opción correcta y se verifica** (`assemble`): `test/quiz.test.js` genera 2.000 preguntas por tipo. «¿Quién es ese Pokémon?» acepta nombres sin tildes ni mayúsculas ni signos y, desde 6 letras, una errata (Levenshtein ≤ 1); escribir el nombre exacto de otro Pokémon nunca se perdona (Nidorina ≠ Nidorino).
* **Antifraude**: la pregunta, la respuesta, el plazo y las opciones barajadas viven en `user.games.quiz`; al cliente solo llegan el enunciado, las opciones y los milisegundos restantes. El plazo se controla en el servidor (+1 s de margen de latencia, +1 s más si hay imagen); quedarse sin tiempo, aunque no se vuelva a contestar, pierde la ronda. No hay cobro ni nueva pregunta mientras hay una en juego (no se puede ver la pregunta y luego retirarse: eso sería selección adversa que rompería el RTP). Las imágenes se sirven por `/api/quiz/img/<token>` (el servidor descarga el *official artwork*, lo guarda en caché, y genera **la silueta o el recorte en el propio servidor**; el token no contiene el número). Mínimo 250 ms entre acciones y el límite de eventos del socket.

**Límite conocido (lo importante).** Como toda escalera geométrica, el RTP crece rápido si aciertas **más** de lo supuesto: con `+5` puntos de precisión el mejor plan devuelve ≈ 145 % (Fácil), 228 % (Normal), 201 % (Difícil) y 156 % (Maestro), y alguien que acierte el 99 % (por ejemplo buscando las respuestas) ganaría muchas veces la apuesta. Lo mitigan los tiempos cortos, que el modo de escribir y Maestro no tengan opciones que buscar a ciegas, el tope de pago por ronda (20 × límite de apuesta), la racha máxima por dificultad y el tope ×50; pero **no se elimina**. Si se detectara abuso, las medidas siguientes son baratas: precisión efectiva por jugador (ajustar la escalera con su acierto histórico), reducir el límite de apuesta del juego o quitar Fácil/Normal con rachas largas.

### Desafío Pokémon: escalera personal (revisión)

La escalera fija (`0,94 / acc^k`) dejaba ganar a quien acierta más de lo supuesto: con +5 puntos de precisión
devolvía 145–228 %, y buscando las respuestas, aún más. Ahora cada jugador tiene su propia escalera por modo y
dificultad, calculada con una estimación prudente de su precisión real:

- se empieza suponiendo un experto (≥ 90 %, peso de 8 preguntas), y la estimación es media + 2 desviaciones + 1 punto;
- nunca baja de la precisión supuesta de la dificultad (quien falla más que eso juega con la escalera original);
- la escalera de cada ronda se fija al empezarla.

`test/quiz.test.js` simula 400 rondas por dificultad con jugadores del 99 % y de la precisión supuesta + 10 puntos,
con el mejor punto de retirada para cada uno: el retorno esperado queda por debajo del 100 % en todos los casos.
Coste: un jugador honrado muy bueno ve multiplicadores algo más bajos (≈ 85–90 % de retorno) y los primeros
partidos de cualquiera empiezan con multiplicadores prudentes, que suben a medida que juega.

## Ajuste «casual» (28-10-2026)

El casino es una experiencia casual: los topes diarios molestaban más de lo que protegían. Lo que impide sacar
monedas de la nada son las cotas de precio (los NPC nunca pagan más que liberar el duplicado; comprarles y
revenderles siempre pierde) y las ventajas de la casa, no los topes diarios, así que se relajan:

| Qué | Antes | Ahora |
|---|---|---|
| Vender a NPC al día | 3 por artículo · 1.500 + 100 × nivel | 10 por artículo · 5.000 + 500 × nivel |
| Comprar a NPC al día | 5 por artículo | 20 por artículo |
| Gasto diario de cada NPC | 15 % de su tesorería | 30 % |
| Enfermera Joy | 500 cada 12 h | 1.000 cada 4 h (si tienes < 200) |
| Recompensa diaria | 500 + 100/día (máx. 1.100) | 1.000 + 150/día (máx. 1.900) |
| 💠 del evento Mega por jugar | 150 al día | 300 al día |

Ingreso de un casual con todo hecho ≈ 3.300 monedas/día; una legendaria concreta sigue costando ≈ 2–3 semanas.

## NPC más interesantes: precios justos, encargos y ofertas flash (28-10-2026)

Petición: que los comerciantes sean menos «casa de empeños», más divertidos y un buff claro para los jugadores,
sin chat lleno de mensajes y sin grifos de monedas. Todos los invariantes de `server/npc.js` siguen en `test/npc.test.js`.

### Precios (antes → después)

| Artículo | Suelo de venta antes | Suelo ahora | Tope de compra antes | Tope ahora |
|---|---|---|---|---|
| Pokémon C / U / R / E / L / M | 150 / 400 / 1.200 / 4.000 / 15.000 / 30.000 | **90 / 200 / 500 / 1.500 / 9.000 / 18.000** | 90 % del valor de liberar (18 / 43 / 108 / 288 / 900 / 1.800) | **100 %** (20 / 48 / 120 / 320 / 1.000 / 2.000) |
| Variocolor | ≥ 4 × normal | **máx(3 × suelo normal, 2,5 × tope variocolor)** | 3 × normal | 3 × normal (= su valor de liberar) |
| Cosméticos C / U / R / E / L | 250 / 600 / 1.500 / 4.500 / 15.000 | **150 / 350 / 900 / 2.700 / 9.000** | 60 / 150 / 400 / 1.200 / 4.000 | **69 / 172 / 450 / 1.350 / 4.500** |
| Master Ball | 12.000 | **9.000** | 2.000 | 2.300 |
| Amuleto Iris | 3.000 | **6.000** | 500 | 575 |
| Huevo Misterioso | 900 | **600** | 150 | 172 |
| Objetos de tienda | = precio de tienda | máx(precio, 2 × tope) (≥ tienda) | 50 % del precio | **57,5 %** del precio |
| Polvo estelar | 9 | 8 | 3 | 3 (≤ tipo de cambio − 1: nunca el cambio exacto) |

* **Invariante nuevo:** suelo ≥ 2 × tope de compra para TODOS los artículos (antes ≥ 3 ×), también con el precio flash
  (80 % del suelo) y con la prima de encargo (1,5 × tope).
* **Gacha:** Σ probabilidad × tope máximo ≈ **80 monedas por tirada** (≈ 84 con variocolor) frente a 135 que cuesta
  una tirada del ×10: el test exige < 0,75 × 135 = 101 (antes < 0,6 × 135 = 81). El suelo de las legendarias (9.000)
  es ≥ el coste esperado de una legendaria al azar con tiradas sueltas (150 / 0,0175 ≈ 8.571), comprobado en test.
  Los suelos de R (500) y E (1.500) están por debajo del coste de una R/E al azar (1.000 / 2.941) a propósito: se
  vende una concreta (no al azar) y solo en cantidad limitada (restock + 20 uds. al día por artículo).
* **Precio según stock:** `ask = suelo × askMult × clamp(1,15 − 0,1 × uds, 0,8, 1,15)` (más stock → más barato, hasta
  el suelo; menos → más caro, con tope 8 × suelo). Pujas: 90-100 % del tope con demanda (hay jugadores vendiéndolo)
  o con ≤ 1 unidad; 70-85 % si no, y un 4 % menos por unidad a partir de la tercera. Nunca por encima del tope.

### Encargos 📜

* 3-6 al día entre todos los NPC (plan diario al azar; con `NPC_FAST=1` salen a los pocos segundos), 2-6 h de
  duración, máximo 2 activos por NPC. Solo raras, épicas y legendarias normales (Kecleon: R · Bill: R/E · Ginger:
  cosméticos R/E/L · Dorado: L), elegidas por lo que más falta a los jugadores (faltan en su colección, completan
  una colección o se ofrecieron en las últimas 48 h).
* El NPC deja un pedido de compra al precio normal (≤ tope). Quien le vende ese artículo cobra el precio normal
  **más una prima de monedas del 50 % del precio cobrado** (≤ 1,5 × tope) **más un premio que no son monedas**:
  Ticket Gacha, Huevo Misterioso o 💠 Megafragmentos (solo con el evento Mega activo; si acaba antes, tickets).
* **Cotas:** una vez por encargo y jugador, 2 premios (y primas) al día por jugador, solo jugadores elegibles
  (nivel ≥ 3, cuenta de > 24 h). La prima la paga el NPC de su tesorería (cuenta para su gasto diario): son monedas
  que cambian de manos, no se crean. **Prima extra máxima por jugador y día = 2 × 0,5 × tope = 1 × tope** del artículo:
  ≤ 1.000 con Pokémon L, ≤ 320 con E, ≤ 120 con R, y como mucho 4.500 con dos cosméticos L. Es el único caso en que un NPC paga
  por encima de su tope, y el test lo comprueba explícitamente.
* Los premios están valorados (ticket 150, huevo 600, 💠 ≈ 6) y el test exige que `suelo − 1,5 × tope > valor del
  premio` (y con el 80 % del suelo en artículos que pueden estar en oferta flash): comprar a un NPC, venderle de
  vuelta al encargo y cobrar el premio siempre pierde monedas.

### Ofertas flash 🔥

* 1-2 al día: un NPC rebaja un artículo de su stock un 15-25 % durante 1-2 h, nunca por debajo del 80 % del suelo
  (y por tanto siempre por encima de cualquier puja de NPC: invariante `max puja < min venta` con precios flash).
  Solo Pokémon C/U/R/E normales, Huevo Misterioso y Amuleto Iris (no tienda, L/M, variocolores ni cosméticos).

### Reabastecimiento diario

C/U (5-10, como antes) + **2-4 R** + **0-2 E** (con peso ×4 para las especies de colecciones) + una **L no destacada**
de banner con probabilidad 0,5 (≈ 1 cada 2 días, al NPC Dorado) + 1-2 Huevos. Nunca míticos, variocolores, Master Ball
ni megapiedras. Crea objetos, no monedas, y se venden por encima del suelo (sumidero de monedas).

### Feed y chat

Los NPC **nunca escriben en el chat**. En el feed «En vivo» solo aparecen anuncios de encargos (máx. 3) y ofertas
flash, **4 líneas al día en total**; las operaciones con NPC ya no generan línea de feed.

## Fase B2 · Repetidos y reciclaje: caramelos, evolución, Milagroso, reciclaje (server/candy.js, test/candy.test.js)

Ninguna acción de esta fase crea monedas. Los caramelos no se pueden vender ni tienen valor en monedas; el polvo que dan las acciones es el de liberar (o menos).

| Mecánica | Números |
|---|---|
| Caramelos por familia evolutiva | Tirada de gacha: +1 (+3 si la especie es nueva). Transferir un ejemplar (da además el mismo polvo que liberar): C 3 · U 4 · R 6 · E 10 · L 20 · M 25 |
| Subir nivel (5 → 100) | Nivel N → N+1 cuesta ⌈N/10⌉ caramelos de la familia. 5 → 50 = 141; 5 → 100 = 536. Efecto en duelos: ×(1 + 0,001 × (Nv − 5)): Nv. 100 ≈ +9,5 %; los ejemplares de nivel 5 no cambian |
| Evolución | Fase 2: 25 caramelos y Nv. 16; fase 3: 100 caramelos y Nv. 36. Si evolucionar sube la rareza (p. ej. Magikarp C → Gyarados E), el coste sube a ⌈polvo extra / 1,5⌉ (hasta 50). Destinos L/M: ×4. Hace falta otra copia de la especie origen (se conserva su entrada en la Pokédex) y que el destino tenga < 5 estrellas. El ejemplar conserva IVs, naturaleza, mote, nivel, amistad, favorito, variocolor y compañero. No hay piedras de evolución en `items.js`, así que no hay evolución por piedra |
| Entrenar IV | +1 IV (máx. 31) = 2 caramelos; 10 entrenamientos al día por ejemplar |
| Intercambio Milagroso | 3 al día; una copia sobrante (ni favorita, ni compañero, ni variocolor, ni mítica) por una copia aleatoria de la misma rareza (pesos de fase del gacha; las L excluyen las destacadas de los banners activos; solo especies con < 5 estrellas) |
| Reciclaje | Solo objetos con precio de tienda: 40 % del precio / 4 monedas por ✦ (Ticket 15 ✦, Huevo Suerte 30 ✦, Moneda Amuleto 40 ✦, Caramelo Raro 90 ✦). En monedas son 60 de 150, 120 de 300, 160 de 400 y 360 de 900: siempre < precio. Tope 300 ✦ al día, por si un objeto se compra barato en el Mercado |

**Por qué no hay arbitraje de polvo.** Transferir da ≥ 5/3 ≈ 1,67 ✦ por caramelo (el peor caso, las Comunes) y evolucionar da como máximo 1,5 ✦ extra por caramelo gastado al liberar el resultado. Es decir, los caramelos de una evolución costaron siempre más polvo (transfiriendo las copias que los dan) del que la evolución añade. `test/candy.test.js` lo comprueba para las 484 evoluciones. Sin la subida de coste por rareza, Magikarp → Gyarados (+75 ✦ por 25 caramelos = 3 ✦/caramelo) sí habría sido rentable.

**Tiempo para completar la Pokédex (estimación).** Simulación aproximada (`banner permanente, 20 tiradas al día, fabricando con polvo`; el Milagroso se modela como 3 especies nuevas al día el 70 % de los días y la evolución como gratis si hay caramelos suficientes; es optimista porque ignora el requisito de copia sobrante):

| | 50 % | 90 % | 99 % | 100 % |
|---|---|---|---|---|
| Solo tiradas y fabricar (antes) | ≈ 50 días | ≈ 290 | ≈ 590 | ≈ 780 (≈ 15.700 tiradas, coherente con las 14.400 de arriba) |
| Con caramelos, evolución y Milagroso | ≈ 36 días | ≈ 160 | ≈ 310 | ≈ 470 |

El 100 % pasa de ≈ 2 años a ≈ 15 meses para quien tira 20 veces al día: los Pokémon de fase 2 y 3 (que casi no salen) se consiguen evolucionando y el Milagroso reparte las últimas especies. Sigue siendo un objetivo de más de un año; no se ha tocado ningún número por esto.

## Fase B3 · Personalidad y vínculo: amistad, hallazgos del compañero y Huerto (server/bond.js, test/bond.test.js)

La única fuente nueva de monedas de toda la fase es el hallazgo del compañero: **máximo +200 monedas al día por jugador** (motivo `buddy` en el registro). Todo lo demás (amistad, bayas, caramelos) no tiene precio en monedas.

| Mecánica | Números |
|---|---|
| Amistad | 0-255 por ejemplar (70 al obtenerlo). Compañero: +1 por cada 1.000 monedas apostadas (tope +20/día; los duelos no cuentan). Bayas: +5/+10/+10/+15/+20 (tope +60/día por ejemplar). Ganar un duelo: +3 (5 victorias al día). Máximo teórico por ejemplar y día: +95 |
| Efecto | Amistad ≥ 220 («Te adora»): +3 % a PS, ataque, defensa y velocidad en duelos (menos que el +9,5 % del nivel 100). Corazones 0-5 y etiqueta: Indiferente (< 100), Amistoso, Muy amistoso (≥ 160), Te adora |
| Evolución por amistad | 18 evoluciones (Pichu → Pikachu, Cleffa, Igglybuff, Golbat, Chansey, Eevee → Espeon/Umbreon, Togepi, Azurill, Budew, Buneary, Chingling, Riolu, Munchlax, Woobat, Swadloon, Código Cero, Snom). Con amistad ≥ 220: sin nivel mínimo y la mitad del coste base (25 → 13, 100 → 50). Se mantiene el suelo por subida de rareza (≤ 1,5 ✦ de polvo extra por caramelo), así que el argumento de «no hay arbitraje de polvo» de B2 sigue valiendo (`test/bond.test.js` lo comprueba). Espeon y Umbreon solo salen por amistad; el resto admite también la vía normal |
| Hallazgos del compañero | Uno cada 4 h reales (sin conexión), máximo 3 acumulados (12 h; lleno, el contador se para). Premio: caramelos de su familia 2-5 (60 %), 1-2 bayas (≈ 24-30 %), 10-40 ✦ (≈ 8-12 %, tope 40 ✦ al día) o 1 Ticket Gacha (≈ 2-5 %, máximo 1 al día), más 20-80 monedas **con tope de 200 al día**. La amistad solo mejora los pesos de baya, polvo y ticket |
| Huerto | 4 parcelas. Planta 1 baya y da 2-4 bayas de la misma clase: Aranja 4 h, Frambu 6 h, Zidra 8 h, Latano 10 h, Pinia 12 h. Regar una vez quita el 25 % del tiempo que falta. Regalo inicial: 3 Bayas Aranja |
| Bayas | No están en `ITEMS`: no se compran, no entran en el Mercado ni las comercian los NPC. Reciclar da 1 ✦ por baya con un tope de 20 ✦ al día (dentro de los 300 ✦ del reciclaje general), es decir, ≤ 80 monedas al día en el peor caso si se cambia el polvo |

**Coste máximo diario en valor de monedas por jugador (techo teórico):** hallazgos 200 monedas + ticket 150 + polvo 40 ✦ (160 monedas) + bayas recicladas 20 ✦ (80 monedas) ≈ 590 monedas equivalentes, siempre que se abra la app cada 4 h; en la práctica (3 hallazgos si se conecta 2 veces al día, ≈ 150 monedas de media) es mucho menos. Para comparar: la recompensa diaria y las misiones ya dan más, y el tope de bonus del compañero es de 300 + 50 × nivel.

## Fase B7 · Combates Showdown: Liga de entrenadores y PvP (server/showdown.js, test/showdown.test.js)

Combates reales con el simulador oficial de Pokémon Showdown (individuales y dobles). Los «Duelos rápidos» de siempre (`server/games/duel.js`) no cambian.

| Mecánica | Números |
|---|---|
| Liga (CPU) | Victoria: **20 / 30 / 40 / 50 / 65 / 80 monedas** según la fuerza del rival (novato, ruta, medio, veterano, líder de gimnasio, campeón), motivo `battle` en el registro. **Máximo 10 victorias premiadas al día → techo de 10 × 80 = 800 monedas/día** (la recompensa diaria base ya son 1.000 y el techo realista, con rivales de ruta, es de 200-400): se queda en «casual» y por debajo de lo que paga el casino por jugar. Perder no cuesta nada. |
| Resto del premio CPU | Mismo tope de 10 victorias/día: +2 caramelos de cada familia que participó (≤ 6 familias → ≤ 120 caramelos/día en el peor caso, menos que 3 tiradas de gacha diarias valen en caramelos de especies nuevas), +2 de amistad por participante (tope +10/día por ejemplar, `bond.js`), 15 XP fija (dentro de los 400 XP/día). |
| PvP | Apuesta opcional igual para los dos, dentro de `maxBet`. Se cobra al crear el reto (depósito `escrow`) y al aceptar; el ganador cobra el bote menos el **5 % de comisión** (0 % en el evento de duelos); empate, cancelación, caducidad (10 min), fallo del simulador o reinicio del servidor: **devolución íntegra**. Sin bonus de compañero (`noBonus`), como los duelos. Cuenta como duelo para estadísticas y misiones. |
| Zero-sum | Un combate PvP no crea monedas: `suma antes = suma después + comisión`, con test. |
| Simultáneos | Máximo 8 combates a la vez (`SD_MAX_BATTLES`): el simulador pesa ~130 MB de RSS cuando se usa y la instancia gratuita tiene 512 MB. El simulador se carga solo al empezar el primer combate. |
| Turnos | 60 s por turno; al agotarse se elige «default»; 3 tiempos agotados seguidos = derrota por inactividad. |

## Progresión casual: completar la Pokédex y maxear un Pokémon sin cientos de horas (server/gacha.js, candy.js, bond.js, pokedex.js · test/progression.test.js)

Petición del dueño: «completar la Pokédex y maxear un Pokémon no debe costar cientos de horas; el casino es casual, pero sin abusar de las mecánicas para sacar una ventaja considerable». Se mantienen los topes diarios de monedas y todos los invariantes anti-faucet; lo que cambia es **cuánto cuesta cada cosa en tiempo**.

**Jugador de referencia.** ≈ 1 hora al día. Ingresos = recompensa diaria (racha 7) + Ticket + tirada gratis + 3 misiones + bonus de misiones ≈ 3.300 monedas; menos lo que se pierde jugando una hora (≈ 15.000 apostadas × ventaja × 70 %) y a 135 monedas por tirada de un ×10: **22 tiradas al día** (`test/progression.test.js` lo calcula con las constantes).

**Objetivos** (1 h/día: «días» = «horas»):

| | Antes | Después | Objetivo |
|---|---|---|---|
| Pokédex núcleo (C/U/R/E = 931 especies) | ≈ 280-360 días | **≈ 33 días** | ≤ 5 semanas |
| Pokédex completa (1.025, con 94 L y M) | ≈ 400-470 días | **≈ 97 días** | cola larga de legendarios, ≤ ≈15 semanas |
| Especies al día 35 | ≈ 600 | **≈ 957** | ≥ 90 % |
| Maxear Común / Poco común | > 20 días (límite de 10 entrenamientos al día) | **≈ 2 días** | 1-2 h |
| Maxear Rara / Épica | > 20 días / > 100 | **≈ 2 / ≈ 4,5 días** | 3-5 h |
| Maxear Legendaria / Mítica | > 100 días / > 200 | **≈ 7,5 / ≈ 15 días** | 8-12 h |

«Maxear» = 5★ (5 copias, como siempre; ahora fabricar una copia es barato) + Nv. 100 + los 6 IV a 31 + amistad 255. El tiempo es el del recurso más lento: polvo para las copias, caramelos para nivel e IV (media de 93 IV por entrenar), tope diario de entrenamientos y amistad.

### Palancas y cambios

| Palanca | Antes → después | Por qué |
|---|---|---|
| **Sesgo de Pokédex** (`gacha.TUNING.dupKeep`) | – → 0,08 | Dentro de la rareza ya sorteada, una especie que ya tienes solo se acepta con probabilidad 0,08 (muestreo por rechazo: su peso ×0,08). No cambia las rarezas, el EV de la tirada, ni el 50 % de los destacados (se aplica dentro de cada rama). Sin pity: cada tirada sigue siendo aleatoria, solo que repetir es raro. El Intercambio Milagroso pesa igual |
| Pesos por fase | 0,25 / 0,06 → 0,12 / 0,03 | Las evoluciones son baratas, así que se tiran aún menos las formas finales |
| Probabilidad L / M | 1,75 % / 0,25 % → 2,5 % / 0,5 % (C 49,6 → 48,6 %) | Sin esto los 94 L y M son una cola de ≈ 1 año. El polvo de L y M baja a la par, así que el EV de una tirada no sube |
| Polvo por duplicado L / M | 250 / 500 → 170 / 320 | Compensa lo anterior: Σ prob × polvo ≈ 20,4 (antes 20,1) |
| Fabricar (polvo) C/U/R/E/L/M | 60/150/400/1.200/4.000/8.000 → **15/36/90/240/400/800** | 3 duplicados de su rareza (2,3-2,5 en L y M) en vez de 10-16. Sigue sin salir a cuenta: ver invariantes |
| **Primera evolución a una especie nueva** | exigía copia sobrante, Nv. 16/36 y 25/100 caramelos (más suelo por rareza) → **8 / 18 caramelos, sin nivel, sin gastar la copia de origen** | Sin esto, 484 especies evolucionadas necesitarían ≈ 1.600 copias en total (más que las tiradas del mes). Solo se da **una vez por especie y cuenta** (`u.evoReg`, aunque vendas la copia) y la copia resultante es la última de su especie (no se libera ni se vende por la regla de conservar una). Las evoluciones repetidas siguen gastando copia de origen y llevan suelo ⌈ganancia de polvo / 0,5⌉ |
| **Caramelos comodín** (`u.candy['*']`) | – → +5 por tirada y +2…+15 por ejemplar transferido (C 2 · U 3 · R 4 · E 6 · L 12 · M 15) | Valen para cualquier familia (se gastan después de los de la familia). Sin ellos, la mayoría de las familias nunca reúnen caramelos para evolucionar o subir su Pokémon favorito. El cliente ve «familia + comodín» en cada familia |
| Caramelos de familia | tirada 1 (+3 nueva) → 2 (+5 nueva) | |
| Subir nivel | ⌈N/10⌉ → ⌈N/50⌉ por nivel | Nv. 5 → 100: 536 → **144** caramelos (5 → 50: 141 → 45) |
| Entrenar IV | 2 caramelos, 10 al día → **1 caramelo, 60 al día** | Antes llevaba ≥ 10 días solo por el tope diario |
| Intercambio Milagroso | 3 → 5 al día | Cada uno es casi siempre una especie nueva |
| Amistad | compañero +1 por 1.000 apostadas (tope 20) → **por 500 (tope 30)**; bayas tope 60 → **100** al día | De 70 a 255 en ≈ 2 días |

### Invariantes (ninguno se ha eliminado; los umbrales cambiados están en `test/balance.test.js`)

* **Polvo y monedas.** Cambiar polvo sigue pagando 4 monedas y un PNJ compra a como mucho 4 monedas por ✦ del duplicado (`npc.maxBid`). Una tirada con todo repetido devuelve ≈ 103 de 150 monedas (≈ 69 %, test `bucle gacha → liberar/vender`, límite 0,7). Fabricar una especie y venderla a un PNJ devuelve < 50 % de su coste en monedas (nuevo en `bucle crear → liberar`; el factor 10 pasa a 2,3).
* **Caramelos → evolución → liberar** (nuevo test): con el máximo de caramelos por tirada (≈ 17,7 en el peor caso) y ≤ 0,5 ✦ por caramelo en evoluciones repetidas, el peor caso total es ≈ 139 de 150 monedas (< 95 %). Los caramelos no se pueden vender, comprar ni comerciar.
* **Evolución gratuita no imprime copias**: una vez por especie y cuenta; la copia nueva es la única de su especie. `test/progression.test.js` lo comprueba (liberar falla; vender la copia y repetir exige copia sobrante).
* Los PNJ, el Mercado y los topes diarios de monedas (recompensa diaria, misiones, hallazgos 200/día, Liga 800/día…) no se han tocado; el Intercambio Milagroso y el sesgo no crean valor (misma rareza). Los Caramelos Raros siguen ligados.
* Fabricar barato baja el precio de mercado de los Pokémon entre jugadores (no crea monedas: el polvo viene de duplicados); el suelo de los PNJ no cambia.

### Cómo se mide (`test/progression.test.js`, < 10 s)

* Ingresos y tiradas/día desde las constantes (22).
* Cinco partidas simuladas con el código real del gacha (`rollRarity`, `rollPokemon`, `grant`, `evoCost`): tira, evoluciona por primera vez lo que puede, usa el Milagroso, transfiere sobrantes y fabrica lo más barato. Media: núcleo ≈ 33 días (límite del test 38), completa ≈ 97 (límite 115), ≥ 90 % de la Pokédex al día 35.
* Maxear por rareza: modelo de recursos por día (polvo con el 60 % de tiradas repetidas, solo caramelos comodín, IV medios 93, amistad con las bayas al 70 % del tope). Resultados en la tabla de arriba.
* El sesgo no cambia las rarezas ni los destacados; la evolución gratuita es única.

### Combates y redespliegues
Cada combate en curso se guarda en `db.data.sdBattles` (semilla explícita + registro de entradas); al arrancar se reconstruye reescribiendo las entradas en un simulador nuevo (sin que la IA ni los temporizadores actúen sobre peticiones antiguas) y el turno de los humanos recibe 60 s extra. Los depósitos de PvP (`escrow btl:*`) no se devuelven en el arranque mientras exista el combate guardado; si el registro está dañado o es de otra versión del simulador, se devuelven desde el propio depósito. Abandono: 15 min sin elegir = derrota (en PvP el rival cobra el bote).
