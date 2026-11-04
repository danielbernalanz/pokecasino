# Auditoría antiabuso (29-10-2026)

Objetivo: casino casual. Se puede ganar bastante jugando, pero nadie debe poder sacar una ventaja exagerada
repitiendo una mecánica, con cuentas secundarias o con el panel de anfitrión.

## Monedas que no salen de apostar (máximo por jugador y día)

| Fuente | Máximo | Notas |
|---|---|---|
| Recompensa diaria | 1.000 + 150 × racha (hasta 1.900) | |
| Combates contra la CPU | 800 | 10 victorias pagadas al día; perder no cuesta |
| Encargos de los NPC | ≈ 1.000 extra con legendarios (4.500 con dos cosméticos legendarios) | 2 al día; el NPC paga de su tesoro |
| Expediciones | 300 (+ ≈ 250 en polvo y objetos) | |
| Hallazgos del compañero | 200 (+ 40 ✦) | |
| Primera visita a cada apartado | 750 en total, una sola vez | |
| Misiones, medallas y niveles | Progresión, no se repiten | |
| Enfermera Joy | 1.000 cada 4 h, solo con menos de 200 monedas | Red de seguridad; no se puede regalar ni pagar de más en 24 h |

Un jugador muy activo saca como mucho unas 4.000–5.000 monedas al día sin apostar, menos que la apuesta máxima
de nivel 1 (10.000). Todos los juegos tienen ventaja de la casa (ver BALANCE.md).

## Bucles cerrados (tests)

- Liberar, transferir, reciclar o vender a un NPC nunca devuelve más de lo que cuesta conseguirlo
  (`test/balance.test.js`, `test/npc.test.js`, `test/candy.test.js`, `test/progression.test.js`).
- Criadero: la tarifa supera lo que vale el bebé (`test/daycare.test.js`).
- Evolución + transferir: la EXP de cada fuente tiene tope diario por ejemplar y en el botín; las evoluciones ocurren en su nivel real, así que el máximo teórico es ≈ 2.250 ✦ al día (≈ 9.000 monedas, con 30 duplicados escogidos a mano) y el típico ≈ 585 monedas (`test/progression.test.js`, `test/candy.test.js`). Los Caramelos Exp. no se compran con monedas ni los comercian los PNJ.
- Puntos de Batalla: solo en combates, 30/día (CPU) + 20/día (PvP con mínimo de turnos y 3 combates/rival); intransferibles y sin conversión a monedas; los PNJ no compran lo que se paga con PB (`test/bp.test.js`).
- Fragmentos del Tutor: 3/día desde expediciones; los PNJ no los comercian (`test/tutor.test.js`).
- Máquina MT: fabricar cuesta monedas (`tm_craft`) y materiales; los PNJ no compran MT ni materiales y su tope teórico sería ≤ 25 % del coste (`test/tm.test.js`). Botín de materiales: 12/día en expediciones y 15/día en combates; MT de premio: 1/día por vía (`tm.js`).
- Desafío Pokémon: multiplicadores ajustados a la precisión reciente del jugador, preguntas que no se repiten
  y tope de ganancia neta diaria de 25 × su apuesta máxima (`test/quiz.test.js`).
- Combates PvP: suma cero menos un 5 %; las apuestas se guardan y se pagan una sola vez aunque el casino se
  reinicie (`test/showdown.test.js`).

## EVs, vitaminas y objetos de evolución

- Los EVs no tienen valor en monedas. Las fuentes gratuitas (Expediciones 60/día, combates CPU 48/día por ejemplar) cuelgan de actividades que ya tienen tope propio. Las vitaminas (1.000) y bayas de EVs (300) son un sumidero de monedas; los NPC las tratan como cualquier objeto de tienda (nunca compran por encima del 60 % ni venden por debajo del precio).
- Los objetos de evolución (piedras 2.000, objetos raros 5.000) se compran con monedas y se gastan al evolucionar: no hay ciclo comprar → vender que gane monedas (el NPC paga como mucho el 60 % del precio de tienda) y reciclar da solo el 40 % en polvo.

## Torre Batalla

