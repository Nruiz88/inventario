/* Borrar los productos que dejan las pruebas de los modales.
 *
 * ── POR QUÉ NO SE PIDE A LA API ──
 *
 * `db/ver-modales.js` crea un producto para comprobar que el alta, la
 * edición y el borrado funcionan, y lo borra al terminar. Pero lo borra
 * con `DELETE /api/productos`, y esa API tiene una regla a propósito: un
 * producto CON MOVIMIENTOS no se borra, se desactiva.
 *
 * Y un producto creado con stock genera un movimiento de entrada. O
 * sea, que el producto de prueba se quedaba en la base para siempre
 * como una fila inactiva, y la corrida siguiente se encontraba un
 * producto más y fallaba por un motivo que no era del listado.
 *
 * Aquí se borra en el orden que impone la clave ajena: primero los
 * movimientos, luego las variantes, luego el producto. Es el mismo
 * orden que usa `limpiar-demo.js`, pero sin tocar el kiosco de ejemplo,
 * que es lo que hay en la base cuando se corren estas pruebas.
 *
 * ── POR QUÉ BUSCA POR NOMBRE Y NO "TODO" ──
 *
 * La base es compartida con el panel y con clientes de verdad. Todo lo
 * que se borra aquí se identifica por un nombre exacto que solo usan
 * estas pruebas.
 */
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

/* El mismo nombre que escribe `db/ver-modales.js`. Con una constante
   compartida entre los dos, si uno cambia el nombre y el otro no, el
   script se calla y deja el producto ahí sin avisar. */
const PRUEBA = "Prueba de modal";

function leerEnv(ruta) {
  const s = {};
  if (!fs.existsSync(ruta)) return s;
  for (const l of fs.readFileSync(ruta, "utf8").split("\n")) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) s[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return s;
}

const env = leerEnv(path.join(__dirname, "..", ".env.local"));

(async () => {
  const db = new Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();

  const { rows: productos } = await db.query(
    "select id from inv_productos where nombre = $1",
    [PRUEBA]
  );

  if (!productos.length) {
    console.log("  no hay productos de prueba");
    await db.end();
    return;
  }

  const ids = productos.map((p) => p.id);

  const { rowCount: movs } = await db.query(
    "delete from inv_movimientos where variante_id in (select id from inv_variantes where producto_id = any($1))",
    [ids]
  );
  await db.query("delete from inv_variantes where producto_id = any($1)", [ids]);
  const { rowCount: borrados } = await db.query("delete from inv_productos where id = any($1)", [ids]);

  console.log(
    "  " +
      borrados +
      " producto(s) de prueba borrados, con " +
      (movs || 0) +
      " movimiento(s)"
  );

  await db.end();
})().catch((e) => {
  /* Falla ruidosamente. Un `catch` que se traga el error y sale con 0
     convierte un fallo de clave ajena en un «se limpió» que no es
     cierto, y el producto se queda ahí sin que nadie lo sepa. */
  console.error("  ✗ no se pudo limpiar: " + e.message);
  process.exit(1);
});