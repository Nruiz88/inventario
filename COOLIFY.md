# Desplegar un microservicio nuevo

Esto no es la guía de "cómo se despliega". Es la lista de **los fallos que pasaron de verdad**, para no repetirlos.

---

## 1. La tabla de sesiones necesita RLS sin políticas

La migración `db/001_sesiones.sql` la crea. Si te olvidas de la línea:

```sql
alter table inventario_sesiones enable row level security;
```

entonces `authenticated` puede leer **todas** las sesiones del sistema, y con eso los tokens. Con RLS encendido y **sin políticas**, la tabla es invisible para el navegador y solo la alcanza la secret key.

---

## 2. ⚠️ En Coolify: `is_preview` tiene que ser FALSE

**Este es el que más rato costó.**

Las variables de entorno que se crean por la API de Coolify vienen marcadas `is_preview: true`, lo que significa *solo para despliegues de preview*. En un despliegue normal **no llegan al contenedor**.

El síntoma: el servicio arranca y dice

```
[db] falta SUPABASE_URL o SUPABASE_SECRET_KEY
```

y en Coolify, en la lista, están todas puestas.

Lo que hay que hacer: marcar `is_preview = false` en cada una. O desde la interfaz, que el interruptor se llame algo como "Available at Preview" y deba estar apagado.

Cómo comprobarlo, que es lo que de verdad sirve:

```bash
# dentro del contenedor
docker exec <contenedor> env | grep SUPABASE
```

Si no salen, es esto.

---

## 3. Dos clientes de Supabase, y no uno

- `SUPABASE_SECRET_KEY` para el servidor. Salta RLS.
- `SUPABASE_PUBLISHABLE_KEY` para el cliente con token de usuario. Aplica RLS.

Se confunden porque las dos se llaman "la clave de Supabase". Si las pones cambiadas, la app funciona en local (donde el error es el mismo) y en producción se rompe de formas distintas según qué ruta se ejecutó.

La de RLS empieza por `sb_secret_`; la de usuario es más corta y empieza por `sb_publishable_`.

---

## 4. `SERVICE_SECRET` tiene que ser IGUAL al del panel

Y distinto de `SESSION_SECRET`.

Si no coinciden, el canje devuelve 401 con "ese enlace no vale", que no dice nada de por qué. **Lo primero que hay que mirar si da 401 es si los dos secretos tienen la misma longitud.** Esa comparación la resuelve el fallo en un minuto.

---

## 5. La cookie en producción necesita `secure`

```ts
secure: process.env.NODE_ENV === "production"
```

Sin esto, detrás de un proxy HTTPS el navegador **descarta la cookie entera** y el servicio parece roto sin decir nada: entra, canjea bien, y a la siguiente página no hay sesión.

Ojo con esto: `request.url` puede decir `http` aunque el navegador venga por `https`, si no se leen las cabeceras del proxy. `secure` se decide con `NODE_ENV`, no con `request.url`.

---

## 6. El `matcher` del proxy, o la app va lentísima

```ts
matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"]
```

El `.*\\..*` saca de la lista todo lo que tiene un punto: los `.js`, `.css`, las imágenes. Sin eso, una página con 40 recursos hace 40 consultas a la tabla de sesiones para comprobar una cookie que no ha cambiado.

No es solo la base: son 40 `await` en el camino crítico de la primera pintura, y en un móvil se nota.

---

## 7. El proxy NO es la seguridad

Solo evita pintar páginas vacías. La seguridad son las políticas de RLS.

Un servicio que se apoya solo en el middleware tiene un fallo de seguridad con toda la pinta de funcionar: con `searchParams.get("id")` sin comprobar, el proxy deja pasar la petición, RLS filtra `bots` pero no tu tabla, y nadie se entera hasta que alguien ve datos ajenos.

**La regla:** el id siempre sale de una función que usa el cliente con RLS. Nunca de la URL.

---

## 8. La firma se comprueba ANTES de deserializar

Si primero haces `JSON.parse` del payload y luego compruebas la firma, alguien puede mandarte un payload arbitrario y lo deserializas antes de comprobar nada.

