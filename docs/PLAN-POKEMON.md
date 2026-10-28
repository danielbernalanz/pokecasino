# Plan: Pokémon con personalidad

Cada fase la implementa un agente con un encargo cerrado. Después se revisa: tests, batería de navegador (escritorio y móvil) y comprobación de que no se crean monedas de la nada. Luego se hace commit y se despliega en Render.

| # | Fase | Contenido | Estado |
|---|------|-----------|--------|
| 1 | Pokémon únicos + Caja PC | Cada ejemplar es único: naturaleza, IVs, EVs, nivel, amistad, habilidad, 4 movimientos, sexo, objeto, mote. Las copias actuales se migran (con copia de seguridad) y las estrellas y el bonus de compañero se mantienen. Vista Caja PC con ficha detallada. Mercado: las órdenes de venta son de un ejemplar concreto y los pedidos de compra, por especie | |
| 2 | Repetidos y reciclaje | Transferir al Profesor Oak (caramelos de especie y polvo). Caramelos para subir nivel y evolucionar, también por piedra, amistad o intercambio, con animación. Entrenamiento de IVs con repetidos. Intercambio Milagroso. Máquina de reciclaje de objetos y cosméticos con su tienda de puntos | |
| 3 | Personalidad y vínculo | La amistad sube como compañero, con bayas, expediciones y victorias. Da efectos en los duelos, evoluciones por amistad y que el compañero traiga objetos (con tope). Huerto de bayas | |
| 7 | Animaciones de Pokémon | Sprites animados (Showdown) con respaldo estático. Reposo, ataque, golpe, desmayo, partículas por tipo, evolución y eclosión | |
| 4 | Criadero | Parejas por grupo huevo, sexo o Ditto. Herencia de IVs, naturaleza (Piedra Eterna) y movimientos huevo. Método Masuda. Pasos ganados jugando. Tarifa como sumidero de monedas | |
| 5 | Expediciones AFK | Zonas con tipos favorecidos y duraciones de 1, 4, 8 o 12 h. Recompensas sobre todo en objetos, caramelos y polvo, con monedas con tope. Experiencia, amistad y EVs para el equipo | |
| 6 | Duelos 2.0 | Equipos de 3 a 6. Turnos con elección a ciegas. Movimientos reales, físico/especial, bonus por mismo tipo, críticos, estados, cambios y habilidades simplificadas. Gimnasios, Liga, Torre Batalla, clasificatoria por temporadas e incursiones cooperativas | |

## Reglas de economía (todas las fases)

- Las recompensas nuevas son sobre todo objetos, caramelos y experiencia. Lo que dé monedas tiene tope diario y un sumidero que lo compense.
- Hay nivel mínimo y límites diarios por cuenta. Lo conseguido recientemente no se puede vender a los NPC hasta pasado un tiempo.
- Cada fase añade un test de conservación de monedas.
