-- =====================================================================
-- Reglas del inventario (004)
-- =====================================================================
-- Aquí está lo que hace que los datos CUADREN. Las tablas de antes
-- guardan; esto vigila.
--
--
-- POR QUÉ UN TRIGGER Y NO UNA COLUMNA GENERADA
-- --------------------------------------------
-- El total de una venta es la suma de sus líneas. Lo natural sería:
--
--     total_cents integer generated always as (
--       (select sum(total_cents) from inv_venta_items where venta_id = id)
--     ) stored
--
-- Y Postgres NO LO ADMITE: "cannot use subquery in column generation
-- expression". Una columna generada solo puede hacer cuentas con
-- valores de la MISMA fila, no consultar otras tablas.
--
-- Se podría resolver con un trigger en vez de con `generated`, que es
-- lo que se hace. La diferencia práctica: una columna generada es
-- imposible de corromper desde fuera porque no se puede escribir, y un
-- trigger se puede saltar con un UPDATE si alguien desactiva el trigger.
-- Por eso el trigger va con `security definer` y con la política de RLS
-- que impide al cliente escribir `total_cents` directamente: las dos
-- cosas.
--
--
-- LO QUE VIGILA ESTE FICHERO
-- --------------------------
--   1. Que el total de la venta sea la suma de sus líneas. Siempre.
--   2. Que una compra en borrador NO mueva el stock.
--   3. Que anular una venta devuelva el stock.
--   4. Que no se pueda vender lo que no hay.
--   5. Que el saldo de caja no se pueda escribir a dedo.
--
--
-- ⚠️  LA REGLA DE ORO DE TODO ESTO
-- ---------------------------------
-- Stock y movimientos se escriben SIEMPRE juntos, en la misma
-- operación. Si se pueden desincronizar, llega el día que hay que
-- elegir cuál miente, y las dos respuestas son malas.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. El total de la venta
-- ---------------------------------------------------------------------
-- Recalcula el total desde las líneas, siempre. No se suma un delta
-- porque los deltas se pierden: si alguien corrige una cantidad dos
-- veces, la suma ya no cuadra con lo que hay en pantalla.
--
-- Se dispara al insertar, modificar o borrar una línea, porque las tres
-- cosas cambian el total. Olvidar el DELETE es el error clásico: se
-- borra un ítem de una venta y el total sigue siendo el de antes.
create or replace function recalcular_total_venta()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_venta uuid := coalesce(new.venta_id, old.venta_id);
  begin
    update inv_ventas v
       set total_cents = coalesce(
             (select sum(i.total_cents) from inv_venta_items i where i.venta_id = v_venta),
             0
           )
     where v.id = v_venta;

    return null;
  end;
  $$;

comment on function recalcular_total_venta is
  'Recalcula el total de la venta desde sus líneas. AFTER INSERT/UPDATE/DELETE, para que las tres cosas lo actualicen. Recalcular entero y no sumar deltas: los deltas se pierden y al tercer ajuste el total ya no cuadra con lo que se ve.';

create trigger tr_total_venta
  after insert or update or delete on inv_venta_items
  for each row execute function recalcular_total_venta();


