-- =====================================================================
-- RLS del inventario (003)
-- =====================================================================
-- ⚠️  ESTO ES LO MÁS IMPORTANTE DE ESTE SERVICIO
-- ------------------------------------------------
-- Los patrones que hay en esta base incluyen `client_id` en casi todas
-- las tablas. Eso NO es una barrera: es una columna como cualquier otra, y
-- cualquiera que pueda escribir una consulta podría poner el
-- `client_id` de otro en un SELECT y ver sus datos.
--
-- Lo que impide eso es lo de abajo: políticas que comprueban la
-- pertenencia, con la MISMA sesión que usa el servicio.
--
-- Y todas se apoyan en `inventario_sesiones`, que es la tabla que crea
-- 001_sesiones.sql. Sin sesión viva, no hay acceso. Un token caducado o
-- revocado deja de dar acceso inmediatamente, y no hace falta esperar a
-- que expire nada más.
--
--
-- LA REGLA DE ORO
-- ----------------
--   El `client_id` SIEMPRE sale de la sesión.
--   Nunca de la petición.
--
--   MAL:   db.from("inv_productos").select().eq("client_id", req.query.cliente)
--   BIEN:  db.from("inv_productos").select().eq("client_id", sesion.clientId)
--
-- Con RLS, lo segundo funciona sin filtrar: la base ya quita lo que no es
-- suyo. Lo primero FUNCIONA IGUAL de visible y es un fallo de seguridad
-- con toda la pinta de funcionar, porque devuelve filas sin avisar.
--
--
-- POR QUÉ `security definer`
-- -------------------------
-- La función lee `inventario_sesiones` y `profiles`. Si no fuera
-- `security definer`, la política se ejecutaría con los permisos del
-- usuario que consulta, y no podría leer esas tablas — que es
-- justamente lo que estamos comprobando. Es el patrón de `es_cliente_de()`
-- (migración 001 del panel) y `es_dueno_de_bot()` (011), y no es
-- opcional: sin `search_path` fijo, la función se podría usar para leer
-- tablas de las que el usuario no tiene permiso.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. La regla única
-- ---------------------------------------------------------------------
-- Una función, y todas las políticas la usan. Si cada tabla tuviera la
-- suya, habría quince sitios donde un día se corrige uno y se olvidan
-- catorce.
--
-- Comprueba tres cosas, en este orden:
--
--   1. Que hay una sesión viva del usuario.
--   2. Que esa sesión es del cliente al que pertenece la fila.
--   3. Que el cliente sigue teniendo el servicio contratado.
--
-- La tercera parece redundante porque `exigeSession()` ya la comprueba
-- en cada petición. Sigue aquí a propósito: es la que hace que el
-- cliente pierda el acceso al instante si le caduca la suscripción, y
-- no solo cuando recargue.
create or replace function tiene_inventario(cliente_uuid uuid)
  returns boolean
  language sql stable security definer
  set search_path = public
  as $$
    select exists (
      select 1
      from inventario_sesiones s
      join profiles p on p.id = s.user_id
      where s.client_id = cliente_uuid
        and p.id = auth.uid()
        and s.revocado_en is null
        and s.expira_en > now()
    )
    and exists (
      select 1
      from suscripciones sub
      join profiles p on p.id = auth.uid()
      where sub.client_id = cliente_uuid
        and sub.module_id = 'inventario'
        and sub.estado in ('activo', 'prueba')
        and p.activo
    );
  $$;

comment on function tiene_inventario is
  'ÚNICA regla de acceso del inventario. Sesión viva + del mismo cliente + con el módulo contratado. Todas las políticas la usan.';


-- ---------------------------------------------------------------------
-- 2. Lo que tiene el `client_id` directo
-- ---------------------------------------------------------------------
-- Estas son las tablas donde el dato de quién es está en la propia fila,
-- así que la comprobación es directa.

do $$
declare
  t text;
