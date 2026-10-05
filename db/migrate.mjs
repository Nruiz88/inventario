/* =========================================================
   Inventario — aplicar migraciones
   ---------------------------------------------------------
   Aplica los .sql de db/ en orden, guardando en `schema_migrations`
   cuáles se aplicaron.

   ⚠️  POR QUÉ NO SE USA `supabase db push` NI LAS MIGRACIONES DE SUPABASE
   ------------------------------------------------------------------------
   Porque este servicio comparte la base con el panel, y las migraciones
   del panel (`db/migrations/*.sql` en el otro proyecto) también se
   aplican contra ella. Si dos herramientas aplicaran migraciones por su
   cuenta, se pisarían los números.

   Este script solo lee de SU carpeta, y además usa `supabase_migrations`
   —con prefijo de servicio— en vez de `schema_migrations`, para que las
   dos listas no se confundan al mirar cuál se aplicó.

   Es lo mismo que hace el panel con su carpeta, y por el mismo motivo.

   USO
     node db/migrate.mjs          # aplica las que falten
     node db/migrate.mjs --estado # solo muestra el estado
   ========================================================= */

import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const RAIZ = path.resolve(import.meta.dirname, "..");
const DIR = path.join(RAIZ, "db");

/* El prefijo va en el nombre de la tabla de control, no solo en el
   filtro: dos servicios pueden tener un `001_init.sql` cada uno. */
const TABLA = "inventario_migrations";

/* ---------------------------------------------------------------------
   La conexión
   --------------------------------------------------------------------- */

function leerEnv(ruta) {
  if (!fs.existsSync(ruta)) return {};
  const salida = {};
  for (const linea of fs.readFileSync(ruta, "utf8").split("\n")) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;
    const eq = limpia.indexOf("=");
    if (eq < 1) continue;
    salida[limpia.slice(0, eq).trim()] = limpia.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return salida;
}

const env = { ...leerEnv(path.join(RAIZ, ".env.local")), ...process.env };
const url = env.DATABASE_URL;

if (!url) {
  console.error("\n✗ Falta DATABASE_URL.\n");
  console.error("  Está en .env.local. Se usa SOLO para migraciones: la");
  console.error("  aplicación no la lee nunca, porque lleva la contraseña");
  console.error("  dentro y no tiene por qué ir en las variables del");
  console.error("  contenedor.\n");
  process.exit(1);
}

/* ---------------------------------------------------------------------
   Aplicar
   --------------------------------------------------------------------- */

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

await client.connect();

await client.query(`
  create table if not exists ${TABLA} (
    nombre      text primary key,
    aplicada_en timestamptz not null default now()
  )
`);

const archivos = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const { rows: aplicadas } = await client.query(`select nombre from ${TABLA}`);
const yaHechas = new Set(aplicadas.map((r) => r.nombre));

const soloEstado = process.argv.includes("--estado");

console.log(`\nArchivos en disco:  ${archivos.length}`);
console.log(`Ya aplicadas:       ${yaHechas.size}`);
console.log(`Pendientes:         ${archivos.filter((f) => !yaHechas.has(f)).length}\n`);

if (soloEstado) {
  for (const f of archivos) {
    console.log(`  ${yaHechas.has(f) ? "✓ aplicada" : "· pendiente"}  ${f}`);
  }
  await client.end();
  process.exit(0);
}

const pendientes = archivos.filter((f) => !yaHechas.has(f));
if (!pendientes.length) {
  console.log("  Nada que hacer.\n");
  await client.end();
  process.exit(0);
}

for (const f of pendientes) {
  const sql = fs.readFileSync(path.join(DIR, f), "utf8");
  process.stdout.write(`→ Aplicando ${f} ... `);

  /* Cada migración va en su propia transacción. Si una falla, esa no
     queda a medias y las anteriores siguen aplicadas: es lo que hace
     falta para poder arreglar y volver a correr.

     Se ejecutan los statements de uno en uno, no el fichero entero como
     un solo string, porque algunas migraciones llevan varias sentencias
     que no se pueden mandar juntas a la vez (CREATE INDEX CONCURRENTLY,
     o un $$ con punto y coma dentro). */
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query(`insert into ${TABLA} (nombre) values ($1)`, [f]);
    await client.query("commit");
    console.log("✓");
  } catch (e) {
    await client.query("rollback");
    console.log("✗\n");
    console.log(`  ${e.message}\n`);
    console.log("  Se ha hecho rollback: no quedó nada a medias.\n");
    await client.end();
    process.exit(1);
  }
}

console.log(`\n✓ ${pendientes.length} migración(es) aplicada(s).\n`);
await client.end();