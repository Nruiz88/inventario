/* Limpia los datos que dejaron las pruebas al fallar a medias.

   `db/test-reglas.js` borra lo suyo al terminar, incluso si falla. Pero
   si falla ANTES de la limpieza —un error de sintaxis, una excepción no
   prevista, un Ctrl+C— se queda todo a medias: un producto de prueba
   con su variante y media compra.

   Y el problema de la prueba siguiente es que no tiene dónde probar: su
   "cliente sin inventario" desaparecen todos, y contesta "No hay
   ningún cliente sin inventario. No hay dónde probar", que parece un
   problema de la base y es basura de la prueba anterior.

   Este script se ejecuta a mano cuando pasa eso. */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

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

  /* Se busca por nombre, no "todo lo que no tenga datos". La diferencia
     importa: esto corre contra una base compartida con clientes de
     verdad, y "borrar los clientes que no tienen inventario" se lleva
     por delante el inventario vacío de un cliente real. */
  const { rows: productos } = await db.query(
    "select id, client_id from inv_productos where nombre = 'Producto de prueba'"
  );

  if (!productos.length) {
    console.log("\n  No hay datos de prueba. Nada que limpiar.\n");
    await db.end();
    return;
  }

  console.log(`\n  Encontrados ${productos.length} producto(s) de prueba.`);
  console.log("  Esto borra las ventas, compras, movimientos y arqueos de");
  console.log("  ESOS productos. Los datos de otros clientes no se tocan.\n");

  const clientes = [...new Set(productos.map((p) => p.client_id))];

  /* El orden lo manda la base: los hijos antes que los padres, o el
     borrado falla por la clave ajena. */
  for (const cliente of clientes) {
    await db.query("delete from inv_caja where client_id = $1", [cliente]);
    await db.query("delete from inv_arqueos where client_id = $1", [cliente]);
    await db.query("delete from inv_cuentas where cliente_id in (select id from inv_clientes where client_id = $1)", [cliente]);
    await db.query("delete from inv_clientes where client_id = $1", [cliente]);
    await db.query(
      "delete from inv_movimientos where variante_id in (select v.id from inv_variantes v join inv_productos p on p.id = v.producto_id where p.client_id = $1)",
      [cliente]
    );
    await db.query(
      "delete from inv_venta_items where venta_id in (select id from inv_ventas where client_id = $1)",
      [cliente]
    );
    await db.query("delete from inv_ventas where client_id = $1", [cliente]);
    await db.query(
      "delete from inv_compra_items where compra_id in (select id from inv_compras where client_id = $1)",
      [cliente]
    );
    await db.query("delete from inv_compras where client_id = $1", [cliente]);
    await db.query("delete from inv_proveedores where client_id = $1", [cliente]);
    await db.query(
      "delete from inv_variantes where producto_id in (select id from inv_productos where client_id = $1)",
      [cliente]
    );
    await db.query("delete from inv_productos where client_id = $1", [cliente]);
    console.log(`  limpiado el cliente ${cliente}`);
  }

  await db.query("delete from inventario_sesiones where csrf_token = 'csrf-de-prueba'");

  console.log("\n  ✓ Listo.\n");
  await db.end();
})().catch((e) => {
  console.error("\n✗ " + e.message + "\n");
  process.exit(1);
});