begin
  foreach t in array array[
    'inv_productos', 'inv_proveedores', 'inv_compras', 'inv_clientes', 'inv_caja', 'inv_arqueos'
  ]
  loop
    execute format('drop policy if exists "leer sus %s" on %I', t, t);
    execute format(
      'create policy "leer sus %s" on %I for select to authenticated '
      || 'using (tiene_inventario(client_id))',
      t, t
    );

    /* INSERT no lleva `using`: una fila nueva no tiene `client_id` todavía.
       Lo que se comprueba es que el cliente al que se le pone SEA el de
       la sesión. Sin esto, un cliente podría insertar con el
       `client_id` de otro. */
    execute format('drop policy if exists "crear sus %s" on %I', t, t);
    execute format(
      'create policy "crear sus %s" on %I for insert to authenticated '
      || 'with check (tiene_inventario(client_id))',
      t, t
    );

    execute format('drop policy if exists "editar sus %s" on %I', t, t);
    execute format(
      'create policy "editar sus %s" on %I for update to authenticated '
      || 'using (tiene_inventario(client_id)) '
      || 'with check (tiene_inventario(client_id))',
      t, t
    );
  end loop;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. Lo que cuelga de otra tabla
-- ---------------------------------------------------------------------
-- Estas no tienen `client_id`: hay que subir por la relación. Es lo que
-- evita guardar el mismo dato en diez sitios, que es como se desincroniza.