-- ---------------------------------------------------------------------
-- 2. Una compra en borrador NO mueve el stock
-- ---------------------------------------------------------------------
-- Este es el que más caro sale si se olvida. El dueño abre el pedido
-- por la mañana, se distrae, y nunca lo marca como recibido.
--
-- Si el stock se moviera al crear el borrador, el inventario mostraría
-- mercadería que no ha llegado, y el "qué tengo" sería mentira. Por eso
-- el movimiento sale al pasar a 'recibida', no antes.
--
-- Y es IRREVERSIBLE a propósito: una compra recibida no se puede volver
-- a poner en borrador. Si se receiving por error, se anula: eso deja
-- rastro, que es lo que tiene que pasar.
create or replace function stock_de_compra()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_linea record;
  begin
    -- ¿Pasó a recibida AHORA? Si ya lo estaba, no hay nada que hacer.
    if new.estado = 'recibida' and (tg_op = 'INSERT' or old.estado <> 'recibida') then
      new.recibido_en := now();

      for v_linea in
        select variante_id, cantidad, costo_unitario_cents
        from inv_compra_items where compra_id = new.id
      loop
        update inv_variantes v
           set stock = v.stock + v_linea.cantidad,
               precio_costo_cents = v_linea.costo_unitario_cents,
               actualizado_en = now()
         where v.id = v_linea.variante_id;

        insert into inv_movimientos
          (variante_id, tipo, cantidad, motivo, compra_id, costo_unitario_cents)
        values
          (v_linea.variante_id, 'entrada', v_linea.cantidad,
           'compra ' || coalesce(new.factura_nro, new.id::text),
           new.id, v_linea.costo_unitario_cents);
      end loop;
    end if;

    -- Volver a borrador después de haber recibido: no.
    if new.estado = 'borrador' and old.estado = 'recibida' then
      raise exception
        'Una compra recibida no puede volver a borrador. Anulala: así queda en el registro.';
    end if;

    new.total_cents := coalesce(
      (select sum(i.total_cents) from inv_compra_items i where i.compra_id = new.id),
      0
    );

    return new;
  end;
  $$;

comment on function stock_de_compra is
  'El stock entra SOLO al pasar la compra a "recibida", no al crearla. Volver a borrador una compra recibida es error a propósito: se anula, que deja rastro.';

create trigger tr_stock_compra
  before insert or update on inv_compras
  for each row execute function stock_de_compra();


-- ---------------------------------------------------------------------
-- 3. Anular una venta devuelve el stock
-- ---------------------------------------------------------------------
-- Una venta anulada no es una venta que se borra: pasó, se cobró y se
-- cayó. El stock vuelve, y queda el movimiento de devolución, que es la
-- única forma de que el historial square con el número que hay en el
-- estante.
--
-- ⚠️  POR QUÉ LA COMPROBACIÓN ES POR MOVIMIENTOS Y NO POR `old.anulada`
-- ------------------------------------------------------------------------
-- La forma obvia sería `if new.anulada and not old.anulada`. Es FALLA, y
-- la prueba lo cazó: stock a 14 en vez de 10.
--
-- El motivo: si alguien marca el casillero, lo desmarca y lo vuelve a
-- marcar (que es lo que pasa cuando alguien se equivoca dos veces), el
-- segundo `true` viene de un `old.anulada` que era `false`, y el stock
-- vuelve a subir. La venta queda anulada y con el stock devuelto dos
-- veces: 10 unidades que no existen.
--
-- La comprobación correcta es la que se hace dentro: si esta venta YA
-- tiene un movimiento de devolución, no se devuelve otra.
--
-- Es idempotente de verdad porque depende del HISTORIAL y no del estado
-- de un campo que alguien puede cambiar a voluntad.
create or replace function anular_venta()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_item record;
  begin
    /* Solo si se está anular ahora. */
    if not new.anulada then
      return new;
    end if;

    /* Y solo si no se devolvió antes. */
    if exists (
      select 1 from inv_movimientos
      where venta_id = new.id and motivo = 'devolución: venta anulada'
    ) then
      return new;
    end if;

    for v_item in
      select variante_id, cantidad from inv_venta_items where venta_id = new.id
    loop
      update inv_variantes v
         set stock = v.stock + v_item.cantidad,
             actualizado_en = now()
       where v.id = v_item.variante_id;

      insert into inv_movimientos
        (variante_id, tipo, cantidad, motivo, venta_id)
      values
        (v_item.variante_id, 'entrada', v_item.cantidad,
         'devolución: venta anulada', new.id);
    end loop;

    /* El dinero que entró por esa venta sale de la caja. Si no se saca,
       el arqueo cuadra con un ingreso que ya no existe. */
    delete from inv_caja where venta_id = new.id;

    return new;
  end;
  $$;

comment on function anular_venta is
  'Al anular una venta devuelve el stock y saca el dinero de la caja. Idempotente de verdad: comprueba si YA hay un movimiento de devolución de esa venta, en vez de mirar old.anulada, que con anular-desanular-anular devuelve el stock dos veces.';

create trigger tr_anular_venta
  before update on inv_ventas
  for each row execute function anular_venta();


