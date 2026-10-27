# 🎰 PokéCasino

Casino Pokémon **online y multijugador** para jugar con tus amigos en una red privada. Monedas ficticias, sin dinero real. Proyecto de uso personal y no comercial; Pokémon y sus nombres son marcas de Nintendo / Game Freak / The Pokémon Company. Los sprites se cargan desde el repositorio público [PokeAPI/sprites](https://github.com/PokeAPI/sprites).

## Qué incluye

| Sección | Descripción |
|---|---|
| 🎰 **Pika-Slots** | Tragamonedas 3×3 con 5 líneas, Ditto comodín y **bote progresivo compartido** entre todos los jugadores (3 Master Ball en la línea central). |
| 🎡 **Ruleta de Tipos** | 18 tipos + casilla Poké Ball. Apuestas a tipo (×18), grupo (×3) y par/impar (×2). |
| ⚡ **Voltorb Flip** | El minijuego de HeartGold/SoulSilver con 8 niveles, pistas por fila/columna y notas. |
| 🏁 **Gran Carrera** | Carreras **en directo** cada ~45 s: todos ven la misma carrera y apuestan a la vez. |
| ⚔️ **Duelos PvP** | Reta a otros entrenadores con un Pokémon de tu colección. Combate por turnos con tabla de tipos completa. |
| 🎁 **Poké Gacha** | 4 banners (Kanto, Aves legendarias, Mewtwo/Mew, Johto), pity suave (60) y duro (80), garantía de rara cada 10, 50/50 de destacado, variocolores 1/64 y tirada gratis diaria. |
| 📕 **Pokédex** | 161 Pokémon (Kanto + invitados de Johto). Estrellas por copias, compañero que da bonus a tus ganancias, regalos entre jugadores. |
| ✦ **Tienda Estelar** | Fabrica Pokémon con polvo estelar o cámbialo por monedas. |
| 💬 **Social** | Chat con menciones `@nombre`, actividad en vivo, jugadores conectados, fichas de entrenador, ranking y regalos de monedas. |
| 👑 **Anfitrión** | El primer usuario registrado es administrador: invitaciones de un solo uso, ajustar monedas, suspender, cambiar contraseñas. |

Extras: recompensa diaria con racha, Centro Pokémon (préstamo si te quedas sin monedas), niveles de entrenador, sonidos 8-bit sintetizados y diseño adaptado a móvil.

Todas las tiradas se resuelven en el servidor con `crypto` (el cliente nunca decide un resultado). RTP aproximados: slots ~96 % (incluido el bote), ruleta 94,7 %, carrera ≤ 90 %, Voltorb Flip ~95 % con una estrategia razonable (calibrado por simulación), duelos con 5 % de comisión.

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
npm test   # RTP de las máquinas, pity del gacha, Voltorb Flip, combate y filtro de red
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
  games/          slots, roulette, voltorb, race, duel, battle
public/
  index.html, css/style.css
  js/core.js      Utilidades, sprites públicos, sonidos
  js/main.js      Acceso, conexión y navegación
  js/views/*.js   Una vista por sección
```
