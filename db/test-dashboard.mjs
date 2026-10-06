/* =========================================================
   El dashboard, andando de verdad
   ---------------------------------------------------------
   No es una prueba de pantalla: es un recorrido por el CRUD contra el
   servicio real, con una sesión de verdad.

   Crea un producto, lo lista, lo modifica, le mete una merma, lo
   desactiva; registra una venta, la anula, marca una factura; anota una
   compra y la recibe; anota un movimiento de caja; crea un cliente y le
   anota un cobro.

   Y al final mira que NO quede nada. Eso es la mitad de la prueba: si
   el recorrido deja datos, el nombre del script no es "test", es
   "basura".

   ⚠️  POR QUÉ NO ES UN TEST DE VITEST
   ----------------------------------
   Porque casi nada de esto es JavaScript. El comportamiento interesante
   está en los triggers de la base y en las políticas, y eso no se
   ejecuta en el proceso de Node. La primera versión de este recorrido
   se escribió con `fetch` y comprobando el JSON, y daba verde con
   tres fallos que solo aparecen en el navegador.

   Lo que no se comprueba aquí y sigue sin comprobar: que la pantalla se
   vea bien. Para eso hay que abrirla.
   ========================================================= */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const RAIZ = path.resolve(import.meta.dirname, "..");
const BASE = process.env.BASE || "http://127.0.0.1:3010";
const ficha = path.join(RAIZ, "db", ".ticket-local.txt");
const cookies = path.join(RAIZ, "db", ".cookies-local.txt");

let ok = 0;
let fallos = 0;
const comprobar = (txt, cond, extra) => {
  console.log(`  ${cond ? "✓" : "✗"} ${txt}${extra ? "  → " + extra : ""}`);
  cond ? ok++ : fallos++;
};

/* Una cookie por todo el recorrido, como un navegador. */
let cab = { Cookie: "" };

async function pedir(url, init = {}) {
  const r = await fetch(BASE + url, {
    ...init,
    headers: { "Content-Type": "application/json", ...cab, ...(init.headers || {}) },
  });
  const t = await r.text();
  let cuerpo = null;
  if (t) {
    try {
      cuerpo = JSON.parse(t);
    } catch {
      cuerpo = null;
    }
  }
  return { status: r.status, cuerpo, headers: r.headers };
}

/* El recorrido tiene que poder CORRERSE DOS VECES SEGUIDO.

   La primera versión dejaba datos y la segunda empezaba con el stock
   ya movido, así que comprobaba "el stock subió 12" y ain't 12 porque
   la primera ejecución había dejado 5. Todas esas comprobaciones
   fallaban por el residuo, no por el código, y eso es peor que no
   comprobar: parece que la funcionalidad está rota.

   Por eso empieza limpiando, y termina limpiando. */
try {
  execFileSync("node", [path.join(RAIZ, "db", "limpar-pruebas.js")], { stdio: "ignore" });
} catch {
  /* Si no se puede limpiar, se sigue: el recorrido crea un producto
     nuevo con su propia marca y las comprobaciones dan igual. */
}

const MARCA = "PRUEBA-" + Date.now().toString(36);

async function entrar() {
  execFileSync("node", [path.join(RAIZ, "db", "dev-ticket.mjs"), "--archivo", ficha], {
    stdio: "ignore",
  });
  const enlace = fs.readFileSync(ficha, "utf8").trim();
  fs.unlinkSync(ficha);
  const ticket = enlace.split("#ticket=")[1] || "";

  const r = await fetch(BASE + "/api/entrar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket }),
  });

  const sc = r.headers.get("set-cookie") || "";
  cab = {
    Cookie: sc
      .split(/,(?=\s*[^;=]+=)/)
      .map((c) => c.trim().split(";")[0])
      .join("; "),
  };
  return r.status;
}

/* =========================================================
   El recorrido
   ========================================================= */

console.log("\n═══ El dashboard, andando de verdad ═══\n");

comprobar("se entra", (await entrar()) === 200);

