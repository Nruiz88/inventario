-- =====================================================================
-- Las políticas que faltaban de inv_ventas (009)
-- =====================================================================
-- ⚠️  ESTA MIGRACIÓN EXISTE POR UN FALLO REAL
-- -------------------------------------------
-- `inv_ventas` quedó con RLS ENCENDIDO y CERO políticas. Esa combinación
-- es la peor de las dos: la tabla es invisible para el cliente.
--
-- El síntoma, medido: el POST de una venta devolvía 200 con el id y el
-- total correctos, y un segundo después el GET del historial devolvía
-- CERO filas y el PATCH de anular daba 404 con "esa venta no existe".
--
-- Es el peor tipo de fallo posible en esto: la escritura dice que fue
-- bien. El dueño ve el total en pantalla, oye el comprovante, y cuando
-- va a anular la venta porque se equivocó, resulta que no existe.
--
--
-- POR QUÉ PASÓ
-- ------------
-- En `003_rls.sql` las políticas se crean con un bucle sobre un array de
-- tablas:
--
--     foreach t in array array[
--       'inv_productos', 'inv_proveedores', 'inv_compras',
--       'inv_clientes', 'inv_caja', 'inv_arqueos'
--     ]
--
-- `inv_ventas` no está en la lista. Está en las tablas del resto del
-- fichero —porque `venta_es_de()` sí existe y la usan las políticas de
-- `inv_venta_items`—, y en el comentario de la cabecera de `005` que
-- enumera las que no tenían RLS encendido. En un sitio sí y en otro no.
--
-- `005_rls_encendido.sql` turned RLS on for it. Eso la dejó peor: con
-- RLS apagada una tabla sin políticas se lee (y eso ya era un problema),
-- pero con RLS encendida no se lee NADA.
--
--
-- ⚠️  LA PRUEBA NO LO CAZÓ, Y POR QUÉ NO
-- -------------------------------------
-- `db/test-reglas.js` miraba `relrowsecurity` tabla por tabla, que es
-- exactamente lo que faltaba. Pero mirar que RLS esté encendido NO
-- comprueba que haya políticas: son dos cosas distintas y una no implica
-- la otra.
--
-- Esa es la lección, y es la razón de que esta migración escriba la
-- comprobación al final: "RLS encendido" y "RLS con políticas" son dos
-- preguntas. La segunda es la que importa, y es la que faltaba.
--
-- Lo que SÍ encontró el fallo fue probar de verdad: registrar una venta
-- y luego anularla. Ninguna prueba unitaria toca triggers ni políticas.
-- =====================================================================

-- ⚠️  POR QUÉ UN `DO` Y NO `alter table if not exists`
-- ----------------------------------------------------
-- Porque en el Postgres de Supabase esa forma NO EXISTE:
--
--     alter table if not exists inv_ventas enable row level security;
--     ERROR: syntax error at or near "exists"
--
-- Lo que sí funciona ahí es `alter table if exists` y
-- `create table if not exists`. Comprobado uno por uno, porque es un
-- error que no parece posible: `ALTER TABLE IF EXISTS` viene de
-- PostgreSQL 9.1 y el `IF NOT EXISTS` de ALTER TABLE es posterior, así
-- que con leer la documentación parece que debería estar.
--
-- La primera versión de esta migración usaba `if not exists` y la
-- migración entera falló con un error que no señalaba la línea: el
-- rollback se llevaba por delante las políticas de más abajo, y el
-- mensaje era solo "syntax error at or near exists", a 2.382 bytes del
-- principio del fichero.
--
-- El bloque de abajo es idempotente de verdad: si la tabla existe, la
-- enciende; si no, no falla. Que es lo que se quería del `if not exists`.
do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'inv_ventas'
  ) then
    execute 'alter table inv_ventas enable row level security';
  end if;
end $$;

-- Sin políticas: RLS encendido + cero políticas = invisible. Con
-- políticas: solo lo que corresponde. Nunca al revés.

drop policy if exists "leer sus ventas" on inv_ventas;
create policy "leer sus ventas" on inv_ventas
  for select to authenticated
  using (tiene_inventario(client_id));

