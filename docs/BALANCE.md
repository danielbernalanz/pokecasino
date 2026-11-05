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
| 12 | Precios de la tienda | Huevo Suerte 1.200, Moneda de la Suerte 2.500 | 300 y 400 (valen mucho menos de lo que costaban) |

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
2. **Bonus** de compañero (0-10 % + estrellas), colecciones (+1 % cada una, máx. 8 %) y Moneda de la Suerte (+10 %) sobre las **ganancias netas**.
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
* **Bonus con tope «de sala»**: cada apuesta suma a una bolsa diaria `apuesta × ventaja × 0,30` (0,45 con Moneda de la Suerte, ×1,25 el fin de semana del Compañero); el bonus pagado en un día no supera esa bolsa ni el tope fijo. En el peor caso (Amuleto + fin de semana + Huevo Suerte permanentes) la devolución total es 0,56 + 0,38 = **94 % de la ventaja**: por debajo del 100 % en todos los juegos. `test/balance.test.js` lo calcula juego a juego.
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
| Medallas (única vez) | 1.000 × n (36.000) + Campeón 25.000 | 500 × n (18.000) + Campeón 10.000 | 61.000 → 28.000 (las medallas ahora se ganan venciendo a los líderes; los premios no cambian) |
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
| Moneda de la Suerte | +10 % de ganancias netas y bolsa de bonus del 45 % en lugar del 30 % durante 1 h | 2.500 | **400** | beneficio máximo ≈ 0,15 × ventaja × lo apostado en la hora: con 100.000 apostados en Slots ≈ 360 monedas |
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

## Fase B2 · Repetidos y reciclaje: transferir, evolución, Milagroso, reciclaje (server/candy.js, test/candy.test.js)

> **Actualizado el 04-11-2026.** Los caramelos de familia y comodín (subir nivel, evolución y entrenar IV con caramelos) se sustituyeron por el sistema de EXP de los juegos: ver «Progresión como en los juegos» más abajo. Lo que sigue describe lo que se mantiene.

Ninguna acción de esta fase crea monedas. Los Caramelos Exp. no se pueden vender ni tienen valor en monedas; el polvo que dan las acciones es el de liberar (o menos).

| Mecánica | Números |
|---|---|
| Transferir al Profesor Oak | Da el mismo polvo que liberar **más Caramelos Exp.**: C 1 XS (100 EXP) · U 2 XS (200) · R 1 S (800) · E 2 S (1.600) · L 1 M (3.000) · M 2 M (6.000). Se conserva siempre una copia de la especie |
| Evolución | **Sin coste en caramelos**: nivel de los juegos + requisitos especiales (piedras, intercambio, amistad ≥ 160, sexo, hora…). Hace falta otra copia de la especie origen, salvo la **primera** evolución a una especie nueva, que no gasta la copia de origen (una vez por especie y cuenta, `u.evoReg`; la copia nueva es la última de su especie: no se puede liberar ni vender). El destino debe tener < 5 estrellas. El ejemplar conserva IVs, naturaleza, mote, nivel, amistad, favorito, variocolor y compañero |
| Intercambio Milagroso | 5 al día; una copia sobrante (ni favorita, ni compañero, ni variocolor, ni mítica) por una copia aleatoria de la misma rareza (pesos de fase del gacha; las L excluyen las destacadas de los banners activos; solo especies con < 5 estrellas) |
| Reciclaje | Solo objetos con precio de tienda: 40 % del precio / 4 monedas por ✦ (Ticket 15 ✦, Huevo Fortuna 30 ✦, Moneda de la Suerte 40 ✦, Caramelo Raro 90 ✦). En monedas son 60 de 150, 120 de 300, 160 de 400 y 360 de 900: siempre < precio. Tope 300 ✦ al día. Los Caramelos Exp., las Chapas y los objetos de evolución no se reciclan |

**Por qué no hay arbitraje de polvo con la evolución.** Antes lo evitaba el coste en caramelos; ahora lo evita la EXP: ver «Techo de polvo evolucionando y transfiriendo» en la sección nueva (`test/candy.test.js` y `test/progression.test.js` lo comprueban para las ≈ 380 evoluciones «de nivel»).

**Tiempo para completar la Pokédex.** Ver «Progresión casual» y la tabla actualizada en «Progresión como en los juegos».

## Fase B3 · Personalidad y vínculo: amistad, hallazgos del compañero y Huerto (server/bond.js, test/bond.test.js)

La única fuente nueva de monedas de toda la fase es el hallazgo del compañero: **máximo +200 monedas al día por jugador** (motivo `buddy` en el registro). Todo lo demás (amistad, bayas, Caramelos Exp.) no tiene precio en monedas.

| Mecánica | Números |
|---|---|
| Amistad | 0-255 por ejemplar (70 al obtenerlo). Compañero: +1 por cada 1.000 monedas apostadas (tope +20/día; los duelos no cuentan). Bayas: +5/+10/+10/+15/+20 (tope +60/día por ejemplar). Ganar un duelo: +3 (5 victorias al día). Máximo teórico por ejemplar y día: +95 |
| Efecto | Amistad ≥ 220 («Te adora»): +3 % a PS, ataque, defensa y velocidad en duelos (menos que el +9,5 % del nivel 100). Corazones 0-5 y etiqueta: Indiferente (< 100), Amistoso (≥ 100), Muy amistoso (≥ 150), Compañero fiel (≥ 200), Te adora (≥ 220), Vínculo máximo (255); efectos por nivel en «Ampliar la amistad» |
| Evolución por amistad | 18 evoluciones (Pichu → Pikachu, Cleffa, Igglybuff, Golbat, Chansey, Eevee → Espeon/Umbreon, Togepi, Azurill, Budew, Buneary, Chingling, Riolu, Munchlax, Woobat, Swadloon, Código Cero, Snom). Desde el 04-11-2026 **todas** exigen amistad ≥ 160 (como en los juegos actuales; antes solo Espeon y Umbreon) y no cuestan caramelos; sin nivel mínimo |
| Hallazgos del compañero | Uno cada 4 h reales (sin conexión), máximo 3 acumulados (12 h; lleno, el contador se para). Premio: 2-5 Caramelos Exp. XS (60 %), 1-2 bayas (≈ 24-30 %), 10-40 ✦ (≈ 8-12 %, tope 40 ✦ al día) o 1 Ticket Gacha (≈ 2-5 %, máximo 1 al día), más 20-80 monedas **con tope de 200 al día**. La amistad solo mejora los pesos de baya, polvo y ticket |
| Huerto | 4 parcelas. Planta 1 baya y da 2-4 bayas de la misma clase: Aranja 4 h, Frambu 6 h, Zidra 8 h, Latano 10 h, Pinia 12 h. Regar una vez quita el 25 % del tiempo que falta. Regalo inicial: 3 Bayas Aranja |
| Bayas | No están en `ITEMS`: no se compran, no entran en el Mercado ni las comercian los NPC. Reciclar da 1 ✦ por baya con un tope de 20 ✦ al día (dentro de los 300 ✦ del reciclaje general), es decir, ≤ 80 monedas al día en el peor caso si se cambia el polvo |

**Coste máximo diario en valor de monedas por jugador (techo teórico):** hallazgos 200 monedas + ticket 150 + polvo 40 ✦ (160 monedas) + bayas recicladas 20 ✦ (80 monedas) ≈ 590 monedas equivalentes, siempre que se abra la app cada 4 h; en la práctica (3 hallazgos si se conecta 2 veces al día, ≈ 150 monedas de media) es mucho menos. Para comparar: la recompensa diaria y las misiones ya dan más, y el tope de bonus del compañero es de 300 + 50 × nivel.

### Ampliar la amistad: niveles, afecto en combate, caricias y frases (server/affection.js, bond.js · test/bond2.test.js)

Inspirado en el «afecto» de las generaciones 6 y 7. **Contra la CPU (Liga) actúa solo sobre el Pokémon del jugador (regla `Affection`, lado p1). En PvP es una opción del reto («💞 Efectos de amistad», activada por defecto; también en «Buscar rival», donde forma parte de la clave de emparejamiento) y, si está activa, actúa sobre los Pokémon de los DOS jugadores (regla `AffectionBoth`), cada uno según la amistad de los suyos**, así que es justo. Los duelos rápidos no tienen efectos de afecto. Nada crea monedas.

| Nivel (amistad) | Etiqueta | Efectos |
|---|---|---|
| < 100 | Indiferente | Ninguno |
| ≥ 100 | Amistoso | Ninguno (3-4 corazones) |
| ≥ 150 | Muy amistoso | Afecto en combates CPU: aguantar un golpe con 1 PS 5 %, esquivar 5 %, curarse de un estado 10 %, crítico 0 % |
| ≥ 200 | Compañero fiel | Aguantar 10 %, esquivar 8 %, curarse 15 %, crítico 3 % |
| ≥ 220 | Te adora | Aguantar 15 %, esquivar 10 %, curarse 20 %, crítico 5 % · +3 % a las estadísticas en duelos rápidos · +10 % de caramelos, bayas y polvo en expediciones (monedas no) |
| 255 | Vínculo máximo | Aguantar 20 %, esquivar 12 %, curarse 25 %, crítico 8 % (resto como «Te adora») |

* **Cómo se engancha al simulador:** los combates CPU añaden la regla `Affection` al formato (`gen9customgame@@@Species Clause,Terastal Clause,Affection`), registrada en `Dex.data.Rulesets` al cargar el simulador (`affection.js`, `sdmap.ps()`). Showdown la convierte en un pseudo-clima del campo con manejadores `onDamage` (prioridad −50, tras Robustez/Banda Focus), `onTryHit`, `onModifyCritRatio` y `onResidual` (orden 28, tras el daño de quemadura/veneno). Leen `pokemon.happiness` (= amistad del ejemplar) y solo actúan sobre el lado `p1` (el jugador). Todo el azar es `this.randomChance` del simulador, así que el combate sigue reproduciéndose con semilla + registro de entradas: la instantánea guarda `aff: 1` (CPU), `aff: 2` (PvP, ambos lados) o 0 para reconstruir con la misma regla (las instantáneas antiguas, sin `aff`, se reconstruyen sin afecto). Los mensajes de PvP nombran al entrenador del Pokémon rival.
* **Aguantar:** un golpe directo que lo debilitaría lo deja con 1 PS (máximo una vez por Pokémon y combate). **Esquivar:** solo movimientos del rival que pueden fallar. **Curarse:** estados no volátiles (quemadura, parálisis, veneno, sueño, congelación) al final del turno. **Crítico:** golpe crítico seguro en un movimiento de daño. Mensajes en español en `sd-protocol.js` y un corazón sobre el sprite.
* **Retribución / Frustración:** potencia `⌊amistad × 10 / 25⌋` y `⌊(255 − amistad) × 10 / 25⌋` (mínimo 1; máx. 102), la fórmula del simulador. No están en el aprendizaje de la 9.ª generación, así que el vínculo las desbloquea gratis una vez por ejemplar desde la ficha «Vínculo»: Retribución con amistad ≥ 150, Frustración con ≤ 99. La Caja PC muestra la potencia actual según la amistad. (Retribución a 255 es un ataque Normal de 102 sin desventajas, como en los juegos; cuesta llegar al máximo con las bayas, la caricia y los topes diarios.)
* **Acariciar:** una vez al día por ejemplar, +2 de amistad (tope propio `pet`: 2, aparte de bayas 100, compañero 30, duelos 15, combates 10 y expediciones 40). Máximo teórico por ejemplar y día: +97.
* **Frases del Pokémon:** 12 por nivel (8 comunes, 2 de la ficha y 2 del inicio), fijas por ejemplar, contexto y día (sin parpadeo).
* **Botín de expediciones:** cada ejemplar que «te adora» aporta +10 % (repartido entre el equipo) a la EXP, los Caramelos Exp., las bayas y el polvo (con redondeo aleatorio para que cuente en cantidades pequeñas; el polvo sigue topado a 20 al día). **Monedas, MT, materiales, fragmentos y objetos raros no cambian.**
* **Duelos rápidos:** siguen con el +3 % de «Te adora»; no se añadieron efectos de afecto al motor de duelos rápidos (no hay turnos).

