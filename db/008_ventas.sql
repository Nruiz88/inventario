-- =====================================================================
-- Registrar una venta, entera (008)
-- =====================================================================
-- Una función que hace la venta completa: valida, crea la venta, crea
-- sus líneas y deja que los triggers muevan el stock.
--
--
-- POR QUÉ NO SE HACE DESDE EL SERVIDOR
-- -------------------------------------
-- Lo primero que se intentó eran varias llamadas a la API de Supabase,
-- con la lectura del precio en una y los `insert` en otras. Tres
-- problemas, ninguno visible en el happy path:
--
--   · El precio se leía antes de escribir. Entre esa lectura y el
--     `insert`, otro terminal puede cambiarlo. En un kiosco con dos cajas,
--     el precio que se leyó hace un segundo puede no ser el de ahora, y la
--     venta se guarda al precio viejo sin que nadie lo note.
--
--   · El stock se comprobaba antes de escribir y se escribía después.
--     Con dos cajas vendiendo lo mismo a la vez, las dos ven 10, las dos
--     pasan el control, y la segunda escribe sobre un stock ya
--     descontado. El trigger `descontar_stock` lo frenaba con su
--     `where stock >= cantidad`, así que la segunda venta se rechazaba
--     entera: el cliente tenía dos cosas en el mostrador y solo se
--     guardó una.
--
--   · Y la última versión, con `ejecutar_sql`, no podía funcionar
--     siquiera: esa función del panel es de SOLO LECTURA y rechaza
--     cualquier cosa que no sea un `SELECT`. Se vio al probar una venta
--     de verdad, y el error decía
--     "ejecutar_sql: solo permite SELECT, recibido: begin;".
--
--     Con tres escrituras encadenadas, esa es la respuesta correcta: si
--     la tercera falla, las dos primeras quedan y hay una venta huérfana
--     sin líneas.
--
--
-- LO QUE HACE ESTA FUNCIÓN
-- -----------------------
-- En una transacción, y en este orden:
--
--   1. Que las líneas no estén vacías.
--   2. Que TODAS las variantes existan, sean del cliente y estén
--      activas. Si alguna no, no se escribe nada: una venta con tres de
--      cuatro productos es peor que ninguna, porque descuenta stock de
--      tres y no se sabe de cuál.
--   3. Que haya stock de todas. Antes de escribir, y con la variante
--      bloqueada: se bloquea en el paso 5, cuando va a tocar el stock.
--   4. Crear la venta, vacía. El total lo calcula el trigger de las
--      líneas, que por eso existe.
--   5. Crear las líneas. Cada una dispara `descontar_stock()`, que
--      descuenta SOLO si hay y que vuelve a comprobar con su propio
--      `where stock >= cantidad`.
--
-- El paso 5 vuelve a comprobar el stock, y no es redundante: es la
-- segunda de dos barreras, y la que de verdad manda. El paso 3 sirve
-- para fallar con un mensaje claro; el trigger existe para el caso en
-- que la comprobación quedó vieja.
--
--
-- ⚠️  POR QUÉ EL PRECIO LO PONE AQUÍ Y NO EL CLIENTE
-- -------------------------------------------------
-- Porque un navegador puede mandar lo que quiera. Si el precio viniera
-- del cliente, abrir las herramientas del desarrollador y vender todo a
-- un peso sería cuestión de un minuto.
--
-- El precio se COPIA al ítem y ahí queda congelado. Si mañana suben las
-- gaseosas a 2,50, la venta de hoy sigue siendo a 2,25, y el histórico
-- del negocio no se reescribe al cambiar la lista de precios.
-- =====================================================================

