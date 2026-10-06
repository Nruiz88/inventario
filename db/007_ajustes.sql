-- =====================================================================
-- Ajustes manuales de stock (007)
-- =====================================================================
-- Una función que hace el ajuste entero: toca el stock, escribe el
-- movimiento, y todo o nada.
--
--
-- POR QUÉ UNA FUNCIÓN Y NO UN UPDATE DESDE EL SERVIDOR
-- ---------------------------------------------------
-- Un ajuste de stock son DOS escrituras: cambiar `inv_variantes.stock`
-- y escribir en `inv_movimientos`. Hechas desde el servidor, una tras
-- otra, son dos transactions, y entre medias cabe otra cosa.
--
-- El caso: el dueño anota una merma de seis. El UPDATE del stock
-- termina. En ese instante el stock es 24 y NO hay ningún movimiento que
-- lo explique. Si el INSERT falla —una conexión que se cae, un timeout,
-- un error de validación—, esa distancia es permanente y nadie la ve:
-- el sistema dice 24 y no hay forma de saber de dónde salió.
--
-- Y en el otro sentido también: si el movimiento se inserta primero y el
-- UPDATE del stock falla, el historial dice que salieron seis y el stock
-- no bajó. El arqueo cuadra con una cosa y el inventario con otra.
--
-- Con una función que hace las dos cosas en el servidor de Postgres, no
-- hay hueco entre medias. O sale el ajuste entero, o no sale nada.
--
--
-- POR QUÉ NO HAY UN "FIJAR EL STOCK EN 42"
-- ----------------------------------------
-- Porque es la tentación y sería un agujero. Un campo que fija el stock
-- a un número cualquiera rompe la relación entre el número del estante y
-- el historial, y a partir de ahí el historial no puede explicar nada.
--
-- Aquí solo hay dos operaciones, y las dos dicen QUÉ y POR QUÉ:
--
--   merma      se rompió, se venció, se pisó.   → resta
--   devolucion nos devolvieron mercadería.        → suma
--   ajuste     contó mal, apareció de más.        → suma
--
-- Un ajuste dice CUÁNTO y POR QUÉ; el stock lo recalcula esta función.
-- Si el dueño se equivocó y puso 6 de merma cuando eran 2, se corrige
-- con otro ajuste de 4 hacia el otro lado, y los dos quedan a la vista.
-- Que es lo contrario de fijar el número, y justo por eso funciona.
--
--
-- ⚠️  EL STOCK NO QUEDA NEGATIVO
-- -----------------------------
-- Una merma de 10 sobre un stock de 4 es un error de tipeo, no una
-- mercadería fantasma. Si se dejara, el stock quedaría en -6 y la suma
-- de los movimientos no cuadraría con el número del estante, que es el
-- único invariante que tiene este módulo.
--
-- Se rechaza con `raise exception` en vez de recortarlo a cero. Recortar
-- en silencio sería peor: el dueño vería "quedan 0" y pensaría que lo
-- arregló, cuando en realidad lo que se rompió es el registro.
-- =====================================================================