## Fase B6 · Expediciones AFK (server/expedition.js, test/expedition.test.js)

Los ejemplares salen de la Caja durante 1, 4, 8 o 12 h reales (1-3 por equipo, 2 expediciones a la vez; la tercera, a nivel de entrenador 15) y vuelven con EXP y un botín. **Nunca dan Pokémon** (ni legendarios ni míticos) y nada se paga por adelantado: la única fuente de monedas es un hallazgo pequeño con tope.

| Recompensa (por expedición de `H` horas) | Número | Tope |
|---|---|---|
| **EXP** de cada participante | `H × (300 + 8 × nivel) × (1,5 si comparte tipo con la zona) × (1,25 a su hora, día/noche) × (1,1 «Te adora») × (1,5 Huevo Suerte)`: a Nv. 50, 12 h = 8.400 | tope diario de EXP por ejemplar (`exp.dayCap`, compartido con los combates): ≥ 24.000 y ≈ 5 niveles a niveles medios |
| Caramelos Exp. | `⌈H/4⌉` tiradas de 1-2 (XS 60 % · S 30 % · M 10 %) | **8 al día** por jugador |
| Caramelo Exp. L | solo 8 h (5 %) y 12 h (12 %) | **1 al día** |
| Huevo Suerte (objeto equipable) | solo 8 h (1 %) y 12 h (3 %) | **1 al día** |
| Pokérus | 1 / 3.000 por participante; contagia dentro del equipo | ver «Pokérus» |
| Bayas | `⌈H/4⌉` tiradas de 1-2 bayas al azar | tope de 999 por baya |
| Polvo estelar | `H…2H` | **20 ✦ al día** por jugador |
| Objeto raro (Ticket Gacha 70 % / Huevo Misterioso 30 %) | solo 8 h (10 %) y 12 h (20 %) | **1 al día** entre los dos |
| Amistad | `5 × H` (vía `bond.addFriend`, fuente `exp`) | **40 al día** por ejemplar |
| Monedas (motivo `expedition`) | `8 × H × (1 + 0,5 × proporción que coincide)`: 12 h con todos coincidiendo = 144 | **300 al día** por jugador |

**Valor máximo diario** (`expedition.dailyMaxValue()`, test): 300 monedas + 20 ✦ × 4 monedas (cambio de polvo) + 1 objeto raro valorado al tope de compra de un PNJ (Huevo Misterioso 172) = **552 monedas equivalentes**, es decir, ≈ 22 % del ingreso diario de un casual (≈ 2.500) y menos que los hallazgos del compañero (590 en el techo teórico). El test comprueba que el tope de monedas se alcanza pero no se supera tras 12 expediciones de 12 h el mismo día, que el polvo y el objeto raro respetan su tope y que no hay ningún otro movimiento positivo en el libro. La EXP ya no es «niveles gratis»: se reparte con la fórmula de arriba y con el tope diario por ejemplar (ver «Progresión como en los juegos»).

**Ejemplares ocupados** (`m.away = 'exp:<id>'`, o `'care'` en el criadero): no se pueden liberar (`pc:release`), transferir (`pc:transfer` y en bloque), intercambiar (Milagroso), evolucionar, regalar ni vender en el Mercado (`gacha.takePoke` y `market.owned` descuentan los ocupados y, si solo quedan copias ocupadas, se rechaza con un mensaje claro), liberar por especie (`gacha.release`) ni llevar a combates o equipos guardados. `specimen.sync` nunca descarta a un ocupado (prioridad +20). El compañero sí puede ir de expedición.

## Fase B5 · Criadero (server/daycare.js, test/daycare.test.js)

Dos ejemplares compatibles (comparten un tipo, o uno es Ditto; sin legendarios, míticos ni familias cuya forma base lo sea) producen un huevo cada **6 h** (**4 h** si son de la misma especie). Recoger el huevo cuesta una tarifa (motivo `daycare`, sumidero); eclosiona con **pasos** (1 por cada 100 monedas apostadas, sin duelos; 50 / 70 / 100 / 150 pasos para C / U / R / E) o, esperando, **12 h** después de recogerlo. Una pareja (la segunda, a nivel de entrenador 20) y como máximo 2 huevos sin eclosionar.

| Elemento | Número |
|---|---|
| Especie del bebé | forma base de la familia de la madre (la hembra, o la primera plaza); con Ditto, la del otro padre |
| Herencia | 3 IV al azar tomados de uno de los padres; naturaleza de un padre con 50 % |
| Variocolor | 1/128 por huevo (1/64 si algún padre es variocolor: «Método Masuda» simplificado) |
| Bebé | ejemplar nuevo Nv. 5 por `gacha.grant` (Pokédex, estrellas; a 5 estrellas solo da polvo) + 1 Caramelo Exp. S |
| Tarifa | `máx(200, ⌈1,2 × reventa esperada⌉)` donde reventa esperada = `polvo × 4 × (1 + 2/64)` (= tope de compra de un PNJ, con la cota alta del variocolor ×3): C 200 · U 200 · R 200 · E 400 |

**No es un grifo de monedas.** El máximo que se recupera de un bebé normal es el tope de compra de un PNJ = el polvo de liberarlo cambiado a 4 monedas (C 20, U 48, R 120, E 320); la tarifa de todas las rarezas (200-400) lo supera, y también la reventa esperada con el variocolor. El test (`economía: criar → vender/liberar…`) lo comprueba para todas las rarezas y todas las formas base criables, y simula el bucle completo (tarifa → eclosión → liberar → cambiar polvo) con pérdida neta. Además cada huevo tarda ≥ 4 h reales y, para los pasos, ≥ 5.000-15.000 monedas apostadas (o 12 h). Los caramelos que da transferir al bebé (hasta 5-16) no tienen valor en monedas.

Los padres llevan `away = 'care'` y están protegidos igual que en las expediciones (ver Fase B6).

## Fase B7 · Combates Showdown: Liga de entrenadores y PvP (server/showdown.js, test/showdown.test.js)

Combates reales con el simulador oficial de Pokémon Showdown (individuales y dobles). Los «Duelos rápidos» de siempre (`server/games/duel.js`) no cambian.

| Mecánica | Números |
|---|---|
| Liga (CPU) | Victoria: **premio en metálico real** (clase × nivel más alto del rival, ver «Medallas, Alto Mando y dinero de combate»), motivo `battle` en el registro. **Tope diario de monedas de combate: 800** (= el techo de antes, 10 × 80) y **máximo 10 victorias premiadas al día** (la recompensa diaria base ya son 1.000 y el techo realista, con rivales de ruta, es de 200-400): se queda en «casual» y por debajo de lo que paga el casino por jugar. Perder no cuesta nada. |
| Resto del premio CPU | Mismo tope de 10 victorias/día: **EXP** para cada participante (fórmula de 5.ª gen.; ver «Progresión como en los juegos») y una tirada de Caramelo Exp. con tope de 12.000 EXP al día, +2 de amistad por participante (tope +10/día por ejemplar, `bond.js`), 15 XP fija (dentro de los 400 XP/día). |
| PvP | Apuesta opcional igual para los dos, dentro de `maxBet`. Se cobra al crear el reto (depósito `escrow`) y al aceptar; el ganador cobra el bote menos el **5 % de comisión** (0 % en el evento de duelos); empate, cancelación, caducidad (10 min), fallo del simulador o reinicio del servidor: **devolución íntegra**. Sin bonus de compañero (`noBonus`), como los duelos. Cuenta como duelo para estadísticas y misiones. |
| Zero-sum | Un combate PvP no crea monedas: `suma antes = suma después + comisión`, con test. |
| Simultáneos | Máximo 8 combates a la vez (`SD_MAX_BATTLES`): el simulador pesa ~130 MB de RSS cuando se usa y la instancia gratuita tiene 512 MB. El simulador se carga solo al empezar el primer combate. |
| Turnos | 60 s por turno; al agotarse se elige «default»; 3 tiempos agotados seguidos = derrota por inactividad. |

## Progresión casual: completar la Pokédex y maxear un Pokémon sin cientos de horas (server/gacha.js, candy.js, bond.js, pokedex.js · test/progression.test.js)

> **Histórico (28-10-2026).** Las tablas de esta sección describen el sistema de caramelos de familia, que se sustituyó el 04-11-2026 por EXP, Caramelos Exp. y Chapas (ver «Progresión como en los juegos»). Se conserva porque explica el sesgo de Pokédex, la fabricación barata y los topes que siguen vigentes.

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

## Progresión como en los juegos: EXP, Caramelos Exp., evolución por nivel, Chapas, Pokérus (server/exp.js, candy.js, hyper.js, pokerus.js, forms.js · test/exp.test.js, candy.test.js, progression.test.js) — 04-11-2026

Petición del dueño: sustituir los caramelos de familia (estilo Pokémon GO) por los sistemas de la serie principal, **sin nerfs de valor y sin perder nada de lo que ya tienen los jugadores**, y «que tenga sentido, no demasiado fácil».

### EXP y niveles
* Cada ejemplar tiene `exp` y su nivel sale del **grupo de experiencia real** de su especie (Rápido 800.000 · Medio rápido 1.000.000 · Medio lento 1.059.860 · Lento 1.250.000 · Errático 600.000 · Fluctuante 1.640.000 al Nv. 100). Los datos (grupo y EXP base de las 1.025 especies, y las seis tablas) salen de los CSV de PokeAPI con `node scripts/build-exp.js <carpeta-csv>` → `server/expdata.json` (Showdown no trae el grupo). Los ejemplares anteriores tenían `exp: 0`: `exp.ensure` les da la EXP de su nivel la primera vez (no pierden nada).
* **Combates contra la CPU:** a cada participante, por cada rival derrotado, `⌊((base × N_rival) ÷ (5 × participantes) × ((2 N_rival + 10) ÷ (N_rival + N_propio + 10))^2,5 + 1) × 1,5⌋` (fórmula escalada de 5.ª gen., ×1,5 por ser entrenador; el nivel propio es el real del ejemplar, el del rival el de la partida: 50 en «Nivel 50 (justo)» o el del equipo + 0…9 en «Niveles reales»). Se aplica en el servidor al terminar la victoria premiada (las 10 al día de siempre). Huevo Suerte: ×1,5.
* **Expediciones:** `H × (300 + 8 × nivel)` por participante, con las bonificaciones de zona (×1,5), hora (×1,25) y «Te adora» (×1,1) de antes.
* **Tope diario por ejemplar** (combates + expediciones, `exp.dayCap`): lo que cuesta subir 5 niveles desde el nivel con el que empezó el día, con un mínimo de **24.000 EXP** (a Nv. 50 ≈ 50.000; a Nv. 80 ≈ 100.000; a niveles bajos son muchos niveles de golpe, como subir a un Pokémon flojo en los juegos). **Los Caramelos Exp. no cuentan para el tope.**
* Al subir de nivel se aprenden los movimientos de ese nivel (cola de pendientes de siempre) y, si cumple los requisitos, el servidor ofrece **«¿Quieres que evolucione?»** (`evoOptions`: solo las evoluciones «de nivel», es decir, nivel, amistad, objeto equipado o movimiento). Cancelar no cambia nada y se puede evolucionar desde la Caja PC.

### Caramelos Exp.
| | XS | S | M | L | XL |
|---|---|---|---|---|---|
| EXP | 100 | 800 | 3.000 | 10.000 | 30.000 |
| Tienda de Combate (PB) | – | 8 | 30 | 100 | – |

