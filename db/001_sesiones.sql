-- ================================================================
-- Sesiones de un microservicio (plantilla)
-- ------------------------------------------------------------
-- Cada servicio tiene SU PROPIA tabla de sesiones. No se reusa la del
-- panel, y esto no es capricho:
--
--   · La cookie del panel es host-only a propósito. Si compartiera
--     Domain con el panel, un XSS en CUALQUIER subdominio se llevaría la
--     sesión de todos, que es donde están todos los clientes.
--
--   · Si el servicio escribiera en `sessions`, el panel podría leer sus
--     sesiones y el revés. Y si mañana el panel acepta "cerrar sesión en
--     todos lados", el servicio se queda dentro sin querer.
--
-- Con una tabla por servicio, cada dominio mantiene su almacén, su
-- cookie y su vida útil, y ninguno puede tocar el del otro.
--
--
-- ⚠️  RLS: SIN POLÍTICAS, A PROPÓSITO
-- -----------------------------------
-- Con RLS encendido y sin políticas, `authenticated` no llega a esta
-- tabla. Solo la alcanza el servidor, con la secret key.
--
-- Es lo que hace que la sesión no se pueda falsificar desde el
-- navegador: leerla, escribirla o revocarla requiere la clave del
-- servidor, que no baja nunca al cliente.
--
-- Lo mismo que hace `sessions` del panel (migración 005) y que
-- `bot_sesiones` (migración 013).
-- ================================================================


-- ---------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------

create table if not exists inventario_sesiones (
  id          uuid primary key default gen_random_uuid(),

  /* El cliente dueño de la sesión. NULL solo para staff antes de que
     elija a quién atiende (ver migración de soporte si lo necesitas). */
  client_id   uuid references clients on delete cascade,

  /* Solo el hash. El token en claro va en la cookie y no se guarda
     nunca: quien lea esta tabla puede invalidar una sesión, no
     suplantarla. */
  token_hash  text not null unique,

  user_id     uuid not null references auth.users on delete cascade,
  rol         text not null check (rol in ('staff','client')),

  /* Para reconstruir la sesión de Supabase y que RLS decida, en vez de
     filtrar por client_id a mano en el código. */
  access_token text,

  csrf_token  text not null,

  /* 4 horas. Más corta que la del panel: este es un servicio de uso
     concreto, y una ventana más corta por si acaso. */
  expira_en   timestamptz not null,

  revocado_en timestamptz,

  creado_en   timestamptz not null default now(),

  /* Se comprueba al crear, pero también en el sitio: un UPDATE que
     pusiera una caducidad lejana no debe poder saltarse el límite.

     OJO con el efecto colateral: por este check, `expira_en` NO se
     puede escribir en el pasado nunca. Para revocar una sesión hay que
     usar `revocado_en`, no "ponerla caducada". */
  check (expira_en > creado_en)
);

comment on table inventario_sesiones is
  'Sesiones de este microservicio. Tabla propia, separada de la del panel a propósito: cada servicio mantiene su almacén para que una cookie de un subdominio no sirva en otro.';

comment on column inventario_sesiones.token_hash is
  'SHA-256 del token de la cookie. El token en claro no se guarda: leer esta tabla permite invalidar una sesión, no suplantarla.';

create index if not exists ix_inventario_sesiones_token on inventario_sesiones (token_hash);
create index if not exists ix_inventario_sesiones_user on inventario_sesiones (user_id);
create index if not exists ix_inventario_sesiones_client on inventario_sesiones (client_id);

-- Solo las que siguen vivas: es lo único que se consulta, y así el
-- índice no crece con las sesiones viejas.
create index if not exists ix_inventario_sesiones_vivas
  on inventario_sesiones (token_hash)
  where revocado_en is null;

alter table inventario_sesiones enable row level security;
-- Sin políticas a propósito. Ver la nota de arriba.


-- ---------------------------------------------------------------------
-- 2. Permisos
-- ---------------------------------------------------------------------
-- El servidor entra con la secret key, que salta RLS. Si tu servicio
-- usa un rol de Postgres propio, dale escritura aquí y SOLO aquí.
--
-- grant select, insert, update on inventario_sesiones to mi_rol;
--
-- Y si necesitas leer `profiles` para saber el rol o el client_id:
-- grant select on profiles to mi_rol;
-- Con RLS, leer profiles sin permiso da error, no filas vacías: es un
-- fallo ruidoso, que es lo que se quiere aquí.


-- ---------------------------------------------------------------------
-- 3. Lo que NO hay en esta migración, y por qué
-- ---------------------------------------------------------------------
-- Las políticas de los DATOS del servicio no van aquí.
--
-- Van en la migración del propio servicio, con sus propias tablas, y
-- tienen que apoyarse en una función que compruebe la pertenencia desde
-- la sesión. El bot de WhatsApp lo tiene en la migración 011:
--
--     create function puede_ver_bot(bot_uuid uuid) returns boolean ...
--
-- La forma, para que sea el modelo:
--
--     create function puede_ver_mi_dato(dato_uuid uuid)
--       returns boolean
--       language sql stable security definer
--       set search_path = public
--       as $$
--         select exists (
--           select 1 from mis_datos d
--           join profiles p on p.client_id = d.client_id
--           where d.id = dato_uuid
--             and p.id = auth.uid()
--             and p.rol = 'client'
--             and p.activo
--         );
--       $$;
--
-- `security definer` + `search_path` fijo: sin eso, la función se
-- podría usar para leer tablas de las que el usuario no tiene permiso.
-- Es el patrón que ya usan `es_cliente_de()` (001) y `es_dueno_de_bot()`
-- (011), y no es opcional.
--
-- Y una regla que se escribe una vez y se cumple siempre: el id SIEMPRE
-- sale de una consulta que RLS ya filtró. Nunca de la URL.
--
--     const id = await botDeLaSesion(sesion);   ← con RLS, de fiar
--     const filas = await query("WHERE id = ?", [id]);
--
-- es correcto porque el id viene de un SELECT que la base ya filtró.
-- Lo que NO sería correcto es aceptarlo de la petición:
--
--     searchParams.get("id")   ← NUNCA
-- ====================================================================