- Da PB (tope **40/día**), títulos y, solo cuando cobra PB (o sea, dentro de ese tope), un Caramelo Exp. M al cerrar ronda y, al vencer a un Jefe, una Chapa de Botella (una al día); nunca monedas. Los PNJ no compran nada de eso. Los PB no se regalan ni se venden (ver arriba).
- Los equipos son de alquiler y se generan en el servidor (el cliente solo elige índices); el rival lo genera el servidor al empezar cada combate. Empatar, rendirse o abandonar acaba la carrera.
- Una cuenta secundaria puede sacar como mucho 40 PB al día en la Torre, igual que la principal: no aporta nada a la principal (los PB son intransferibles).

## Liga Pokémon (clasificatoria)

- Solo puntúan combates contra **otra cuenta**, con las dos cuentas de nivel ≥ 3 y ≥ 3 días (`transfer.young`), de **≥ 3 turnos** y como mucho **5 combates puntuados al día contra el mismo rival** (los dos formatos comparten el cupo; el emparejamiento ya evita al rival con el cupo lleno y la liquidación lo vuelve a comprobar). Quedan fuera de la puntuación, pero siguen siendo combates normales.
- Rendirse, agotar el tiempo (3 turnos sin elegir) o abandonar (15 min) cuentan como derrota; no hay forma de «huir» sin perder tras 3 turnos.
- Sin apuesta ni monedas por combate: no se pueden pasar monedas perdiendo adrede. El máximo que puede dar la Liga a una cuenta es 2.000 monedas por temporada (y solo a Master Ball / Top 3 con ≥ 5 / ≥ 10 combates), más PB, marcos y títulos (no comerciables los títulos).
- Win-trading con una cuenta secundaria: limitado a 5 combates/día (≈ ±80 puntos al día como mucho); las cuentas nuevas no puntúan.
- Pendiente: varias cuentas desde redes distintas siguen siendo posibles; el tope de monedas y que los premios sean sobre todo cosméticos limitan el incentivo.

## Cuentas secundarias

- Registro abierto: 3 cuentas nuevas por IP y día (IP real detrás del proxy de Render: `TRUST_PROXY_HOPS=3`).
- Regalar exige nivel 3 y 3 días de cuenta; cada cuenta recibe como mucho 5.000 monedas y 10 Pokémon
  (2 legendarios o míticos) regalados al día (`server/transfer.js`, `test/transfer.test.js`).
- En el Mercado, las cuentas nuevas o ayudadas por la Enfermera Joy en las últimas 24 h no pueden pagar más de
  3 × el precio mínimo de referencia (evita pasar monedas comprando caro).
- Los NPC solo compran a cuentas de nivel 3 y más de 24 h.

## Panel de anfitrión

- Topes: 10.000 por concesión y 50.000 al día; todo queda en el registro y en «En vivo» si se concede a sí mismo.
- Alerta de saldo sospechoso en el panel y auditoría en el registro del servidor en cada arranque.

## Pendiente / a vigilar

- Varias cuentas desde redes distintas (datos móviles) siguen siendo posibles; los topes de regalos limitan el daño.
- El Mercado entre jugadores veteranos admite cualquier precio (es su libertad); la alerta de saldo sospechoso
  avisa si alguien acumula sin explicación.

## EXP, Caramelos Exp., Chapas y Pokérus

- **EXP** solo se gana combatiendo contra la CPU (victorias premiadas, 10 al día) y en expediciones, con un **tope diario por ejemplar** (≥ 24.000 EXP, ≈ 5 niveles) que un jugador no puede saltarse con cuentas secundarias (la EXP no se transfiere). Los combates PvP no dan EXP.
- **Caramelos Exp.:** sin precio en monedas; se pueden vender entre jugadores como cualquier objeto, pero sus fuentes tienen tope (combates 12.000 EXP/día, expediciones 8/día + 1 L, Tienda de Combate ≤ 9.000 EXP/día por los PB, Torre y Liga). Pasar caramelos a una cuenta secundaria no aporta nada que no pueda conseguir ella con esos mismos topes.
- **Chapas** (Entrenamiento Extremo): solo PB, Torre (1 al día) y Liga (mensual); IV reales intactos, así que no hay forma de «criar» IV perfectos con ellas.
- **Pokérus:** 1/3.000 por victoria o expedición, solo duplica los EVs (que ya tienen tope diario por ejemplar); no crea monedas ni EXP.
- **Migración de caramelos:** una sola vez por cuenta (`u.expMig`), tras una copia de seguridad, y solo convierte lo que la cuenta ya tenía; los valores se redondean hacia arriba, nunca hacia abajo. No se puede repetir ni forzar desde el cliente.