* Sin precio en monedas (no se compran, no se reciclan, los PNJ no los comercian; entre jugadores se pueden vender en el Mercado como cualquier objeto). Se usan en Caja PC → Datos → Entrenar (se elige cuántos; se gastan solo los necesarios hasta el Nv. 100) o desde la Mochila.
* **Fuentes** (todas con tope): victoria contra la CPU (una tirada según la fuerza del rival: tier 1 XS 30 % / S 5 % … tier 6 S 25 % / M 15 % / L 4 %; **tope 12.000 EXP en caramelos al día**) · expediciones (≤ 8 caramelos al día + 1 L al día) · cada tirada del gacha 1 XS (S si es especie nueva) · eclosión 1 S · hallazgo del compañero 2-5 XS · transferir: C 1 XS, U 2 XS, R 1 S, E 2 S, L 1 M, M 2 M · Torre: 1 M al cerrar una ronda con PB (dentro del tope de 40 PB/día) · Liga: premios de temporada · Tienda de Combate (100 EXP por PB; con el tope de 90 PB al día son ≤ 9.000 EXP al día).
* **Huevo Suerte** (objeto equipable de la Tienda de Combate, 64 PB; 1 % / 3 % en expediciones de 8 / 12 h, 1 al día): ×1,5 a la EXP de combates y expediciones (no a los caramelos, como en los juegos). El consumible anterior «Huevo Suerte» (EXP de entrenador ×2, 1 h) se llama ahora «Huevo Fortuna» y no cambia.

### Migración (sin pérdidas)
Una sola vez por cuenta (`u.expMig`; `fixes.js` la aplica al arrancar **después de una copia de seguridad**, y además de forma perezosa al leer la cuenta si llegara una restaurada de una copia vieja): cada caramelo de familia o comodín se convierte en Caramelos Exp. por **lo que valía subir de nivel con él**: de 5 a 100 costaba 144 caramelos (⌈N/50⌉ por nivel), así que 1 caramelo = `⌈EXP(5→100) del grupo de su familia ÷ 144⌉` = **8.680** (Lento) · **6.944** (Medio rápido) · 5.555 (Rápido) · 7.360 (Medio lento) · 4.166 (Errático) · 11.389 (Fluctuante) EXP, y 1 caramelo comodín = **7.373** EXP (la media de los grupos ponderada por especies). El total se redondea hacia arriba a 100 EXP y se reparte en XL, L, M, S y XS (voraz). `u.candy` desaparece y `u.candyOld = { n, exp, at, map }` deja constancia (incluye el mapa original de caramelos por familia, por si hubiera que revertir). La corrección de arranque con copia de seguridad solo corre con Postgres (`DATABASE_URL`, como el resto de `fixes.js`); con la base en fichero la conversión es la perezosa, al leer la cuenta. **Los niveles ya subidos, los IV ya entrenados (ahora son IV reales) y las evoluciones hechas no se tocan.** `test/exp.test.js` comprueba el valor, el redondeo, la idempotencia, que se suman a lo que ya había y que la corrección de arranque y la lectura perezosa coinciden.

### Evolución sin caramelos
* Requisitos: **nivel** (de los juegos, `evodata.json` → `lvl`; 30 / 40 por fase si el dato es «pasos, críticos, lugares…»), **amistad ≥ 160** en las 18 evoluciones por amistad (umbral de los juegos actuales, Gen 8+ / Escarlata-Púrpura; antes solo Espeon y Umbreon exigían amistad y las demás podían hacerse con caramelos; «Te adora» 220 sigue siendo solo el nivel de afecto en combate), y los especiales de siempre (piedras, intercambio, sexo, hora, movimiento, estadísticas). La «primera evolución» a una especie nueva sigue sin gastar la copia de origen (es por copias, no por caramelos).
* **Niveles reales:** las evoluciones ocurren en su nivel real de los juegos (Magikarp → Gyarados 20, Charmeleon 16, Charizard 36…); no hay suelos inventados.
* **Techo de polvo evolucionando y transfiriendo** (`test/progression.test.js`, «techo de polvo…»; `SHOW=1` imprime los números). Se trata como cualquier fuente con tope diario: la EXP «externa» máxima al día es ≈ **444.600** (15 ejemplares al tope de 24.000 + botín de combates 12.000 + expediciones 24.000 + 10.000 + PB 9.000 + Torre 12.000 + tiradas 17.600) y cada evolución necesita un duplicado (≈ 30 al día: 22 tiradas + 5 Milagrosos + huevos).
  * **Techo teórico:** el mínimo de (EXP × mejor relación polvo/EXP, 0,0165 ✦ por EXP, la de Kricketot) y (30 duplicados × 75 ✦ de la mejor evolución) = **≈ 2.250 ✦ ≈ 9.000 monedas al día** (la prueba exige ≤ 9.500). Exige tener justo esos duplicados (cada tirada cuesta 135-150 monedas y gacha → liberar devuelve < 70 %) y es un límite superior que nadie alcanza. La EXP que da transferir (≤ 26,7 EXP por ✦) apenas lo realimenta.
  * **Caso típico** (los duplicados que da el gacha de verdad, evolucionados por la rama de más polvo): ≈ 25 ✦ de polvo extra por ≈ 26.000 EXP → **0,00097 ✦ por EXP**. Un casual (≈ 150.000 EXP al día, dedicándolos TODOS a esto) gana ≈ **146 ✦ ≈ 585 monedas al día** (antes, con caramelos: ≈ 770); con la EXP máxima teórica ≈ 1.700 monedas.
  * Las evoluciones por piedra e intercambio cuestan más monedas (objeto) que el polvo que ganan; las de amistad (≥ 160) tienen el tope diario de amistad por ejemplar (`bond.CAP`).
  * `test/balance.test.js` mantiene el bucle «una tirada con todo repetido y transferido, con su EXP gastada en evolucionar» por debajo del 95 % de lo que cuesta.

### Tiempo para subir de nivel (jugador de ≈ 1 h al día)
`levelDays` simula día a día con las funciones reales (`foeExp`, `award`, tope diario, botín esperado): **10 victorias** contra rivales de EXP base 150 que van 3 niveles por encima (3 participantes, «niveles reales»), **una expedición de 12 h** y los Caramelos Exp. esperados (≈ 6.000 al día entre combates, expedición y 22 tiradas).

| Un Pokémon al que se dedica el día | Nv. 50 | Nv. 100 |
|---|---|---|
| Medio rápido (Pikachu) | 5 días | **20 días** (15 con Huevo Suerte) |
| Medio lento (Charizard) | 4 días | **21 días** (16) |
| Lento (Gyarados) | 5 días | **25 días** (18) |
| «Nivel 50 (justo)» (rivales fijos de Nv. 50: rinden menos a partir del Nv. 50) | 4-5 días | 31-38 días |
| Más tranquilo (5 victorias y 8 h de expedición al día) | 6-8 días | 32-40 días |

Objetivo: Nv. 50 en 3-5 días y Nv. 100 en 2-3 semanas dedicándole el día: significativo, no trivial (el último tramo cuesta más de 3 veces lo que cuesta llegar al 50).

### Pokédex (con la evolución gastando EXP)
Mismo modelo que antes (22 tiradas al día, Milagroso, fabricar con polvo, requisitos especiales ignorados) pero cada evolución nueva gasta la EXP que falta hasta su nivel (≈ 140.000 EXP al día en combates «justos» de Nv. 50 contra Pokémon de Nv. ≈ 20 y una expedición de 8 h, más los caramelos de tiradas y transferencias):

| | Antes (caramelos) | Después (EXP) |
|---|---|---|
| Núcleo (931 especies) | ≈ 33 días | **≈ 45 días** (límite del test 52) |
| Completa (1.025) | ≈ 97 días | **≈ 106 días** (límite 125) |
| Especies al día 35 | ≈ 957 | **≈ 917** |

Es más lento porque evolucionar ya no es «gratis con caramelos baratos» sino que pide subir de nivel, que es lo que se buscaba; sigue siendo cuestión de semanas, no de cientos de horas.

### Entrenamiento Extremo (Chapas)
* **Chapa de Botella** (40 PB): UN IV *efectivo* a 31 en combate (a elegir); **Chapa Dorada** (200 PB): todos los que no lo sean. Solo con **Nv. 50+** (regla de Escarlata/Púrpura). `m.hyper = [bool × 6]`; los IV reales (`m.ivs`) no cambian: el Criadero hereda los reales (`test/daycare.test.js`) y las estadísticas de la Caja PC y los conjuntos de Showdown (`sdmap.toSet`) usan los efectivos (`hyper.effIvs`). Una estadística con IV 31 no admite chapa; no se puede deshacer.
* **Fuentes:** Tienda de Combate (PB, nunca monedas), Torre (Chapa de Botella al vencer a un Jefe, una al día) y Liga (premios de temporada). Con 20 PB al día (solo 10 victorias) una Dorada son 10 días; con ≈ 40 (victorias + una carrera corta de Torre) ≈ 5 días; 6 Chapas de Botella (240 PB) cuestan más que una Dorada. Un Pokémon al azar necesita ≈ 5,8 estadísticas: **IV al máximo en ≈ 1-2 semanas de PB**.
* El entrenamiento de IV con caramelos **desaparece**; lo ya entrenado queda como IV real.

### Pokérus
`server/pokerus.js`: **1 / 3.000** por Pokémon y victoria premiada o expedición (no a cuentas NPC). Duplica los EVs que gana (el tope diario cuenta el valor base). Se contagia (25 % por cada otro Pokémon del mismo equipo de combate o expedición, solo mientras el portador está «infectado») y a los **2-5 días** (según el ejemplar) queda «curado»: sigue duplicando, ya no contagia. Aviso al jugador y mensaje en «En vivo» cuando aparece (no al contagiar). Marca «PKRS» en la Caja PC.

### Evoluciones al azar «reales» (`server/forms.js`)
Fijas por ejemplar (se derivan de su `uid`): **Wurmple** → Silcoon o Cascoon (50 / 50; solo se ofrece la que toca); **Dunsparce** → Dudunsparce, 1 de cada 100 «de tres segmentos» (`Dudunsparce-Three-Segment` en Showdown); **Tandemaus** → Maushold, 1 de cada 100 «familia de tres» y el resto «familia de cuatro» (`Maushold-Four`). Al evolucionar se guarda `m.form` y la Caja PC muestra la forma; el sprite sigue siendo el de la especie.

### Cómo se mide
* `test/exp.test.js`: tablas y grupos, fórmula, tope diario, Huevo Suerte, Caramelos Exp., combate CPU, migración (valor, redondeo, idempotencia, arranque y lectura perezosa), Chapas, Pokérus (contagio, curación, EVs ×2) y evoluciones al azar.
* `test/candy.test.js`: transferencias, evolución sin coste, aviso al subir de nivel y niveles reales en las ≈ 380 evoluciones; `test/progression.test.js`: Pokédex, tiempo de nivel, Chapas y techo de polvo; `test/balance.test.js`: bucle de caramelos; `test/bp.test.js` y `test/npc.test.js`: precios en PB y artículos inertes.

## Movimientos como en los juegos: por nivel, MT, Puntos de Batalla, objetos, habilidades… (server/moves.js · test/moves.test.js)

### Fase 1 · Movimientos por nivel
* Cada ejemplar tiene `learned` (todos los movimientos que ha aprendido) y `sdMoves` (hasta 4 equipados, los que lleva a combate), más `pending` (movimientos nuevos por decidir) y `mv: 2` (versión del formato).
* **Migración B (perezosa, una vez por ejemplar):** aprendidos = movimientos por nivel de su especie con nivel ≤ su nivel (los de «al evolucionar» cuentan como nivel 1); equipados = los 4 últimos, como un Pokémon salvaje de los juegos. Los movimientos libres antiguos se descartan. Los equipos guardados solo guardan ejemplares, así que siempre salen con movimientos legales.
* **Subir de nivel / evolucionar** (combates, caramelos, expediciones, evolución): los movimientos nuevos se equipan solos si hay hueco; si no, quedan pendientes y el cliente pregunta «¿cuál olvida?». «No aprender» lo deja en `learned` (se equipa luego gratis, como el Recordador de Escarlata/Púrpura). La evolución conserva todo lo aprendido.
* Datos de `server/learnsets.json` (`scripts/gen-learnsets.js`, Showdown generación 9 y, para especies ausentes de Escarlata/Púrpura, la última con datos). La Caja PC no carga el simulador.
* En «Nivel 50 (justo)» las estadísticas se normalizan a 50, pero los movimientos son los realmente aprendidos (como el VGC). Los entrenadores básicos de la CPU (fuerza 1) llevan movimientos por nivel acordes al equipo del jugador.
* No crea monedas ni valor: aprender, olvidar y cambiar movimientos es gratis.