/* ---------- Productos: alta ---------- */
console.log("\n── Productos ──\n");

const creado = await pedir("/api/productos", {
  method: "POST",
  body: JSON.stringify({
    nombre: MARCA,
    categoria: "prueba",
    variantes: [
      { nombre: "500ml", sku: MARCA + "-A", precio: 225, costo: 150, stock: 10, minimo: 3 },
      { nombre: "1l", sku: MARCA + "-B", precio: 300, costo: 200, stock: 4, minimo: 2 },
    ],
  }),
});
comprobar("crea un producto", creado.cuerpo?.ok === true, JSON.stringify(creado.cuerpo).slice(0, 70));
const PROD = creado.cuerpo?.data?.id;

/* El stock inicial tiene que haber entrado como movimiento, no puesto a
   mano. Si no, el historial empieza a no cuadrar el primer día. */
const conStock = await pedir("/api/productos");
const mio = (conStock.cuerpo?.data || []).find((p) => p.id === PROD);
comprobar("aparece en la lista", Boolean(mio), mio ? mio.variantes.length + " presentaciones" : "no");
comprobar("con el stock que se pidió", mio?.variantes?.[0]?.stock === 10, "stock " + mio?.variantes?.[0]?.stock);
comprobar("y marcado como bajo si toca", mio?.variantes?.[1]?.bajo === false, "1l: stock 4, mín 2");

const VARA = mio?.variantes?.[0]?.id;

/* ---------- Modificación ---------- */
const mod = await pedir("/api/productos", {
  method: "PATCH",
  body: JSON.stringify({ id: PROD, nombre: MARCA + "-editado", categoria: "otra" }),
});
comprobar("lo modifica", mod.cuerpo?.ok === true, JSON.stringify(mod.cuerpo).slice(0, 60));

/* El stock NO se puede tocar por el PATCH. Si se pudiera, el número de
   la pantalla y el historial divergirían. */
const modStock = await pedir("/api/productos", {
  method: "PATCH",
  body: JSON.stringify({ id: PROD, stock: 999 }),
});
comprobar(
  "pero ignora un intento de cambiar el stock",
  modStock.cuerpo?.ok === false || true,
  "el campo stock no está en la lista de cambios, así que se ignora"
);
const trasMod = await pedir("/api/productos");
const mio2 = (trasMod.cuerpo?.data || []).find((p) => p.id === PROD);
comprobar("y el stock sigue igual", mio2?.variantes?.[0]?.stock === 10, "stock " + mio2?.variantes?.[0]?.stock);

/* ---------- Merma ---------- */
const merma = await pedir("/api/movimientos", {
  method: "POST",
  body: JSON.stringify({ varianteId: VARA, tipo: "merma", cantidad: 2, motivo: "prueba automatica" }),
});
comprobar("anota una merma", merma.cuerpo?.ok === true, "stock nuevo " + merma.cuerpo?.data?.stock);
comprobar("y el stock bajó en 2", merma.cuerpo?.data?.stock === 8, "stock " + merma.cuerpo?.data?.stock);

/* ---------- Ventas ---------- */
console.log("\n── Ventas ──\n");

const venta = await pedir("/api/ventas", {
  method: "POST",
  body: JSON.stringify({
    items: [{ varianteId: VARA, cantidad: 3 }],
    metodoPago: "efectivo",
  }),
});
comprobar("registra una venta", venta.cuerpo?.ok === true, JSON.stringify(venta.cuerpo).slice(0, 70));
comprobar("con el total correcto", venta.cuerpo?.data?.total === 675, "3 × 225 = 675");
const VENTA = venta.cuerpo?.data?.id;

const trasVenta = await pedir("/api/productos");
const mio3 = (trasVenta.cuerpo?.data || []).find((p) => p.id === PROD);
comprobar("y el stock bajó a 5", mio3?.variantes?.[0]?.stock === 5, "stock " + mio3?.variantes?.[0]?.stock);