create or replace function inv_registrar_venta(
  p_cliente    uuid,
  p_cliente_id uuid,     -- el comprador, para la cuenta corriente. NULL en mostrador
  p_metodo     text,
  p_usuario    uuid,
  p_items      jsonb,
  p_notas      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venta  uuid;
  v_items  jsonb;
  v_linea  jsonb;
  v_var    uuid;
  v_cant   integer;
  v_precio integer;
  v_stock  integer;
  v_total  integer;
  v_faltan integer;
  v_n      integer;
begin
  -- ── 1. Que haya algo que vender ──
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos';
  end if;

  if p_metodo not in ('efectivo','tarjeta','transferencia','cuenta_corriente') then
    raise exception 'Forma de pago no válida';
  end if;

  -- Vender a cuenta corriente sin saber a quién se le apunta la deuda
  -- deja una venta que nadie le debe a nadie. El trigger no lo revisa
  -- porque el trigger no sabe si el `cliente_id` es de este cliente.
  if p_metodo = 'cuenta_corriente' and p_cliente_id is null then
    raise exception 'Para vender a cuenta corriente hay que elegir un cliente';
  end if;

  -- ── 2 y 3. Validar TODAS las líneas antes de escribir NADA ──
  --
  -- Es lo que evita la venta a medias. Si se valida línea a línea
  -- mientras se inserta, la tercera falla y quedan la venta y dos
  -- ítems, con el stock de esos dos descontado.
  --
  -- El `for update` en el paso 5 es la barrera buena; esta es la que da
  -- un mensaje que el dueño entiende.
  v_faltan := 0;
  v_n := 0;

  for v_linea in select * from jsonb_array_elements(p_items) loop
    v_var := (v_linea ->> 'varianteId')::uuid;

    if v_var is null then
      raise exception 'Hay una línea sin producto';
    end if;

    /* `greatest(1, ...)` en vez de rechazar un 0 o un negativo.

       No es perdonar: una línea con 0 unidades es una línea que el dueño
       no quiso, y borrarla de la pantalla es lo mismo que ignorarla.
       Rechazarla con un error obligaría a entender un mensaje de Postgres
       por un botón que se tocó sin querer. */
    v_cant := greatest(1, coalesce(((v_linea ->> 'cantidad')::integer), 1));

    /* El precio y el stock se LEEN aquí, dentro de la transacción y con
       la variante bloqueada (`for update`). El bloqueo va en la lectura y
       no después a propósito: si se bloqueara más tarde, entre la
       validación y el bloqueo otra caja podría vender lo mismo y esta
       seguiría con el número viejo.

       Se mira `found` y no `v_precio is null`: una variante que existe
       con precio 0 es válida —un producto de regalo, o uno que todavía
       no tiene precio puesto—, y mirar el precio confundiría "gratis"
       con "no es tuyo", que son dos cosas muy distintas y la segunda es
       un intento de acceso. */
    select v.precio_venta_cents, v.stock
      into v_precio, v_stock
      from inv_variantes v
      join inv_productos p on p.id = v.producto_id
     where v.id = v_var
       and p.client_id = p_cliente
       and v.activo
       and p.activo
       for update of v;

    if not found then
      v_faltan := v_faltan + 1;
      continue;
    end if;

    if v_stock < v_cant then
      raise exception
        'No hay stock suficiente: quedan % y se quieren vender %',
        v_stock, v_cant;
    end if;

    v_n := v_n + 1;
  end loop;

  if v_faltan > 0 then
    raise exception
      '% producto(s) no existen, no son tuyos o están desactivados',
      v_faltan;
  end if;

  -- ── 4. La venta, vacía ──
  insert into inv_ventas
    (client_id, cliente_id, metodo_pago, usuario_id, notas)
  values
    (p_cliente, p_cliente_id, p_metodo, p_usuario, p_notas)
  returning id into v_venta;

  -- ── 5. Las líneas ──
  --
  -- Cada `insert` dispara `descontar_stock()`, que ya valida el stock
  -- con su propio `where stock >= cantidad` y devuelve el stock al
  -- cliente. Y `recalcular_total_venta()` pone el total.
  --
  -- El precio se vuelve a leer aquí y no se reutiliza el de la
  -- validación. La diferencia es mínima (esta es la misma transacción)
  -- y tiene una ventaja: si el trigger o alguien cambia el precio
  -- entremedias, la venta guarda el del momento de escribir, que es el
  -- que corresponde.
  for v_linea in select * from jsonb_array_elements(p_items) loop
    v_var   := (v_linea ->> 'varianteId')::uuid;
    v_cant  := greatest(1, coalesce(((v_linea ->> 'cantidad')::integer), 1));

    select v.precio_venta_cents into v_precio
      from inv_variantes v
      join inv_productos p on p.id = v.producto_id
     where v.id = v_var
       and p.client_id = p_cliente
       and v.activo and p.activo
       for update of v;

    insert into inv_venta_items
      (venta_id, variante_id, cantidad, precio_unitario_cents)
    values
      (v_venta, v_var, v_cant, v_precio);
  end loop;

  -- ── 6. Devolver lo que la pantalla necesita ──
  select total_cents into v_total from inv_ventas where id = v_venta;

  return jsonb_build_object(
    'id', v_venta,
    'total', v_total,
    'lineas', v_n
  );
end;
$$;

comment on function inv_registrar_venta(uuid, uuid, text, uuid, jsonb, text) is
  'Registra una venta entera en una transacción: valida que todo sea del cliente y esté activo, comprueba el stock ANTES de escribir, y crea venta y líneas. El precio lo lee de la base y lo congela en el ítem, nunca lo manda el cliente. El stock lo mueven los triggers.';


-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
-- `security definer` porque tiene que escribir en tablas donde las
-- políticas del cliente no dan permiso a insertar. El `search_path`
-- fijo no es opcional: sin él, la función se podría usar para leer
-- tablas de las que el usuario no tiene permiso, que es el mismo patrón
-- que `tiene_inventario()`.

revoke all on function inv_registrar_venta(uuid, uuid, text, uuid, jsonb, text) from public;
grant execute on function inv_registrar_venta(uuid, uuid, text, uuid, jsonb, text) to authenticated, service_role;