### Fase 2 · Máquina MT (server/tmdata.js, tm.js · test/tm.test.js)
* **MT = las 229 de Escarlata/Púrpura** con su número oficial (`MT001…MT229`, PokeAPI `machines.csv`, grupo de versiones 25). Son objetos `tm-<movimiento>` de la mochila (consumibles, un solo uso), se comercian en el Mercado como cualquier objeto y **no se compran con monedas en tienda**: se fabrican en la pestaña «Máquina MT» de la Tienda.
* **Compatibilidad:** la especie (o cualquiera de sus preevoluciones) tiene el código `M` de ese movimiento en el learnset de Showdown (gen. 9; para especies ausentes de Escarlata/Púrpura, la última generación con datos). Usarla gasta la MT y añade el movimiento a `learned` (y lo equipa si hay hueco). Si ya lo conoce o no es compatible, no se gasta.
* **Coste de fabricar (monedas + materiales del tipo del movimiento):**

| Nivel | Criterio | Monedas | Materiales | Nº de MT |
|---|---|---|---|---|
| Básica | estado normal o potencia < 60 | 500 | 3 | 76 |
| Buena | estado «premium» (Danza Espada, Protección, Trampa Rocas…) o potencia 60–89 | 1.500 | 4 | 98 |
| Fuerte | potencia 90–119 | 4.000 | 6 | 27 |
| Élite | potencia ≥ 120 | 6.000 | 7 | 21 |
| Suprema | Terremoto, Psíquico, Rayo, Lanzallamas, Surf, Bola Sombra, Rayo Hielo | 8.000 | 8 | 7 |

* **Materiales (9 familias, 18 tipos):** Escama (agua/hielo/dragón), Pluma (volador/normal), Garra (lucha/siniestro), Polvo de Hada (hada/psíquico), Hoja (planta/bicho), Chispa (eléctrico/acero), Ascua (fuego), Fragmento de Roca (roca/tierra) y Esencia Espectral (fantasma/veneno). No se compran: caen del botín.
* **Fuentes (con tope diario por jugador):**

| Fuente | Qué da | Tope diario |
|---|---|---|
| Expedición (por reclamación) | 1 / 2 / 4 / 6 materiales (1 / 4 / 8 / 12 h) de los tipos de la zona | 12 materiales |
| Expedición de 8 / 12 h | 4 % / 8 % de una MT al azar de los tipos de la zona (hasta nivel «Fuerte») | 1 MT |
| Victoria CPU | 1–3 materiales (según fuerza del rival) de los tipos de los Pokémon rivales | 15 materiales (dentro de las 10 victorias/día) |
| Victoria CPU contra líder / campeón | 20 % / 35 % de una MT de su tipo (hasta «Fuerte» / «Élite») | 1 MT |

* **Sin bucles de monedas:** fabricar es un sumidero (`tm_craft`). Los PNJ **no compran ni venden MT ni materiales** (`inFocus` los excluye) y, aunque algún día se activaran, su tope de compra es ≤ 25 % del coste en monedas (`npc.bounds`, con test sobre las 229). Entre jugadores el Mercado es suma cero menos comisión e impuesto. Los materiales no tienen valor en monedas.
* Valor máximo diario de botín (referencia): ≤ 27 materiales y ≤ 2 MT por jugador y día.

#### Gacha de MT (server/tmgacha.js · test/tmgacha.test.js)
* **Es la vía rápida, no la eficiente.** Pestaña «Gacha MT» de la Tienda; la Máquina MT no cambia. `tm:gacha {count}` (1 o 10) cobra monedas (motivo `tm_gacha`), entrega las MT a la mochila y cuenta contra un tope de **30 tiradas al día** (`u.tmDay.gacha`). Sin pity. No da materiales (no toca la economía de fabricación) y no cuenta para misiones del Poké Gacha (evento propio `tm_gacha`).
* **Precios:** ×1 = **1.500** · ×10 = **13.500** (−10 %, 1.350 por tirada).
* **Probabilidades por nivel:** Básica 66 % · Buena 23 % · Fuerte 7,5 % · Élite 3 % · Suprema 0,5 %. Dentro del nivel la MT es uniforme, salvo que el **tipo destacado de la semana** (rota cada lunes UTC entre los 18 tipos) pesa ×3: cambia qué MT sale, no el nivel.
* **Valor esperado (monedas de fabricación de cada nivel: 500 / 1.500 / 4.000 / 6.000 / 8.000):**
  EV = 0,66·500 + 0,23·1.500 + 0,075·4.000 + 0,03·6.000 + 0,005·8.000 = 330 + 345 + 300 + 180 + 40 = **1.195 monedas** por tirada.
  Frente al precio: 1.195 / 1.500 = **80 %** (×1) y 1.195 / 1.350 = **89 %** (×10). Además fabricar exige materiales que aquí no se pagan, así que el valor real de fabricar es aún mayor: el gacha pierde ≈ 305 monedas por tirada (≈ 155 en ×10) en MT y no hay forma de tirar → vender para ganar monedas.
* **Sin bucle de monedas:** los PNJ no compran MT (`inFocus`), y entre jugadores el Mercado es suma cero menos comisión e impuesto. Una MT sacada del gacha nunca vale (en monedas de fabricación) más que lo que se pagó de media. Test: `valor esperado…` (EV < 85 % de ×1 y < 90 % de ×10, también con cada tipo destacado) y una simulación de 40.000 tiradas.
* Máximo diario: 30 tiradas = 45.000 monedas (hundidas) ≈ 30 MT, con ≈ 0,15 Supremas esperadas.

### Fase 3 · Puntos de Batalla, objetos, habilidades y mentas (server/bp.js, bpdata.js, abilities.js · test/bp.test.js)
* **PB (`u.bp`) solo se ganan combatiendo:** victoria CPU 1/1/2/2/3/3 según la fuerza del rival (**tope 30/día**, dentro de las 10 victorias premiadas); PvP: ganar 3, perder 1 (**tope 20/día**, mínimo 3 turnos, máx. 3 combates con PB contra el mismo rival al día). No se regalan, no están en el Mercado ni se cambian por monedas: ninguna operación los convierte.
* **Tienda de Combate:** 16 objetos equipables (16 PB: Hierba Blanca/Mental, Periscopio · 32: Banda Aguante, Casco Dentado, Lodo Negro, Seguro Debilidad, Cinta Experto, Botas Gruesas · 40: Chaleco Asalto, Mineral Evol · 48: Restos, Vidasfera, Cinta/Gafas/Pañuelo Elección), 21 mentas (50 PB; cambian el efecto de la naturaleza, la original sigue figurando), Cápsula Habilidad (50) y Parche Habilidad (200). Máximo 50 PB/día ≈ un objeto o una menta al día.
* Los objetos de PB son objetos normales (comerciables entre jugadores), pero los PNJ ni los compran ni los venden (`inFocus`), así que no hay bucle con monedas del casino. Equipar uno quita 1 de la mochila (o del almacén de bayas); quitarlo lo devuelve.
* **Habilidades:** normal (casilla 0/1) u oculta (`ha`). Ya no se eligen gratis: la Cápsula alterna entre las dos normales y el Parche da la oculta (irreversible, como en los juegos). Criadero: si la madre (el padre no Ditto) tiene la oculta, el bebé la hereda el **60 %** (si su especie tiene una).
* **Combate:** un objeto por Pokémon; Cláusula de objetos solo en PvP. La CPU (fuerza ≥ 3) también lleva objetos suaves sin repetir. Bayas del Huerto = Baya Aranja (Aranja), Zidra (Zidra), Ziuela, Atania y Zanama, equipables y con la misma función que en los juegos.

### Fase 4 · Movimientos huevo y Tutor (server/tutor.js · test/tutor.test.js)
* **Huevo:** al recoger el huevo, el bebé hereda los movimientos huevo de su especie que **cualquiera de los dos padres tenga aprendidos** (hasta 4); al eclosionar se aprenden (y se equipan si hay hueco). No cuesta nada extra.
* **Tutor de movimientos:** enseña los movimientos de tutor de la especie por **4 Fragmentos** del color del tipo del movimiento (Rojo: fuego/lucha/roca/tierra · Azul: agua/hielo/volador/dragón · Amarillo: eléctrico/psíquico/normal/hada · Verde: el resto). Sin monedas.
* **Fragmentos:** solo en Expediciones de 4/8/12 h (35 % / 60 % / 100 %, 1/1/2 unidades), **tope 3 al día** (≈ un movimiento cada 1–2 días). Comerciables entre jugadores, nunca con PNJ (`inFocus`, test).


### Buscar rival (cola PvP) (server/showdown.js · test/pvpqueue.test.js)

`battle:queue {format, level, band, bond, team}` mete al jugador en una cola en memoria; empareja (el más antiguo primero) con quien tenga el mismo formato, nivel, banda de apuesta (`none` 0 / `small` 50 / `medium` 200) y opción de amistad. El emparejamiento reutiliza `challenge()` + `accept()` (reto dirigido al rival), así que depósito `escrow`, persistencia y premios son idénticos a un reto normal; la apuesta no se cobra hasta emparejar. La búsqueda caduca a los 2 min, se cancela con `battle:unqueue`, al desconectarse el último socket o al empezar cualquier combate. Un jugador en combate no puede entrar en cola ni emparejarse consigo mismo. No crea monedas.

## EVs como en los juegos (server/evs.js · test/evs.test.js)

- `m.evs = [PS, Ataque, Defensa, At. Esp., Def. Esp., Velocidad]`: máx. **252 por estadística y 510 en total**. Los conjuntos de Showdown (`sdmap.toSet`) usan los EVs reales en **todos** los modos, también en «Nivel 50 (justo)» (como en el VGC: el entrenamiento es parte del equipo). Las estadísticas «Nv. 50» de la Caja PC los incluyen.
- **Migración sin nerf:** los ejemplares anteriores (sin campo `evs`) reciben perezosamente 84 en cada estadística (504 en total), que es lo que usaban los combates; sus combates no cambian. Los ejemplares nuevos empiezan en 0 (`specimen.make`).
- **Fuentes gratuitas** (con tope diario por ejemplar, `evd`): Expediciones **+4 EV/h por participante** en la estadística de la zona (Bosque Verde PS, Cueva Celeste Defensa, Mar Espuma Def. Esp., Volcán Canela At. Esp., Central Energía Velocidad, Torre Dragón Ataque, Jardín Hada Def. Esp., Barrio Oscuro Ataque), tope **60/día**; victorias contra la CPU **+4 EV por rival derrotado** en su estadística base más alta (Showdown no trae «EV yield»), a todos los participantes, tope **48/día** (y las victorias premiadas ya tienen tope de 10 al día).
- **Sumidero de monedas:** vitaminas (Más PS, Proteína, Hierro, Calcio, Zinc, Carburante) **+10 EV por 1.000 monedas** (hasta 252 y 510 total) y bayas Grana, Algama, Ispero, Meluce, Uvav y Tamate **−10 EV por 300 monedas**. Un Pokémon a 252 en una estadística cuesta ≈ 25 vitaminas = 25.000 monedas (≈ 2 semanas de ingresos casuales): entrenar a fondo es una meta, no un trámite. Las gratuitas dan como mucho 108 EV al día por ejemplar si se combina todo (≈ 5 días para 510).
- **Pokérus** (`server/pokerus.js`): ×2 a los EVs que gana el ejemplar (el tope diario cuenta el valor base, así que el tope máximo de EVs al día no cambia: solo se alcanza antes). Ver «Progresión como en los juegos».
- Los EVs no valen monedas ni polvo y no se transfieren; las vitaminas y bayas son objetos de tienda normales (Mercado y NPC con sus topes habituales: el NPC nunca compra por encima del 60 % ni vende por debajo del precio de tienda; reciclar da el 40 %).

## Evoluciones especiales como en los juegos (server/evoreq.js, scripts/build-evo.js, server/evodata.json · test/evoreq.test.js)

