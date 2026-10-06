# =========================================================
   Desplegar en Coolify
   ---------------------------------------------------------
   Esto no es "cómo se despliega". Es lo que hay que poner, en el orden
   en que hay que ponerlo, y los sitios donde se equivocó alguien antes.

   Lo que hay aquí son fallos que pasaron de verdad en este proyecto. Los
   que no han pasado están en la documentación de Coolify.

   ── ESTÁ DESPLEGADO ──
   ------------------------
   | | |
   |---|---|
   | URL | `https://inventario.panel-niconqn.duckdns.org` |
   | App | `inventario` — `vu36zj9mmqnczlirdkdoifpv` |
   | Build pack | `dockerfile` |
   | Build | `npm run build` dentro del `Dockerfile`, no de Coolify |

   Verificado con 28 comprobaciones contra el servicio real, firmado
   el ticket con el código del panel: `empresa/db/probar-produccion.mjs`.

   ── EL ORDEN, Y POR QUÉ EN ESTE ──
   ---------------------------------
   1. Código en un repositorio, con remoto.
   2. Aplicar las migraciones.
   3. Crear la app en Coolify apuntando al repositorio.
   4. Poner las variables.
   5. Desplegar.
   6. Registrar el módulo en el panel.
   7. Abrir el enlace en un navegador de verdad.

   Las migraciones van ANTES del primer despliegue, y no por purismo. Si
   el contenedor arranca sin tablas, el proxy deja pasar, la sesión se
   crea, y la primera consulta falla con "relation inv_ventas does not
   exist". Un cliente ve una pantalla en blanco y el log dice algo que no
   tiene nada que ver con la causa.

   Al revés también falla: si primero desplegás y después aplicás las
   migraciones, hay una ventana en la que la app está publicada y no
   funciona. Con un solo cliente no pasa nada. Con dos, sí.

   ── LO QUE VA EN VARIABLES DE ENTORNO ──
   ---------------------------------------
   Estas siete, y solo estas:

   | Variable | De dónde sale |
   |---|---|
   | `SUPABASE_URL` | `.env.local` de este proyecto |
   | `SUPABASE_SECRET_KEY` | ídem. **Empieza por `sb_secret_`** |
   | `SUPABASE_PUBLISHABLE_KEY` | ídem. Empieza por `sb_publishable_` |
   | `SERVICE_SECRET` | ídem. **Tiene que ser IGUAL al del panel** |
   | `BUSINESS_TIMEZONE` | `America/Argentina/Buenos_Aires` |
   | `APP_URL` | El dominio de este servicio |
   | `NEXT_PUBLIC_PANEL_URL` | El panel. Sin barra final |

   ### Lo que NO va

   - **`DATABASE_URL`**. Lleva la contraseña de la base dentro y solo la
     usan las migraciones, que corren en tu máquina. Meterla en el
     contenedor es poner una contraseña en un sitio donde antes no
     estaba.

     Y la app no la lee nunca: `src/lib/db.ts` se vale de las dos claves
     de Supabase. Por eso no sale en `.env.example` como obligatoria.

   - **`NODE_ENV`**. Coolify lo pone solo. Ver el punto 5.

   - **`PORT`**. Lo asigna Coolify. Si lo fijás, el contenedor escucha en
     un puerto que el proxy no busca, y el health check falla sin decir
     por qué.

   ── EL SECRETO COMPARTIDO ──
   --------------------------
   `SERVICE_SECRET` tiene que ser **carácter por carácter** el mismo que
   el del panel. Si difieren, el canje responde 401 y el mensaje es "ese
   enlace no vale", que no dice nada de por qué.

   **Lo primero que hay que mirar si da 401 es comparar las LONGITUDES.**
   Si no coinciden, ya sabés lo que es, y se resuelve en un minuto.

   ─────────────────────────────────────────────────────────────────────
   1. ⭐ EL TICKET, Y POR QUÉ NO SE COMPRUEBA EN EL SERVIDOR
   ─────────────────────────────────────────────────────────────────────

   El acceso lo comprueba el proxy (cookie) y las políticas de RLS. El
   proxy **no es la barrera de seguridad**: solo evita pintar páginas
   vacías a quien no tiene sesión. La barrera son las políticas.

   Un servicio que se apoya solo en el middleware tiene un fallo de
   seguridad con toda la pinta de funcionar.

   ─────────────────────────────────────────────────────────────────────
   2. ⭐ `is_preview` TIENE QUE SER FALSE
   ─────────────────────────────────────────────────────────────────────

   **Este es el que más rato costó, y ya costó dos veces.**

   Las variables que se crean por la API de Coolify vienen marcadas
   `is_preview: true`, que significa *solo para despliegues de preview*.
   En un despliegue normal **no llegan al contenedor**.

   El síntoma: el servicio arranca y dice

       [db] falta SUPABASE_URL o SUPABASE_SECRET_KEY

   y en Coolify, en la lista, están todas puestas.

   Lo que hay que hacer: marcar `is_preview = false` en cada una. O desde
   la interfaz, que el interruptor se llame algo como "Available at
   Preview" y deba estar **apagado**.

   Cómo comprobarlo, que es lo que de verdad sirve:

       docker exec <contenedor> env | grep SUPABASE

   Si no salen, es esto.

   ─────────────────────────────────────────────────────────────────────
   3. ⭐ `NEXT_PUBLIC_*` SE HORNEAN EN EL BUILD
   ─────────────────────────────────────────────────────────────────────

   `NEXT_PUBLIC_PANEL_URL` se sustituye al compilar y queda **dentro del
   JavaScript** que baja el navegador. Cambiarla después no cambia nada
   hasta que se reconstruya la imagen.

   El síntoma: la app levanta, todo funciona, y los enlaces "vuelve a tu
   panel" llevan al sitio anterior. Sin ningún error en ningún log.

   Es la trampa más silenciosa de Next en Docker, y por eso el
   `Dockerfile` avisa de ella en mayúsculas.

   ─────────────────────────────────────────────────────────────────────
   4. ⭐ `output: "standalone"` O LA IMAGEN NO ARRANCA
   ─────────────────────────────────────────────────────────────────────

   El `Dockerfile` copia `.next/standalone`. Si `next.config.ts` no tiene
   `output: "standalone"`, esa carpeta no existe y el build falla.

   El error aparece al final de la compilación de Docker, después de dos
   minutos instalando dependencias, y no dice nada de por qué.

   ─────────────────────────────────────────────────────────────────────
   5. ⭐ `NODE_ENV=production` EN EL BUILD
   ─────────────────────────────────────────────────────────────────────

   Coolify avisa de esto y acierta: con `NODE_ENV=production` en el paso
   de build, `npm ci` **salta las devDependencies**. Este proyecto
   compila con TypeScript, y `typescript` es una devDependency.

   O no se marca "Available at Buildtime", o se pone
   `NODE_ENV=development` **solo durante el build**. El runner ya pone
   `NODE_ENV=production` en el `Dockerfile`.

   ─────────────────────────────────────────────────────────────────────
   6. ⭐ EL TYPECHECK PARTA EL DESPLIEGUE, Y AQUÍ SÍ
   ─────────────────────────────────────────────────────────────────────

   `next.config.ts` tiene `typescript.ignoreBuildErrors: false`. Eso
   significa que un error de tipos **corta el build**.

   Es deliberado, y es la diferencia con el bot: `D:\webs\wweb` tiene
   `ignoreBuildErrors: true`, así que el bot que está en producción
   despliega con los errores de tipos que quiera.

   Un minuto de typecheck es un coste conocido. Un fallo de tipos en
   producción es un cliente que no puede entrar.

   Antes de desplegar, en local:

       npm run test:base      # 38 comprobaciones contra la base
       npm run test:entrada   # 13 del camino de acceso
       npm run test:dashboard  # 36 del CRUD
       npm run build

   Las tres primeras van contra la base real y son las que encuentran los
   fallos que no se ven leyendo el código.

   ─────────────────────────────────────────────────────────────────────
   7. ⭐ COPIAR LAS MIGRACIONES, NO SOLO LAS TABLAS
   ─────────────────────────────────────────────────────────────────────

   Este servicio tiene **funciones** además de tablas: las que mueven el
   stock (`inv_registrar_venta`, `inv_ajustar_stock`), la regla de
   acceso (`tiene_inventario`) y los triggers.

   Sin esas funciones, el servicio arranca y **cada venta falla**. No
   hay error al arrancar: hay un 409 cuando alguien cobra.

   Se aplican antes del despliegue, desde la máquina:

       npm run migrate
       npm run migrate:estado     # tiene que decir 0 pendientes

   ─────────────────────────────────────────────────────────────────────
   8. ⭐ LAS POLÍTICAS RLS, Y QUE EXISTAN
   ─────────────────────────────────────────────────────────────────────

   Una tabla con RLS encendido y **cero políticas** es invisible. No
   falla: la consulta devuelve cero filas, sin error.

   Pasó aquí con `inv_ventas`. El síntoma era que el POST de una venta
   devolvía 200 con el total correcto, y un segundo después el historial
   venía vacío y anular daba 404.

   Para comprobarlo:

       node db/test-reglas.js

   Incluye una comprobación de que toda tabla de negocio con RLS tiene al
   menos una política. Esa comprobación no estaba, y por eso el fallo
   pasó.

   ─────────────────────────────────────────────────────────────────────
   9. ⭐ EL MATCHER DEL PROXY, O LA APP VA LENTÍSIMA
   ─────────────────────────────────────────────────────────────────────

       matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"]

   El `.*\\..*` saca de la lista todo lo que tiene un punto. Sin eso, una
   página con 40 recursos hace 40 consultas a la tabla de sesiones para
   comprobar una cookie que no ha cambiado.

   No es solo la base: son 40 `await` en el camino crítico de la primera
   pintura, y en un móvil se nota.

   ─────────────────────────────────────────────────────────────────────
   10. ⭐ LA COOKIE EN PRODUCCIÓN NECESITA `secure`
   ─────────────────────────────────────────────────────────────────────

       secure: process.env.NODE_ENV === "production"

   Sin esto, detrás de un proxy HTTPS el navegador **descarta la cookie
   entera** y el servicio parece roto sin decir nada: entra, canjea
   bien, y a la siguiente página no hay sesión.

   `request.url` puede decir `http` aunque el navegador venga por
   `https`, si no se leen las cabeceras del proxy. `secure` se decide con
   `NODE_ENV`, no con `request.url`.

   ─────────────────────────────────────────────────────────────────────
   11. EL CERTIFICADO
   ─────────────────────────────────────────────────────────────────────

   El dominio tiene que tener el certificado válido **antes** del primer
   despliegue, o el navegador lo rechaza al entrar y el canje falla.

   Con los subdominios de duckdns: Let\'s Encrypt los emite, pero
   Coolify tiene que resolver el dominio. Si el DNS todavía no apunta,
   falla y no hay nada que ver.

   ─────────────────────────────────────────────────────────────────────
   12. LO QUE NO SE DESPLIEGA
   ─────────────────────────────────────────────────────────────────────

   El `.dockerignore` deja afuera `db/*.mjs`, y a propósito: `db/demo-kiosco.mjs`
   mete datos de ejemplo **en la base real** si alguien lo lanza dentro
   del contenedor.

   Las migraciones también quedan afuera, y también a propósito. Se
   aplican desde la máquina, una vez, antes del despliegue. Un contenedor
   que aplica migraciones al arrancar es un contenedor que dos instancias
   pueden aplicar a la vez.

   ─────────────────────────────────────────────────────────────────────
   EL CHECKLIST DE ARRIBA
   ─────────────────────────────────────────────────────────────────────

       1.  npm run test:base
       2.  npm run test:entrada
       3.  npm run test:dashboard
       4.  npm run build
       5.  git push
       6.  npm run migrate          ← desde la máquina
       7.  npm run migrate:estado   ← tiene que decir 0 pendientes
       8.  App en Coolify: build pack Dockerfile, puerto 3000
       9.  Las 7 variables, con is_preview = FALSE
       10. docker exec <contenedor> env | grep SUPABASE   ← tiene que salir
       11. Poner modules.url en el panel, con la URL pública
       12. Abrir el enlace en un navegador de verdad

   El 12 no lo sustituye ninguna prueba. Es el que detectó el bug más
   caro del bot, y el 10 es el que detecta el problema del 2.

   ─────────────────────────────────────────────────────────────────────
   ─────────────────────────────────────────────────────────────────────