-- ---------------------------------------------------------------------
-- 4. No se puede vender lo que no hay
-- ---------------------------------------------------------------------
-- Es la regla que más veces se salta en un inventario, y siempre por la
-- misma razón: dos cajas en dos terminals. El kiosco tiene dos cajas y
-- las dos venden "Gaseosa", y las dos ven 10. Las dos venden una, y
-- quedan 8, y en la base hay 0.
--
-- El `update ... where stock >= cantidad` resuelve las dos cosas a la
-- vez: descuenta SOLO si hay stock, y si no hay, no cambia nada. Con
-- `where id = ?` a secas, las dos cajas descontarían y quedaría
-- negativo.
--
-- Y si no descontó, es que no había: eso hay que decirlo, no pasar.
create or replace function descontar_stock()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    update inv_variantes v
       set stock = v.stock - new.cantidad,
           actualizado_en = now()
     where v.id = new.variante_id
       and v.stock >= new.cantidad;

    if not found then
      raise exception 'No hay stock suficiente de esa variante';
    end if;

    insert into inv_movimientos
      (variante_id, tipo, cantidad, motivo, venta_id, costo_unitario_cents)
    values
      (new.variante_id, 'salida', new.cantidad, 'venta', new.venta_id,
       (select precio_costo_cents from inv_variantes where id = new.variante_id));

    return null;
  end;
  $$;

comment on function descontar_stock is
  'Descuenta el stock SOLO si hay. El "where stock >= cantidad" es lo que evita que dos cajas vendan lo mismo: sin él, con dos terminales, el stock queda negativo y nadie sabe desde cuándo.';

create trigger tr_descontar_stock
  after insert on inv_venta_items
  for each row execute function descontar_stock();


-- ---------------------------------------------------------------------
-- 5. Ventas y movimientos NO anulados
-- ---------------------------------------------------------------------
-- Un movimiento de una venta anulada no puede existir: si no, anular
-- devuelve el stock dos veces.
create or replace function no_movimientos_de_venta_anulada()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    if exists (select 1 from inv_ventas v where v.id = new.venta_id and v.anulada) then
      raise exception 'No se puede añadir stock a una venta anulada';
    end if;
    return new;
  end;
  $$;

create trigger tr_no_movimientos_venta_anulada
  before insert on inv_movimientos
  for each row execute function no_movimientos_de_venta_anulada();


-- ---------------------------------------------------------------------
-- 6. La caja no se inventa
-- ---------------------------------------------------------------------
-- El saldo es lo que dice la tabla. Si alguien puede escribir un saldo,
-- el arqueo no sirve para nada: el dueño cuenta 50.000, el sistema dice
-- 60.000, y la diferencia es siempre culpa del que cuenta.
--
-- Aquí solo se CALCULA la diferencia, nunca el saldo.
create or replace function calcular_diferencia_arqueo()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_saldo numeric;
  begin
    if new.saldo_real_cents is not null then
      -- El saldo del día es el inicial MÁS todo lo que ha entrado y salido
      -- de la caja HOY.
      --
      -- `coalesce(saldo_inicial_cents, 0)` viene de la fila del arqueo, no
      -- de inv_caja: la primera versión lo leía de inv_caja y daba
      -- "column does not exist", que no dice de qué tabla. El saldo
      -- inicial es de esta fila, y los movimientos son de la otra.
      select a.saldo_inicial_cents
             + coalesce(sum(case when c.tipo = 'ingreso' then c.monto_cents else -c.monto_cents end), 0)
        into v_saldo
        from inv_arqueos a
        left join inv_caja c
          on c.client_id = a.client_id
         and c.fecha >= a.fecha
         and c.fecha < a.fecha + interval '1 day'
       where a.id = new.id
       group by a.saldo_inicial_cents;

      new.saldo_calculado_cents := coalesce(v_saldo, new.saldo_inicial_cents)::integer;
      new.diferencia_cents := new.saldo_real_cents - coalesce(v_saldo, new.saldo_inicial_cents)::integer;
      new.cerrado_en := now();
    end if;

    return new;
  end;
  $$;