- Los requisitos salen de los datos de Showdown (`evoType`, `evoItem`, `evoCondition`, sexo del destino) y se guardan en `evodata.json` (111 evoluciones; regenerar con `node scripts/build-evo.js`). Desde el 04-11-2026 la evolución **no cuesta caramelos**: el requisito especial se suma al nivel mínimo y se gasta al evolucionar (solo si todo lo demás es válido).
- Tipos: **piedras** (Fuego, Agua, Trueno, Hoja, Lunar, Solar, Día, Noche, Alba, Hielo: Eevee → Vaporeon/Jolteon/Flareon/Leafeon/Glaceon…); **objetos** (Manzana Ácida/Dulce/Melosa, Tetera Agrietada, Augurita Negra, Armaduras…); **intercambio** (Kadabra, Machoke, Graveler, Haunter… y con objeto: Revestimiento Metálico, Escama Dragón, Mejora, Protector, Electrizador, Magmatizador, Tela Terrible, Disco Extraño, Roca del Rey, Escamas, Saquito, Nata) que se paga con un **Cordón Unión** o con un **intercambio real pendiente**; **sexo** del destino (Kirlia ♂ + Piedra Alba → Gallade, Snorunt ♀ → Froslass, Combee ♀ → Vespiquen, Burmy ♀/♂ → Wormadam/Mothim, Salandit ♀ → Salazzle); **hora** de España (Espeon de día y Umbreon de noche además de amistad ≥ 160; Chansey/Weavile/Gliscor con su objeto; Tyrantrum, Aurorus, Lurantis, Gumshoos, Houndstone); **estadísticas** (Tyrogue → Hitmonlee/Hitmonchan/Hitmontop según Ataque y Defensa a Nv. 50); **movimiento** (Mr. Mime/Sudowoodo con Mimético, Mamoswine con Poder Pasado…: solo si la preevolución puede aprenderlo aquí). Lo demás (pasos, críticos, lugares, clima) es solo por nivel (el de los juegos, o 30 / 40 si no tiene).
- **Precios (sumidero):** piedras **2.000**, objetos raros **5.000**, Cordón Unión **1.500** en la Tienda Poké. Una evolución por intercambio con objeto cuesta ≈ 6.500 monedas; una por piedra, 2.000.
- **Fuente gratuita:** las Expediciones de 8 h (6 %) y 12 h (12 %) pueden dar un objeto de evolución de la zona (sobre todo piedras), máx. 1 al día. Sin valor en monedas: los PNJ no los compran y **no se reciclan** (por eso un objeto de 2.000 que cae gratis no es un surtidor de polvo; en todos los casos el objeto vale más monedas que el polvo que gana la evolución: lo comprueba `test/candy.test.js`); entre jugadores se comercian como cualquier objeto.
- **Intercambio real:** cada Pokémon recibido de otro jugador (regalo o Mercado) da un «intercambio pendiente» (máx. 2 al día y 3 guardados) que vale como un Cordón Unión. No se puede obtener con cuentas NPC ni con uno mismo, y los regalos ya tienen sus topes (ver ANTIABUSO.md).

## Pokémon de día y de noche (server/daytime.js, gacha.js, expedition.js · test/daytime.test.js)

- Reloj de España (`Europe/Madrid`, con cambio de hora): **noche 21:00–06:00, día 06:00–21:00**. Todo recibe `now` para poder probarse.
- **Gacha (todos los banners):** 41 especies nocturnas (línea de Gastly, Zubat, Hoothoot, Murkrow, Misdreavus, Sableye, Houndour, Sneasel, Absol, Duskull, Litwick, Phantump…) y 28 diurnas (Ledyba, Sunkern, Cherubi, Hoppip, Starly, Combee, Pidgey…) pesan **×2 a su hora y ×0,5 fuera** (4× entre una y otra). Es un peso dentro de la rareza ya sorteada, igual que el peso por fase evolutiva y el sesgo «Pokédex»: la probabilidad de cada rareza, los destacados, el valor esperado de una tirada y los legendarios/míticos no cambian, y nada se excluye (la Pokédex se completa a cualquier hora).
- **Expediciones** (nunca dan Pokémon): un Pokémon de día/noche que **sale a su hora** (se guarda en la expedición, `phase`) rinde **+25 % de EXP**; fuera de hora, igual que antes (sin penalización).
- También manda el reloj en las evoluciones de horario (Espeon de día, Umbreon de noche…; ver el apartado de evoluciones especiales).

## Liga Pokémon: clasificatoria por temporadas (server/league.js · test/league.test.js)

- **Qué es:** un modo más de «🔎 Buscar rival» (`battle:queue {ranked: true}`): 1 contra 1 o dobles, **nivel 50 justo, sin apuesta y sin efectos de amistad** (se fuerzan en el servidor; el cliente no puede cambiarlo). No hay monedas en juego: el PvP clasificatorio no crea ni destruye monedas. Los combates dan los PB de siempre (3/1, topes y límites por rival de `bp.js`).
- **Puntuación:** Elo por formato (Individual y Dobles por separado): empieza en 1000, K = 32, suelo 0, empate = ½. Rangos: Poké Ball < 1100 · Super Ball 1100 · Ultra Ball 1250 · Master Ball 1400, más el «Top 3» de cada formato (mín. 10 combates puntuados y Super Ball). El emparejamiento prefiere al rival más cercano (ventana de ±300 que crece 150 cada 30 s de espera).
- **Temporadas:** mes natural en hora de España (`Europe/Madrid`). Un comprobador cierra la temporada al arrancar y cada minuto (idempotente; si el casino estuvo apagado meses, la cierra igualmente). Reloj inyectable para pruebas (`LEAGUE_FAKE_NOW` o `_setClock`).
- **Premios de fin de temporada** (por el rango más alto alcanzado; hace falta haber jugado **≥ 5 combates puntuados**): Poké Ball 20 PB · Super Ball 40 PB + Marco Liga Super + título · Ultra Ball 80 PB + Marco Liga Ultra + título · Master Ball 150 PB + Marco Liga Master + título + **1.000 monedas** · Top 3 (en lugar de las 1.000): Marco Liga Top 3 + título + **2.000 monedas**. Además, **objetos de entrenamiento** (una vez al mes): Poké Ball 3 Caramelos Exp. S · Super Ball 3 M + 1 Chapa de Botella · Ultra Ball 2 L + 2 Chapas de Botella · Master Ball 1 XL + 2 L + 1 Chapa Dorada · el Top 3 suma 1 Chapa Dorada. **Tope: 2.000 monedas por jugador y temporada** (≈ 3 % de una sesión normal; las monedas solo llegan a Master Ball y Top 3, quien suele jugar mucho). Los PB de temporada no cuentan en los topes diarios: son un premio, no una vía de granjeo (máx. 150 al mes).
- **Cosméticos:** los marcos son objetos `event` (no salen de Huevos Misteriosos; los PNJ no los compran ni venden); los títulos se ganan (no comerciables).
- **Reinicio suave:** nueva puntuación = 1000 + (puntuación − 1000) / 2, por formato. El historial de temporadas (último año) se guarda en el jugador (`u.league.hist`).
- **Dónde se ve:** pestaña «🏆 Liga» de Combates (rango, puntuación, V/D, cuenta atrás, top 20, premios, temporadas pasadas), categoría «Liga» del Ranking y el emblema (sprites de objeto Poké/Super/Ultra/Master Ball) junto al nombre en la lista de conectados, la ficha del jugador, el chat y la barra del combate.

## Torre Batalla (server/tower.js · test/tower.test.js)

- **Qué es:** carrera de combates contra la CPU con **equipos de alquiler**: conjuntos de los combates aleatorios de Showdown (movimientos del `movepool` del rol, habilidad real, objeto sin repetir, EVs por rol), **nivel 50**, validados con `TeamValidator` (`gen9customgame@@@Obtainable`; las especies que solo existen en eventos o son legendarias se descartan). Se eligen 3 de 6 (Individual) o 4 de 6 (Dobles); tras cada victoria se puede cambiar uno por uno del rival derrotado (cláusula de especies). No hace falta tener ningún Pokémon.
- **Estructura:** 7 combates = una ronda; el combate 21 (y cada 21) es contra un Jefe de la Torre con nombre (Magno, Valeria, Tomás, Elena). Fuerza del rival por suma de base: 300–450 (1–7), 380–520 (8–14), 440–590 (15–21), 480–640 (22+), jefes 540–680. Perder (o empatar, rendirse, abandonar) termina la carrera; se guarda el récord por formato.
- **Recompensas: PB, títulos y un poco de entrenamiento, NUNCA monedas** (ni amistad, ni MT; un Caramelo Exp. M al cerrar cada ronda con PB —o sea, dentro del tope diario de la Torre— y una Chapa de Botella al vencer a un Jefe, una al día como mucho): **1 PB por victoria en los combates 1–7, 2 en 8–14, 3 de ahí en adelante, +10 PB al cerrar cada ronda**, con **tope propio de 40 PB al día** (`bpdata.CAPS.tower`, independiente de los 30 + 20 de CPU y PvP). Una carrera hasta el 21 vale 72 PB sin tope, así que el tope manda: el máximo total de PB al día pasa de 50 a 90 (≈ dos objetos de la Tienda). Títulos a las rachas de 21, 50 y 100 («Aspirante / Maestro / Leyenda de la Torre»).
- **Persistencia:** la carrera vive en `u.tower.run` (fase, equipo de alquiler, racha); el combate es un combate CPU normal con `tw` en su instantánea (se reconstruye con semilla + registro de entradas). Si el combate guardado se pierde, la carrera vuelve a «lista» sin perder la racha.

## Medallas, Alto Mando y dinero de combate (server/trainers.js, progress.js, elite.js, battlemoney.js · test/gyms.test.js)

### Medallas al vencer a los Líderes de Gimnasio
* Las 8 medallas se ganan **venciendo al líder en Combates** y en el orden de Rojo Fuego / Verde Hoja: Brock → Misty → Teniente Surge → Erika → Koga → Sabrina → Blaine → Giovanni (nombres y medallas, los de siempre). Antes se ganaban por progreso en el casino (nivel, Pokédex, victorias…): esos requisitos ya no existen (texto de «Mi Entrenador», Ruta del Entrenador y consejos del Prof. Oak actualizados).
* Equipos de **nivel fijo, los de los juegos** (Brock Geodude 12 y Onix 14 … Giovanni Rhydon 50): del nivel 14 (máximo del equipo de Brock) al 50. Combaten siempre en **Individual y a «Niveles reales»** (el servidor fuerza ambos), con equipo entero (sin «Picked Team Size»: el jugador lleva hasta 6 contra los 2-5 del líder), la **IA lista** de `sdai.js` (`smart`: apenas ruido en la puntuación y cambia de Pokémon cuando le conviene en vez de «a veces») y **objeto en todos los Pokémon desde el 4.º líder** (Erika).
* **Orden:** el líder k se abre con la medalla k − 1 (o con cualquier medalla posterior, para no dejar fuera a quien ya las tenía). La medalla se concede **una sola vez**, al ganar; repetir al líder es una revancha (EXP, premio, PB… pero ninguna medalla ni premio de medalla más).
* **Nada ganado se pierde:** quien ya tenía medallas (aunque fueran salteadas, p. ej. Trueno sin Cascada) las conserva con su título y su límite de apuesta; Misty/Surge… se pueden retar para la que le falte o como revancha.
* **Premios por medalla, sin cambios:** 500 × n monedas, 2 Tickets (impares) o un Huevo Misterioso (pares), título «Vencedor de …» y el límite de apuesta de `MAX_BET_BY_BADGES`. El título de **Campeón de la Liga** y su premio (10.000 monedas, Master Ball, Marco Arcoíris) pasan de «tener 8 medallas» a **vencer al Alto Mando** (una sola vez; quien ya tenía el título no lo cobra otra vez).
* No hay tope de nivel (regla opcional descartada: con niveles fijos y reales, llevar Pokémon de más nivel es justo lo que premia el sistema).