13. ⭐ BORRAR `.next` CON EL SERVIDOR CORRIENDO PIERDE LAS VARIABLES
─────────────────────────────────────────────────────────────────────

Este no pasa en producción. Pasa en local, y es el que más costó
diagnosticar porque **el síntoma no dice nada de variables de entorno**.

Con `next dev` corriendo en otra terminal, un `npm run build` o un
borrado manual de `.next` elimina el directorio que el servidor tiene
abierto. Next lo ve, avisa

    The directory at ".next\dev" was deleted.
    Deleting this directory while Next.js is running can lead to
    undefined behavior. Restarting the server to recover...

y se reinicia. **Ese reinicio pierde el `.env.local`.**

Lo que se ve después, en este orden:

    [db] falta SUPABASE_URL o SUPABASE_SECRET_KEY — no se puede leer ni escribir
    [entrar] ticket rechazado: no-verifica
    POST /api/entrar 401

Y lo que se piensa: que el `SERVICE_SECRET` del panel y el de aquí no
coinciden. Es la conclusión más razonable y en producción suele ser la
correcta, así que uno compara longitudes de secretos idénticos, firma
tickets a mano, y acaba suspectando del base64.

La causa real: `verificar()` devuelve `null` en cuanto falta el secreto,
porque su primera línea es

    if (!secret) return null;

