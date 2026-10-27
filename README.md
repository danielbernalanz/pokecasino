# 🎰 PokéCasino

Casino Pokémon **online y multijugador** para jugar con tus amigos en una red privada. Monedas ficticias, sin dinero real. Proyecto de uso personal y no comercial; Pokémon y sus nombres son marcas de Nintendo / Game Freak / The Pokémon Company. Los sprites se cargan desde el repositorio público [PokeAPI/sprites](https://github.com/PokeAPI/sprites).

## Qué incluye

**12 juegos** (4 multijugador en tiempo real), gacha, mercado y objetos:

| Juego | Tipo | Descripción |
|---|---|---|
| ♠️ **Texas Hold'em** | Multijugador | Póker No-Limit en 3 mesas (ciegas 10/20, 50/100, 250/500). Botes paralelos, all-in, 25 s por turno, sin comisión de la casa. |
| 🚀 **Crash Rocket** | Multijugador | El multiplicador sube hasta que el Team Rocket sale volando; retírate a tiempo (manual o automático). |
| 🏁 **Gran Carrera** | Multijugador | Carreras en directo cada ~45 s; todos ven la misma carrera. |
| ⚔️ **Duelos PvP** | Multijugador | Reta a otros entrenadores con tus Pokémon; combate con tabla de tipos. |
| 🃏 **Blackjack** | Mesa | 6 barajas, 3:2, doblar, dividir, el crupier se planta en 17. |
| 🂡 **Video Póker** | Mesa | Jacks or Better 9/6. |
| 🎴 **Baccarat** | Mesa | Punto, Banca (0,95:1) y Empate (8:1) con reglas oficiales de tercera carta. |
| 🎡 **Ruleta de Tipos** | Mesa | 18 tipos + casilla Poké Ball. |
| 🎰 **Pika-Slots** | Máquina | 5 líneas, Ditto comodín y bote progresivo compartido. |
| 🔻 **Plinko** | Máquina | 12 filas, riesgo bajo/medio/alto, varias bolas a la vez. |
| 💣 **Minas Geodude** | Máquina | 5×5, de 1 a 24 Geodude, retírate cuando quieras. |
| ⚡ **Voltorb Flip** | Máquina | El minijuego de HeartGold/SoulSilver con 8 niveles. |

**Colección y economía**

- 🎁 **Poké Gacha**: 4 banners, pity suave (60) y duro (80), rara garantizada cada 10, 50/50 de destacado, variocolores 1/64, tirada gratis diaria.
- 📕 **Pokédex** de 161 Pokémon con estrellas por copias y compañero que da bonus a tus ganancias.
- 🎒 **Objetos**: Ticket Gacha, Caramelo Raro, Huevo Suerte (XP ×2), Moneda Amuleto (+10 % ganancias), Amuleto Iris (variocolor ×4) y Master Ball (legendaria asegurada). Los cuatro primeros se compran en la Tienda Poké; los dos últimos solo se consiguen como premio (subir de nivel, racha diaria, tiradas ×10, Voltorb Flip) o en el Mercado.
- 🏪 **Mercado** entre jugadores: vende Pokémon (normales o variocolor), objetos y polvo estelar a precio fijo. Lo publicado queda en depósito hasta que se vende, se retira o caduca (7 días); el comprador confirma el precio, nadie puede comprar su propio anuncio y la casa cobra un 5 %. Muestra el precio medio de las últimas ventas.

**Social**: chat con menciones `@nombre`, actividad en vivo, conectados, fichas de entrenador, ranking, regalos, recompensa diaria con racha, niveles y panel de anfitrión (invitaciones, monedas, suspensiones, contraseñas).

Todos los resultados se calculan en el servidor con `crypto`. RTP aproximados: Video Póker 99,5 % (juego óptimo), Blackjack ~99,5 % (estrategia básica), Baccarat 98,9 %, Plinko 95,5–97,5 %, Crash y Minas 97 %, Slots ~96 %, Voltorb Flip ~95 %, Ruleta 94,7 %, Carrera ≤ 90 %. Subir de nivel devuelve ~2,5 % de lo apostado.

## Puesta en marcha

Requisitos: Node.js 18 o superior.

```bash
npm install
npm start
```

Al arrancar verás en consola algo así:

```
🎰 PokéCasino escuchando en http://0.0.0.0:3000
🔒 Modo de red: private
🔑 Código de invitación maestro: 3F9A1C7B2E04
```

1. Abre `http://localhost:3000`, pulsa **Registrarse** y usa el código maestro. Serás el anfitrión (admin).
2. Comparte con tus amigos la dirección del servidor y el código maestro, o genera **invitaciones de un solo uso** desde el panel 👑 Anfitrión.

Los datos se guardan en `data/db.json` (jugadores, colecciones, chat). Haz copia de esa carpeta si quieres conservar las partidas.

## Acceso restringido

El servidor tiene dos capas de protección:

1. **Filtro de red** (`NETWORK_MODE=private`, por defecto): solo acepta conexiones desde loopback, redes LAN (`10.x`, `172.16-31.x`, `192.168.x`), enlaces locales y el rango CGNAT `100.64.0.0/10` que usan **Tailscale** y otras VPN. Cualquier IP pública recibe un 403.
2. **Invitación obligatoria**: nadie puede crear cuenta sin el código maestro o una invitación de un solo uso. Las contraseñas se guardan con `scrypt` y hay límite de intentos fallidos por IP.

### Jugar con amigos fuera de tu casa

La opción recomendada es una VPN privada como [Tailscale](https://tailscale.com/) o ZeroTier: instálala en el servidor y en los dispositivos de tus amigos, y conéctate a `http://<ip-tailscale-del-servidor>:3000`. Funciona sin abrir puertos del router y sin cambiar nada de la configuración.

Si prefieres exponerlo detrás de un proxy inverso con HTTPS, usa `TRUST_PROXY=1` y añade las IPs permitidas con `ALLOW_CIDRS`, o `NETWORK_MODE=any` para depender solo de las invitaciones.

## Alojarlo en la nube (sin PC propio)

Todo se hace desde el navegador, también desde el móvil. En la nube no hay red privada, así que el acceso queda protegido **solo por las invitaciones**: `NETWORK_MODE=any` ya viene configurado en el `Dockerfile` y en `render.yaml`.

### Railway (recomendado: datos persistentes, ~5 USD/mes)

1. Entra en [railway.com](https://railway.com) con tu cuenta de GitHub.
2. **New Project → Deploy from GitHub repo** → elige `pokecasino` (rama `main` una vez fusionado el PR). Railway usa el `Dockerfile` automáticamente.
3. En el servicio: **Variables** → añade `ACCESS_KEY` con un código secreto que elijas (será el código de invitación maestro).
4. **Click derecho sobre el servicio → Attach Volume** con ruta de montaje `/data`. Ahí se guardan las cuentas y colecciones; sin volumen se pierden en cada reinicio.
5. **Settings → Networking → Generate Domain**. Esa URL `https://….up.railway.app` es la que compartes con tus amigos.

### Render (gratis, para probar)

1. Entra en [render.com](https://render.com) con GitHub → **New → Blueprint** → elige el repositorio; usa `render.yaml`.
2. El código maestro está en **Environment → ACCESS_KEY** (generado automáticamente).
3. Limitaciones del plan gratuito: se duerme tras 15 min sin visitas (tarda ~1 min en despertar) y **no tiene disco persistente**, así que las cuentas y monedas se borran cada vez que se reinicia. Para conservarlas hace falta un plan de pago con disco montado en `/data` y `DATA_DIR=/data`.

### Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP. |
| `HOST` | `0.0.0.0` | Interfaz de escucha (`127.0.0.1` para solo local). |
| `NETWORK_MODE` | `private` | `private` = solo LAN/VPN; `any` = cualquier IP (solo invitaciones). |
| `ALLOW_CIDRS` | — | Rangos extra permitidos, separados por comas: `203.0.113.7/32,198.51.100.0/24`. |
| `ACCESS_KEY` | aleatorio | Código maestro. Si no se define se genera y se guarda en `data/config.json`. |
| `TRUST_PROXY` | — | `1` si estás detrás de un proxy inverso (usa `X-Forwarded-For`). |
| `DATA_DIR` | `./data` | Carpeta de datos. |

## Desarrollo

```bash
npm test   # RTP, pity, póker (conservación de fichas en 300 manos), mercado, combate y filtro de red
```

```
server/
  index.js        Express + Socket.IO, eventos, chat, administración
  auth.js         Registro con invitación, sesiones, scrypt
  netguard.js     Filtro de IP privada / VPN
  db.js           Almacén JSON con escritura atómica
  hub.js          Economía (apuestas, pagos, niveles, compañero) y difusión
  pokedex.js      Datos de Pokémon, rarezas y tabla de tipos
  gacha.js        Banners, pity, variocolores y tienda de polvo
  items.js        Objetos, Tienda Poké y efectos
  market.js       Mercado entre jugadores con depósito
  cards.js        Baraja y evaluador de manos de póker
  games/          holdem, crash, race, duel, battle, blackjack, videopoker,
                  baccarat, roulette, slots, plinko, mines, voltorb
public/
  index.html, css/style.css
  js/core.js      Utilidades, sprites públicos, sonidos
  js/main.js      Acceso, conexión y navegación
  js/views/*.js   Una vista por sección
```