### Alto Mando (carrera de 5 combates)
* Con las 8 medallas: **Lorelei → Bruno → Agatha → Lance → Campeón Azul** (equipos de Rojo Fuego / Verde Hoja, niveles 53-63, 5 + 5 + 5 + 5 + 6 Pokémon), **sin curar entre combates**: los PS, los PP y los estados con los que acaba cada Pokémon se fijan en el siguiente combate (`>eval` sobre el simulador, que queda en el registro de entradas: el combate se reconstruye igual tras un reinicio) y los debilitados quedan fuera hasta el final. Si el máximo de PS cambia entre combates (EVs o nivel ganados) se conserva la proporción.
* Perder o empatar acaba la carrera (se empieza de nuevo desde Lorelei con el equipo curado); un fallo del simulador no cuenta y se reintenta el mismo combate. Cada victoria ya paga lo suyo (EXP, premio con su tope, PB, Caramelos Exp.), dentro de las 10 victorias premiadas al día.
* Al vencer al Campeón: **Salón de la Fama** (equipo con sprites; se guardan las últimas 50 entradas), título «Campeón de la Liga» + premios (una sola vez) y, la primera vez, **1 Moneda Amuleto**. Las **revanchas** suben los equipos **+3 niveles por victoria anterior (máx. +15)** y vuelven a entrar en el Salón de la Fama (sin premios de título nuevos).
* Solo Lance se sigue pudiendo retar suelto (como antes); el resto del Alto Mando solo en la carrera.

### Premio en metálico (dinero de combate)
* Como en los juegos: **clase del entrenador × nivel más alto de su equipo**. Clases (`pay`): Dominguera/Pescador/Campista ×16 · Entrenadora Guay ×20 · Montañero/Karateka/Médium/Ingeniero ×24 · Veterano/Entrenadora Élite ×36 · Domadora de dragones ×40 · **Líder de Gimnasio y Alto Mando ×100** · Campeón ×150. Ejemplos: Montañero con su mejor Pokémon a Nv. 20 → 480; Brock (Nv. 14) → 1.400; Giovanni (Nv. 50) → 5.000.
* **Tope diario de monedas de combate: 800** (`trainers.COINS_DAY`, el máximo que ya se podía ganar: 10 × 80). El premio real manda en cada combate, pero lo que se cobra en un día **no puede superar el tope** (lo que sobra se pierde, como el EXP que sobrepasa el tope por ejemplar). Mínimos: Nv. 5 × ×16 = 80 ≥ las 20-80 monedas de antes, así que ningún combate paga menos que antes.
* **Moneda Amuleto** (objeto equipable real, ahora con ese nombre; el consumable antiguo «+10 % en ganancias durante 1 h» pasa a llamarse **Moneda de la Suerte** y no cambia): si **algún participante** del combate la lleva, el premio y el Día de Pago se **duplican**, pero **el tope diario sigue en 800** (por eso no rompe la economía: solo ayuda a llegar antes al tope). Se consigue en la **Tienda de Combate (40 PB)**, como botín **raro de expediciones largas** (8 h 1 %, 12 h 2 %, máx. 1 al día) y como **premio del Alto Mando** (la primera vez). Sin efecto en el simulador.
* **Día de Pago:** cada uso que acierta esparce **5 × el nivel** de quien lo usa (nivel del combate); se cuenta del **registro del combate** (`|move|p1a: …|Pay Day|…`, sin los usos que fallan, los del rival ni los de los Pokémon que lo usan contra un objetivo inmune) al **ganar** y cuenta para el mismo tope diario (y se duplica con la Moneda Amuleto). Meowth, Persian y Perrserker lo aprenden por nivel (datos de Escarlata/Púrpura).
* **Recogida:** tras **cada victoria premiada**, cada Pokémon del equipo con la habilidad tiene un **10 %** de encontrar un objeto de una tabla por nivel (1-24 / 25-49 / 50-74 / 75-100): Bayas del Huerto, Caramelos Exp. XS/S, y raros (≤ 6 %): Huevo Fortuna, Piedra de evolución al azar y, a niveles altos, Caramelo Raro (1-2 %). **Tope: 5 hallazgos al día.** Se muestra en la pantalla final como «¡Meowth encontró …!».
* Sin creación de monedas por encima de los topes documentados: Recogida no da monedas, el Día de Pago y la Moneda Amuleto trabajan dentro de las 800 diarias, y el EXP y las demás recompensas siguen con sus topes (10 victorias, EXP por ejemplar, 12.000 EXP en caramelos, 30 PB).

## Captura de Pokémon salvajes (server/capture.js, capzones.js, balls.js, catchdata.json · test/capture.test.js) — 05-11-2026

Apartado nuevo **🌿 Captura** (Pokémon → Aventura). Reproduce los juegos (Gen. 8/9) con RNG de casino y **sin ningún bucle de monedas rentable**: capturar nunca da monedas y cada captura cuesta, de media, más de lo que vale el Pokémon. Todo se calcula en el servidor (`crypto`); el cliente solo pide «buscar», «atacar», «lanzar Ball» o «huir».

### Cómo funciona
| Pieza | Regla |
|---|---|
| **Rutas** (`capzones.js`) | 13 zonas de Kanto con tablas de encuentros como las de los juegos: `[especie, nivel mín., nivel máx., peso, hora]`. Pesos = % de la tabla de los juegos (aproximado); hay Pokémon de día y de noche (`daytime.js`, hora de España). Las zonas se abren con medallas (0–8). Estructura `REGIONS[]` lista para más regiones |
| **Tope diario** | **30 encuentros por jugador y día** (día UTC como el resto de topes). Gastar uno es buscar, no capturar: huir o que el salvaje escape también lo gasta. Un solo encuentro abierto a la vez (se conserva si se recarga la página) |
| **Ratio real** | `catchdata.json` sale de `scripts/gen-catch.js` (PokeAPI `pokemon_species.csv`: `capture_rate` y `base_happiness`; pokemon-showdown no los trae). Pikachu 190, Magikarp 255, Onix 45, Chansey 30, legendarios 3 |
| **Fórmula** | `a = ((3·PSmáx − 2·PSact) · ratio · nivel · Ball · estado) / (3·PSmáx)`; nivel = `(30 − nivel)/10` por debajo del 20 (8.ª gen.). Si `a ≥ 255`, captura segura; si no, 4 comprobaciones de sacudida con `b = 65536 / (255/a)^0,1875`. Estados: dormido/congelado ×2,5; paralizado/envenenado/quemado ×1,5 |
| **Captura crítica** | `C = ⌊a·m/6⌋` sobre 256, con `m` según las especies registradas en tu Pokédex: >600 → 2,5 · >450 → 2 · >300 → 1,5 · >150 → 1 · >30 → 0,5 · ≤30 → 0. Una sola sacudida y una sola comprobación |
| **Debilitar** | Atacas con cualquier Pokémon libre de tu Caja (daño de 5.ª gen. con sus estadísticas reales, STAB y tipos) o le pones un estado (dormir, paralizar, quemar, envenenar, congelar; con la precisión y las inmunidades del movimiento). Falso Tortazo nunca lo debilita (deja 1 PS). Veneno y quemadura bajan PS sin rematarlo. El salvaje **no contraataca** (simplificación: no hay PS del equipo) pero puede **huir** (6 % por turno; nunca dormido ni congelado; 60 turnos como máximo) y puede **debilitarse** (encuentro perdido) |
| **Aparición masiva** | Cada tramo de 4 h hay una (6 al día, determinista por tramo y igual para todos) en una zona al aire libre: 40 % de los encuentros de esa zona son de esa especie |
| **Clima** | Despejado 55 % · lluvia 25 % · niebla 20 %, por zona y tramo de 6 h (sin clima en cuevas ni torres). Con lluvia los Pokémon de Agua pesan ×1,5 |
| **Marcas** (`m.mark`) | Una por encuentro como mucho: **Rara** 1/1000 · **Mini** (tamaño 0) · **Jumbo** (tamaño 255) · Aparición masiva 1/10 (solo en ella) · Lluvia/Niebla 1/50 con ese clima · Amanecer/Mediodía/Atardecer/Noche 1/50 en esa franja. Se ven en la ficha de la Caja PC con su título |
| **Tamaño** (`m.size`) | 0–255 (suma de dos dados: campana con extremos rarísimos, ≈ 1/16.000 cada uno); etiqueta Minúsculo / Diminuto / Pequeño / Normal / Grande / Enorme / Gigante |
| **Variocolor / habilidad oculta** | Variocolor 1/1024 por encuentro (×2 con el evento de fin de semana); habilidad oculta 2 % si la especie la tiene; IV 0–31, naturaleza y género al azar como en los juegos |
| **Legendarios de encuentro** | Articuno, Zapdos y Moltres (Nv. 50, 5 medallas) y Mewtwo (Nv. 70, 8 medallas y ser Campeón), ratio real 3. **Una sola captura por jugador y especie**; no huyen; cada intento gasta un encuentro y solo hay uno al día por legendario, así que si escapa o se debilita se puede repetir otro día |
| **Ejemplar capturado** | Entra con `gacha.grant` como cualquier ejemplar: Pokédex, Caja PC, colecciones. Guarda `level`/`exp` reales, `ivs`, `nature`, `ha`, `friendship` (la base de la especie, 150 con Amigo Ball), `ball`, `mark`, `size` y `caught` (zona, nivel). Con 5 estrellas la captura se convierte en polvo (como el Gacha). Los movimientos son los de su nivel |

### Poké Balls (Tienda Poké → ⚪ Poké Balls)
Precios ≈ 0,6 × el precio en yenes de los juegos (sumidero de monedas). La **Master Ball** es la del Gacha (premios y Mercado): en Captura vale 100 %; no se compra.

| Ball | Precio | Efecto real |
|---|---|---|
| Poké | 120 | ×1 |
| Super | 360 | ×1,5 |
| Ultra | 480 | ×2 |
| Ocaso | 600 | ×3 de noche |
| Rápida | 600 | ×5 en el primer turno |
| Turno | 600 | `1 + turnos·1229/4096`, máx. ×4 (turno 10) |
| Red | 600 | ×3,5 contra Agua y Bicho |
| Nido | 600 | `(41 − nivel)/10` hasta el nivel 29 |
| Acopio | 600 | ×3,5 si ya tienes la especie |
| Lujo | 600 | ×1; la amistad sube ×1,5 (`bond.addFriend`, mismos topes diarios) |
| Amigo | 180 | ×1; llega con 150 de amistad |
| Sanación | 180 | ×1 |
| Master | — | 100 % |

**Herencia de la Ball en el Criadero** (`balls.inherit`, regla de los juegos): el bebé nace en la Ball de la madre (la hembra, o el que no es Ditto); si los padres son de la misma especie, en la de uno de los dos al azar; Master Ball y ejemplares sin Ball (Gacha, huevos antiguos) dan Poké Ball. Se ve en el huevo y en el bebé. **Regalar** un Pokémon conserva su Ball, marca, tamaño, lugar de captura, IV, naturaleza y habilidad oculta (como al intercambiar en los juegos; nivel, EXP, EVs y amistad no viajan, porque la EXP no se transfiere). El **Mercado** es un libro de órdenes por especie y variocolor (no por ejemplar) y los PNJ operan igual, así que ahí el comprador recibe un ejemplar nuevo sin esos rasgos, como ya ocurría con los IV.

### Economía (por qué no es rentable)
El valor máximo de un Pokémon capturado es lo que se saca liberándolo (polvo × 4; los PNJ pagan menos): **Común 20 · Poco común 48 · Rara 120 · Épica 320 · Legendaria 680**, ×3 si es variocolor (1/1024). Las rutas solo tienen Comunes, Poco comunes y unas pocas Raras (Onix, Kangaskhan, Rhydon). Los ataques son gratis, así que el jugador ideal baja a 1 PS, duerme (×2,5) y lanza **una** Ball barata: aun así **el precio de la Ball dividido entre la probabilidad de captura supera siempre el valor de reventa**:

| Caso | Valor de reventa | Coste esperado de capturarlo (jugador ideal) |
|---|---|---|
| Común (Pidgey nv. 3, 1 PS dormido, Poké Ball) | 20 | 120 (captura segura) |
| Rara con poco ratio (Onix nv. 13, 1 PS dormido, Poké Ball) | 120 | ≈ 150 (peor caso de todas las rutas: valor / coste ≈ 0,85) |
| Rara sin debilitar (Kangaskhan nv. 26, PS llenos, Poké Ball) | 120 | ≈ 1.000; con 50 % de PS y sin estado ≈ 600; 1 PS dormido ≈ 220 |
| Legendario (Articuno, 1 PS dormido) | 680 (y solo una vez) | ≈ 1.700 con Poké Ball (≈ 4.000 con Ultra; 18.000 sin debilitar) |

