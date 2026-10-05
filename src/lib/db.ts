/* =========================================================
   Cliente de Supabase
   ---------------------------------------------------------
   Por qué hay DOS clientes y no uno
   -------------------------------
   · `admin` lleva la secret key. SALTA RLS. La usa el SERVIDOR:
     las webhooks que entran sin sesión de usuario, las tareas de
     mantenimiento, la tabla de sesiones.

   · `scoped` lleva la publishable key Y el access_token del usuario.
     APLICA RLS, o sea que si el código se equivoca al comprobar de qué
     cliente son los datos, la base lo rechaza igual.

   Que exista `scoped` es lo que hace que un fallo en la comprobación de
   pertenencia no sea un fallo de SEGURIDAD. Con solo `admin`, todo el
   backend podría leer los datos de otro cliente y nadie se enteraría
   hasta que un cliente viera los pedidos de otro.

   ⚠️  EL ERROR QUE ESTO PREVIENE
   ------------------------------
   El patrón peligroso es este:

       const id = await datoDeLaSesion(sesion);   ← con RLS, de fiar
       const filas = await query("WHERE id = ?", [id]);

   Es correcto porque el id sale de un SELECT que RLS ya filtró.

   Lo que NO sería correcto es aceptar el id de la petición:

       searchParams.get("id")   ← NUNCA

   Con `query()` (que va por secret key) nadie te va a avisar: la base
   responde igual de contenta. Por eso `query()` es peligrosa y
   `scoped` es obligatoria: una te deja pasar sin darte cuenta, la otra
   te para en la puerta.

   REGLA, PARA SIEMPRE
   ------------------
     El id SIEMPRE sale de una función que usa el cliente `scoped`.
     Nunca de la URL, nunca de un parámetro sin comprobar.
   ========================================================= */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || "";
const secretKey =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const admin: SupabaseClient | null = secretKey
  ? createClient(url, secretKey)
  : null;

/**
 * Cliente que respeta RLS. Requiere el access_token del usuario.
 *
 * El nombre `scoped` viene de "scoped to this user": un cliente con un
 * token de sesión solo ve lo que ese token le deja ver. En Supabase se
 * suele llamar así a un `createClient` con la sesión del usuario.
 */
export function getScoped(token: string): SupabaseClient {
  return createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY || "", {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * El cliente del servidor, o error si no hay credenciales.
 *
 * OJO: esto se llama DENTRO de cada función, no al importar el módulo.
 * Si se evaluara en el `const admin = ...` de arriba, importar este
 * fichero sin variables de entorno (que es lo que hacen los tests, que
 * mockean las consultas) lanzaría al importar y rompería la suite
 * entera con un error de configuración de base de datos en lugar de un
 * fallo de una prueba.
 */
export function getAdmin(): SupabaseClient {
  if (!admin) {
    throw new Error(
      "Supabase no está configurado (SUPABASE_URL / SUPABASE_SECRET_KEY)"
    );
  }
  return admin;
}

if (admin) {
  console.log(`[db] supabase → ${url}`);
} else {
  /* Se dice en el arranque, no en cada consulta: un error por petición
     llena el log de lo mismo y esconde lo que sí pasó. */
  console.error(
    "[db] falta SUPABASE_URL o SUPABASE_SECRET_KEY — no se puede leer ni escribir"
  );
}

/**
 * Ejecuta SQL crudo y devuelve SIEMPRE un array de filas.
 *
 * ⚠️  ESTA FUNCIÓN VA POR LA SECRET KEY: SALTA RLS
 * -----------------------------------------------
 * Es decir, lo que devuelva no está filtrado por el usuario, y por eso
 * SOLO puede usarse con un id que ya venga de una consulta con RLS (ver
 * la nota de "la regla" arriba). Para lo que sea del cliente que entra,
 * `getScoped()`.
 *
 * Y no debe usarse para escribir: el panel expone `ejecutar_sql` con
 * solo SELECT, a propósito, para que ninguna ruta pueda escribir saltándose
 * RLS. Para escribir, `insert()`/`update()`/`remove()`.
 *
 * El tipo genérico es la FILA, no el array:
 * `query<{ id: string }>()` devuelve `Promise<{ id: string }[]>`, que
 * es lo que hace que `.map`, `.length` y `[0]` type-chequeen.
 */
export async function query<T = any>(sql: string, values: any[] = []): Promise<T[]> {
  const { data, error } = await getAdmin().rpc("ejecutar_sql", {
    consulta: aPlaceholders(sql),
    args: values,
  });
  if (error) throw errorFromPostgres(error);
  return (data ?? []) as T[];
}

/** MariaDB usaba `?` y Postgres usa `$1`, `$2`. */
function aPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => "$" + ++i);
}

/**
 * Traduce los errores de Postgres a algo que un catch pueda reconocer.
 *
 * Es lo que sustituye al `ER 3819` de MariaDB. Sin esto, una violación
 * de CHECK llegaba a la interfaz como "Error inesperado" porque el
 * catch miraba `err.code === 'ER 3819'`, y el código nuevo es un
 * número.
 */
export function errorFromPostgres(e: unknown): Error {
  const err = e as { code?: string; message?: string; details?: string } | null;
  if (!err) return new Error(String(e));

  const code = err.code || "";
  const mensaje =
    code === "23505" ? "Ya existe un registro con esos datos"
    : code === "23503" ? "No se puede: hay datos que apuntan a este registro"
    : code === "23514" ? "Datos no válidos: no pasa la validación"
    : code === "23P01" ? "Ese hueco de la agenda ya está ocupado"
    : code === "42501" ? "No tienes permiso para esto"
    : err.message || "Error desconocido";

  const out = new Error(mensaje) as Error & { code?: string; original?: string };
  out.code = err.code;
  /* El mensaje original de Postgres. Se guarda aparte porque `mensaje`
     ya lo tradujo a algo legible, y el original es lo que dice el log
     cuando algo raro pasa. */
  out.original = err.message;
  return out;
}

/* ---------------------------------------------------------------------
   Escrituras
   ---------------------------------------------------------------------
   Van con la secret key, como el resto del servidor. Para lo que
   escribe el USUARIO y tiene que pasar por RLS, usa `getScoped()`.
   --------------------------------------------------------------------- */

export async function insert(
  table: string,
  data: Record<string, any>
): Promise<{ affectedRows: number; id: string | null }> {
  const { data: filas, error } = await getAdmin().from(table).insert(data).select();
  if (error) throw errorFromPostgres(error);
  const lista = (filas ?? []) as Record<string, string>[];
  return { affectedRows: lista.length, id: lista[0]?.id ?? null };
}

export async function update(
  table: string,
  id: string,
  data: Record<string, any>
): Promise<{ affectedRows: number }> {
  const { data: filas, error } = await getAdmin()
    .from(table)
    .update(data)
    .eq("id", id)
    .select();
  if (error) throw errorFromPostgres(error);
  return { affectedRows: (filas ?? []).length };
}

export async function remove(table: string, id: string): Promise<{ affectedRows: number }> {
  const { data: filas, error } = await getAdmin().from(table).delete().eq("id", id).select();
  if (error) throw errorFromPostgres(error);
  return { affectedRows: (filas ?? []).length };
}