Es decir, **"no hay secreto" y "la firma no cuadra" devuelven
exactamente lo mismo**: 401 con "ese enlace no vale". Y el mensaje al
usuario es el mismo en los dos casos, a propósito, para no decirle a
alguien que está probando firmas cuál de los dos es.

Cómo distinguirlo sin adivinar: el log. `[db] falta SUPABASE_URL` es la
línea que lo dice, y sale al arrancar. Si está, el problema son las
variables, no el secreto.

Dos formas de no caer en esto:

  · No borrar `.next` mientras el servidor corre. Para un build limpio,
    parar el servidor primero.

  · `npm run conexiones` avisa de variables que faltan. Correrlo tras un
    reinicio raro es más rápido que comparar firmas.

En el contenedor **no puede pasar**: allí `.next` no se borra en
caliente y las variables vienen del entorno de Coolify, no de un
fichero.

─────────────────────────────────────────────────────────────────────
14. ⭐ EL HEALTH CHECK NECESITA wget EN LA IMAGEN
─────────────────────────────────────────────────────────────────────

Este falló tres despliegues seguidos, y el error no apunta a la causa.

    Attempt 10 of 10 | Healthcheck status: "unhealthy"
    Healthcheck logs: /bin/sh: curl: not found
    wget: can't connect to remote host: Connection refused
    New container is not healthy, rolling back to the old container.

