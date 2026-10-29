# Migrar la base de datos (antes de que caduque)

La base de datos **gratuita** de Render se borra a los 30 días si no se mejora de plan. La actual caduca el **26 de noviembre de 2026**. Si caduca sin copia, se pierden todas las cuentas, monedas y Pokémon. Esta guía te lleva paso a paso; solo necesitas el panel de Render y esta conversación.

> Antes de nada, **descarga una copia** (vale para las tres opciones):
> 1. Entra en el casino con tu cuenta de anfitrión y abre **Admin**.
> 2. En la tarjeta «💾 Copias de seguridad» pulsa **⬇️ Descargar copia**.
> 3. Guarda el archivo `pokecasino-AAAA-MM-DD.json` en un sitio seguro (tu correo, Drive…).
>
> Repite la descarga de vez en cuando: el casino te recuerda si llevas más de 7 días sin hacerlo.

Aviso en el panel: define en el servicio web la variable `DB_EXPIRES=2026-11-26` y, desde 3 semanas antes, verás un aviso con los días que quedan.

## Opción A: mejorar el plan de la base de datos (la más fácil)

No se pierde nada ni hay que mover datos.

1. En el panel de Render, abre la base de datos Postgres del casino.
2. Entra en **Settings** / **Instance type** (o «Upgrade»).
3. Elige un plan de pago. **Consulta el precio actual en Render** (página de precios de Postgres): tiene un coste mensual.
4. Confirma. La base deja de caducar y el casino sigue igual.
5. Quita la variable `DB_EXPIRES` del servicio web para que desaparezca el aviso.

## Opción B: crear otra base gratuita en Render y migrar

Hazlo **antes** del día de caducidad y con la copia ya descargada. Las bases gratuitas nuevas vuelven a durar 30 días, así que tendrás que repetirlo cada mes: solo merece la pena como solución temporal.

1. Descarga la copia (arriba).
2. En Render pulsa **New → PostgreSQL**, plan **Free**, y créala.
3. Cuando esté lista, copia su **Internal Database URL** (o la External si el servicio está en otra región).
4. Abre el servicio web del casino → **Environment** → cambia `DATABASE_URL` por la nueva URL y guarda. Render reiniciará el servicio.
5. El casino arrancará **vacío** (sin cuentas): es lo esperado.
6. Regístrate de nuevo con tu usuario de anfitrión (la primera cuenta creada es la de anfitrión) y abre **Admin**.
7. Pulsa **♻️ Restaurar…** y elige el archivo `.json` descargado. Confirma: el casino se reinicia con todos los datos.
8. Comprueba que están las cuentas y el saldo. Actualiza `DB_EXPIRES` con la nueva fecha de caducidad (30 días desde hoy).
9. Cuando todo esté bien, borra la base antigua.

### Alternativa con el script (si prefieres copiar directamente)

Con el servidor parado o sin actividad, desde un ordenador con Node 22:

```
npm install
node scripts/migrate-db.js <URL_BASE_ANTIGUA> <URL_BASE_NUEVA>
node scripts/migrate-db.js --from-file pokecasino-2026-11-10.json <URL_BASE_NUEVA>
```

El primero copia de una base a otra (estado y copias diarias); el segundo carga un archivo descargado. Se niega a escribir en una base que ya tenga datos salvo que añadas `--force`. Usa las URLs **externas** (acaban en `.render.com`) y con `?sslmode=require`.

## Opción C: otro proveedor con Postgres gratuito (Neon, Supabase…)

1. Crea una cuenta y un proyecto con Postgres gratuito en Neon o Supabase. Revisa en su web las condiciones actuales del plan gratis (límites, pausas por inactividad).
2. Copia la cadena de conexión (`postgresql://usuario:clave@host/base?sslmode=require`).
3. En Render, servicio web → **Environment** → cambia `DATABASE_URL` por esa cadena.
4. Sigue desde el paso 5 de la opción B: el casino arranca vacío, te registras y usas **♻️ Restaurar…** con tu archivo.

## ¿Prefieres que lo haga Claude?

Si me lo pides en este chat, puedo hacer los pasos con las herramientas de Render: crear la base nueva, cambiar `DATABASE_URL` del servicio web, lanzar el despliegue y comprobar los registros. Lo único que tendrás que hacer tú es **descargar la copia** y **restaurarla** desde el panel de Admin (o pasarme el archivo para usar el script).

## Si algo sale mal

- No borres la base antigua hasta comprobar que todo funciona en la nueva.
- El casino también guarda 14 copias diarias dentro de la propia base; si migras con el script, se copian también.
- Si el casino no arranca tras cambiar `DATABASE_URL`, revisa que la URL esté completa y que incluya `?sslmode=require` si es externa.