drop policy if exists "crear sus ventas" on inv_ventas;
create policy "crear sus ventas" on inv_ventas
  for insert to authenticated
  with check (tiene_inventario(client_id));

drop policy if exists "editar sus ventas" on inv_ventas;
create policy "editar sus ventas" on inv_ventas
  for update to authenticated
  using (tiene_inventario(client_id))
  with check (tiene_inventario(client_id));

-- ---------------------------------------------------------------------
-- Y AHORA LO QUE RLS NO PUEDE HACER
-- ---------------------------------------------------------------------
-- ⚠️  RLS ES POR FILA, NO POR COLUMNA
-- -----------------------------------
-- La política de arriba dice QUIÉN puede tocar QUÉ FILA. No dice qué
-- columnas de esa fila. Con ella sola, un cliente puede mandar un
-- `update` con `total_cents` y reescribir el total de una venta cerrada,
-- o mover `client_id` a otra cosa.
--
-- La primera versión de este fichero intentaba resolverlo con una
-- segunda política "de columna". Eso no existe: una política de RLS no
-- puede(listar columnas, y una política idéntica a la anterior solo
-- añade ruido.
--
-- Lo que SÍ existe para esto es REVOKE sobre columnas. Es la única
-- forma, y es complementaria a RLS: RLS decide la fila, el permiso
-- decide la columna. Las dos juntas.
--
-- Lo que el cliente puede cambiar de una venta, y nada más:
--   · facturada, factura_nro      → marcar como facturada
--   · anulada, anulada_motivo     → anular
--   · notas                       → una nota
--
-- ⚠️  EL ORDEN IMPORTA, Y EL `revoke` VA UNA SOLA VEZ
-- ---------------------------------------------------
-- Hay que quitar el privilegio de TABLA antes de conceder el de
-- columna. Al revés no funciona: con `grant update (factura_nro...)` sin
-- quitar antes el de tabla, `has_column_privilege` sigue diciendo que sí
-- para todas, porque el privilegio de tabla gana.
--
-- Y el `revoke` no puede aparecer DESPUÉS del `grant`. Esta migración
-- tenía los dos: uno antes del `grant` y otro repetido al final, de un
-- párrafo que se había editado a medias. Ese segundo borraba lo que el
-- primero había dejado hacer, y el resultado era una tabla con RLS,
-- políticas y CERO privilegios de UPDATE: el historial funcionaba y
-- anular una venta daba 500.
--
-- Comprobado: después de `revoke` + `grant`, las columnas con UPDATE
-- son exactamente las cinco de arriba.
revoke update on inv_ventas from authenticated;
grant update (facturada, factura_nro, anulada, anulada_motivo, notas)
  on inv_ventas to authenticated;
drop policy if exists "editar sus ventas" on inv_ventas;
create policy "editar sus ventas" on inv_ventas
  for update to authenticated
  using (tiene_inventario(client_id))
  with check (tiene_inventario(client_id));

/* Ni DELETE ni nada más.

   Una venta no se borra: se anula. Y se anula porque el stock ya salió
   del estante y el movimiento que lo dice existe. Borrarla sería dejar
   el historial incompleto sin avisar. */


-- ---------------------------------------------------------------------
-- Comprobación: toda tabla de negocio con RLS tiene AL MENOS una política
-- ---------------------------------------------------------------------
-- Esta es la que faltaba, escrita como SQL para que la vea quien lea
-- las migraciones, y como Javascript en `db/test-reglas.js` para que
-- corte el despliegue si alguien vuelve a meter la pata.

do $$
declare
  t text;
  flojas text := '';
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relrowsecurity
       and c.relname like 'inv\_%'
       and not exists (select 1 from pg_policies p where p.tablename = c.relname)
  loop
    flojas := flojas || t || ' ';
  end loop;

  if flojas <> '' then
    raise exception
      'Tablas de inventario con RLS encendido y sin ninguna politica: %',
      flojas;
  end if;
end $$;

comment on table inv_ventas is
  'Ventas. facturada solo APUNTA que alguien emitió el comprobante en otro sistema: este servicio no emite nada fiscal. No se borran, se anulan, porque el stock ya salió del estante y el movimiento que lo dice existe.';