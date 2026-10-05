-- =====================================================================
-- El soporte entra en la sesión (006)
-- =====================================================================
-- ESTA MIGRACIÓN EXISTE POR UN FALLO QUE HIZO LA PRIMERA
-- ---------------------------------------------------------
-- `sesion.ts` escribe estas tres columnas al crear una sesión, y la
-- tabla no las tenía. El resultado era que NINGUNA sesión se podía
-- crear: el canje del ticket devolvía 500.
--
-- Es la forma más tonta de fallo posible y la más difícil de ver desde
-- el código: `crearSesion()` hace un `insert` con cuatro columnas que
-- existen y tres que no, y el error de Postgres es genérico. Nada en
-- el TypeScript avisa, porque `insert` de supabase-js acepta un objeto
-- con cualquier forma.
--
-- Apareció al Trying a entrar de verdad en local, no al aplicar la
-- migración: aplicar 001 da "todo correcto" porque el INSERT de la
-- migración no menciona estas columnas. El fallo solo aparece cuando
-- alguien entra.
--
-- Lo que hace la plantilla es dejar la tabla de sesiones a medias:
-- escribe en el código lo que el acceso de soporte necesita, pero no
-- añade las columnas. Quien use la plantilla para un servicio nuevo
-- hereda el fallo.
--
--
-- QUÉ SON ESTAS COLUMNAS
-- ----------------------
--·soporte_de          el cliente al que el miembro del equipo está
--                     atendiendo. Es lo que hace que el soporte vea los
--                     datos de UN cliente y no de todos.
-- · soporte_motivo     por qué entra. Sin motivo obligatorio no hay
--                     sesión de soporte: es lo que queda guardado y lo
--                     que contesta a "por qué alguien del equipo tocó
--                     esto".
-- · soporte_abierto_en cuándo se abrió, para saber si lleva un rato
--                     con acceso a la cuenta de un cliente.
--
--
-- ⚠️  LO QUE NO SE HACE AQUÍ, Y POR QUÉ
-- --------------------------------------
-- NO se añade una política de RLS que deje leer estas columnas a
-- cualquiera. La tabla sigue SIN políticas a propósito: con RLS
-- encendido y sin políticas, solo la secret key la alcanza. El
-- `client_id` de la sesión decide, y eso lo aplica `tiene_inventario()`
-- en las políticas de negocio, no esta tabla.
--
-- Que staff pueda atender a un cliente NO significa que staff vea todas
-- las sesiones. Son dos cosas distintas y este fichero mantiene la
-- separación.
-- =====================================================================

alter table inventario_sesiones
  add column if not exists soporte_de        uuid references clients on delete cascade,
  add column if not exists soporte_motivo     text,
  add column if not exists soporte_abierto_en timestamptz;

comment on column inventario_sesiones.soporte_de is
  'Cliente al que atiende este miembro del equipo, si la sesión es de soporte. NULL en una sesión normal. Es lo que acota el acceso: staff ve UN cliente, no todos.';
comment on column inventario_sesiones.soporte_motivo is
  'Por qué entra soporte. Sin motivo obligatorio no hay sesión de soporte. Es lo que contesta a "por qué alguien del equipo tocó esto".';
comment on column inventario_sesiones.soporte_abierto_en is
  'Cuándo se abrió el acceso de soporte. Para saber cuánto lleva alguien con la cuenta de un cliente abierta.';

-- El índice que hace falta para "las sesiones de soporte abiertas de
-- este cliente", que es la pregunta que se hace al cerrar un ticket de
-- soporte.
--
-- Es un índice PARCIAL: solo cubre las filas donde hay soporte. En el
-- caso normal son cero, así que no ocupa nada. Sin esto, la pregunta
-- "qué sesiones de soporte hay abiertas" recorre toda la tabla.
create index if not exists ix_inventario_sesiones_soporte
  on inventario_sesiones (soporte_de, soporte_abierto_en desc)
  where soporte_de is not null and revocado_en is null;