`test/capture.test.js` lo comprueba para **cada especie y nivel de cada ruta** (con la mejor Ball posible de cada tipo, 601+ especies para críticas, Ocaso de noche, Nido, Red y Acopio activos, Turno a ×4, etc.) y con una **simulación de 3.000 encuentros por zona** con el jugador ideal (el valor devuelto es siempre < 90 % del gasto). El test mide el valor directo del ejemplar capturado; la evolución posterior queda acotada por los topes diarios de EXP/amistad («Evolución + transferir» en ANTIABUSO, ≈ 9.000/día en el máximo teórico) y por `test/progression.test.js`. Chansey, Golbat y Primeape están en sus rutas reales (Cueva Celeste, Safari). Como mucho un día entero da 30 capturas, es decir, ≥ 3.600 monedas en Balls para ≤ 600 de reventa.

Lo que sí da la captura es **objetivo** (elegir qué especie, Ball, marca o tamaño) y progreso de colección: una Pokédex de comunes sale a ≈ 150-250 monedas por especie dirigida en lugar de las 150 por tirada al azar del Gacha, pero los Pokémon salen con el nivel y la amistad de la ruta (y sin ventajas de monedas). Los **legendarios de encuentro** abaratan el camino a las Aves y a Mewtwo para las colecciones (una sola vez por cuenta, con medallas y la Liga como filtro y ≈ 1.700 monedas de Balls de media en lugar de ≈ 51.000 de Gacha): es el único «atajo» y está limitado a 4 Pokémon por cuenta. Master Ball: sin cambios (se sigue ganando cada 25 niveles, como Campeón y en el Mercado).

## Lotería ID (server/lottery.js · test/lottery.test.js) — 05-11-2026

Como la Lotería del Centro Pokémon de los juegos. Está en **Mi Entrenador → 🎟️ Lotería**.

| Pieza | Regla |
|---|---|
| **ID de entrenador** | 5 dígitos (`u.tid`). Si la cuenta ya tenía uno se respeta; si no, sale de un hash del id de usuario y se reserva el siguiente libre si choca con otra cuenta (nunca se repite entre cuentas) |
| **OT de los ejemplares** | Los ejemplares nuevos llevan `ot` = ID de quien los obtiene. Los antiguos (sin `ot`) cuentan como del propio jugador. Al **regalar** un Pokémon conserva el `ot` (y el nombre `otn`) del entrenador original, aunque pase por varias manos: por eso tiene sentido intercambiar. El Mercado y los PNJ crean un ejemplar nuevo para el comprador |
| **Sorteo** | Un número de 5 dígitos al día (día UTC): `sha256(semilla del servidor + fecha) mod 100000`. La semilla (`state.lotSeed`) se genera una vez y no sale del servidor: el número de mañana no se puede conocer. Es el mismo para todos. Solo lo ve quien ya lo ha comprobado |
| **Comprobación** | Gratis, **una vez al día por jugador** (se guarda el resultado; recargar no repite). Se compara con el `ot` de todos tus Pokémon y cuenta el **mejor** (un único premio al día) |
| **Premios** | Cifras coincidentes contando desde el final, como en los juegos: **2 → Caramelo Exp. XS · 3 → Caramelo Exp. M · 4 → 5 Ultra Ball · 5 → Master Ball**. Solo objetos que ya existen; **nunca monedas** |

### Probabilidades y valor esperado
Con un ID, cada día: exactamente 2 cifras **0,9 %** · 3 cifras **0,09 %** · 4 cifras **0,009 %** · 5 cifras **0,001 %** (≥ 2 cifras: 1 %). Cada **ID distinto** que tengas (Pokémon regalados por otros entrenadores) es una oportunidad más (los ID propios cuentan una sola vez). Valor esperado por ID y día, valorando el Caramelo Exp. XS en ≈ 3 monedas, el M en ≈ 90, las 5 Ultra Ball en 2.400 y la Master Ball en 75.000 (cotas altas): `0,009·3 + 0,0009·90 + 0,00009·2.400 + 0,00001·75.000 ≈ 1,1` monedas al día; con 12 ID distintos ≈ 13. Muy por debajo de cualquier otra fuente sin apostar (≈ 2.500 al día) y con la Master Ball en ≈ 1 de cada 100.000 días por ID (`test/lottery.test.js`, «valor esperado»).

## Teracristalización (server/tera.js, showdown.js, sdmap.js · test/tera.test.js) — 05-11-2026

| Pieza | Regla |
|---|---|
| **Teratipo** (`m.tera`) | Cada ejemplar tiene uno. Por defecto es **uno de los tipos de su especie** (determinista por `uid`: los de doble tipo salen repartidos), como los Pokémon normales de los juegos. Los jefes de Teraincursión capturados pueden tener uno distinto. Viaja con el ejemplar al regalarlo |
| **Orbe Teracristal** | Objeto clave (`items.ITEMS['tera-orb'].key`): no se vende, no se comercia (`market.parseRef` lo rechaza), no se recicla ni lo compran los PNJ. Lo da el Profesor Oak al conseguir la **1.ª medalla** (también a quien ya la tenía, al conectarse) y solo una vez. Sin Orbe no hay botón |
| **En combate** | Soporte nativo del simulador (gen. 9, `move N terastallize`): una vez por combate y jugador, cambia su tipo al Teratipo y refuerza los ataques de ese tipo (Tera STAB). Botón «Teracristalizar (tipo)» junto a los movimientos, como la Megaevolución. El servidor valida la elección (hace falta el Orbe y un modo que lo permita), quita `canTerastallize` de la petición a quien no puede y el combate guardado recuerda la regla (`tr`) para restaurarlo tras un reinicio |
| **Dónde sí** | **Combates libres** contra entrenadores normales (la CPU nunca teracristaliza: su IA no lo usa), **PvP** (opción del reto, activada por defecto: solo se activa si **los dos** tienen el Orbe, para que nadie juegue con ventaja) y **Teraincursiones** |
| **Dónde no** | **Líderes de gimnasio y Alto Mando** (Kanto/FRLG no tenía Tera; son los mismos combates de siempre), **Torre Batalla** (equipos de alquiler iguales para todos) y **Clasificatoria de la Liga** (igualdad de condiciones, como con los efectos de amistad). Esos combates mantienen la «Terastal Clause» del simulador |
| **Teralitos** | 18 objetos, uno por tipo (`tera-shard-<tipo>`), que caen de las Teraincursiones. **50 Teralitos de un tipo cambian el Teratipo de un ejemplar a ese tipo** (Caja PC → Datos → 💎 Teratipo → Cambiar). Sin precio en monedas: los PNJ no los comercian; solo se pasan entre jugadores en el Mercado |

Nada de esto da monedas ni cambia ninguna recompensa: teracristalizar solo cambia cómo se juega el combate (la CPU no se hace más fuerte ni más débil). Los combates que ya estaban en curso se restauran sin Tera como antes.

## Teraincursiones cooperativas (server/raid.js · test/raid.test.js) — 05-11-2026

Apartado **💎 Teraincursiones** (Pokémon → Aventura). Modelo por turnos sencillo, todo en el servidor (`crypto`); el cliente solo pide «crear», «unirse», «elegir movimiento», «salir» o «capturar».

| Pieza | Regla |
|---|---|
| **Estrellas** | 1★ con 1 medalla · 2★ con 2 · 3★ con 4 · 4★ con 6 · 5★ con 8 (las mismas medallas de Kanto) |
| **Jefes del día** | 2 por estrella y día UTC, deterministas (`sha256` de la fecha) y distintos entre sí; igual para todos. Teratipo al azar de los 18 (también determinista). Especies sin legendarios ni míticos: 1★ Comunes (BST 250-340), 2★ Comunes y Poco comunes, 3★ Poco comunes y Raras, 4★ Raras y Épicas, 5★ Épicas (BST 500-640). Nv. 20 / 30 / 40 / 50 / 60 |
| **Jefe** | PS fijos 1.000 / 1.500 / 2.200 / 2.600 / 3.000; su Teratipo es su único tipo (defensa); al llegar al **50 % de PS** aparece un **escudo** del 25 % de sus PS (el golpe se detiene en el 50 % aunque sobrara daño): mientras dura no baja la vida; al romperse **pierde su siguiente ataque**. Ataca con su Teratipo (STAB ×1,5) a un Pokémon al azar y **cada 3 turnos a todos** con 0,55 de potencia. Potencia 40 / 45 / 52 / 48 / 48. Es inmune a estados |
| **Equipo** | Hasta 4 jugadores (un Pokémon cada uno: estadísticas reales del Nv. 50 con IV, EV y naturaleza, movimientos equipados, Teratipo propio). Las plazas libres son aliados de la CPU (Pokémon de la rareza de la estrella con un ataque del tipo que mejor funcione contra el jefe), así que se puede ir **en solitario** (tú + 3). Los movimientos de daño hacen daño (fórmula de 5.ª generación, STAB, tipos, críticos 1/24), Recuperación-like cura el 50 %, los que suben Ataque/At. Esp. lo suben y los de estado puro no afectan al jefe |
| **Tera** | Una vez por incursión y jugador (necesita el Orbe Teracristal): STAB ×1,5 en el Teratipo (×2 si ya era uno de sus tipos) y su tipo defensivo pasa a ser el Teratipo |
| **KO y turnos** | Un Pokémon debilitado **vuelve con los PS llenos dos turnos después**; con **4 debilitados en total** se pierde. Máximo **20 turnos** |
| **Tiempo** | Turnos de 30 s (5 min en solitario). Sin respuesta se elige el mejor movimiento; tras 3 turnos seguidos sin tiempo el jugador pasa al **piloto automático** (y vuelve en cuanto elige). Quien sale de la incursión deja su Pokémon a la CPU. Las salas esperan 2 minutos y se completan con aliados CPU |
| **Persistencia** | El estado vive en `db.data.raids` y las fechas límite son marcas de tiempo: un reinicio del servidor amplía los plazos y todo sigue. Las terminadas se conservan 6 h; las capturas pendientes, 24 h (`u.raid.claims`) |

### Recompensas (solo por ganar y participar; **tope de 10 incursiones premiadas por jugador y día**)
Participar = elegir movimiento en al menos un tercio de los turnos (quien deja que la CPU juegue por él no cobra).

| Estrellas | Teralitos (tipo del jefe) | Caramelos Exp. | Menta al azar | Cápsula Habilidad | Ball mínima para capturar |
|---|---|---|---|---|---|
| 1★ | 1-2 | 2 × XS (200 EXP) | — | — | Poké |
| 2★ | 2-3 | 1 × S (800) | — | — | Poké |
| 3★ | 3-5 | 2 × S (1.600) | 8 % | — | Super |
| 4★ | 4-7 | 1 × M (3.000) | 12 % | — | Ultra |
| 5★ | 6-10 | 2 × M (6.000) | 20 % | 5 % | Ultra |

* **Teralitos**: sin valor en monedas (ni los compran los PNJ). Con 50 se cambia un Teratipo: como mucho ≈ 100 al día (2 cambios).
* **Caramelos Exp.**: **tope propio de 9.000 EXP al día** (lo mismo que 90 PB de la Tienda de Combate), aunque se hagan 10 incursiones de 5★; se suman a los 12.000 de combates y no se pueden comprar con monedas.
* **Captura garantizada**: el jefe nunca escapa. Entra con su **Teratipo**, nivel de la incursión (20-60), 1-4 IV perfectos, naturaleza y tamaño al azar, variocolor 1/1024 y habilidad oculta 2 %. **Cuesta una Ball** del precio mínimo de la tabla (o mejor; la Master Ball también vale). Se reclama durante 24 h.
* Además XP de entrenador plana (10 × estrellas, con su tope diario) y **nunca monedas**.

