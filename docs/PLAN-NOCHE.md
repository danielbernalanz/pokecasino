# Plan de actualizaciones nocturnas

Trabajo autónomo (sin confirmaciones), en fases independientes. Cada fase termina con:
tests (`npm test`) + pruebas de navegador + commit + despliegue en Render + comprobación en los logs.
Si una fase falla y no se puede arreglar con seguridad, se revierte y se pasa a la siguiente.

| # | Fase | Contenido | Estado |
|---|------|-----------|--------|
| 1 | Móvil | Barra de navegación inferior, cabecera compacta, ventanas como hojas inferiores, cada juego adaptado a 360–430 px y apaisado, botones táctiles ≥ 44 px, sin scroll horizontal, sin zoom al escribir, zonas seguras (notch) | ✅ |
| 2 | App instalable (PWA) | Manifiesto, iconos, *service worker* con red primero (sin versiones viejas en caché), página sin conexión, «Añadir a pantalla de inicio» | ✅ |
| 3 | Rendimiento | Compresión gzip, caché de estáticos con versión, Pokédex de 1.025 con carga progresiva, menos datos iniciales | ✅ |
| 4 | Social | Mensajes privados (`/w nombre`), emotes de Pokémon en el chat, avisos al móvil (vibración) en tu turno de póker / duelo aceptado / venta en el Mercado | ✅ |
| 5 | Historial y perfil | Historial personal de partidas y movimientos de monedas, gráficas en «Mi Entrenador» | ✅ |
| 6 | Panel del anfitrión | Estadísticas de economía (monedas totales, fuentes y sumideros, jugadores activos), registro de acciones del anfitrión | ✅ |
| 7 | Eventos | Calendario semanal (Duelos sin comisión, Misiones ×2, Mercado sin impuesto, Variocolor ×2 y Compañero ×2 el fin de semana) anunciado en el Vestíbulo; el anfitrión puede lanzar eventos. Se descartó «XP doble»: duplicaría la devolución por nivel y algún juego daría dinero seguro | ✅ |
| 8 | Seguridad y calidad | Cabeceras de seguridad, límites de registro, CI de GitHub con `npm test`, más tests | ✅ |
| 9 | Regresión final | Todas las pruebas de navegador en escritorio y móvil, informe final para el usuario | |