create or replace function inv_ajustar_stock(
  p_variante uuid,
  p_tipo     text,
  p_cantidad integer,
  p_motivo   text,
  p_usuario  uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock  integer;
  v_signo  integer;
  v_tipo_m text;   -- 'entrada' o 'salida' en inv_movimientos
begin
  -- ── Validar ──
  if p_tipo not in ('merma', 'ajuste', 'devolucion') then
    raise exception 'Tipo de movimiento no válido: %', p_tipo;
  end if;

  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad tiene que ser mayor que cero';
  end if;

  -- El motivo es obligatorio y no por llevar la cuenta: un -6 sin motivo
  -- es un número que nadie sabe explicar cuando le pregunten por qué el
  -- stock no cuadra con la última compra.
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Falta el motivo del movimiento';
  end if;

  -- `merma` resta. Todo lo demás suma.
  if p_tipo = 'merma' then
    v_signo  := -1;
    v_tipo_m := 'salida';
  else
    v_signo  := 1;
    v_tipo_m := 'entrada';
  end if;

  -- ── Comprobar de quién es, y bloquearla ──
  --
  -- ⚠️  EL `tiene_inventario()` NO ES OPCIONAL AQUÍ
  -- ------------------------------------------------
  -- Esta función es `security definer`, así que salta RLS. Eso es lo
  -- que necesita para hacer las dos escrituras, pero significa que
  -- `inv_variantes` NO le está aplicando las políticas: si solo se
  -- comprueba que la variante exista, un cliente podría llamar a esta
  -- función con el id de la variante de OTRO y moverle el stock.
  --
  -- El `join` con `inv_productos` es para subir al `client_id`, porque
  -- `inv_variantes` no lo tiene: tiene producto, y el producto tiene
  -- cliente. La función `tiene_inventario()` es la misma regla que usan
  -- todas las políticas de negocio, así que no hay una segunda versión
  -- de "quién es el dueño" que pueda desincronizarse.
  --
  -- Y `tiene_inventario()` ya comprueba que la suscripción esté activa,
  -- no solo que exista la sesión. Con la suscripción caducada, el ajuste
  -- tampoco pasa.
  --
  -- `for update` es lo que hace que dos ajustes simultáneos no se
  -- pisen. Sin él, dos cajas anotan merma a la vez, las dos leen el
  -- mismo stock, las dos escriben stock - 6, y el resultado es 12 en
  -- vez de 18, sin ningún rastro de que faltara.
  --
  -- Con el candado, la segunda espera a que la primera termine y calcula
  -- sobre el número nuevo. Es lo mismo que hace `descontar_stock()` en
  -- las ventas, y por el mismo motivo.
  select v.stock into v_stock
    from inv_variantes v
    join inv_productos p on p.id = v.producto_id
   where v.id = p_variante
     and tiene_inventario(p.client_id)
     for update of v;

  if not found then
    -- Se dice lo mismo para "no existe" y para "es de otro": distinguirlo
    -- diría qué productos existen en la plataforma.
    raise exception 'Ese producto no existe o no es tuyo';
  end if;

  -- No se deja negativo. Ver la cabecera.
  if v_stock + (v_signo * p_cantidad) < 0 then
    raise exception
      'No hay stock suficiente: quedan % y el movimiento es de %',
      v_stock, p_cantidad;
  end if;

  -- ── Las dos escrituras ──
  update inv_variantes
     set stock = stock + (v_signo * p_cantidad),
         actualizado_en = now()
   where id = p_variante;

  insert into inv_movimientos
    (variante_id, tipo, cantidad, motivo, usuario_id)
  values
    (p_variante, v_tipo_m, p_cantidad, p_tipo || ': ' || btrim(p_motivo), p_usuario);

  -- Se devuelve el stock nuevo para que la pantalla no tenga que
  -- releerlo. Un segundo viaje por un número que ya se sabe es un viaje
  -- de más en la operación que el dueño hace cada vez que anota una
  -- merma.
  return stock from inv_variantes where id = p_variante;
end;
$$;

comment on function inv_ajustar_stock is
  'Ajuste manual de stock: merma (resta), devolución y ajuste (suman). Hace las DOS escrituras en una transacción y con la variante bloqueada, para que el stock y su historial no puedan separarse. No permite fijar el stock a un número: solo moverlo con un motivo.';


-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
-- `security definer` y con el search_path fijo. Sin lo segundo, la
-- función se podría usar para leer tablas de las que el usuario no tiene
-- permiso: es el mismo patrón que `tiene_inventario()`.

revoke all on function inv_ajustar_stock(uuid, text, integer, text, uuid) from public;
grant execute on function inv_ajustar_stock(uuid, text, integer, text, uuid) to authenticated, service_role;