Lo que engaña: el aviso habla de la salud de la aplicación, y la
aplicación estaba perfecta. Dos líneas más abajo, en el log del
propio contenedor:

    ▲ Next.js 16.3.8  Ready in 0ms  Network: http://0.0.0.0:3000

Levantada y escuchando. Lo que falla es que **nadie puede
preguntarle cómo está**, porque `node:22-alpine` no trae ni `curl`
ni `wget`. Coolify hace diez intentos, los diez fallan por falta de
herramienta —no por salud—, y deshace el despliegue.

Se arregla con una línea en el `Dockerfile`:

    RUN apk add --no-cache wget

Cuándo aplica: a **cualquier** despliegue con build pack Dockerfile
en Coolify. No es de esta aplicación. El bot y la web usan
`railpack`, que trae sus propias herramientas, y por eso no lo
sufren.

Lo que sale después del arreglo, y merece la pena verlo:

    Healthcheck logs: /bin/sh: curl: not found  | Return code: 0
    Attempt 1 of 10 | Healthcheck status: "healthy"

El `curl: not found` sigue ahí y ya no importa: Coolify cae al
`wget`, que sí está, y la primera comprobación pasa.

─────────────────────────────────────────────────────────────────────
15. ⭐ LOS SECRETOS NO SON `buildtime`
─────────────────────────────────────────────────────────────────────

Al compilar, BuildKit avisa:

    SecretsUsedInArgOrEnv: Do not use ARG or ENV instructions for
    sensitive data (ARG "SERVICE_SECRET")

Y tiene razón. Coolify pasa las variables marcadas `buildtime` como
**argumentos de build**, y un ARG no se borra: queda en el historial
de la imagen, a la vista con `docker history`. En un servicio con
`SUPABASE_SECRET_KEY` y `SERVICE_SECRET` ahí dentro.

Solo una variable debe ser `buildtime`:

