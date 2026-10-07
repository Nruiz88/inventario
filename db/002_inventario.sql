-- =====================================================================
-- Inventario (002)
-- =====================================================================
-- PARA QUIÉN
-- ---------
-- Comercios chicos y kioscos. UnCORE tiene un mostrador, dos o tres
-- productos de cada marca y necesita saber dos cosas: qué se está
-- acabando y cuánto dinero hay.
--
-- Eso condiciona TODO lo de este fichero. Un almacén con 20.000
-- referencias necesita lotes, vencimientos y ubicaciones; un kiosco con
-- 200 productos no, y esas tablas serían peso muerto.
--
--
-- PRODUCTO Y VARIANTE: DOS TABLAS, Y POR QUÉ
-- --------------------------------------------
-- "Gaseosa" no es lo que se vende: se vende "Gaseosa 2,25" y "Gaseosa 1,25".
-- Son el mismo producto con distinta presentación, distinto código de
-- barras y distinto precio.
--
-- Guardarlas separadas es lo que hace posible que el kiosco_enqueue la
-- presentación de 500 ml sin tener que duplicar el producto. El precio,
-- el stock y el código de barras van en la VARIANTE, que es la unidad
-- real. El producto solo agrupa.
--
-- Es la misma decisión que toma Vendure, y es la que más importa: si se
-- empieza mal, migrar después es dolor.
--
--
-- STOCK: EN LA VARIANTE, Y ADEMÁS CADA MOVIMIENTO
-- -----------------------------------------------
-- Hay dos opciones y se usan las dos:
--
--   · `stock` en la variante: es lo que se lee al vender. Si se calculara
--     sumando movimientos en cada consulta, cada venta sería un SUM sobre
--     toda la historia, y el mostrador se sentiría lento.
--
--   · `inv_movimientos`: la verdad de qué pasó. Sin esto, "por qué tengo
--     3 y antes tenía 20" no tiene respuesta, y en un almacén chico eso
--     pasa: se rompe una caja, se pierde una mercadería, alguien anota a
--     mano.
--
-- El stock se actualiza SIEMPRE junto a escribir el movimiento, en la
-- misma operación. Si se pueden desincronizar, hay que elegir cuál
-- miente, y las dos Respuestas son malas.
--
--
-- PRECIOS EN CENTÍVOS, SIEMPRE
-- -----------------------------
-- `precio_cents integer`. Un precio en coma flotante acumula error de
-- redondeo, y al multiplicar por 500 unidades deja de cuadrar. Con
-- enteros no hayenteros no hay desvío.
--
-- La última palabra la lleva el nombre de la columna: si no dice `_cents`
-- en todas partes, alguien va a guardar pesos en una.
--
--
-- CUENTAS CORRIENTES: POR QUÉ UN LEDGER Y NO UN SALDO
-- ----------------------------------------------------
-- Podría haber un `saldo` en el cliente y ya. No, porque entonces no se
-- puede responder "¿cuándo me me empezó a deberó a deber?", y en un kiosco eso es
-- exactamente lo que se pregunta: "yo te dejé fiado el mes pasado".
--
-- `inv_cuentas` es un libro de debe y haber. El saldo es la suma, y se
-- puede mostrar cada movimiento que lo componen.
--
--
-- FACTURACIÓN: SOLO AVISA
-- ----------------------
-- Este servicio NO emite comprobantes fiscales. Es otra cosa, con otra
--base legal y otra integración.
--
-- Lo que sí hace es marcar la venta como `registrada` o `facturada`, y
-- decir al final del día cuáles se quedaron sin facturar. Así el dueño
-- sabe qué tiene que ir a hacer a otro lado, sin tener que buscar venta
-- por venta.
--
-- El campo se llama `factura_nro` y es texto libre, no un número
-- validado: lo escribe quien lo emitió, en el sistema que lo emitió.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Productos
-- ---------------------------------------------------------------------
create table if not exists inv_productos (
  id          uuid primary key default gen_random_uuid(),

  /* Dueño. El servicio no guarda usuarios: esta es la fila que dice de
     quién es, y la que todas las políticas de este fichero comprueban. */
  client_id   uuid not null references clients on delete cascade,

  nombre      text not null,
  descripcion text,

  /* Para filtrar en la pantalla de ventas. Sin índice, porque se filtra
     y no se ordena, y un índice que no se usa solo hace la escritura más
     lenta. */
  categoria   text,

  /* Si está inactivo aparece en el histórico pero no se puede vender.
     Un producto que se deja de vender no se borra: el movimiento de
     hace seis meses lo referencia. */
  activo      boolean not null default true,

  creado_en   timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table inv_productos is
  'Lo que vende el comercio. NO es lo que tiene stock: eso son las variantes. Un producto agrupa sus presentaciones (ver inv_variantes).';
comment on column inv_productos.activo is
  'Inactivo = no se puede vender, pero sigue apareciendo en el histórico. Nunca se borra un producto con movimientos.';

create index if not exists ix_inv_productos_client on inv_productos (client_id);


-- ---------------------------------------------------------------------
-- Variantes: la unidad real, la que tiene stock y precio
-- ---------------------------------------------------------------------
create table if not exists inv_variantes (
  id          uuid primary key default gen_random_uuid(),
  producto_id uuid not null references inv_productos on delete cascade,

  /* El SKU. Es lo que se escribe a mano al principio y lo que se imprime
     en la etiqueta. Opcional: hay productos que se identifican solo por
     nombre. */
  sku         text,

  /* Cómo se llama esta presentación concreta: "500ml", "talle M". Es lo
     que se ve en la etiqueta y lo que se escoge al vender, así que se
     separa del nombre del producto ("Gaseosa" / "500ml"). */
  nombre_variante text,

  precio_venta_cents  integer not null default 0 check (precio_venta_cents >= 0),
  precio_costo_cents  integer not null default 0 check (precio_costo_cents >= 0),

  /* El stock de esta variante. Se actualiza SIEMPRE junto a escribir un
     movimiento, en la misma operación. Es una caché de la verdad, que
     está en inv_movimientos: se lee mucho y se escribe poco, que es
     exactamente cuando conviene cachear. */
  stock       integer not null default 0,

  /* Por debajo de esto sale el aviso de "se está acabando". Un kiosco
     quiere saberlo antes de quedarse sin nada, no después. */
  stock_minimo integer not null default 0 check (stock_minimo >= 0),

  /* Para ordenar la pantalla de venta: lo primero que se vende, primero.
     A mano, no "por fecha": el dueño sabe qué se vende. */
  orden       integer not null default 0,

  activo      boolean not null default true,

  creado_en   timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  check (precio_venta_cents >= precio_costo_cents or precio_costo_cents = 0)
);

comment on table inv_variantes is
  'La unidad que se vende y la que tiene stock. "Gaseosa 500ml" es una variante; "Gaseosa" es el producto que la agrupa.';
comment on column inv_variantes.stock is
  'Stock actual. CACHÉ de inv_movimientos: se lee en cada venta y se actualiza junto al movimiento, en la misma operación. Si alguna vez se desincroniza, la verdad son los movimientos.';

create index if not exists ix_inv_variantes_producto on inv_variantes (producto_id);

-- El índice que de verdad se usa: buscar por código de barras al vender.
-- Es la operación más repetida del día en un kiosco.
create index if not exists ix_inv_variantes_sku on inv_variantes (sku) where sku is not null;


-- ---------------------------------------------------------------------
-- Códigos de barras, aparte
-- ---------------------------------------------------------------------
-- Un producto tiene varios códigos: el del fabricante, el propio del
-- comercio, el de la caja. Si el código fuera una columna, habría que
-- elegir uno y los otros se perderían.
create table if not exists inv_codigos (
  id          uuid primary key default gen_random_uuid(),
  variante_id uuid not null references inv_variantes on delete cascade,

  /* Solo los formatos que existen: EAN-13, UPC-A, CODE-128, ITF.
     Un CHECK abierto no valida nada, porque siempre hay un valor
     inventado que se cuela. */
  formato     text not null check (formato in ('ean13','upca','code128','itf')),

  codigo      text not null,

  /* El principal es el que se usa al escanear. */
  principal   boolean not null default false,

  creado_en   timestamptz not null default now()
);

comment on table inv_codigos is
  'Códigos de barras de una variante. Varios: el del fabricante, el del comercio, el de la caja.';

create unique index if not exists ix_inv_codigos_codigo on inv_codigos (codigo);
create index if not exists ix_inv_codigos_variante on inv_codigos (variante_id);


-- ---------------------------------------------------------------------
-- Movimientos: la verdad de qué pasó con el stock
-- ---------------------------------------------------------------------
create table if not exists inv_movimientos (
  id          uuid primary key default gen_random_uuid(),
  variante_id uuid not null references inv_variantes on delete cascade,

  /* entrada = entró mercadería (compra, devolución)
     salida   = salió mercadería (venta, merma, consumo)
     ajuste   = se corrigió el número sin que entre ni salga nada
               (contó mal, se rompió algo, apareció de más) */
  tipo        text not null check (tipo in ('entrada','salida','ajuste')),

  /* Negativo en `ajuste` para restar, positivo para sumar. En los demás
     tipos es siempre positivo y el `tipo` dice la dirección: así no hay
     dos formas de expresar "salió" que den el mismo resultado. */
  cantidad    integer not null,

  /* Por qué pasó. Sin esto, un adjustment es un número que nadie sabe
     explicar tres meses después. */
  motivo      text,

  /* De dónde viene: la venta o la compra que lo provocaron. Es lo que
     permite deshacer una venta entera. */
  venta_id    uuid,
  compra_id   uuid,

  /* Quién lo hizo. Referencia a auth.users porque quien opera puede ser
     un empleado del cliente, no el dueño, y en un almacén chico se
     necesita saber quién tocó qué. */
  usuario_id  uuid references auth.users on delete set null,

  /* El costo en el momento del movimiento, NO el de ahora. Si el precio de
     compra sube mañana, el margen de la venta de ayer sigue siendo el de
     ayer. */
  costo_unitario_cents integer,

  creado_en   timestamptz not null default now(),

  check (cantidad <> 0)
);

comment on table inv_movimientos is
  'La verdad del stock. inv_variantes.stock es una caché de aquí. Un movimiento NUNCA se borra ni se edita: se corrige con un ajuste contrario, que queda en el registro.';

create index if not exists ix_inv_movimientos_variante on inv_movimientos (variante_id, creado_en desc);
create index if not exists ix_inv_movimientos_venta on inv_movimientos (venta_id) where venta_id is not null;


-- ---------------------------------------------------------------------
-- Proveedores y compras
-- ---------------------------------------------------------------------
create table if not exists inv_proveedores (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients on delete cascade,

  nombre      text not null,
  contacto    text,
  telefono    text,
  email       text,
  notas       text,

  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

comment on table inv_proveedores is
  'De quién se compra. En un kiosco son tres o cuatro: la distribuidora, el kiosco de la esquina, el que vende helados.';

create index if not exists ix_inv_proveedores_client on inv_proveedores (client_id);


create table if not exists inv_compras (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients on delete cascade,
  proveedor_id  uuid references inv_proveedores on delete set null,

  fecha         date not null default current_date,

  /* borrador  = se está anotando, el stock NO se ha movido
     recibida   = llegó la mercadería y el stock ya entró

     La separación importa: se puede empezar el pedido al amanecer y
     recibida a la tarde. Si el stock se moviera al crear el borrador, un
     pedido olvidado descontaría mercadería que nunca llegó. */
  estado        text not null default 'borrador' check (estado in ('borrador','recibida','anulada')),

  /* Número de factura del proveedor. Texto libre: cada proveedor lo
     escribe como quiere. */
  factura_nro   text,

  total_cents   integer not null default 0,
  notas         text,

  usuario_id    uuid references auth.users on delete set null,
  creado_en     timestamptz not null default now(),
  recibido_en   timestamptz
);

comment on table inv_compras is
  'Pedido a proveedor. El stock solo se mueve al pasar a "recibida", nunca al crear el borrador.';

create index if not exists ix_inv_compras_client on inv_compras (client_id, fecha desc);


create table if not exists inv_compra_items (
  id          uuid primary key default gen_random_uuid(),
  compra_id   uuid not null references inv_compras on delete cascade,
  variante_id uuid not null references inv_variantes on delete cascade,

  cantidad    integer not null check (cantidad > 0),
  costo_unitario_cents integer not null check (costo_unitario_cents >= 0),

  /* El costo total de ESTA línea, congelado. Si el precio del proveedor
     cambia mañana, lo que se pagó por esto sigue siendo esto. */
  total_cents integer generated always as (cantidad * costo_unitario_cents) stored
);

comment on column inv_compra_items.total_cents is
  'Generada: cantidad × costo. No se escribe a mano, que es como una cuenta pendiente se desajusta sin que nadie se entere.';

create index if not exists ix_inv_compra_items_compra on inv_compra_items (compra_id);


-- ---------------------------------------------------------------------
-- Clientes del comercio y cuentas corrientes
-- ---------------------------------------------------------------------
/* NO son usuarios de Nexo Studio. Son las personas que le compran al
   kiosco y a las que se les fía. No tienen cuenta ni contraseña: no
   entran nunca a este servicio. */
create table if not exists inv_clientes (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients on delete cascade,

  nombre      text not null,
  telefono    text,

  /* DNI o lo que sea. Texto: en Argentina hay CUIT, DNI, y foreigners con
     pasaporte, y un campo numérico obliga a inventar un número. */
  documento   text,

  notas       text,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

comment on table inv_clientes is
  'Personas que le compran al comercio y a las que se les fía. NO tienen usuario ni contraseña: nunca entran al servicio.';

create index if not exists ix_inv_clientes_client on inv_clientes (client_id);


/* Libro de debe y haber. El saldo es la suma, y así se puede ver cada
   movimiento que lo componen. Un `saldo` en la ficha no permite eso. */
create table if not exists inv_cuentas (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references inv_clientes on delete cascade,

  /* debe   = el cliente nos debe más (le fiamos)
     haber  = el cliente nos pagó o devolvió
     nota   = ajuste sin movimiento de dinero (perdón, error de carga) */
  tipo        text not null check (tipo in ('debe','haber','nota')),

  /* Positivo siempre. El `tipo` dice la dirección. Igual que en
     inv_movimientos: una sola forma de decirlo. */
  monto_cents integer not null check (monto_cents > 0),

  venta_id    uuid,
  concepto    text,
  usuario_id  uuid references auth.users on delete set null,
  fecha       date not null default current_date,
  creado_en   timestamptz not null default now()
);

comment on table inv_cuentas is
  'Libro de debe y haber de las cuentas corrientes. El saldo es la suma, para poder responder "desde cuándo me debe esto".';

create index if not exists ix_inv_cuentas_cliente on inv_cuentas (cliente_id, fecha desc);


-- ---------------------------------------------------------------------
-- Ventas
-- ---------------------------------------------------------------------
create table if not exists inv_ventas (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients on delete cascade,

  /* NULL = venta de mostrador, la de un kiosco sin apuntar a nadie. */
  cliente_id  uuid references inv_clientes on delete set null,

  fecha       timestamptz not null default now(),

  /* efectivo, tarjeta, transferencia, cuenta corriente. */
  metodo_pago text not null check (metodo_pago in ('efectivo','tarjeta','transferencia','cuenta_corriente')),

  /* Lo que suma la venta. Lo CALCULA un trigger, no la base.
     Ver la nota de abajo: era una columna generada y Postgres no
     admite subconsultas ahí. */
  total_cents integer not null default 0,

  /* Lo que se cobró. Con una venta a cuenta corriente, `total` es la
     deuda y `cobrado` es 0. La diferencia ES la deuda, y se lee sola. */
  cobrado_cents integer not null default 0,

  /* ⭐ ESTE SERVICIO NO EMITE COMPROBANTES.
     Solo apunta si alguien ya lo emitió en otro sistema. Es un texto
     libre a propósito: cada jurisdicción y cada proveedor lo escribe
     distinto, y validarlo aquí sería inventar un formato que no es de
     nadie. Lo que sí se hace es avisar de lo que falta. */
  factura_nro text,
  facturada   boolean not null default false,

  /* Anulada: la venta pasó, se cobró y se cayó. Se marca, no se borra,
     porque el movimiento de stock que dejó sigue ahí. */
  anulada     boolean not null default false,
  anulada_motivo text,

  notas       text,
  usuario_id  uuid references auth.users on delete set null,
  creado_en   timestamptz not null default now()
);

comment on table inv_ventas is
  'Ventas. facturada solo APUNTA que alguien emitió el comprobante en otro sistema: este servicio no emite nada fiscal.';
comment on column inv_ventas.total_cents is
  'La suma de sus líneas, calculada por trigger. NO la escribe nadie: si hay que corregir el total de una venta, lo que está mal es una línea, no el total.';
comment on column inv_ventas.anulada is
  'Anulada, no borrada: el movimiento de stock que dejó sigue existiendo y hay que dejarlo ver.';

create index if not exists ix_inv_ventas_client on inv_ventas (client_id, fecha desc);
create index if not exists ix_inv_ventas_sin_facturar on inv_ventas (client_id, fecha desc)
  where not facturada and not anulada;


create table if not exists inv_venta_items (
  id          uuid primary key default gen_random_uuid(),
  venta_id    uuid not null references inv_ventas on delete cascade,
  variante_id uuid not null references inv_variantes on delete cascade,

  cantidad    integer not null check (cantidad > 0),

  /* El precio CON EL QUE SE VENDIÓ, no el de ahora. Si mañana suben las
     gaseosas a 2,50, la venta de hoy sigue siendo a 2,25. Guardar el
     precio de ahora y recalcular es como se pierde la mitad del
     histórico de un negocio. */
  precio_unitario_cents integer not null check (precio_unitario_cents >= 0),

  /* Descuento en la línea, en centavos. No en porcentaje: un porcentaje
     guardado se aplica sobre un precio que puede haber cambiado. */
  descuento_cents integer not null default 0 check (descuento_cents >= 0),

  total_cents integer generated always as (
    cantidad * precio_unitario_cents - descuento_cents
  ) stored
);

comment on column inv_venta_items.total_cents is
  'Generada: cantidad × precio − descuento. El precio es el del momento de la venta, no el de ahora.';

create index if not exists ix_inv_venta_items_venta on inv_venta_items (venta_id);


-- ---------------------------------------------------------------------
-- Caja
-- ---------------------------------------------------------------------
/* Todo lo que entra y sale del cajón. Las ventas con efectivo entran
   solas desde inv_ventas; los gastos, los retiros y los pagos a
   proveedor se anotan a mano. */
create table if not exists inv_caja (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients on delete cascade,

  /* ingreso = entró dinero al cajón
     egreso  = salió (pago a proveedor, gasto, retiro del dueño) */
  tipo        text not null check (tipo in ('ingreso','egreso')),

  /* Para saber en qué está el dinero. `venta` y `gasto` auto documentan;
     el resto se agrupa. */
  categoria   text not null check (categoria in
    ('venta','compra','gasto','retiro','pago_deuda','otro')),

  monto_cents integer not null check (monto_cents > 0),

  /* Enlaza con el movimiento que lo generó. Una venta pagada en efectivo
     genera su entrada de caja: si no se enlaza, al anular la venta queda
     el dinero en el cajón y no hay forma de saber de dónde salió. */
  venta_id    uuid references inv_ventas on delete cascade,
  compra_id   uuid references inv_compras on delete set null,

  concepto    text,
  fecha       timestamptz not null default now(),
  usuario_id  uuid references auth.users on delete set null,
  creado_en   timestamptz not null default now()
);

comment on table inv_caja is
  'Entradas y salidas del cajón. Los retiros del dueño también son egreso: es la forma más común de que falte dinero y no quede registrado.';

create index if not exists ix_inv_caja_client on inv_caja (client_id, fecha desc);


/* Cierre de caja diario. */
create table if not exists inv_arqueos (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients on delete cascade,

  fecha         date not null,

  /* Con cuánto se abrió. Lo escribe el dueño al empezar el día. */
  saldo_inicial_cents integer not null check (saldo_inicial_cents >= 0),

  /* Lo que dice el sistema. Se calcula al cerrar. */
  saldo_calculado_cents integer,

  /* Lo que contó el dueño. Lo escribe al cerrar. */
  saldo_real_cents integer,

  /* Calculado, no escrito: por qué sobró o faltó dinero. */
  diferencia_cents integer,

  notas         text,
  cerrado_por    uuid references auth.users on delete set null,
  cerrado_en     timestamptz,
  creado_en      timestamptz not null default now()
);

comment on table inv_arqueos is
  'Cierre de caja del día. La diferencia se CALCULA: contarlo dos veces y que no coincida no es un dato, es un error de tipeo.';

-- Un arqueo por día. Sin esta restricción se pueden abrir dos y el
-- "saldo del día" deja de tener sentido.
create unique index if not exists ix_inv_arqueos_client_fecha on inv_arqueos (client_id, fecha);