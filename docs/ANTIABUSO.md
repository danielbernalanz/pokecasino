# Auditoría antiabuso (29-10-2026)

Objetivo: casino casual. Se puede ganar bastante jugando, pero nadie debe poder sacar una ventaja exagerada
repitiendo una mecánica, con cuentas secundarias o con el panel de anfitrión.

## Monedas que no salen de apostar (máximo por jugador y día)

| Fuente | Máximo | Notas |
|---|---|---|
| Recompensa diaria | 1.000 + 150 × racha (hasta 1.900) | |
| Combates contra la CPU | 800 | Premio real (clase × nivel más alto) con tope diario de 800 monedas y 10 victorias premiadas al día; la Moneda Amuleto y el Día de Pago cuentan dentro del tope; perder no cuesta |
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

## Medallas, Alto Mando y dinero de combate

- **Medallas:** solo las concede el servidor al ganar un combate contra el líder (`awardBadge`, una sola vez por medalla; la revancha no da nada). Rendirse o perder no cuenta; el rival CPU no se rinde. El orden de los gimnasios lo comprueba el servidor al empezar el combate (`trainers.unlocked`), no el cliente, que además no puede elegir formato ni nivel contra un líder (se fuerzan Individual y niveles reales). Las medallas antiguas se conservan.
- **Alto Mando:** el estado de la carrera (equipo, PS/PP/estados) vive en el servidor (`u.elite.run`); el cliente solo pide «empezar», «siguiente» o «abandonar» y no puede curar ni cambiar a su equipo entre combates. Los PS que se arrastran salen del estado final real del simulador. Abandonar vuelve a empezar desde Lorelei (equipo curado), igual que perder. Los premios del título (10.000 monedas, Master Ball, Marco) y la Moneda Amuleto de la primera vez se cobran una sola vez por cuenta (`awardChampion` mira el título; `E.amulet` la Moneda); las revanchas solo dan lo de cada combate dentro de los topes diarios.
- **Dinero de combate:** el premio sale de una fórmula del servidor (tabla de clases × nivel del equipo que genera el propio servidor), con **tope de 800 monedas al día** también para el Día de Pago y la Moneda Amuleto. Un jugador no puede inflar el Día de Pago alargando el combate más allá del tope (el combate dura lo que dure, pero el día paga como mucho 800). El Día de Pago se cuenta del registro del combate que genera el simulador, no de nada que mande el cliente.
- **Recogida:** 10 % por Pokémon y victoria premiada (el combate tiene que ganarse y estar dentro de las 10 premiadas), 5 hallazgos al día como máximo; sin monedas. Los objetos raros (Caramelo Raro, Piedras, Huevo Fortuna) tienen peso ≤ 6 % de los hallazgos, así que como mucho unos pocos al mes con las 5 diarias.
- **Moneda Amuleto:** objeto equipable comerciable como los demás de la Tienda de Combate; una cuenta secundaria no puede sacar más de 800 monedas al día de combates (con o sin ella) ni más de 1 Moneda por día de expediciones.

## Captura de Pokémon salvajes (server/capture.js)

