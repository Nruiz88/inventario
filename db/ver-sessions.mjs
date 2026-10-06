/* El esquema REAL de la tabla sessions, y el RLS.
 *
 * node db/ver-sessions.mjs
 *
 * Hace falta porque el service_role de Supabase ignora RLS, asi que
 * un SELECT normal dice lo que ve el rol privilegiado, no lo que ve un
 * login. Para ver la verdad —las politicas y el RLS forzado— hay que
 * preguntar al Postgres con la conexion de contrasena, que es la unica
 * que ve el catalogo del sistema.
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
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

async function ver(titulo, sql) {
  console.log(`\n── ${titulo} ──\n`);
  const r = await c.query(sql);
  if (!r.rows.length) {
    console.log("  (nada)");
    return;
  }
  const cols = Object.keys(r.rows[0]);
  for (const fila of r.rows) {
    console.log(
      "  " +
        cols
          .map((k) => {
            const v = fila[k];
            return v === null ? "-" : String(v).slice(0, 70);
          })
          .join("  |  ")
    );
  }
}

await ver("columnas de sessions", `
  select column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_name = 'sessions'
  order by ordinal_position;
`);

await ver("RLS y FORCE RLS de sessions", `
  select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public' and c.relname='sessions';
`);

await ver("todas las politicas de sessions", `
  select policyname, cmd, coalesce(roles::text,'(public)') as roles
  from pg_policies
  where schemaname='public' and tablename='sessions'
  order by policyname;
`);

await ver("los roles de Postgres y si saltan RLS", `
  select rolname, rolbypassrls, rolsuper from pg_roles
  where rolname in ('service_role','anon','authenticated','postgres','supabase_admin')
  order by rolname;
`);

await ver("triggers de sessions", `
  select tgname,
         substring(pg_get_triggerdef(t.oid) from 1 for 150) as definicion
  from pg_trigger t
  where t.tgrelid = 'public.sessions'::regclass
    and not t.tgisinternal
  order by tgname;
`);

await ver("restricciones y claves foraneas de sessions", `
  select conname,
         substring(pg_get_constraintdef(oid) from 1 for 120) as definicion
  from pg_constraint
  where conrelid = 'public.sessions'::regclass
  order by conname;
`);

/* Esto es lo que mas importa y es lo que nadie mira: si la tabla
   sessions esta Enabled por RLS y NO tiene ninguna politica, el
   unico rol que puede escribir es uno con BYPASSRLS. Y aunque el
   service_role lo tenga, cualquier llamada que llegue con el rol
   `authenticated` —por ejemplo, un cliente construido con
   getClientForToken— falla con este error exacto. */
await ver("RLS de sessions y quien puede saltarselo", `
  select
    c.relrowsecurity     as rls_activo,
    c.relforcerowsecurity as rls_forzado,
    (select count(*) from pg_policies where schemaname='public' and tablename='sessions') as politicas,
    (select rolbypassrls from pg_roles where rolname='service_role') as service_salta_rls,
    (select rolbypassrls from pg_roles where rolname='authenticated') as authenticated_salta_rls
  from pg_class c
  where c.oid = 'public.sessions'::regclass;
`);

console.log("\n");
await c.end();
process.exit(0);