### Economía (por qué no es rentable)
Valor de reventa máximo de un jefe (polvo × 4): Común 20 · Poco común 48 · Rara 120 · Épica 320 (×3 si variocolor, 1/1024). La Ball mínima cuesta **siempre más** que el valor del Pokémon (`test/raid.test.js`, «economía», para **cada especie de cada estrella**):

| Estrellas | Mejor valor de reventa | Ball mínima | Coste / valor |
|---|---|---|---|
| 1★ | 20 | Poké (120) | 6× |
| 2★ | 48 | Poké (120) | 2,5× |
| 3★ | 120 | Super (360) | 3× |
| 4★-5★ | 320 | Ultra (480) | 1,5× |

Con el tope de 10 al día lo máximo que se podría «sacar» liberando son ≤ 3.200 monedas de reventa por ≥ 4.800 de Balls: pérdida segura. Mentas y Cápsulas Habilidad no tienen precio de tienda ni los compran los PNJ (solo valen entre jugadores).

### Dificultad (simulación, `test/raid.test.js` «equilibrio»)
Con un Pokémon sin entrenar (Nv. 50, 0 EV, sus movimientos por nivel), jugando siempre el movimiento de más daño y teracristalizando si coincide el tipo, en solitario con 3 aliados: **1★ ≈ 100 % · 2★ ≈ 100 % · 3★ ≈ 95 % · 4★ ≈ 55-80 % · 5★ ≈ 30-50 %** (según tipos), 4-15 turnos. Con EV, buenos tipos y compañeros reales sube bastante.

## GTS: intercambio de Pokémon por Pokémon (server/gts.js · test/gts.test.js) — 05-11-2026

Como la Global Trade Station de Platino / Blanco y Negro. Está en **Mercado → Comercio → 🌐 GTS**. Es un trueque de **ejemplares exactos**: ni entran ni salen monedas entre jugadores, así que no hay precio ni bucle de monedas posible.

| Pieza | Regla |
|---|---|
| **Depositar** | Un ejemplar de la Caja (el mismo que eliges) sale de tu Caja y se guarda entero. Se indica qué se pide: **especie** (solo las «vistas»: la Pokédex no lleva un registro de vistos, así que cuenta lo que tienes, lo que tienes con candado y lo que has llegado a tener, `u.dexSeen`), **sexo** (cualquiera / ♂ / ♀; una especie de sexo fijo o sin sexo solo admite lo que es) y **nivel** (cualquiera, 1-10, 11-20 … 91-100) |
| **Bloqueos** | Los mismos que para vender/regalar (el ejemplar fuera de expedición o Criadero) y los de uso: compañero, combate en curso, carrera del Alto Mando o Teraincursión con ese ejemplar |
| **Comisión** | **150 monedas** por depósito, no reembolsables (si retiras o caduca tampoco). Es un sumidero (`gts_fee` en el historial y el panel de economía). Se ha elegido por ser ≈ la comisión de publicar una orden de 10.000 en el Mercado (1,5 %): lo bastante para que no se use como almacén gratis ni se publiquen y retiren depósitos en bucle, y casi nada frente a los ≈ 2.500 monedas al día sin apostar |
| **Límites** | 3 depósitos por jugador (abiertos, caducados sin recoger o con intercambio pendiente) · caducidad a los **7 días** (el ejemplar vuelve intacto a la Caja; si ya tienes 5 de la especie y no cabe, espera guardado y se recoge cuando haya sitio) |
| **Intercambiar** | Quien tiene un ejemplar que cumple lo pedido lo ofrece y el intercambio es **inmediato**, sin esperas ni aceptación. Los dos reciben un ejemplar nuevo con los rasgos del otro (`traitsOf/applyTraits`: Ball, marca, tamaño, IV, naturaleza, Teratipo, habilidad oculta, entrenador original) **y, como en los juegos, su nivel, EXP, movimientos, objeto y mote**. **No viajan EVs ni amistad** (empiezan a cero, como en los regalos) |
| **Lo que recibe el dueño** | Pasa **directo a su Caja** con un aviso (toast); si no cabe (ya tiene 5 de esa especie), el depósito queda «hecho» y lo recibido **espera en la GTS** hasta que haya sitio (al entrar en la GTS o cada 10 min se entrega solo) |
| **Evolución por intercambio** | El sistema evoluciona a mano (Caja PC → Evolución) y las evoluciones por intercambio gastan un «intercambio pendiente» o un Cordón Unión (`evoreq.noteTrade`). La GTS reutiliza lo mismo que los regalos y el Mercado: cada intercambio da **un intercambio pendiente a cada parte** (máx. 3 guardados y 2 nuevos al día), así Kadabra, Machoke, Graveler, Haunter… y los de objeto (Roca del Rey, Revestimiento Metálico…) evolucionan después exactamente igual. No existe la Piedra Eterna en el juego, así que no hay excepción que aplicar |

### ¿El nivel que viaja abre un bucle de EXP entre cuentas?
Al regalar, el nivel/EXP no viaja precisamente para que una cuenta secundaria no pueda subir Pokémon y pasarlos a la principal. En la GTS sí viaja (como en los juegos) porque es un **1 por 1**: cada parte entrega su propio ejemplar y recibe el de la otra, así que la EXP que gana una cuenta la pierde la otra; no se crea EXP. Lo que sí podría hacer una cuenta secundaria es «entrenar» en paralelo y mover ese trabajo a la principal, y eso se acota así (decisión: **mantener el nivel y poner topes**, en vez de quitarlo):
- Solo cuentas con nivel 3 y 3 días, sin ayuda de la Enfermera Joy en 24 h (`transfer.canGift`), como al regalar.
- **5 intercambios al día por cuenta** (como oferente o como dueño del depósito) → como mucho 5 ejemplares con nivel entran por día, y cada uno cuesta un Pokémon propio (con su nivel) a quien lo recibe.
- Los topes de regalos compartidos: **10 Pokémon y 2 legendarios o míticos recibidos al día** (`pokeInCheck/notePokeIn`), para el que ofrece y para el dueño.
- La EXP por combate y expedición ya tiene un tope diario por ejemplar, y a cuentas nuevas se les cierra la GTS. Lo que no se puede evitar (y ya pasaba con regalos y Mercado) es que dos amigos se pasen Pokémon entre sí; el valor que se mueve queda acotado por esos topes.
- No se obtiene nada que no se pudiera obtener: el nivel de un ejemplar vale como mucho el de uno que ya existe en el casino.

### Cómo se mide (`test/gts.test.js`, < 1 s)
Depositar/retirar (intacto, comisión no reembolsable), máximo de depósitos, comisión, caducidad (vuelve a la Caja o espera si no cabe), requisitos de especie/sexo/nivel, carrera de dos ofertas al mismo depósito (solo gana una y la otra no pierde nada), rasgos y nivel conservados sin EVs ni amistad, topes de `transfer.js` (cuentas nuevas, 2 legendarios, 10 recibidos al día), 5 intercambios al día, evolución por intercambio y que no se duplica ni se pierde ningún ejemplar.

## Torneos entre amigos (server/tourney.js · test/tourney.test.js) — 05-11-2026

- **Formato:** eliminación directa de 4, 8 o 16 plazas (el cuadro se genera al llenarse o cuando el anfitrión lo inicia con ≥ 3 jugadores; las plazas libres son «bye» para las mejores siembras, con la siembra estándar 1-N, 4-(N-3)…). Individual o Dobles, nivel 50 justo (como el VGC) o niveles reales, y las mismas opciones de amistad y Teracristalización que los retos PvP. **Cada ronda es un combate PvP normal** (`showdown.startTourney`: mismo simulador, equipos con la cláusula de objetos, turnos de 60 s, 3 tiempos agotados = derrota); solo lleva la marca `tn` para avisar al torneo al acabar. Un empate o un error del simulador repiten el combate; no se pierde la ronda.
- **Plazos:** el anfitrión elige 5, 10 o 15 min por combate, que corren desde que los dos rivales están definidos. Si solo se presenta (pulsa «Listo») uno, gana por incomparecencia; si no se presenta ninguno, no pasa nadie y el rival siguiente avanza solo. Si los dos están listos pero el combate no cabe (otro combate en curso, simulador lleno) el plazo se prolonga y se reintenta cada 5 s.
- **Bote (opcional):** inscripción de 0, 100, 250, 500 o 1.000 monedas. Bote neto = bote − 5 % (0 % el Lunes de Duelos, igual que el PvP); campeón 70 %, finalista 30 % (100 % al campeón si no hay finalista). Es suma cero menos la comisión: no se crean monedas. Si nadie se presenta a la final, o el torneo se cancela o caduca (24 h sin llenarse), se devuelve todo.
- **Premio cosmético:** título «Campeón de Torneo» y Marco Trofeo, una sola vez por cuenta, solo con ≥ 4 inscritos y ≥ 2 victorias reales del campeón. No dan monedas ni ventaja.
- **Sin XP ni monedas extra:** cada combate del torneo es un PvP normal (PB, XP plana y amistad con los topes diarios que ya tiene el PvP: 3 combates/día por rival para los PB).

## Eventos temáticos: semanas por tipo (server/themes.js · test/themes.test.js) — 05-11-2026

- **Calendario determinista:** cada semana (lunes 00:00 a domingo 23:59, hora de España, también con el cambio de hora) es «Semana de <tipo>». Cada ciclo de 18 semanas recorre los 18 tipos una vez, en un orden barajado por hash (`h32('theme:<ciclo>:<tipo>')`): no hay que programarlo ni guardarlo y todos los jugadores (y reinicios) ven lo mismo. Se **suma** a los eventos de fin de semana (`events.js` no cambia; `events.publicState()` solo añade el campo `theme`) y se anuncia en «En vivo» y en el Vestíbulo.
- **Captura:** los Pokémon del tipo pesan ×3 en las tablas de encuentros (`capture.pickWild`): solo cambia cuál te sale; los 30 encuentros diarios, los ratios de captura, las Balls, los legendarios y el valor de reventa no cambian (la economía de `docs/ANTIABUSO.md → Captura` sigue igual). Solo afecta a las rutas que tengan algún Pokémon de ese tipo.
- **Teraincursiones:** el último jefe de cada estrella del día es de ese tipo (especie de ese tipo del grupo de esa estrella, si hay al menos 2) y su Teratipo es ese tipo; el primero no cambia. Las incursiones rotan por día UTC, así que el tipo nuevo llega a la 01:00/02:00 (hora de España) del lunes. Mismas rarezas, mismos tope (10 al día) y mismas recompensas.
- **Misión temática semanal:** captura 3 Pokémon de ese tipo (en Captura o capturando a un jefe de Teraincursión; `finishCapture`) → **2 Tickets Gacha** una sola vez por semana (`u.theme`). Sin monedas: 2 tickets/semana es menos que cualquier misión diaria.

## Pokédex regionales y Diploma del Game Freak (server/regions.js · test/regions.test.js) — 05-11-2026

- **Regiones = generaciones** de la Pokédex del casino: Kanto 151 (n.º 1-151), Johto 100, Hoenn 135, Sinnoh 107, Teselia 156, Kalos 72, Alola 88, Galar 96 (incluye los 7 de Hisui, n.º 899-905, de la 8.ª generación) y Paldea 120: suman los 1.025. Son los tamaños de las Pokédex nacionales por generación de los juegos, no las Pokédex regionales «reducidas» de cada juego concreto.
- **Obtenido** = lo que tienes, lo que tienes en la Caja con candado y lo que has llegado a tener (`u.dexSeen`, que no se pierde al regalar, liberar o transferir; el registro de «capturados» de los juegos tampoco se borra). Nada ya ganado se pierde.
- **Diploma del Game Freak** al completar cada región: título «Diploma de <región>» y Marco Diploma <región> (cosméticos de evento: no salen de Huevos Misteriosos), una sola vez por cuenta y región (`u.dexDip`). **Sin monedas**: ni siquiera pequeñas. Las cuentas que ya tenían la Pokédex completa lo reciben al evaluar sus colecciones; las nuevas, al obtener el último Pokémon.
- Dónde se ve: Mi Entrenador → Colecciones (progreso por región, enlace a la Pokédex filtrada) y la ficha pública del entrenador.
