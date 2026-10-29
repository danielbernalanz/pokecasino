# Despliegue: variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `TRUST_PROXY` | — | `1` si estás detrás de un proxy inverso (Render, Cloudflare…). Sin él se usa la IP de la conexión y se ignora `X-Forwarded-For`. |
| `TRUST_PROXY_HOPS` | `1` (con `TRUST_PROXY=1`) | Cuántos proxies de confianza hay delante de la app. Se toma la entrada de `X-Forwarded-For` que está esa cantidad de posiciones **desde la derecha** (1 = la última, la que añade Render). Las entradas de la izquierda las puede escribir el cliente y se ignoran, así los límites por IP (registro, bloqueo de inicio de sesión) no se pueden esquivar falsificando la cabecera. Si hay otro proxy delante de Render (p. ej. Cloudflare), pon `2`. **En Render (oct. 2026) llegan 3 entradas, así que en producción está a `3`.** |
| `DB_EXPIRES` | — | Fecha de caducidad de la base de datos gratuita (para el aviso a los jugadores). Ver `docs/MIGRAR-BASE-DE-DATOS.md`. |
| `OPEN_REGISTRATION` | — | `1` permite crear cuenta sin código de invitación (siguen los límites por IP). |
| `NETWORK_MODE` | `private` | `private`: solo LAN/VPN (Tailscale, ZeroTier, loopback). `any`: sin filtro de IP. |
| `ACCESS_KEY` | generada | Clave maestra de invitación. Si no se define se genera una vez y se guarda en `config.json`. |
| `DATABASE_URL` | — | Cadena de conexión de PostgreSQL. Sin ella se guarda en archivos dentro de `DATA_DIR`. |

## Verificar los saltos de proxy

Al recibir la primera petición el servidor escribe en el registro una línea como:

    🌐 IP: cabeceras X-Forwarded-For con N entradas (saltos de confianza: 1)

No se registran direcciones. Si `N` es mayor que los saltos configurados, el cliente (o un proxy no contado) está añadiendo entradas; si es menor, hay menos proxies de los esperados. Ajusta `TRUST_PROXY_HOPS` hasta que coincidan.
