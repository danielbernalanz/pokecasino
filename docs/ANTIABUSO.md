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
- Puntos de Batalla: solo en combates, 30/día (CPU) + 20/día (PvP con mínimo de turnos y 3 combates/rival); intransferibles y sin conversión a monedas; los PNJ no compran lo que se paga con PB (`test/bp.test.js`).
- Máquina MT: fabricar cuesta monedas (`tm_craft`) y materiales; los PNJ no compran MT ni materiales y su tope teórico sería ≤ 25 % del coste (`test/tm.test.js`). Botín de materiales: 12/día en expediciones y 15/día en combates; MT de premio: 1/día por vía (`tm.js`).
- Desafío Pokémon: multiplicadores ajustados a la precisión reciente del jugador, preguntas que no se repiten
  y tope de ganancia neta diaria de 25 × su apuesta máxima (`test/quiz.test.js`).
- Combates PvP: suma cero menos un 5 %; las apuestas se guardan y se pagan una sola vez aunque el casino se
  reinicie (`test/showdown.test.js`).

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