create or replace function producto_es_de(cliente_uuid uuid, producto_uuid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
    select exists (
      select 1 from inv_productos p
      where p.id = producto_uuid and p.client_id = cliente_uuid
    );
  $$;

create or replace function variante_es_de(cliente_uuid uuid, variante_uuid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
    select exists (
      select 1
      from inv_variantes v
      join inv_productos p on p.id = v.producto_id
      where v.id = variante_uuid and p.client_id = cliente_uuid
    );
  $$;

create or replace function compra_es_de(cliente_uuid uuid, compra_uuid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
    select exists (
      select 1 from inv_compras c where c.id = compra_uuid and c.client_id = cliente_uuid
    );
  $$;

create or replace function venta_es_de(cliente_uuid uuid, venta_uuid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
    select exists (
      select 1 from inv_ventas v where v.id = venta_uuid and v.client_id = cliente_uuid
    );
  $$;

create or replace function cliente_es_de(cliente_uuid uuid, cliente2_uuid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
    select exists (
      select 1 from inv_clientes c where c.id = cliente2_uuid and c.client_id = cliente_uuid
    );
  $$;


-- ---------------------------------------------------------------------
-- 4. Políticas de las que cuelgan
-- ---------------------------------------------------------------------

-- Variantes: por el producto.
--
-- `cliente_de_la_sesion()` se define ANTES de usarse. En el fichero
-- estaba definida después de la primera política que la usaba, y Postgres
-- no da error al crear una política con una función que todavía no
-- existe: la falla en la PRIMERA CONSULTA, en producción, con un
-- "function does not exist" que no señala el sitio.
alter table inv_variantes enable row level security;
create or replace function cliente_de_la_sesion()
  returns uuid language sql stable security definer set search_path = public as $$
    select s.client_id from inventario_sesiones s
    where s.user_id = auth.uid() and s.revocado_en is null and s.expira_en > now()
    limit 1;
  $$;

comment on function cliente_de_la_sesion is
  'El cliente de la sesión actual. Se resuelve UNA vez en cada política, en vez de repetir la comprobación de sesión en las quince. Es lo que evita que las políticas se desincronicen entre sí.';

drop policy if exists "leer sus variantes" on inv_variantes;
create policy "leer sus variantes" on inv_variantes for select to authenticated
  using (producto_es_de(cliente_de_la_sesion(), producto_id));

drop policy if exists "crear sus variantes" on inv_variantes;
create policy "crear sus variantes" on inv_variantes for insert to authenticated
  with check (producto_es_de(cliente_de_la_sesion(), producto_id));

drop policy if exists "editar sus variantes" on inv_variantes;
create policy "editar sus variantes" on inv_variantes for update to authenticated
  using (producto_es_de(cliente_de_la_sesion(), producto_id))
  with check (producto_es_de(cliente_de_la_sesion(), producto_id));


-- Códigos de barras: por la variante.
alter table inv_codigos enable row level security;
drop policy if exists "leer sus codigos" on inv_codigos;
create policy "leer sus codigos" on inv_codigos for select to authenticated
  using (variante_es_de(cliente_de_la_sesion(), variante_id));

drop policy if exists "crear sus codigos" on inv_codigos;
create policy "crear sus codigos" on inv_codigos for insert to authenticated
  with check (variante_es_de(cliente_de_la_sesion(), variante_id));

drop policy if exists "editar sus codigos" on inv_codigos;
create policy "editar sus codigos" on inv_codigos for update to authenticated
  using (variante_es_de(cliente_de_la_sesion(), variante_id))
  with check (variante_es_de(cliente_de_la_sesion(), variante_id));


-- Movimientos: por la variante. Es la tabla más importante de proteger,
-- porque es la que dice qué ha pasado con el stock de cada cosa.
alter table inv_movimientos enable row level security;
drop policy if exists "leer sus movimientos" on inv_movimientos;
create policy "leer sus movimientos" on inv_movimientos for select to authenticated
  using (variante_es_de(cliente_de_la_sesion(), variante_id));

drop policy if exists "crear sus movimientos" on inv_movimientos;
create policy "crear sus movimientos" on inv_movimientos for insert to authenticated
  with check (variante_es_de(cliente_de_la_sesion(), variante_id));

/* Ni UPDATE ni DELETE, y a propósito.

   Un movimiento es un hecho que ocurrió. Editarlo o borrarlo rompe el
   historial, y con él la explicación de por qué el stock está como
   está. Si algo se registró mal, se corrige con un movimiento contrario,
   que queda en el registro. Un almacén no puede tener "¿por qué tengo
   3?". */


-- Items de compra: por la compra.
alter table inv_compra_items enable row level security;
drop policy if exists "leer sus items de compra" on inv_compra_items;
create policy "leer sus items de compra" on inv_compra_items for select to authenticated
  using (compra_es_de(cliente_de_la_sesion(), compra_id));

drop policy if exists "crear sus items de compra" on inv_compra_items;
create policy "crear sus items de compra" on inv_compra_items for insert to authenticated
  with check (compra_es_de(cliente_de_la_sesion(), compra_id));

drop policy if exists "editar sus items de compra" on inv_compra_items;
create policy "editar sus items de compra" on inv_compra_items for update to authenticated
  using (compra_es_de(cliente_de_la_sesion(), compra_id))
  with check (compra_es_de(cliente_de_la_sesion(), compra_id));


-- Items de venta: por la venta.
alter table inv_venta_items enable row level security;
drop policy if exists "leer sus items de venta" on inv_venta_items;
create policy "leer sus items de venta" on inv_venta_items for select to authenticated
  using (venta_es_de(cliente_de_la_sesion(), venta_id));

drop policy if exists "crear sus items de venta" on inv_venta_items;
create policy "crear sus items de venta" on inv_venta_items for insert to authenticated
  with check (venta_es_de(cliente_de_la_sesion(), venta_id));


-- Cuentas corrientes: por el cliente del comercio.
alter table inv_cuentas enable row level security;
drop policy if exists "leer sus cuentas" on inv_cuentas;
create policy "leer sus cuentas" on inv_cuentas for select to authenticated
  using (cliente_es_de(cliente_de_la_sesion(), cliente_id));

drop policy if exists "crear sus cuentas" on inv_cuentas;
create policy "crear sus cuentas" on inv_cuentas for insert to authenticated
  with check (cliente_es_de(cliente_de_la_sesion(), cliente_id));


-- ---------------------------------------------------------------------
-- 5. Lo que el SERVIDOR escribe y el cliente no
-- ---------------------------------------------------------------------
-- Los totales y los saldos los escribe el servidor con la secret key:
-- el total de la venta, el stock al vender, la diferencia del arqueo.
--
-- El cliente NO puede escribirlos nunca. Si pudiera, podría poner un
-- saldo de caja que cuadre con lo que quiere.
--
-- Es lo que se consigue con RLS encendido y SIN política de escritura
-- para esas columnas: la secret key salta RLS, y `authenticated` no
-- llega.
--
-- Y hay algo más aquí que no está en ninguna tabla: la regla de que el
-- `client_id` sale de la sesión, nunca de la petición. Está al principio
-- del fichero porque es la que más veces se olvida al añadir una ruta,
-- y una ruta nueva que Filtrar por `req.query` se lleva por delante toda
-- la seguridad.