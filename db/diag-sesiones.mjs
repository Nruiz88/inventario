/* Por que el panel no puede iniciar sesion.
 *
 * node db/diag-sesiones.mjs
 *
 * El error del panel es:
 *
 *   [panel] Error en login: new row violates row-level security policy
 *   for table "sessions"
 *
 * Que es raro, porque el panel inserta con SUPABASE_SECRET_KEY, y esa
 * clave deberia saltarse RLS. Si se salta y el error sale, una de
 * estas dos es la causa:
 *
 *   a) La clave NO es service_role. Con las claves nuevas sb_secret_
 *      de Supabase, si la que tiene el panel no es la de admin, el
 *      rol del JWT es otro y RLS se aplica normal.
 *
 *   b) La tabla tiene RLS con CERO politicas. Con RLS activo y sin
 *      ninguna politica, Postgres no rechaza solo lo que no es de tu
 *      cliente: rechaza TODO, y el service_role tampoco se libra si
 *      la tabla tiene FORCE ROW LEVEL SECURITY.
 *
 * Esto prueba las dos cosas sin suponer nada: mira el rol con el que
 * entra la clave, e intenta un INSERT de verdad con ella.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(import.meta.dirname, "..");

function leerEnv(ruta) {
  const s = {};
  if (!fs.existsSync(ruta)) return s;
  for (const l of fs.readFileSync(ruta, "utf8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) s[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return s;
}

const env = leerEnv(path.join(RAIZ, ".env.local"));
for (const [k, v] of Object.entries(env)) {
  if (k in process.env) continue;
  process.env[k] = v;
}

const { createClient } = require("@supabase/supabase-js");

const URL_SB = process.env.SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;

console.log("\n═══ Por que falla el login del panel ═══\n");

console.log("── La clave ──\n");
console.log(`  prefijo: ${SECRET.slice(0, 12)}...  (${SECRET.length} chars)`);
console.log(
  `  tipo:    ${
    SECRET.startsWith("sb_secret_")
      ? "clave nueva sb_secret_ de Supabase"
      : SECRET.startsWith("eyJ")
        ? "JWT"
        : "formato no reconocido"
  }`
);

const db = createClient(URL_SB, SECRET, { auth: { persistSession: false } });

/* Una función que devuelve el rol, si existe. */

/* 1. Que rol tiene de verdad la clave.
 *
 * Las claves nuevas sb_secret_ no son JWT, asi que no se puede
 * decodificar el rol como con un JWT. La unica forma fiable es
 * preguntarselo a la propia base: current_user y session_user desde
 * una funcion, o un SELECT que solo funciona para service_role.
 *
 * Esto importa porque una clave anon con RLS activo da el MISMO
 * error que un RLS mal puesto, y se confunden. */
console.log("\n── que rol tiene la clave ──\n");

const { data: perfil, error: ePerfil } = await db.rpc("cliente_de_la_sesion");

/* Un SELECT a una vista o tabla restringida: si la clave no es de
   admin, esto falla aunque la tabla tenga RLS desactivado. */
const { data: pruebaRol, error: eRol } = await db
  .from("sessions")
  .select("id")
  .limit(1);

if (eRol) {
  console.log(`  SELECT en sessions: FALLA — ${eRol.message}`);
  console.log("  Si el RLS de la tabla estuviera bien, service_role la leeria igual.");
} else {
  console.log(`  SELECT en sessions: OK (${pruebaRol?.length ?? 0} filas)`);
}

/* Un SELECT que el rol anon no puede hacer en absoluto. */
const { error: eLectura } = await db.from("pg_stat_activity").select("*").limit(1);
console.log(`  SELECT en pg_stat_activity: ${eLectura ? "FALLA (no es admin)" : "OK (es admin)"}`);

/* 2. Lo que de verdad importa: un INSERT con esa clave. */
console.log("\n── INSERT de prueba en sessions, con la clave del panel ──\n");

const marca = "diag-" + Date.now();

/* Para el INSERT no hace falta la contrasena del admin: solo un
   user_id que exista, porque sessions tiene clave foranea a auth.
   Se busca el id de un usuario staff con la clave admin, que si
   salta RLS. */
const { data: admins } = await db.auth.admin.listUsers({ page: 1, perPage: 100 });
const { data: sesStaff } = await db.from("sessions").select("user_id").eq("rol", "staff").limit(1);
const userId = sesStaff?.[0]?.user_id || admins?.users?.[0]?.id || null;

console.log(`  user_id para la prueba: ${userId ? userId.slice(0, 8) + "..." : "no hay"}`);

if (!userId) {
  console.log("  no hay ningun usuario para probar");
  process.exit(1);
}

/* Un INSERT con las columnas REALES de la tabla. Este es el mismo que
   hace auth.crearSesion() en el panel. */
const { error: eIns } = await db.from("sessions").insert({
  token_hash: marca,
  user_id: userId,
  csrf_token: marca,
  rol: "staff",
  creada_en: new Date().toISOString(),
  ultimo_acceso: new Date().toISOString(),
  expira_en: new Date(Date.now() + 3600_000).toISOString(),
  access_token: null,
});

if (eIns) {
  console.log(`  ✗ el INSERT falla: ${eIns.message}`);
  console.log(`    codigo: ${eIns.code || '(ninguno)'}`);
  console.log(`    detalle: ${eIns.details || '(ninguno)'}`);
  console.log(`    pista: ${eIns.hint || '(ninguna)'}`);
  console.log("");
  console.log("  Esto es el error que ve el panel al hacer login.");
  console.log("  Suele ser una de estas dos, y se distinguen mirando la tabla:");
  console.log("");
  console.log("    · RLS activo con CERO politicas en sessions");
  console.log("      Con RLS y sin politicas, Postgres rechaza todo. El");
  console.log("      service_role tampoco, si la tabla tiene FORCE RLS.");
  console.log("");
  console.log("    · La clave no es de admin");
  console.log("      Entonces el JWT dice que el rol no puede saltarse RLS.");
} else {
  console.log("  ✓ el INSERT funciona: el panel deberia poder iniciar sesion");
  console.log("");
  console.log("  Entonces el problema NO es RLS ni la clave con ESTA clave.");
  console.log("  Lo que queda es que el contenedor del panel tenga otra, o que");
  console.log("  la tabla que usa el panel sea otra.");
  await db.from("sessions").delete().eq("token_hash", marca);
}

console.log("");
process.exit(0);