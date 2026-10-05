# Inventario

Control de inventario y caja para comercios chicos y kioscos. Es un
microservicio de Nexo Studio: comparte la base y la identidad con el
panel, y no tiene usuarios propios.

## Qué hace

- **Productos y presentaciones.** Un producto agrupa sus presentaciones
  (`Gaseosa` → `500 ml`, `1,25 l`). El precio y el stock van en la
  presentación, que es la unidad que se vende.
- **Stock con historial.** Cada entrada y cada salida es un movimiento que
  no se borra ni se edita. Si algo se registró mal, se corrige con un
  movimiento contrario.
- **Ventas.** Se registran con el escáner o a mano. Descontan stock y
  anotan el total solas.
- **Compras a proveedor.** El pedido se puede dejar en borrador: el stock
  solo entra cuando la mercadería se recibe, no al anotar el pedido.
- **Caja y arqueo.** Todo lo que entra y sale del cajón, incluido los
  retiros del dueño. El arqueo **calcula** la diferencia: no la escribe
  nadie.
- **Cuentas corrientes.** Un libro de debe y haber, así se puede
  responder "desde cuándo me debe esto" y no solo cuánto.
- **Aviso de lo que falta facturar.** Este servicio **no emite
  comprobantes fiscales**. Solo apunta si alguien ya lo emitió en otro
  sistema y avisa qué ventas de hoy siguen sin número.

## Qué NO hace

- **No emite comprobantes fiscales.** Es otra cosa, con otra integración y
  otra base legal. Aquí solo se lleva el registro.
- **No tiene lotes ni vencimientos.** Un almacén con 20.000 referencias
  los necesita; un kiosco con 200 no, y esas tablas serían peso muerto.

## Empezar

```bash
npm install
cp .env.example .env.local     # y rellena
npm run conexiones              # comprueba que nada falta
npm run migrate                 # aplica db/*.sql
npm run dev
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run conexiones` | Valida la configuración antes de desplegar. Avisa de claves que faltan, secretos cortos, RLS apagada. |
| `npm run migrate` | Aplica las migraciones de `db/` que falten. |
| `npm run migrate:estado` | Solo muestra qué se aplicó y qué no. |
| `npm run test:base` | Comprueba los triggers y las RLS **contra la base real**. |
| `npm run test` | Las pruebas de código (no tocan la base). |
| `npm run build` | Compila. Los errores de tipos **paran** el despliegue. |

`npm run test:base` es la que importa antes de tocar las reglas: casi todo
el comportamiento del inventario está en triggers y políticas de la base,
que no se ejecutan en una prueba unitaria. Los datos de prueba se borran
al terminar, incluso si falla a medias.

Si una migración ya aplicada tenía un fallo:

```bash
node db/reverter.mjs 004_reglas.sql            # solo triggers y funciones
node db/reverter.mjs --tablas 002_inventario.sql   # ⚠️ borra las tablas
```

## Cómo está montado

```
db/001_sesiones.sql      Tabla de sesiones y sus políticas
db/002_inventario.sql   Productos, variantes, ventas, compras, caja, cuentas
db/003_rls.sql          Las políticas: una regla, quince tablas
db/004_reglas.sql       Los triggers: lo que vigila que los datos cuadren
db/005_rls_encendido.sql  Enciende RLS donde faltaba

src/lib/acceso/         La conexión con el panel: ticket, sesión, proxy
src/lib/dinero.ts       Centavos, fechas y márgenes
src/app/api/            resumen, productos, ventas
src/app/entrar/         Canje del ticket (el fragmento lo lee el navegador)
```

### La regla de oro

**El `client_id` sale siempre de la sesión. Nunca de la petición.**

```ts
// MAL: devuelve 0 filas si no tiene datos, y parece que filtra
db.from("inv_productos").select().eq("client_id", req.query.cliente)

// BIEN: RLS lo quita, y no hay nada que comprobar
db.from("inv_productos").select().eq("client_id", sesion.clientId)
```

Y detrás de eso está RLS: aunque el código se equivocara, la base no
devuelve filas de otro cliente. El proxy de Next **no** es la barrera de
seguridad, solo evita pintar una página vacía a quien no tiene sesión.

## Antes de desplegar

Lee `COOLIFY.md`. Y después del despliegue, **abre el enlace desde el
panel en un navegador de verdad**: las pruebas no ejecutan el fragmento
`#ticket=`, y ahí estuvo el fallo más caro de todo el proyecto.

## La plantilla

Este servicio salió de `D:\webs\plantilla-servicio`. Para el siguiente,
copia la plantilla y no esta carpeta: aquí ya hay quince tablas de un
negocio concreto.

Al copiarla hay que arreglar dos cosas que se encontraron usándola:

1. La tabla de sesiones se llama `servicio_sesiones`. Renómbrala con el
   nombre de tu servicio, en el `.sql` y en los cuatro ficheros de
   `src/lib/acceso/`.
2. `MODULO_ID` en `src/lib/acceso/sesion.ts` es `PON_AQUI_EL_ID_DEL_MODULO`.
   Sin esto, cualquier módulo contratado deja pasar.