| Variable | buildtime | por qué |
|---|---|---|
| `NEXT_PUBLIC_PANEL_URL` | **sí** | Next la sustituye al compilar y acaba en el JS del navegador |
| las otras seis | **no** | solo se usan en runtime |

`is_runtime = true` para las siete, `is_buildtime = true`
únicamente para `NEXT_PUBLIC_PANEL_URL`.

Cómo se comprueba que un ARG no se coló:

```bash
docker history --no-trunc <imagen> | grep -iE "SERVICE_SECRET|SECRET_KEY"
```

Si sale algo, el secreto está en la imagen.

─────────────────────────────────────────────────────────────────────
16. ⭐ CAMBIAR EL DOMINIO POR SQL NO BASTA
─────────────────────────────────────────────────────────────────────

El síntoma, después de cambiar `fqdn` correctamente y desplegar:

- la app responde `200` por dentro del contenedor
- el contenedor está `healthy`
- el `fqdn` en la base es el nuevo
- **el dominio público da connection refused**

La causa: Coolify no le pasa el `fqdn` a Traefik. Le pasa las
etiquetas de Traefik ya montadas, y las monta desde la columna
`custom_labels`, que es un **base64 de texto**. Ese texto lo escribe
Coolify cuando cambias el dominio en la interfaz. Si cambias el
`fqdn` con `UPDATE`, `custom_labels` se queda con lo anterior.

Para verlo, comparar la etiqueta del contenedor con la columna:

```bash
docker inspect <contenedor> --format '{{json .Config.Labels}}' \
  | tr ',' '\n' | grep 'routers.https.*rule'
# traefik.http.routers.https-0-<uuid>.rule = Host(`<UUID>.panel-...`)
```

El UUID en la regla, cuando el `fqdn` ya dice `inventario.panel-...`.

Solución: que sea el código de Coolify quien regenere las
etiquetas, no escribirlas a mano. La función es
`generateLabelsApplication($app)`:

```php
$app->custom_labels = base64_encode(
    str(implode('|coolify|', generateLabelsApplication($app)))
        ->replace('|coolify|', "\n")
);
$app->save();
```

Es la misma línea que ejecuta la interfaz en
`app/Livewire/Project/Application/Domains.php`.

Un detalle que sale solo: si hubo un rollback, quedan **dos**
contenedores del mismo proyecto y Traefik se queja en bucle

    Router defined multiple times with different configurations

y descarta ambos, así que el dominio deja de responder aunque el
contenedor nuevo esté perfecto. Borra el contenedor viejo.

─────────────────────────────────────────────────────────────────────
17. ⭐ CONFIGURAR LA APP SIN API: POR ELOQUENT, NUNCA POR SQL
─────────────────────────────────────────────────────────────────────

Si no hay token de la API de Coolify —el de este proyecto caducó—, se
puede configurar desde dentro del contenedor:

```bash
docker cp coolify-vars.php coolify:/var/www/html/
docker exec coolify php /var/www/html/artisan tinker /var/www/html/coolify-vars.php
```

`db/generar-coolify.mjs` genera ese PHP con los valores de
`.env.local`, en base64 para no tener que escapar nada.

**Por qué Eloquent y no SQL.** Tres motivos, y cada uno costó un
despliegue:

**a) El valor va cifrado.** La columna `value` tiene el cast
`'encrypted'`. Lo que está en la base no es el valor: es el valor
cifrado con la `APP_KEY` de Coolify. Insertar el texto en claro por
SQL produce una fila correcta en todo lo que se puede mirar desde
fuera, y que Coolify no puede leer:

    Illuminate\Contracts\Encryption\DecryptException
    The payload is invalid.

**b) El tipo del morph tiene que ser la clase entera.**
`resourceable_type` vale `App\Models\Application`, **no `App`**.
Laravel resuelve el morph por el nombre de la clase, y si no
encuentra `App` descarta la fila en silencio. Las variables están
escritas, con los valores correctos, y la interfaz no muestra
ninguna.

