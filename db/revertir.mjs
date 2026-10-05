/* Revertir UNA migración. Para cuando una migración ya aplicada tenía un
   fallo y hay que corregirla y volver a correr.

   ⚠️  ESTO ES PELIGROSO Y HAY QUE USARLO CON LA CABEZA
   ----------------------------------------------------
   Un DROP TABLE borra los datos de esa tabla. Si la migración falla por
   un `raise exception` en un trigger, este script sirve. Si falla por
   un `create table`, este script BORRA la tabla y los datos con ella, y
   no hay vuelta atrás.

   Por eso pide el nombre de la migración a mano, y no lo deduce: para
   que haya que escribirlo, y al escribirlo se piense.

   En la práctica, para una migración de triggers basta con esto:

       node db/revertir.mjs 004_reglas.sql

   Y para una de tablas, lo mismo pero sabiendo que se pierden datos.

   USO
     node db/revertir.mjs <nombre.sql>
     node db/revertir.mjs --tablas <nombre.sql>   # borra las inv_*
   */

import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const RAIZ = path.resolve(import.meta.dirname, "..");

function leerEnv(ruta) {
  const salida = {};
  for (const linea of fs.readFileSync(ruta, "utf8").split("\n")) {
    const t = linea.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) salida[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return salida;
}

const env = leerEnv(path.join(RAIZ, ".env.local"));
const conTablas = process.argv.includes("--tablas");
const nombre = process.argv.find((a) => a.endsWith(".sql"));

if (!nombre) {
  console.error("\nFalta el nombre de la migración. Ejemplo:");
  console.error("  node db/revertir.mjs 004_reglas.sql\n");
  process.exit(1);
}

const db = new Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

console.log("\n⚠️  Revirtiendo " + nombre + (conTablas ? "  (CON LAS TABLAS)" : "") + "\n");

if (conTablas) {
  const { rows } = await db.query(
    "select table_name from information_schema.tables " +
      "where table_schema = 'public' and table_name like 'inv\\_%'"
  );
  for (const t of rows) {
    await db.query(`drop table if exists "${t.table_name}" cascade`);
    console.log("  borrada " + t.table_name);
  }
  const { rows: rls } = await db.query(
    "select count(*)::int as n from pg_policies where tablename like 'inv\\_%'"
  );
  console.log(`  (políticas que quedan: ${rls[0].n})`);
} else {
  /* Los triggers y funciones que mencione el fichero, y solo esos. */
  const sql = fs.readFileSync(path.join(RAIZ, "db", nombre), "utf8");

  const triggers = [...new Set([...sql.matchAll(/create trigger (\w+)/g)].map((m) => m[1]))];
  for (const t of triggers) {
    const { rows } = await db.query(
      "select tgrelid::regclass::text as tabla from pg_trigger where tgname = $1",
      [t]
    );
    for (const r of rows) {
      await db.query(`drop trigger if exists ${t} on ${r.tabla}`);
      console.log("  trigger " + t + " fuera de " + r.tabla);
    }
  }

  const funciones = [...new Set([...sql.matchAll(/create or replace function (\w+)/g)].map((m) => m[1]))];
  for (const f of funciones) {
    await db.query(`drop function if exists ${f} cascade`);
    console.log("  función " + f + " fuera");
  }
}

await db.query("delete from inventario_migrations where nombre = $1", [nombre]);
console.log("  quitada de inventario_migrations\n");

await db.end();