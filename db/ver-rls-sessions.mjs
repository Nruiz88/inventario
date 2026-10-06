/* Ver el RLS y las politicas de la tabla sessions de la app.
 *
 * node db/ver-rls-sessions.mjs
 *
 * Esto NO es un SELECT normal. El service_role de Supabase ignora las
 * politicas RLS por definicion, asi que leer con el como anybody mas
 * devuelve lo que el rol privileged ve, no lo que ve un login. Para
 * ver las politicas hay que preguntar al Postgres, y para eso hace
 * falta la conexion con contrasena (DATABASE_URL), que si existe solo
 * para migraciones.
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

const { Client } = require("pg");

const url = process.env.DATABASE_URL;

if (!url) {
  console.log("  falta DATABASE_URL");
  console.log("  Ojo: la clave de la base NO debe ir al contenedor. Solo se usa aqui.");
  process.exit(1);
}

const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

async function ver(titulo, sql) {
  console.log(`\n── ${titulo} ──\n`);
  const r = await c.query(sql);
  if (!r.rows.length) {
    console.log("  (nada)");
    return;
  }
  const cols = Object.keys(r.rows[0]);
  console.log("  " + cols.join(" | "));
  for (const fila of r.rows) {
    console.log(
      "  " +
        cols
          .map((k) => {
            const v = fila[k];
            return v === null ? "-" : String(v).slice(0, 58);
          })
          .join(" | ")
    );
  }
}

await ver("RLS activado en las tablas que toca el panel", `
  select
    c.relname as tabla,
    c.relrowsecurity as rls_on,
    c.relforcerowsecurity as rls_fuerza
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('sessions','profiles','clients','modules','services')
  order by c.relname;
`);

await ver("politicas de sessions", `
  select policyname, cmd,
         coalesce(roles::text,'(public)') as roles,
         coalesce(qual,'-')      as usando,
         coalesce(with_check,'-') as comprobando
  from pg_policies
  where schemaname = 'public' and tablename = 'sessions'
  order by policyname;
`);

await ver("las funciones que audita el login", `
  select p.proname as funcion,
         pg_get_function_identity_arguments(p.oid) as argumentos
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname ilike '%audit%' or p.proname ilike '%sesion%' or p.proname ilike '%session%')
  order by p.proname;
`);

console.log("\n");
await c.end();
process.exit(0);