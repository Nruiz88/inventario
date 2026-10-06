/* =========================================================
   Borra el kiosco de ejemplo
   ---------------------------------------------------------
   Lo usa `db/demo-kiosco.js` antes de volver a montarlo, y a mano con
   `node db/demo-kiosco.js --limpiar`.

   ⚠️  POR QUÉ BUSCA POR PREFIJO Y NO POR "TODO"
   ---------------------------------------------
   La base es compartida con el panel y con el bot, y `inv_ventas` es de
   INVENTARIO pero los clientes de `clients` son clientes de verdad. Un
   `delete from inv_clientes` sin filtro se lleva los clientes del
   negocio que un dueño de kiosco puede tener de verdad.

   Por eso todo lo que se borra se identifica por el prefijo `DEMO ·` en
   el nombre, y por los ids que se saco de esos productos. Las tablas
   que no tienen nombre —los movimientos, los ítems de venta, la caja—
   se limpian subiendo por el producto de prueba que los originó, que es
   la única forma de saber que son nuestros.

   Y el orden lo manda la base: los hijos antes que los padres, o el
   borrado falla por la clave ajena.
   ========================================================= */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const PREFIJO = "DEMO ·";

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
    "select id, client_id from inv_productos where nombre like $1",
    [PREFIJO + "%"]
  );

  const { rows: clientes } = await db.query(
    "select id from inv_clientes where nombre like $1",
    [PREFIJO + "%"]
  );

  if (!productos.length && !clientes.length) {
    await db.end();
    return;
  }

  const ids = productos.map((p) => p.id);
  const clienteIds = productos.map((p) => p.client_id);
  const comercioIds = clientes.map((c) => c.id);

  let n = 0;

  /* Caja y arqueos: por `client_id`, pero solo los que NO tienen una
     venta detrás. Un arqueo real de un kiosco real se queda: es su
     registro del día. */
  const { rowCount: caja } = await db.query(
    "delete from inv_caja where client_id = any($1) and concepto like $2",
    [clienteIds, "%"]
  );
  n += caja || 0;

  const { rowCount: cuentas } = await db.query(
    "delete from inv_cuentas where cliente_id = any($1)",
    [comercioIds]
  );
  n += cuentas || 0;

  const { rowCount: clientesBorrados } = await db.query(
    "delete from inv_clientes where id = any($1)",
    [comercioIds]
  );
  n += clientesBorrados || 0;

  /* Todo lo que cuelga de los productos del demo, en orden de hojas a
     raíz. `variante_ids` es la lista de las presentaciones, que es lo
     que referencian los movimientos y los ítems. */
  const { rows: variantes } = await db.query(
    "select id from inv_variantes where producto_id = any($1)",
    [ids]
  );
  const varianteIds = variantes.map((v) => v.id);

  const { rows: ventas } = await db.query(
    "select id from inv_ventas where client_id = any($1)",
    [clienteIds]
  );
  const ventaIds = ventas.map((v) => v.id);

  const { rows: compras } = await db.query(
    "select id from inv_compras where client_id = any($1)",
    [clienteIds]
  );
  const compraIds = compras.map((c) => c.id);

  if (varianteIds.length) {
    const { rowCount: movs } = await db.query(
      "delete from inv_movimientos where variante_id = any($1)",
      [varianteIds]
    );
    n += movs || 0;
  }

  if (ventaIds.length) {
    const { rowCount: items } = await db.query(
      "delete from inv_venta_items where venta_id = any($1)",
      [ventaIds]
    );
    n += items || 0;
  }

  /* Los ítems de venta se borran ANTES que la venta, y el trigger del
     total ya no hace nada porque la venta no está. */
  if (compraIds.length) {
    await db.query("delete from inv_compra_items where compra_id = any($1)", [compraIds]);
  }

  if (ventaIds.length) {
    await db.query("delete from inv_ventas where id = any($1)", [ventaIds]);
  }
  if (compraIds.length) {
    await db.query("delete from inv_compras where id = any($1)", [compraIds]);
  }
  if (varianteIds.length) {
    await db.query("delete from inv_variantes where id = any($1)", [varianteIds]);
  }
  await db.query("delete from inv_productos where id = any($1)", [ids]);

  console.error(`  (demo limpiada: ${n} filas de caja y cuentas, ${ids.length} productos)`);
  await db.end();
})().catch((e) => {
  /* Falla ruidosamente y con código de salida 1.

     Antes catchaba y salía con 0, y eso convertía un error de clave
     ajena en un "se limpió" silencioso. El demo lo llama al principio
     con `stdio: "ignore"`, así que montaba sus productos encima de los
     anteriores y el kiosco de ejemplo acababa con veinte
     presentaciones en vez de diez, dos veces cada nombre.

     Un `catch` que se traga el error y devuelve éxito es peor que no
     tener `catch`: parece que todo está bien y el problema aparece tres
     pasos más abajo, en un sitio donde ya no se sabe de dónde vino. */
  console.error("✗ No se pudo limpiar la demo: " + e.message);
  process.exit(1);
});