El orden correcto: cortar por el punto, comprobar la firma, y solo entonces leer el cuerpo.

---

## 9. ⚠️ El `.env.example` NO lleva claves de verdad

Un `.example` con la clave real escrita es una bomba de relojería: el día que alguien lo sube, la clave está en el repositorio para siempre.

En este repositorio ya había uno con claves de producción de verdad (`EVOLUTION_API_KEY`, `WEBHOOK_SECRET`, la URL de MariaDB con contraseña). Estaba ignorado por `.gitignore`, así que no se había filtrado, pero se borró igualmente.

Lo que va en un `.example` es la **forma** de la variable, no su valor.

---

## 10. El test tiene que ejecutar el código que se rompe

El bug más caro que ha habido en este sistema: la entrada al bot **nunca funcionó desde un navegador**, y todas las pruebas daban verde.

La página mandaba el hash con el prefijo `ticket=` pegado. Las pruebas hacían el POST ellas mismas, con el ticket ya limpio, y **no pasaban por esa línea**. El bug no estaba en el servidor, estaba en el navegador, y no había ningún test que lo ejecutara.

Cómo se cubre:

- El parseo del hash va en **su propio fichero** (`hash-ticket.ts`), no dentro del componente. Así se puede probar sin React ni DOM.
- La prueba importa **ese fichero**, no una copia. Una copia se queda vieja el primer día que cambia el original y sigue dando verde.
- Y hay una prueba que **mira el JavaScript publicado** y comprueba que recorta el prefijo. Es frágil a propósito: si el minificador cambia de forma, que falle antes que pasar sin mirar.

---

---

## 11. ⚠️ RLS hay que ENCENDERLO, no solo escribir las políticas

Este es el segundo fallo más caro, y es del mismo tipo que el primero.

En `db/003_rls.sql` se crearon todas las políticas. En seis tablas
faltaba la línea:

```sql
alter table inv_productos enable row level security;
```

**Una tabla con políticas y RLS apagado no filtra nada.** Las políticas
existen, están escritas, son correctas... y no se miran. La consulta
devuelve filas de otros clientes sin decir nada, y todo parece
funcionar.

No hay error. No hay aviso. Es la forma más silenciosa de tener un
agujero de seguridad.

Dos cosas que lo hacen más fácil de que pase:

- **Una migración de políticas y una de RLS separadas fallan por
  separado.** Si escribes las políticas y se rompe algo en medio, unas
  quedan y otras no, y la de RLS se queda sin aplicar.
- **Nadie mira `relrowsecurity`.** Leer el SQL y ver que falta un
  `enable` es fácil. Acordarse de mirar después, no.

Por eso `db/005_rls_encendido.sql` existe y enciende RLS **en todas**,
también en las que ya lo tenían. Y por eso `npm run test:base` comprueba
`relrowsecurity` tabla por tabla, incluida `inventario_migrations`: sin
RLS, cualquiera que pueda escribir en la base podría modificar el
registro de migraciones y hacer que la siguiente creyera que ya está
aplicada.

La regla: **RLS encendido y sin políticas = invisible para el
navegador.** Con políticas = solo lo que corresponde. Nunca al revés.

---

## 12. ⚠️ Los triggers se prueban contra la base, no con unit tests

Un trigger que no dispara **no da ningún error**. La venta se guarda, el
stock no baja, y el dueño vende más de lo que tiene durante semanas sin
darse cuenta.

`vitest` no ejecuta triggers: para probarlos hay que ir contra la base
real. De ahí `npm run test:base` (`db/test-reglas.js`).

Tres fallos reales que encontró, y que ninguna prueba unitaria habría
visto:

- **El trigger de caja se disparaba en el INSERT**, cuando el total
  todavía era 0 (los ítems se añaden después, y el total lo calcula
  otro trigger). Metía en caja una entrada de 0, y la base la rechazaba
  con un error de `check constraint` que no decía qué constraint era.