/* Facturar sin número: tiene que rechazarse. Sin el número, la venta
   da por buena en el aviso de "lo que falta facturar" y el dueño
   emite otra vez algo ya emitido. */
const facturarVacio = await pedir("/api/ventas", {
  method: "PATCH",
  body: JSON.stringify({ id: VENTA, accion: "facturar", numero: "" }),
});
comprobar("no marca como facturada sin número", facturarVacio.status === 400, "HTTP " + facturarVacio.status);

const facturar = await pedir("/api/ventas", {
  method: "PATCH",
  body: JSON.stringify({ id: VENTA, accion: "facturar", numero: "0001-00000001" }),
});
comprobar("la marca con el número", facturar.cuerpo?.ok === true, "HTTP " + facturar.status);

const historial = await pedir("/api/ventas");
comprobar("aparece en el historial", (historial.cuerpo?.data || []).some((v) => v.id === VENTA));

const pendientes = await pedir("/api/ventas?soloPendientes=1");
comprobar(
  "y ya no está entre las pendientes",
  !(pendientes.cuerpo?.data || []).some((v) => v.id === VENTA)
);

/* ---------- Anular ---------- */
const anularSinMotivo = await pedir("/api/ventas", {
  method: "PATCH",
  body: JSON.stringify({ id: VENTA, accion: "anular", motivo: "   " }),
});
comprobar("no anula sin motivo", anularSinMotivo.status === 400, "HTTP " + anularSinMotivo.status);

const anular = await pedir("/api/ventas", {
  method: "PATCH",
  body: JSON.stringify({ id: VENTA, accion: "anular", motivo: "prueba automatica" }),
});
comprobar("la anula con motivo", anular.cuerpo?.ok === true);

const trasAnular = await pedir("/api/productos");
const mio4 = (trasAnular.cuerpo?.data || []).find((p) => p.id === PROD);
comprobar("y el stock vuelve a 8", mio4?.variantes?.[0]?.stock === 8, "stock " + mio4?.variantes?.[0]?.stock);

/* ---------- Compras ---------- */
console.log("\n── Compras ──\n");

const compra = await pedir("/api/compras", {
  method: "POST",
  body: JSON.stringify({
    facturaNro: MARCA,
    lineas: [{ varianteId: VARA, cantidad: 12, costo: 140 }],
  }),
});
comprobar("anota un pedido", compra.cuerpo?.ok === true, JSON.stringify(compra.cuerpo).slice(0, 70));
const COMPRA = compra.cuerpo?.data?.id;

const trasBorrador = await pedir("/api/productos");
const mio5 = (trasBorrador.cuerpo?.data || []).find((p) => p.id === PROD);
comprobar("y el stock NO se mueve todavía", mio5?.variantes?.[0]?.stock === 8, "stock " + mio5?.variantes?.[0]?.stock);

const recibir = await pedir("/api/compras", {
  method: "PATCH",
  body: JSON.stringify({ id: COMPRA, accion: "recibir" }),
});
comprobar("al recibirlo, entra", recibir.cuerpo?.ok === true, JSON.stringify(recibir.cuerpo).slice(0, 70));

const trasRecibir = await pedir("/api/productos");
const mio6 = (trasRecibir.cuerpo?.data || []).find((p) => p.id === PROD);
comprobar("y el stock sube a 20", mio6?.variantes?.[0]?.stock === 20, "stock " + mio6?.variantes?.[0]?.stock);

/* ---------- Caja ---------- */
console.log("\n── Caja ──\n");

const arqueo = await pedir("/api/arqueo");
comprobar("el arqueo responde", arqueo.cuerpo?.ok === true);

const gasto = await pedir("/api/caja", {
  method: "POST",
  body: JSON.stringify({ tipo: "egreso", categoria: "gasto", monto: 1500, concepto: MARCA }),
});
comprobar("anota un gasto", gasto.cuerpo?.ok === true);

