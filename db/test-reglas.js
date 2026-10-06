/* =========================================================
   Inventario — Las reglas, contra la base real
   ---------------------------------------------------------
   Esto no es una prueba de código. Es una prueba de la BASE.

   Casi todo lo interesante del inventario está en triggers y en
   políticas de RLS, y las dos cosas se pueden comprobar en local sin
   levantar la aplicación: son la base, no el código.

   Y es donde están los fallos que duelen. Un trigger que no dispara no
   da ningún error: la venta se guarda, el stock no baja, y el dueño
   vende más de lo que tiene durante semanas sin darse cuenta.

   Cada comprobación mira que pase algo que TIENE que pasar, y a veces
   que NO pase algo. Lo segundo es lo que de verdad importa: que el
   borrado en borrador no mueva el stock, y que anular una venta lo
   devuelva.

   El script se limpia al terminar, incluso si falla a medias: los datos
   de prueba en una base compartida son ruido para todos los demás
   servicios.
   ========================================================= */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

function leerEnv(ruta) {
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

const env = leerEnv(path.join(__dirname, "..", ".env.local"));

let ok = 0;
let fallos = 0;
function comprobar(desc, cond, extra) {
  console.log(`  ${cond ? "✓" : "✗"} ${desc}${extra ? "  → " + extra : ""}`);
  cond ? ok++ : fallos++;
}

(async () => {
  const db = new Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  console.log("\n═══ Las reglas del inventario, contra la base ═══\n");

  /* ---------- Datos de prueba ---------- */

  const { rows: clientes } = await db.query(
    "select c.id, c.nombre from clients c " +
      "where not exists (select 1 from inv_productos p where p.client_id = c.id) limit 1"
  );
  if (!clientes.length) {
    console.log("  No hay ningún cliente sin inventario. No hay dónde probar.");
    await db.end();
    process.exit(1);
  }
  const CLIENTE = clientes[0].id;
  console.log("  cliente: " + clientes[0].nombre + "\n");

  const { rows: prod } = await db.query(
    "insert into inv_productos (client_id, nombre) values ($1, 'Producto de prueba') returning id",
    [CLIENTE]
  );
  const productoId = prod[0].id;

  const { rows: var1 } = await db.query(
    "insert into inv_variantes (producto_id, nombre_variante, sku, precio_venta_cents, precio_costo_cents, stock, stock_minimo) " +
      "values ($1, '500ml', 'TEST-A', 225, 150, 0, 3) returning id",
    [productoId]
  );
  const varA = var1[0].id;

  const { rows: var2 } = await db.query(
    "insert into inv_variantes (producto_id, nombre_variante, sku, precio_venta_cents, precio_costo_cents, stock) " +
      "values ($1, '1.25', 'TEST-B', 300, 200, 5) returning id",
    [productoId]
  );
  const varB = var2[0].id;

  const stockDe = async (id) => {
    const { rows } = await db.query("select stock from inv_variantes where id = $1", [id]);
    return rows[0].stock;
  };

  /* ============================================================
     1. Una compra en BORRADOR no mueve el stock
     ============================================================ */
  console.log("\n── 1. Una compra en borrador ──\n");

  const { rows: compra } = await db.query(
    "insert into inv_compras (client_id, factura_nro) values ($1, 'PRUEBA-1') returning id, estado",
    [CLIENTE]
  );
  const compraId = compra[0].id;

  await db.query(
    "insert into inv_compra_items (compra_id, variante_id, cantidad, costo_unitario_cents) values ($1, $2, 10, 140)",
    [compraId, varA]
  );

  comprobar("la compra nace en borrador", compra[0].estado === "borrador", compra[0].estado);
  comprobar("y el stock SIGUE en 0", (await stockDe(varA)) === 0, "stock " + (await stockDe(varA)));

  /* ============================================================
     2. Al recibirla, entra el stock
     ============================================================ */
  console.log("\n── 2. Al marcarla como recibida ──\n");

  await db.query("update inv_compras set estado = 'recibida' where id = $1", [compraId]);

  const stocktrasRecibir = await stockDe(varA);
  comprobar("el stock sube a 10", stocktrasRecibir === 10, "stock " + stocktrasRecibir);

  const { rows: movs } = await db.query(
    "select tipo, cantidad, motivo from inv_movimientos where variante_id = $1 order by creado_en",
    [varA]
  );
  comprobar("y queda un movimiento de entrada", movs.length === 1 && movs[0].tipo === "entrada", JSON.stringify(movs[0] || {}));

  const { rows: movs2 } = await db.query(
    "select count(*)::int as n from inv_movimientos where variante_id = $1",
    [varB]
  );
  comprobar("y NO toca las otras variantes", movs2[0].n === 0, movs2[0].n + " movimientos");
  comprobar("ni su stock, que sigue en 5", (await stockDe(varB)) === 5, "stock " + (await stockDe(varB)));

  /* ============================================================
     3. Volver a borrador no se puede
     ============================================================ */
  console.log("\n── 3. Una compra recibida no vuelve a borrador ──\n");

  let volvio = "no";
  try {
    await db.query("update inv_compras set estado = 'borrador' where id = $1", [compraId]);
  } catch (e) {
    volvio = e.message.slice(0, 60);
  }
  comprobar("está prohibido", volvio !== "no", volvio);
  comprobar("y el stock no ha cambiado", (await stockDe(varA)) === 10, "stock " + (await stockDe(varA)));

  /* ============================================================
     4. Una venta descuenta el stock
     ============================================================ */
  console.log("\n── 4. Una venta ──\n");

  const { rows: venta } = await db.query(
    "insert into inv_ventas (client_id, metodo_pago) values ($1, 'tarjeta') returning id",
    [CLIENTE]
  );
  const ventaId = venta[0].id;

  await db.query(
    "insert into inv_venta_items (venta_id, variante_id, cantidad, precio_unitario_cents) values ($1, $2, 4, 225)",
    [ventaId, varA]
  );

  comprobar("el stock baja a 6", (await stockDe(varA)) === 6, "stock " + (await stockDe(varA)));

  const { rows: total } = await db.query("select total_cents from inv_ventas where id = $1", [ventaId]);
  comprobar("el total es 4 × 225 = 900", total[0].total_cents === 900, "total " + total[0].total_cents);

  /* ============================================================
     5. No se puede vender lo que no hay
     ============================================================ */
  console.log("\n── 5. Vender más de lo que hay ──\n");

  const { rows: venta2 } = await db.query(
    "insert into inv_ventas (client_id, metodo_pago) values ($1, 'efectivo') returning id",
    [CLIENTE]
  );

  let fallo = "no falló";
  try {
    await db.query(
      "insert into inv_venta_items (venta_id, variante_id, cantidad, precio_unitario_cents) values ($1, $2, 999, 225)",
      [venta2[0].id, varA]
    );
  } catch (e) {
    fallo = e.message.slice(0, 70);
  }
  comprobar("se rechaza", fallo !== "no falló", fallo);
  comprobar("y el stock sigue en 6, no en negativo", (await stockDe(varA)) === 6, "stock " + (await stockDe(varA)));

  /* ============================================================
     6. Anular la venta devuelve el stock
     ============================================================ */
  console.log("\n── 6. Anular la venta ──\n");

  await db.query("update inv_ventas set anulada = true where id = $1", [ventaId]);

  comprobar("el stock vuelve a 10", (await stockDe(varA)) === 10, "stock " + (await stockDe(varA)));

  const { rows: movs3 } = await db.query(
    "select tipo, motivo from inv_movimientos where variante_id = $1 and venta_id = $2 order by creado_en desc limit 1",
    [varA, ventaId]
  );
  comprobar("y queda el movimiento de devolución", movs3[0] && movs3[0].tipo === "entrada", JSON.stringify(movs3[0] || {}));

  /* Anular dos veces no debe devolver el stock dos veces. */
  await db.query("update inv_ventas set anulada = false where id = $1", [ventaId]);
  await db.query("update inv_ventas set anulada = true where id = $1", [ventaId]);
  comprobar("anular dos veces no duplica el retorno", (await stockDe(varA)) === 10, "stock " + (await stockDe(varA)));

  /* ============================================================
     7. Vender a cuenta corriente genera la deuda
     ============================================================ */
  console.log("\n── 7. Venta a cuenta corriente ──\n");

  const { rows: clienteTienda } = await db.query(
    "insert into inv_clientes (client_id, nombre) values ($1, 'Comprador de prueba') returning id",
    [CLIENTE]
  );

  const { rows: venta3 } = await db.query(
    "insert into inv_ventas (client_id, cliente_id, metodo_pago) values ($1, $2, 'cuenta_corriente') returning id",
    [CLIENTE, clienteTienda[0].id]
  );
  await db.query(
    "insert into inv_venta_items (venta_id, variante_id, cantidad, precio_unitario_cents) values ($1, $2, 2, 225)",
    [venta3[0].id, varA]
  );

  const { rows: cuentas } = await db.query(
    "select tipo, monto_cents from inv_cuentas where cliente_id = $1",
    [clienteTienda[0].id]
  );
  const debe = cuentas.filter((c) => c.tipo === "debe").reduce((s, c) => s + c.monto_cents, 0);
  comprobar("anota la deuda sola", debe > 0, "debe " + debe);

  const { rows: caja } = await db.query(
    "select count(*)::int as n from inv_caja where venta_id = $1",
    [venta3[0].id]
  );
  comprobar("y NO mete dinero en la caja", caja[0].n === 0, caja[0].n + " movimientos");

  /* ============================================================
     8. La caja entra con la venta en efectivo
     ============================================================ */
  console.log("\n── 8. Venta en efectivo ──\n");

  const { rows: venta4 } = await db.query(
    "insert into inv_ventas (client_id, metodo_pago) values ($1, 'efectivo') returning id",
    [CLIENTE]
  );
  await db.query(
    "insert into inv_venta_items (venta_id, variante_id, cantidad, precio_unitario_cents) values ($1, $2, 1, 300)",
    [venta4[0].id, varB]
  );

  const { rows: entradas } = await db.query(
    "select monto_cents from inv_caja where venta_id = $1",
    [venta4[0].id]
  );
  comprobar("el dinero entra en la caja", entradas.length === 1 && entradas[0].monto_cents === 300, JSON.stringify(entradas[0] || {}));

  /* ============================================================
     9. El arqueo calcula la diferencia
     ============================================================ */
  console.log("\n── 9. El arqueo ──\n");

  /* El arqueo se ABRE con el saldo inicial, y se CIERRA con una
     actualización. Por eso el trigger de la diferencia es BEFORE UPDATE:
     en el INSERT no hay `saldo_real` todavía, no hay nada que comparar.
     Es el flujo real: se abre al empezar el día, se cierra al terminar. */
  const { rows: arqueo } = await db.query(
    "insert into inv_arqueos (client_id, fecha, saldo_inicial_cents) " +
      "values ($1, current_date, 0) returning id",
    [CLIENTE]
  );

  const { rows: abierto } = await db.query(
    "select diferencia_cents from inv_arqueos where id = $1",
    [arqueo[0].id]
  );
  comprobar("abierto, la diferencia está vacía", abierto[0].diferencia_cents === null, "sin cerrar");

  await db.query("update inv_arqueos set saldo_real_cents = 999999 where id = $1", [arqueo[0].id]);

  const { rows: arqueo2 } = await db.query(
    "select saldo_calculado_cents, diferencia_cents from inv_arqueos where id = $1",
    [arqueo[0].id]
  );
  const dif = arqueo2[0].diferencia_cents;
  const saldo = arqueo2[0].saldo_calculado_cents;
  comprobar("calcula la diferencia al cerrar", dif !== null && dif !== undefined, "saldo " + saldo + "  diferencia " + dif);
  comprobar("y es real - calculado", dif === 999999 - saldo, "999999 - " + saldo + " = " + (999999 - saldo));

  /* ============================================================
     10. Anular una compra saca el stock
     ============================================================ */
  console.log("\n── 10. Anular una compra recibida ──\n");

  const { rows: compra4 } = await db.query(
    "insert into inv_compras (client_id, factura_nro) values ($1, 'PRUEBA-4') returning id",
    [CLIENTE]
  );
  await db.query(
    "insert into inv_compra_items (compra_id, variante_id, cantidad, costo_unitario_cents) values ($1, $2, 5, 150)",
    [compra4[0].id, varB]
  );

  /* El stock de varB se LEE ANTES de tocar nada, y no se supone.

   Antes de esto ya se vendió una unidad en el paso 8, así que el número
   de partida no es el que se acaba de escribir en la línea de arriba.
   Fijarlo a ojo hace que la prueba pase o falle según lo que se hizo
   antes, que es como una prueba acaba sin comprobar nada. */
  const stockBAntes = await stockDe(varB);

  await db.query("update inv_compras set estado = 'recibida' where id = $1", [compra4[0].id]);
  const stockBRecibida = await stockDe(varB);
  comprobar("al recibirla, el stock de la otra variante sube 5", stockBRecibida === stockBAntes + 5, stockBAntes + " → " + stockBRecibida);

  await db.query("update inv_compras set estado = 'anulada' where id = $1", [compra4[0].id]);
  const stockTrasAnular = await stockDe(varB);
  comprobar("al anularla, vuelve al que tenía", stockTrasAnular === stockBAntes, stockBRecibida + " → " + stockTrasAnular);

  const { rows: movAnul } = await db.query(
    "select tipo, motivo from inv_movimientos where compra_id = $1 order by creado_en desc limit 1",
    [compra4[0].id]
  );
  comprobar(
    "y queda el movimiento de devolución",
    movAnul[0] && movAnul[0].tipo === "salida",
    JSON.stringify(movAnul[0] || {})
  );

  /* ============================================================
     11. El ajuste manual de stock
     ============================================================ */
  console.log("\n── 11. Ajustes manuales ──\n");

  /* ⚠️  ESTA PRUEBA NECESITA UNA SESIÓN DE VERDAD
   * -----------------------------------------
   * `inv_ajustar_stock()` comprueba de quién es la variante con
   * `tiene_inventario()`, que mira `auth.uid()`. Esta prueba se conecta
   * con la secret key, y detrás de la secret key NO hay ninguna
   * persona: no hay `auth.uid()`, y la comprobación de propiedad es
   * justamente lo que impide mover el stock de otro cliente.
   *
   * La primera versión de esta prueba pasaba `usuario_id = null` y
   * esperaba que funcionara. Fallaba con "Ese producto no existe o no
   * es tuyo", que es la respuesta CORRECTA: sin identidad no se ajusta
   * nada. Un fallo de la prueba que resultaba ser la propiedad de
   * seguridad funcionando.
   *
   * Para probarla bien hay que fingir una sesión: poner el
   * `request.jwt.claim.sub` y una fila en `inventario_sesiones`. Se
   * hace dentro de una transacción para que el `set local` desaparezca
   * al terminar y no afecte a las demás pruebas.
   */
  const { rows: duenio } = await db.query(
    "select p.id from profiles p where p.client_id = $1 limit 1",
    [CLIENTE]
  );

  if (!duenio.length) {
    comprobar("el cliente de prueba tiene dueño", false, "no hay perfil con client_id");
  } else {
    const USUARIO = duenio[0].id;

    await db.query(
      `insert into inventario_sesiones
         (client_id, user_id, rol, access_token, csrf_token, token_hash, expira_en)
       values ($1, $2, 'client', 'token-de-prueba', 'csrf-de-prueba',
               'hash-de-prueba-' || gen_random_uuid()::text, now() + interval '1 hour')`,
      [CLIENTE, USUARIO]
    );

    /* ---------- 11a. Sin identidad no se toca nada ---------- */

    const antesSinSesion = await stockDe(varA);
    let sinIdentidad = "no falló";
    try {
      await db.query(
        "select inv_ajustar_stock($1, 'merma', 1, 'sin identidad', null)",
        [varA]
      );
    } catch (e) {
      sinIdentidad = e.message.slice(0, 60);
    }
    comprobar("sin sesión, no se ajusta", sinIdentidad !== "no falló", sinIdentidad);
    comprobar("y el stock no se movió", (await stockDe(varA)) === antesSinSesion, "stock " + (await stockDe(varA)));

    /* ---------- 11b. Con sesión, sí ---------- */

    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [USUARIO]);

    /* ⚠️  SAVEPOINT EN CADA FALLO ESPERADO
     * -----------------------------------
     * Un `raise exception` ABORTA la transacción entera. Después, todo lo
     * que sigue da "current transaction is aborted, commands ignored
     * until end of transaction block" y la prueba se para ahí.
     *
     * La primera versión hacía esto: guardaba la transacción para poder
     * deshacerla, y fallaba en el primer caso que debía fallar. Lo que
     * probaba era el `rollback`, no la validación.
     *
     * El patrón correcto es un `savepoint` antes de cada cosa que se
     * espera que falle, y un `rollback to savepoint` cuando falla. Se
     * deshace SOLO ese intento y la transacción sigue viva para las
     * siguientes comprobaciones.
     */
    let sp = 0;
    const intentar = async (texto, fn) => {
      const nombre = "sp_" + ++sp;
      await db.query(`savepoint ${nombre}`);
      try {
        const r = await fn();
        await db.query(`rollback to savepoint ${nombre}`);
        return { fallo: null, r };
      } catch (e) {
        await db.query(`rollback to savepoint ${nombre}`);
        return { fallo: e.message, r: null };
      }
    };

    const antes = await stockDe(varA);

    const r1 = await intentar("sin motivo", () =>
      db.query("select inv_ajustar_stock($1, 'merma', 3, '   ', $2)", [varA, USUARIO])
    );
    comprobar("sin motivo no deja mover nada", r1.fallo !== null, (r1.fallo || "no falló").slice(0, 50));
    comprobar("y el stock no se movió", (await stockDe(varA)) === antes, "stock " + (await stockDe(varA)));

    const { rows: trasMerma } = await db.query(
      "select inv_ajustar_stock($1, 'merma', 2, 'se rompieron dos', $2) as stock",
      [varA, USUARIO]
    );
    comprobar("una merma resta", Number(trasMerma[0].stock) === antes - 2, "stock " + trasMerma[0].stock);

    const { rows: trasDevol } = await db.query(
      "select inv_ajustar_stock($1, 'devolucion', 2, 'el cliente devolvio', $2) as stock",
      [varA, USUARIO]
    );
    comprobar("una devolución suma", Number(trasDevol[0].stock) === antes, "stock " + trasDevol[0].stock);

    const r2 = await intentar("merma excesiva", () =>
      db.query("select inv_ajustar_stock($1, 'merma', 99999, 'error de tipeo', $2)", [varA, USUARIO])
    );
    comprobar("una merma mayor que el stock se rechaza", r2.fallo !== null, (r2.fallo || "no falló").slice(0, 70));
    comprobar("y no deja el stock en negativo", (await stockDe(varA)) === antes, "stock " + (await stockDe(varA)));

    const r3 = await intentar("cantidad cero", () =>
      db.query("select inv_ajustar_stock($1, 'merma', 0, 'nada', $2)", [varA, USUARIO])
    );
    comprobar("una cantidad de cero se rechaza", r3.fallo !== null, (r3.fallo || "no falló").slice(0, 50));

    const r4 = await intentar("producto ajeno", () =>
      db.query("select inv_ajustar_stock(gen_random_uuid(), 'merma', 1, 'inventado', $1)", [USUARIO])
    );
    comprobar("un producto que no existe se rechaza", r4.fallo !== null, (r4.fallo || "no falló").slice(0, 50));

    /* ---------- 11c. El movimiento lleva su motivo ----------
     *
     * ANTES del rollback, y esto es lo que faltaba: los movimientos
     * que se acabaron de crear están dentro de la transacción, así que
     * después de deshacerla no existen. Comprobándolos fuera sale el
     * último movimiento que había de antes —el de la venta— y la
     * prueba falla por una razón que no tiene que ver con lo que
     * comprueba.
     *
     * La primera versión fallaba exactamente así, con
     * `{"tipo":"salida","motivo":"venta"}`: el motivo correcto, pero del
     * movimiento equivocado. */
    const { rows: movAjuste } = await db.query(
      "select tipo, motivo from inv_movimientos where variante_id = $1 order by creado_en desc limit 1",
      [varA]
    );
    comprobar(
      "el movimiento se anota con su motivo",
      movAjuste[0] && /merma|devolucion/.test(movAjuste[0].motivo || ""),
      JSON.stringify(movAjuste[0] || {})
    );

    await db.query("rollback");

    await db.query("delete from inventario_sesiones where csrf_token = 'csrf-de-prueba'");
  }

  /* ============================================================
     12. Las RLS
     ============================================================ */
  console.log("\n── 12. Las RLS ──\n");

  /* Se comprueba TODA tabla que este servicio crea, no solo las de
     negocio. `inventario_migrations` entra en la lista a propósito: es la
     que registra qué migraciones se aplicaron, y sin RLS cualquiera que
     pueda escribir en la base puede modificarla y así falsear el estado
     de la siguiente migración.

     Una tabla sin RLS no falla: aparece en la consulta, sinPolicies
     que la restrinjan. Solo se ve si alguien mira, que es justo el
     problema. */
  const { rows: rls } = await db.query(
    "select c.relname, c.relrowsecurity " +
      "from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
      "where n.nspname = 'public' and c.relkind = 'r' " +
      "and (c.relname like 'inv\\_%' or c.relname = 'inventario_migrations')"
  );
  const sinRls = rls.filter((t) => !t.relrowsecurity);
  comprobar(
    "todas las tablas de inventario tienen RLS",
    sinRls.length === 0,
    sinRls.map((t) => t.relname).join(", ") || "todas (" + rls.length + ")"
  );

  const { rows: pol } = await db.query(
    "select tablename, count(*)::int as n from pg_policies " +
      "where tablename like 'inv_%' or tablename = 'inventario_sesiones' group by 1 order by 1"
  );
  console.log("    políticas por tabla:");
  for (const p of pol) console.log("      " + p.tablename.padEnd(24) + p.n);

  const { rows: sesSinRls } = await db.query(
    "select count(*)::int as n from pg_policies where tablename = 'inventario_sesiones'"
  );
  comprobar("inventario_sesiones NO tiene políticas (solo la secret key)", sesSinRls[0].n === 0, sesSinRls[0].n + " políticas");

  /* ============================================================
     Limpiar
     ============================================================ */
  console.log("\n── Limpiando ──\n");

  /* En cascada, por el orden de las referencias. */
  await db.query("delete from inv_caja where client_id = $1", [CLIENTE]);
  await db.query("delete from inv_arqueos where client_id = $1", [CLIENTE]);
  await db.query("delete from inv_cuentas where cliente_id = $1", [clienteTienda[0].id]);
  await db.query("delete from inv_clientes where client_id = $1", [CLIENTE]);
  await db.query(
    "delete from inv_movimientos where variante_id in (select id from inv_variantes where producto_id = $1)",
    [productoId]
  );
  await db.query("delete from inv_venta_items where venta_id in (select id from inv_ventas where client_id = $1)", [CLIENTE]);
  await db.query("delete from inv_ventas where client_id = $1", [CLIENTE]);
  await db.query("delete from inv_compra_items where compra_id in (select id from inv_compras where client_id = $1)", [CLIENTE]);
  await db.query("delete from inv_compras where client_id = $1", [CLIENTE]);
  await db.query("delete from inv_proveedores where client_id = $1", [CLIENTE]);
  await db.query("delete from inv_variantes where producto_id = $1", [productoId]);
  await db.query("delete from inv_productos where client_id = $1", [CLIENTE]);

  console.log("  datos de prueba borrados");

  await db.end();

  console.log("\n" + "═".repeat(54));
  if (fallos) {
    console.log(`✗ ${fallos} de ${ok + fallos} fallan.\n`);
    process.exit(1);
  }
  console.log(`✓ Las ${ok} comprobaciones pasan.\n`);
  process.exit(0);
})().catch(async (e) => {
  console.error("\n✗ " + e.message + "\n");
  process.exit(1);
});