# Plan: lo que queda por implementar

> **Estado (29-10-2026): todo el plan está hecho y publicado** (A1–A6, B1–B7 y C). Queda A7 (probar sonido y vibración en un móvil real). Ver docs/BALANCE.md y docs/ANTIABUSO.md.

Cada bloque lo implementa un agente con un encargo cerrado. Antes de desplegar en Render se revisa: tests, batería de navegador en escritorio y móvil, y comprobación de que no se crean monedas de la nada.

## A. Remates de lo ya publicado (corto, primero)

| # | Qué | Por qué |
|---|-----|---------|
| A1 | **Copias fuera de Render**: copia diaria enviada fuera de Render (por ejemplo, un archivo en el repositorio o en Google Drive) y guía para mudarse a otra base de datos | La base de datos gratuita de Render **caduca el 26-11-2026** |
| A2 | Duelos: elegir la forma **Mega** al retar o aceptar, y mostrar el arte Mega en la repetición del combate | El servidor ya lo admite; falta la pantalla |
| A3 | Mercado: historial «Completadas» por jugador, sin el límite actual de las 40 últimas operaciones del mercado | Los jugadores poco activos ven desaparecer sus operaciones |
| A4 | Desafío Pokémon: revisar las 79 preguntas escritas a mano y añadir `quiz.css` a la caché sin conexión (service worker) | Se escribieron de memoria |
| A5 | Probar en el navegador los avisos de riesgo aún sin probar (Blackjack, Video Póker, Hold'em, Gacha, Pokédex, regalos, sobreprecio en el Mercado) | Solo se comprobó que el código no tiene errores de sintaxis |
| A6 | Comprobar cómo llega la IP real de cada jugador detrás del proxy de Render (`trust proxy`) | Los límites de registro e intentos dependen de ella |
| A7 | Revisar el sonido y la vibración en un móvil de verdad (Gacha, Mega, Desafío) | El navegador de pruebas no tiene sonido ni vibración |

## B. Pokémon con personalidad (el plan grande)

| # | Fase | Contenido | Estado |
|---|------|-----------|--------|
| 1 | Pokémon únicos + Caja PC | Cada ejemplar es único: naturaleza, IVs/EVs, nivel, amistad, habilidad, 4 movimientos, sexo, objeto y mote. Las copias actuales se migran con copia de seguridad, manteniendo las estrellas, el bonus de compañero, el candado y las Megas. Vista Caja PC. Mercado: las órdenes de venta son de un ejemplar concreto y los pedidos de compra, por especie | |
| 2 | Repetidos y reciclaje | Transferir al Profesor Oak (caramelos y polvo). Caramelos para subir nivel y **evolucionar**, también por piedra, amistad o intercambio, con animación. Entrenamiento de IVs. Intercambio Milagroso. Máquina de reciclaje de objetos y cosméticos con su tienda. **Revisar el tiempo para completar la Pokédex** (hoy ~2 años solo con tiradas) | |
| 3 | Personalidad y vínculo | Amistad (compañero, bayas, expediciones, victorias) con efectos en los duelos y evoluciones por amistad. El compañero trae objetos (con tope). Huerto de bayas | Hecha (server/bond.js, vista Huerto) |
| 4 | Animaciones de Pokémon | Sprites animados de Showdown (con imagen estática de respaldo) en reposo, ataque, golpe y desmayo, partículas por tipo, evolución y eclosión | |
| 5 | Criadero | Grupos huevo, sexo o Ditto. Herencia de IVs, naturaleza (Piedra Eterna) y movimientos huevo. Método Masuda. Pasos ganados jugando. La tarifa retira monedas | |
| 6 | Expediciones AFK | Zonas con tipos favorecidos, duración de 1/4/8/12 h. Recompensas en objetos, caramelos y polvo, con monedas con tope. EXP, amistad y EVs | |
| 7 | Duelos 2.0 | Equipos de 3 a 6, turnos con elección a ciegas, movimientos reales, físico/especial, bonus por tipo propio, críticos, estados, cambios, habilidades simplificadas y Megas. Gimnasios, Liga, Torre Batalla, clasificatoria por temporadas e incursiones cooperativas | |

## C. Rebalance final

Cuando estén las fases 1–7, nueva pasada de equilibrio: simulación de 30 días con las nuevas fuentes (expediciones, criadero, evolución) y tests de que no se crean monedas de la nada.

## Orden

A1 → A2 → A3 → A4–A7 (en paralelo, son pequeños) → B1 → B2 → B3 → B4 → B5 → B6 → B7 → C.

## Reglas de economía (todas las fases)

- Las recompensas nuevas son sobre todo objetos, caramelos y EXP. Lo que dé monedas lleva tope diario y un gasto que lo compense.
- Hay nivel mínimo y límites diarios por cuenta. Lo conseguido recientemente no se puede vender a los NPC hasta pasado un tiempo.
- Cada fase añade un test de que las monedas no aparecen de la nada.

## Hecho hasta ahora (resumen)

Plan nocturno (móvil, PWA, rendimiento, social, historial, economía, eventos, seguridad); Gacha sin pity con animación y
banners rotativos; Mercado estilo Albion con NPC; balance global; avisos de riesgo; evento Megaevolución; Desafío
Pokémon; copias de seguridad; topes del panel de anfitrión; corrección del abuso con candado y alerta de saldos
sospechosos.