- **`anular_venta` usaba `if new.anulada and not old.anulada`.** Con
  anular → desanular → anular, que es lo que pasa cuando alguien se
  equivoca dos veces, el stock se devuelve **dos veces**. La corrección
  es comprobar si YA hay un movimiento de devolución, que depende del
  historial y no de un campo que alguien puede cambiar.
- **Una compra en borrador movía el stock.** Si se creara el movimiento
  al crear el pedido, un pedido olvidado descontaría mercadería que nunca
  llegó. El movimiento sale al pasar a `recibida`.

---

## 13. ⚠️ Los errores de tipos tienen que parar el despliegue

```ts
typescript: { ignoreBuildErrors: false }
```

`next.config.ts` lo pone a `false` por defecto para que la compilación
no tarde un minuto y medio cada vez que tocas un fichero. El problema es
que entonces un error de tipos **no impide desplegar**: la app se
levanta y el error aparece en producción.

En este servicio salió así: un `.lte(undefined)` que no filtraba nada
parecía un filtro roto y no daba error; y un
`inv_productos.nombre` que era `undefined` en pantalla porque PostgREST
devolvió el JOIN como array en vez de objeto.

Un minuto de typecheck es un coste conocido. Un fallo de tipos en
producción es un cliente que no puede entrar.

---

## 14. ⚠️ `useState` NO es "correr esto al montar"

En `src/app/entrar/page.tsx` la primera versión hacía:

```tsx
useState(() => { /* canjea el ticket */ });
```

`useState` evalúa su inicializador **también en el servidor**, y ahí
`window` no existe. El build falla con
`ReferenceError: window is not defined`, que no señala que el problema es
un `useState` usado como `useEffect`.

Para correr una vez al montar es `useEffect(() => { ... }, [])`. Solo
corre en el navegador.

---

## 15. La plantilla trae ficheros que Next no lee

`src/lib/acceso/proxy.ts` en la plantilla era código muerto: Next carga
el middleware desde `src/proxy.ts`. Peor: `scripts/conexiones.mjs` lo
buscaba **solo ahí**, así que si faltaba reventaba con un ENOENT y no
llegaba a avisar de nada. El validador que debía avisar de un problema se
caía él mismo por el problema.

Lo mismo con `src/lib/panel.ts`, `tsconfig.json`, `next.config.ts` y
`src/app/layout.tsx`: la plantilla no los traía, y sin ellos no compila.

---

## El orden, para no perder el día

1. `npm install`
2. `npm run migrate` (con el `DATABASE_URL` del panel)
3. `npm run test:base` — **antes de desplegar**. Comprueba triggers y RLS
4. Poner las variables, con `is_preview = false`
5. Comprobar con `docker exec <contenedor> env`
6. `npm run build` — los errores de tipos paran aquí, no en producción
7. Desplegar
8. Registrar el módulo en el panel: `modules.url` y la fila para que salga en el portal
9. **Abrir el enlace en un navegador de verdad.** Es el paso que detecta el punto 10 y no lo sustituye ninguna prueba

---

## Comprobar que la conexión está bien

Es lo que hay que mirar cuando algo va mal, en este orden:

| Síntoma | Dónde mirar |
|---|---|
| `[db] falta SUPABASE_URL` | Punto 2. Las variables no llegan al contenedor |
| 401 "ese enlace no vale" | Punto 4. Los secretos no coinciden |
| El canje va bien y luego no hay sesión | Punto 5. Falta `secure` |
| Va lento y el log está lleno de lo mismo | Punto 6 |
| El panel da 503 al entrar | El panel, no este servicio. Mirar su log |
| 401 solo en el navegador, nunca en los tests | Punto 10. Es el fragmento |
| **Se ven datos de otro cliente y nada falla** | Punto 11. RLS apagado con políticas escritas |
| **La venta se guarda pero el stock no baja** | Punto 12. Un trigger que no dispara no da error |
| El build pasa y en producción no se ve un nombre | Punto 13. El typecheck estaba desactivado |
| El build falla con `window is not defined` | Punto 14. `useState` usado como `useEffect` |
| Se ven páginas sin sesión, o el validador peta con ENOENT | Punto 15. Ficheros donde Next no los lee |