**c) Y las barras invertidas no se escapan.** En un literal de
Postgres, con `standard_conforming_strings` activo —el valor por
defecto desde 9.1—, lo que va entre comillas se guarda tal cual.
Si el generador escapa `\`, se acaba guardando
`App\\Models\\Application` con dos barras, que tampoco encaja.

Los tres fallos se esconden igual: desde la tabla de Postgres, la
variable parece puesta.

**Cómo comprobarlo sin fiarse de la tabla.** Con la misma llamada que
hace la pantalla:

```php
$app = \App\Models\Application::where('uuid', '<uuid>')->first();
$app->environment_variables()->count();
```

Si sale 0, hay un problema de morph o de cifrado, aunque la tabla
`SELECT` devuelva filas.

Para desplegar, el helper que usa la API:

```php
queue_application_deployment(
    application: $app,
    deployment_uuid: new_public_id(),
    force_rebuild: true,
    is_api: false,
    no_questions_asked: true
);
```

Copia y pegado de
`app/Http/Controllers/Api/ApplicationsController.php`.

─────────────────────────────────────────────────────────────────────
18. ⭐ UN TOKEN DE PRUEBA FALSO PRODUCE 200 Y LUEGO 500 EN TODO
─────────────────────────────────────────────────────────────────────

Este lo Seas uno mismo al probar, y es el que más cuesta reconocer
porque el canje **funciona**:

    [entrar] no se pudo crear la sesión Error: insert or update on
    table "inventario_sesiones" violates foreign key constraint
    "servicio_sesiones_user_id_fkey"

Son **dos** cosas a la vez, y por eso el 500 no dice nada útil:

**El `user_id` del ticket tiene que existir.** Hay clave foránea a un
usuario de `auth`. Un id inventado revienta al crear la sesión, no
antes.

**El `access_token` tiene que ser real.** Si no, la sesión se crea
igual, el canje responde 200, la cookie se pone, el contenedor está
sano… y todas las APIs dan:

    [resumen] no se pudo leer el stock: JWT cryptographic operation failed

Que parece un problema de la secret key o de la base. No es nada de
eso: `SUPABASE_SECRET_KEY` estaba bien, con el md5 correcto. El token
era de mentira.

Un ticket con token falso **no da 401**. Da 200. Es lo que hace la
prueba engañosa.

Cómo evitarlo: la prueba busca un usuario real, inicia sesión con él
para sacar un token de verdad, y avisa si no encuentra credenciales,
en vez de inventarse un token:

    node db/probar-produccion.mjs

─────────────────────────────────────────────────────────────────────
CUANDO ALGO VA MAL
─────────────────────────────────────────────────────────────────────
   ─────────────────────────────────────────────────────────────────────

   | Síntoma | Dónde mirar |
   |---|---|
   | `[db] falta SUPABASE_URL` | Punto 2. Las variables no llegan |
   | 401 "ese enlace no vale" | `SERVICE_SECRET` no coincide, **o faltan las variables**. Punto 13 |
| 403 "no tiene este servicio contratado" | El cliente no lo tiene. **No es un fallo.** Se comprueba con `tiene_modulo` |
| 500 + "JWT cryptographic operation failed" | `access_token` falso en el ticket. Punto 18 |
| 500 + "violates foreign key ... user_id_fkey" | `user_id` inventado en el ticket. Punto 18 |
| Las variables no salen en la interfaz | `resourceable_type` mal, o valor sin cifrar. Punto 17 |
| El dominio da connection refused pero el contenedor está sano | `custom_labels` con el dominio viejo. Punto 16 |
| Rollback con "container is unhealthy" | Falta `wget` en la imagen. Punto 14 |
   | El canje va bien y luego no hay sesión | Punto 10. Falta `secure` |
   | Va lento, el log lleno de lo mismo | Punto 9 |
   | Los enlaces del panel van al sitio viejo | Punto 3. Hay que Rebuild |
   | El build falla al final, en Docker | Punto 4. Falta `standalone` |
   | El build falla al compilar | Punto 5. Faltan devDependencies |
   | Venta con 409 | Punto 7. Faltan las funciones |
   | El historial vacío pero el POST devuelve 200 | Punto 8. Políticas |
   | No entra en el navegador, el panel va bien | El panel, no este servicio |
   | 401 solo en el navegador, nunca en las pruebas | El fragmento `#ticket=` |

   ─────────────────────────────────────────────────────────────────────
   LO QUE PASA DESPUÉS
   ─────────────────────────────────────────────────────────────────────

   Pendiente de rotar, y sin relación con el despliegue:

     · `EVOLUTION_API_KEY`, que además tiene un valor débil y adivinable.
     · Los tokens de Supabase.
     · La clave SSH que quedó expuesta.