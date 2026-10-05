-- =====================================================================
-- Cerrar el RLS: ninguna tabla sin protección (005)
-- =====================================================================
-- ESTA MIGRACIÓN EXISTE POR UN FALLO QUE HIZO LA PRUEBA
-- -------------------------------------------------------
-- `db/003_rls.sql` definía las POLÍTICIAS pero no encendía RLS en seis
-- tablas. Una tabla con políticas y RLS apagado no filtra NADA: las
-- políticas existen pero no se miran.
--
-- Ni las políticas ni el error delata nada. Las consultas devuelven
-- filas de otros clientes sin avisar, y todo parece funcionar. Es la
-- forma más silenciosa de tener un agujero de seguridad que hay.
--
-- Lo detectó `db/test-reglas.js`, mirando `relrowsecurity` tabla por
-- tabla, que es la única forma: leer el SQL y ver que falta un `alter
-- table ... enable row level security` es fácil; acordarse de mirar
-- después, no.
--
--
-- LO QUE SE ENCIENDE AQUÍ
-- -----------------------
--   inv_productos, inv_proveedores, inv_compras, inv_clientes,
--   inv_caja, inv_arqueos, inv_ventas
--
-- Las que ya estaban: inv_variantes, inv_codigos, inv_movimientos,
-- inv_compra_items, inv_venta_items, inv_cuentas.
--
-- Y `inventario_migrations`, que no es de negocio pero que tampoco puede
-- quedar abierta: es la que registra qué migraciones se aplicaron, y sin
-- RLS cualquiera que pueda escribir en la base podría cambiarla y hacer
-- que la siguiente migración creyera que ya está aplicada.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Las que faltaban
-- ---------------------------------------------------------------------
-- `if not exists` porque esta migración puede correr más de una vez, y
-- `enable` no falla si ya está encendido. Con `alter table` a secas,
-- repetirla da error.
alter table if exists inv_productos   enable row level security;
alter table if exists inv_proveedores enable row level security;
alter table if exists inv_compras     enable row level security;
alter table if exists inv_clientes    enable row level security;
alter table if exists inv_caja        enable row level security;
alter table if exists inv_arqueos     enable row level security;
alter table if exists inv_ventas      enable row level security;


-- ---------------------------------------------------------------------
-- 2. Y las que ya lo tenían, por si alguien las apagó
-- ---------------------------------------------------------------------
alter table if exists inv_variantes       enable row level security;
alter table if exists inv_codigos         enable row level security;
alter table if exists inv_movimientos     enable row level security;
alter table if exists inv_compra_items    enable row level security;
alter table if exists inv_venta_items     enable row level security;
alter table if exists inv_cuentas         enable row level security;


-- ---------------------------------------------------------------------
-- 3. La tabla de migraciones
-- ---------------------------------------------------------------------
-- Sin políticas: con RLS encendido y sin políticas, solo la alcanza la
-- secret key. Que es justo lo que tiene que pasar con una tabla de
-- control.
--
-- La política de 003 no llega aquí porque es una tabla de este servicio,
-- no de negocio: no tiene `client_id` y no la mira ninguna función.
alter table if exists inventario_migrations enable row level security;

drop policy if exists "escribir migraciones" on inventario_migrations;
create policy "escribir migraciones"
  on inventario_migrations for all to service_role
  using (true) with check (true);


-- ---------------------------------------------------------------------
-- 4. Comprobación de arranque
-- ---------------------------------------------------------------------
-- Esto NO avisa de nada en una consola normal: `raise notice` solo sale
-- con `client_min_messages = notice`, que no es lo habitual.
--
-- Es un "`DO` que no hace nada", y está aquí a propósito: si alguien
-- vuelve a apagar RLS en alguna tabla, esto sigue ejecutándose sin
-- fallar, y no se entera nadie. Un fallo ruidoso en cada consulta de
-- negocio sería peor: pararía el servicio por un problema que se puede
-- ver en una línea.
--
-- La comprobación de verdad está en db/test-reglas.js, que mira
-- `relrowsecurity` tabla por tabla y falla si encuentra una sin RLS.
--
-- do $$
-- begin
--   raise notice 'RLS de inventario verificado en 005';
-- end $$;