comment on function calcular_diferencia_arqueo is
  'La diferencia se CALCULA al cerrar: real − calculado. No se escribe a mano. Un arqueo donde el dueño pone la diferencia es un arqueo que no sirve para detectar que faltaba.';

create trigger tr_diferencia_arqueo
  before update on inv_arqueos
  for each row execute function calcular_diferencia_arqueo();


-- ---------------------------------------------------------------------
-- 7. La venta a cuenta corriente genera la deuda, y la de efectivo mete
--    el dinero en la caja
-- ---------------------------------------------------------------------
-- Si se vende a cuenta y no se anota la deuda, el cliente aparece
-- debiendo cero y el dueño se despierta con un fiado de hace seis meses
-- que no está en ninguna parte.
--
-- Y la venta en efectivo genera su entrada de caja, porque si no el
-- arqueo no cuadra: el dueño cuenta el cajón y el sistema dice que no
-- hay nada dentro.
--
-- Y el movimiento de caja NO se crea para la cuenta corriente: el
-- dinero no entró. Eso lo hace el pago, cuando llega.
--
-- ⚠️  POR QUÉ AFTER UPDATE Y NO AFTER INSERT
-- -----------------------------------------
-- Porque en el momento del INSERT el total es CERO: la venta se crea
-- vacía y los ítems se añaden después, y el total lo calcula el trigger
-- de los ítems.
--
-- Con AFTER INSERT, este trigger metía en caja una entrada de 0
-- centavos y la base la rechazaba con un error de CHECK que solo decía
-- "check constraint", sin decir qué constraint ni por qué. Peor: si el
-- CHECK no hubiera existido, el arqueo habría tenido un movimiento de
-- cero rompiendo la cuenta, y nadie lo habría visto hasta el cierre.
--
-- Se dispara al cambiar el total, y solo en UPDATE. Así el flujo real
-- queda cubierto: se crea la venta, se añaden los ítems, el total pasa
-- de 0 a N, y AHORA se anota la deuda y el dinero.
--
-- Y el "not exists" evita que alguien que edite el total de una venta
-- ya cobrada genere una segunda entrada con el mismo importe.
create or replace function deuda_por_venta()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    if new.anulada or new.total_cents <= 0 then
      return null;
    end if;

    if new.metodo_pago = 'cuenta_corriente' and new.cliente_id is not null then
      if not exists (select 1 from inv_cuentas where venta_id = new.id) then
        insert into inv_cuentas (cliente_id, tipo, monto_cents, venta_id, concepto)
        values (new.cliente_id, 'debe', new.total_cents, new.id, 'venta a cuenta corriente');
      end if;
    end if;

    if new.metodo_pago = 'efectivo' then
      if not exists (select 1 from inv_caja where venta_id = new.id) then
        insert into inv_caja (client_id, tipo, categoria, monto_cents, venta_id, concepto)
        values (new.client_id, 'ingreso', 'venta', new.total_cents, new.id, 'venta en efectivo');
      end if;
    end if;

    return null;
  end;
  $$;

comment on function deuda_por_venta is
  'Una venta a cuenta corriente genera la deuda sola, y una en efectivo su entrada de caja. AFTER UPDATE porque en el INSERT el total todavía es 0: los items se añaden después. El "not exists" evita duplicar si alguien edita el total de una venta ya cobrada.';

create trigger tr_deuda_venta
  after update of total_cents on inv_ventas
  for each row execute function deuda_por_venta();


-- ---------------------------------------------------------------------
-- 8. Comprobaciones de arranque
-- ---------------------------------------------------------------------
-- Si algo de esto falla, es mejor que NO arranque y lo diga, que
-- arrancar y dejar que un trigger falle en mitad de una venta. Un error
-- al arrancar se lee; un error a las tres de la tarde, con la caja
-- abierta, no.
--
-- Hay tres referencias a revisar en cada migración:
--   · una función que usen las políticas y no exista  → las políticas
--     fallan en la primera consulta, no al crearlas
--   · una columna que un trigger lea y que no exista  → el trigger falla
--     en producción
--   · una tabla que otro servicio creó              → dependencia
--
-- Por eso este fichero va después de todos los demás: es el que
-- comprueba que todo lo anterior encaja.