- **Sin monedas:** capturar no da monedas, XP ni objetos. Cada captura cuesta Poké Balls (120-600 monedas) y el valor de reventa del Pokémon (polvo × 4 o PNJ) es siempre menor que el coste esperado de capturarlo, incluso con el jugador ideal que debilita gratis (`test/capture.test.js`, «economía»). Los PNJ no comercian con Balls (solo entre jugadores); reciclar una Ball da el 40 % de su precio.
- **Tope de 30 encuentros al día por jugador** (también huir o que escape gasta uno) y un único encuentro abierto. El encuentro vive en el servidor (`u.cap.enc`): especie, nivel, IV, naturaleza, tamaño, marca, variocolor y PS los decide el servidor al buscarlo y el cliente no ve IV, naturaleza, tamaño ni marca hasta capturarlo; no se puede tirar de nuevo un encuentro «malo» sin gastar uno de los 30.
- **Legendarios:** una sola captura por cuenta y especie (`u.cap.got`), un intento al día (`u.cap.lt`, se anota al empezar, así que huir o recargar no devuelve el intento) y requisitos de medallas/Campeón comprobados por el servidor. Una cuenta secundaria puede capturarlos, pero solo una vez cada uno, con las mismas medallas, y no puede traspasarlos más rápido que los topes de regalos (10 Pokémon y 2 legendarios al día; cuentas nuevas no regalan).
- **Evoluciones:** las tablas son las reales de los juegos; el valor de evolucionar un Pokémon capturado ya está acotado por los topes diarios de EXP y amistad («Evolución + transferir»), igual que con cualquier ejemplar del Gacha.
- **Apariciones masivas, clima y marcas:** deterministas por tramo de tiempo (iguales para todos, no dependen del jugador) o tiradas del servidor; no dan ventaja de monedas. Variocolor 1/1024.
- **Ejemplares capturados:** son ejemplares normales; al **regalarlos** conservan Ball, marca, tamaño, IV, naturaleza y habilidad oculta (no nivel ni EXP: la EXP no se transfiere); en el Mercado y con los PNJ (órdenes por especie, no por ejemplar) el comprador recibe un ejemplar nuevo. Los capturados no esquivan los topes de cuentas nuevas (`transfer.js`) ni los de los PNJ.
- **Herencia de Ball:** decidida por el servidor al recoger el huevo; la Master Ball nunca se hereda.

## Lotería ID (server/lottery.js)

- **Una comprobación al día por jugador** (`u.lot.day`), con el resultado guardado: recargar no lo repite. El número lo calcula el servidor con una semilla que no sale de él; mañana no se puede adivinar, y hoy solo lo ve quien ya lo ha comprobado.
- **Solo cuentan los Pokémon que tenías antes de las 00:00 UTC de hoy**: aunque alguien vea el número de hoy, no le sirve para fabricar un premio con regalos de última hora. Los ID ajenos solo se consiguen con regalos, que ya tienen tope (10 Pokémon y 2 legendarios al día por receptor; las cuentas nuevas no regalan).
- **Un único premio al día** (el del mejor ejemplar), sin monedas y de objetos baratos de conseguir; el único objeto realmente valioso (Master Ball) sale a 1 de cada 100.000 por ID y día. Una cuenta secundaria no cambia la cuenta: cada una tiene su ID y su propia comprobación diaria, pero sus premios son los mismos objetos de valor esperado ≈ 1 moneda al día.
- El **ID de entrenador** lo asigna el servidor y no se puede elegir ni cambiar.

## Teracristalización (server/tera.js, server/showdown.js)

- **El servidor decide** quién puede teracristalizar: el cliente solo envía `move N terastallize`; `Battle.choose` lo rechaza si el modo no lo permite o el jugador no tiene el Orbe, y la petición que llega al cliente ya sale sin `canTerastallize`. En PvP hace falta el Orbe **en los dos** (si no, la regla del simulador sigue activa) y nunca en la Clasificatoria.
- **Orbe Teracristal:** objeto clave, no comerciable ni reciclable ni vendible a PNJ; se entrega una sola vez (`u.teraOrb`), así que una cuenta secundaria no gana nada.
- **Teralitos:** solo salen de las Teraincursiones (con su tope diario, ver más abajo) y se gastan de 50 en 50 para cambiar un Teratipo: no dan monedas, los PNJ no los comercian y no se pueden reciclar.

## Teraincursiones (server/raid.js)