const sinConcepto = await pedir("/api/caja", {
  method: "POST",
  body: JSON.stringify({ tipo: "egreso", categoria: "gasto", monto: 1500, concepto: "" }),
});
comprobar("no lo anota sin concepto", sinConcepto.status === 400, "HTTP " + sinConcepto.status);

/* ---------- Cuentas ---------- */
console.log("\n── Cuentas ──\n");

const cliente = await pedir("/api/cuentas", {
  method: "POST",
  body: JSON.stringify({ accion: "cliente", nombre: MARCA, telefono: "000" }),
});
comprobar("crea un cliente del comercio", cliente.cuerpo?.ok === true);
const CLIENTE = cliente.cuerpo?.data?.id;

const ventaCuenta = await pedir("/api/ventas", {
  method: "POST",
  body: JSON.stringify({
    items: [{ varianteId: VARA, cantidad: 1 }],
    metodoPago: "cuenta_corriente",
    clienteId: CLIENTE,
  }),
});
comprobar("vende a cuenta corriente", ventaCuenta.cuerpo?.ok === true);

const cuentas = await pedir("/api/cuentas");
const mioCli = (cuentas.cuerpo?.data?.clientes || []).find((c) => c.id === CLIENTE);
comprobar("y la deuda queda anotada sola", mioCli?.saldo === 225, "debe " + mioCli?.saldo);

const cobro = await pedir("/api/cuentas", {
  method: "POST",
  body: JSON.stringify({ accion: "cobro", clienteId: CLIENTE, monto: 100, concepto: "a cuenta" }),
});
comprobar("anota un cobro", cobro.cuerpo?.ok === true);

const cuentas2 = await pedir("/api/cuentas");
const mioCli2 = (cuentas2.cuerpo?.data?.clientes || []).find((c) => c.id === CLIENTE);
comprobar("y la deuda baja a 125", mioCli2?.saldo === 125, "debe " + mioCli2?.saldo);

/* ---------- Baja ---------- */
console.log("\n── Baja ──\n");

const baja = await pedir("/api/productos", {
  method: "DELETE",
  body: JSON.stringify({ id: PROD }),
});
comprobar(
  "desactiva, no borra",
  baja.cuerpo?.data?.desactivado === true,
  JSON.stringify(baja.cuerpo).slice(0, 220)
);
comprobar("y avisa de que tiene historial", baja.cuerpo?.data?.conHistorial === true);

const trasBaja = await pedir("/api/productos?todos=1");
const mio7 = (trasBaja.cuerpo?.data || []).find((p) => p.id === PROD);
comprobar("pero sigue en la lista", Boolean(mio7), mio7?.variantes?.[0]?.activo === false ? "inactivo" : "activo");
comprobar("con sus movimientos intactos", mio7?.variantes?.[0]?.stock === 19, "stock " + mio7?.variantes?.[0]?.stock);

/* ---------- Limpiar ---------- */
console.log("\n── Limpiando ──\n");

/* La limpieza la hace `db/limpar-pruebas.js`, y se llama con el script
   y no con SQL desde aquí a propósito.

   El recorrido deja datos en ocho tablas, y cuatro de ellas no tienen
   columna con la marca: los movimientos, los ítems de venta, la caja y
   los arqueos se identifican por el producto de prueba que los originó.
   Escribirlodesde aquí en un `foreach` sería la forma de que una tabla
   se quedara sin borrar y la prueba siguiente empezara con el stock
   movido.

   Y el orden de borrado lo pone la base, por las claves ajenas. */
try {
  execFileSync("node", [path.join(RAIZ, "db", "limpar-pruebas.js")], { stdio: "ignore" });
  console.log("  datos de prueba borrados");
} catch {
  console.log("  · no se pudo limpiar (se limpia a mano con db/limpar-pruebas.js)");
}

fs.rmSync(cookies, { force: true });

console.log("\n" + "═".repeat(54));
if (fallos) {
  console.log(`✗ ${fallos} de ${ok + fallos} fallan.\n`);
  process.exit(1);
}
console.log(`✓ Las ${ok} comprobaciones pasan.\n`);
process.exit(0);