- **Todo lo decide el servidor:** jefes del día (hash de la fecha), PS, escudo, daño, aliados CPU, recompensas y captura. El cliente solo manda «movimiento N (con o sin Tera)»; la elección se valida (movimiento existente, Pokémon en pie, Orbe Teracristal y una sola Tera por incursión).
- **Tope de 10 incursiones premiadas por jugador y día** (`u.raid.n`, día UTC): a partir de la 11.ª se puede jugar pero no da nada (ni captura). Tope propio de **9.000 EXP de Caramelos Exp. al día** (`u.raid.exp`) y XP de entrenador plana dentro de su tope diario.
- **Participar de verdad:** hay que elegir movimiento en al menos un tercio de los turnos para cobrar; quien está en piloto automático o se ha ido (la CPU lleva su Pokémon) no cobra, así que no se puede «llevar» a cuentas inactivas para que cobren. Las cuentas secundarias tienen su propio tope de 10 y necesitan jugar sus turnos.
- **Sin monedas:** los premios son Teralitos (sin precio de tienda; los PNJ no los comercian), Caramelos Exp., Mentas, Cápsulas Habilidad y la captura del jefe. La captura **gasta una Ball cuyo precio supera el valor de reventa del Pokémon** (test para cada especie y estrella), así que capturar para liberar siempre pierde monedas. Los jefes son de rareza Común a Épica (nunca legendarios ni míticos).
- **Una sola incursión a la vez** por jugador; salas abiertas con 2 minutos de espera, máximo 4 jugadores y con las medallas de la estrella; el código privado es de 4 letras y la sala desaparece al empezar.
- **Capturas pendientes:** viven en la cuenta (`u.raid.claims`), se pueden reclamar durante 24 h, una sola vez cada una, y la Ball se gasta solo al capturar.
- **Persistencia y desconexiones:** el estado se guarda en cada cambio (`db.data.raids`); las fechas límite son marcas de tiempo, así que un reinicio no pierde turnos (se amplían) y un jugador desconectado se resuelve solo con el temporizador. Las incursiones terminadas se limpian a las 6 h.

## GTS (server/gts.js)

- **Todo lo valida el servidor:** el cliente solo manda «deposita este ejemplar y pide esto» u «ofrezco este ejemplar a este depósito». Se comprueba que el ejemplar es tuyo y está libre (no compañero, ni de expedición/Criadero, ni en un combate, carrera del Alto Mando o Teraincursión) y que cumple especie, sexo y nivel pedidos.
- **Atómico y sin carreras:** Node ejecuta cada acción de una vez; todo se valida antes de tocar nada y el depósito pasa a «hecho» en la misma acción, así que si dos personas ofrecen a la vez solo gana la primera (la segunda recibe «ya no está disponible» y no pierde nada). Un ejemplar sale de la Caja de una sola vez: no se puede ofrecer a dos depósitos ni quedarse con copia.
- **Mismos topes que los regalos** (`server/transfer.js`): hace falta nivel 3 y 3 días de cuenta y no haber sido ayudado por la Enfermera Joy en 24 h (para depositar, para ofrecer y también para el dueño al intercambiar), y cada cuenta recibe como mucho **10 Pokémon y 2 legendarios o míticos al día** (compartido con los regalos) y hace **5 intercambios al día** en la GTS.
- **Sin monedas entre jugadores:** solo hay una comisión de **150 monedas** por depositar (sumidero, no reembolsable), así que la GTS no sirve para pasar monedas ni para granjear: el trueque es 1×1 y el valor que se mueve queda acotado por los topes de arriba. Detalle del nivel y la EXP conservados en `docs/BALANCE.md`.
- **Nada ya ganado se pierde:** el ejemplar depositado se guarda entero (nivel, EXP, EVs, amistad, movimientos, objeto…) y vuelve intacto al retirar o caducar; si no cabe en la Caja (5 copias de la especie) espera guardado. Lo recibido que no cabe también espera en la GTS en vez de convertirse en polvo.
- **Pokédex «vista»:** solo se puede pedir una especie que hayas tenido (`u.dexSeen`, que se rellena al obtener un Pokémon y no se pierde al regalarlo o transferirlo), así no se usa la GTS para «ojear» el catálogo.
