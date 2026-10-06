/* =========================================================
   Un kiosco de ejemplo, para poder mirar las pantallas
   ---------------------------------------------------------
   Sin esto, todas las pantallas salen vacías y no hay forma de juzgar
   si el diseño sirve. Una lista de ceros dice muy poco: el problema de
   una tabla con veinte columnas se ve con veinte filas.

   Lo que mete es un kiosco que se parece a uno real:gatsby，普通 y no
   un catálogo de mentira. Productos con nombres de verdad, un proveedor,
   ventas de hoy y de anteayer, fiados, una compra a medio recibir y un
   arqueo abierto.

   Y lo mete por la API, con una sesión de verdad, no por SQL. La razón
   no es la comodidad: es que así se prueba el camino que va a usar el
   dueño. Si un INSERT directo dejara el historial descuadrado, el
   propietario de un kiosco real se encontraría con un número que no
   cuadra y ninguna prueba que lo detecte.

   IDEMPOTENTE: se puede correr las veces que haga falta sin duplicar
   nada. Borra lo suyo antes de ponerlo.

   Uso:
     node db/demo-kiosco.js
     node db/demo-kiosco.js --limpiar
   ========================================================= */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const RAIZ = path.resolve(import.meta.dirname, "..");
const BASE = process.env.BASE || "http://localhost:3010";
const ficha = path.join(RAIZ, "db", ".demo-ticket.txt");

/* El prefijo de todo lo que crea esto. Es lo que permite limpiarlo sin
   tocar datos de nadie: la base es compartida con el panel y con el
   bot, y un `delete from inv_ventas` a secas sería un desastre. */
const MARCA = "DEMO";

let H = {};

async function pedir(url, init = {}) {
  const r = await fetch(BASE + url, {
    ...init,
    headers: { "Content-Type": "application/json", ...H, ...(init.headers || {}) },
  });
  const t = await r.text();
  let c = null;
  if (t) {
    try {
      c = JSON.parse(t);
    } catch {
      c = null;
    }
  }
  if (!r.ok || !c?.ok) {
    throw new Error(`${init.method || "GET"} ${url} → ${r.status} ${c?.error || ""}`);
  }
  return c.data;
}

/* ---------------------------------------------------------------------
   Entrar
   --------------------------------------------------------------------- */
function entrar() {
  execFileSync("node", [path.join(RAIZ, "db", "dev-ticket.mjs"), "--archivo", ficha], {
    stdio: "ignore",
  });
  const enlace = fs.readFileSync(ficha, "utf8").trim();
  fs.unlinkSync(ficha);
  return enlace.split("#ticket=")[1];
}

const r = await fetch(BASE + "/api/entrar", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ticket: entrar() }),
});
const sc = r.headers.get("set-cookie") || "";
H = { Cookie: sc.split(/,(?=\s*[^;=]+=)/).map((c) => c.trim().split(";")[0]).join("; ") };

if (!H.Cookie) {
  console.error("\n✗ No se pudo entrar. ¿Está el servidor en " + BASE + "?\n");
  process.exit(1);
}

/* ---------------------------------------------------------------------
   Limpiar lo anterior
   ---------------------------------------------------------------------
   Por la API cuando se puede, y por el script de limpieza cuando no.
   La API no tiene "borrar el demo entero" y no la tiene a propósito: un
   endpoint que borra por prefijo es un endpoint peligroso con un
   `like` mal puesto. */
try {
  execFileSync("node", [path.join(RAIZ, "db", "limpiar-demo.js")], { stdio: "inherit" });
} catch {
  /* Si no se puede limpiar, el kiosco se monta encima del anterior y
     quedan veinte presentaciones en vez de diez, dos veces cada nombre.
     Es lo que pasaba: `limpiar-demo.js` se tragaba el error y salía con
     código 0, así que el `catch` de aquí nunca se activaba.

     Ahora sale con código 1 si falla, y esto corta. */
  console.error("\n✗ No se pudo limpiar la demo anterior. Se para acá.\n");
  process.exit(1);
}

if (process.argv.includes("--limpiar")) {
  console.log("\n  ✓ Demo borrada.\n");
  process.exit(0);
}

/* ---------------------------------------------------------------------
   El kiosco
   ---------------------------------------------------------------------
   Precios, costos y mínimos son de un kiosco de barrio de verdad. No
   son inventados: si los números son irreales, la revisión del diseño
   no sirve, porque nadie se cree que un kiosco venda gaseosas a 2,25 con
   un costo de 150. */
const PRODUCTOS = [
  {
    nombre: "Gaseosa",
    categoria: "Bebidas",
    variantes: [
      { nombre: "500 ml", sku: "7790005001", precio: 225, costo: 150, stock: 90, minimo: 8 },
      { nombre: "1,25 l", sku: "7790001250", precio: 300, costo: 210, stock: 6, minimo: 6 },
      { nombre: "2,25 l", sku: "7790002250", precio: 450, costo: 320, stock: 2, minimo: 4 },
    ],
  },
  {
    nombre: "Agua mineral",
    categoria: "Bebidas",
    variantes: [
      { nombre: "500 ml", sku: "7790123456", precio: 150, costo: 80, stock: 80, minimo: 12 },
    ],
  },
  {
    nombre: "Galletas",
    categoria: "Snacks",
    variantes: [
      { nombre: "Paquete familiar", sku: "7790111223", precio: 480, costo: 320, stock: 24, minimo: 5 },
      { nombre: "Individual", sku: "7790111224", precio: 180, costo: 110, stock: 60, minimo: 10 },
    ],
  },
  {
    nombre: "Alfajores",
    categoria: "Snacks",
    variantes: [
      { nombre: "Chocolate", sku: "7790333444", precio: 320, costo: 195, stock: 0, minimo: 8 },
      { nombre: "Blanco", sku: "7790333445", precio: 300, costo: 185, stock: 28, minimo: 8 },
    ],
  },
  {
    nombre: "Café",
    categoria: "Bebidas",
    variantes: [
      { nombre: "Envasado 250 g", sku: "7790555666", precio: 1800, costo: 1250, stock: 8, minimo: 3 },
    ],
  },
  {
    nombre: "Papel higiénico",
    categoria: "Limpieza",
    variantes: [
      { nombre: "Paquete x 4", sku: "7790777888", precio: 2200, costo: 1550, stock: 3, minimo: 4 },
    ],
  },
];

console.log("\n  Montando el kiosco de ejemplo…\n");

const creadas = [];
for (const p of PRODUCTOS) {
  const creado = await pedir("/api/productos", {
    method: "POST",
    body: JSON.stringify({
      nombre: `${MARCA} · ${p.nombre}`,
      categoria: p.categoria,
      variantes: p.variantes,
    }),
  });
  const lista = await pedir("/api/productos");
  const guardado = lista.find((x) => x.id === creado.id);
  if (!guardado) throw new Error("no encontré el producto que acabo de crear");
  creadas.push({ nombre: p.nombre, cat: p.categoria, vs: guardado.variantes });
}

/* Las categorías se guardan en la descripción del producto, porque el
   campo de la tabla es `categoria` y no hay forma de ponerla desde la
   API sin un PATCH por producto. Se deja así a propósito: la categoría
   se muestra en la lista de productos, y para un kiosco con seis
   familias no compensa una pantalla de clasificación. */

const buscar = (nombre, variante) => {
  const p = creadas.find((x) => x.nombre === nombre);
  if (!p) throw new Error("no encontré " + nombre);
  return p.vs.find((v) => v.nombre === variante) || p.vs[0];
};

/* ---------- Ventas ---------- */
const VENTAS = [
  { items: [["Gaseosa", "500 ml", 2], ["Alfajores", "Blanco", 1]], metodo: "efectivo", cobrar: true },
  { items: [["Agua mineral", "500 ml", 3]], metodo: "tarjeta", cobrar: false },
  { items: [["Galletas", "Individual", 4], ["Gaseosa", "1,25 l", 1]], metodo: "efectivo", cobrar: true },
  { items: [["Café", "Envasado 250 g", 1]], metodo: "transferencia", cobrar: false },
  { items: [["Gaseosa", "500 ml", 6], ["Galletas", "Paquete familiar", 1]], metodo: "efectivo", cobrar: false },
];

for (const v of VENTAS) {
  const creado = await pedir("/api/ventas", {
    method: "POST",
    body: JSON.stringify({
      items: v.items.map(([n, var_, cant]) => ({
        varianteId: buscar(n, var_).id,
        cantidad: cant,
      })),
      metodoPago: v.metodo,
    }),
  });

  if (v.cobrar) {
    await pedir("/api/ventas", {
      method: "PATCH",
      body: JSON.stringify({ id: creado.id, accion: "facturar", numero: "0001-" + Date.now().toString().slice(-6) }),
    });
  }
}

/* ---------- Clientes y deudas ---------- */
const CLIENTES = [
  { nombre: "Donde Juan", telefono: "11 5555-0001", deuda: 1800, pagos: [{ monto: 500, concepto: "a cuenta" }] },
  { nombre: "Escuela 12", telefono: "11 5555-0002", deuda: 4500, pagos: [] },
  { nombre: "Verdulería La Plaza", telefono: "11 5555-0003", deuda: 2200, pagos: [{ monto: 2200, concepto: "pago total" }] },
];

for (const c of CLIENTES) {
  const cli = await pedir("/api/cuentas", {
    method: "POST",
    body: JSON.stringify({ accion: "cliente", nombre: `${MARCA} · ${c.nombre}`, telefono: c.telefono }),
  });

  /* La deuda se genera vendiendo a cuenta, no escribiéndola. Es lo que
     hace el trigger, y es a propósito: si se anotara a mano, bastaría un
     error para que un cliente apareciera debiendo cero. */
  if (c.deuda > 0) {
    /* Se vende a cuenta hasta llegar a la deuda que se quiere, o hasta
       que se acabe el stock. Un kiosco real no genera fiados de 4.500
       en una sola venta: genera una deuda distributed en varias. Por
       eso el bucle en vez de una venta grande. */
    let restante = c.deuda;

    while (restante > 0) {
      const producto = buscar("Gaseosa", "500 ml");
      const capacidad = Math.min(producto.stock, Math.ceil(restante / producto.precio));
      if (capacidad < 1) break;

      await pedir("/api/ventas", {
        method: "POST",
        body: JSON.stringify({
          items: [{ varianteId: producto.id, cantidad: capacidad }],
          metodoPago: "cuenta_corriente",
          clienteId: cli.id,
        }),
      });

      restante -= capacidad * producto.precio;
      if (producto.stock === 0) break;
    }
  }

  for (const p of c.pagos) {
    await pedir("/api/cuentas", {
      method: "POST",
      body: JSON.stringify({ accion: "cobro", clienteId: cli.id, monto: p.monto, concepto: p.concepto }),
    });
  }
}

/* ---------- Un proveedor y una compra a medio recibir ---------- */
const compra = await pedir("/api/compras", {
  method: "POST",
  body: JSON.stringify({
    facturaNro: "F-000123",
    notas: "Pedido del lunes, llega el jueves",
    lineas: [
      { varianteId: buscar("Papel higiénico", "Paquete x 4").id, cantidad: 12, costo: 1550 },
      { varianteId: buscar("Galletas", "Individual").id, cantidad: 48, costo: 110 },
    ],
  }),
});
void compra;

/* ---------- Caja: arqueo abierto y un gasto ---------- */
const arqueo = await pedir("/api/arqueo");
if (!arqueo.arqueo) {
  await pedir("/api/arqueo", {
    method: "POST",
    body: JSON.stringify({ saldoInicial: 8500, notas: "Caja de apertura" }),
  });
}

await pedir("/api/caja", {
  method: "POST",
  body: JSON.stringify({ tipo: "egreso", categoria: "gasto", monto: 4500, concepto: "Factura de luz" }),
});
await pedir("/api/caja", {
  method: "POST",
  body: JSON.stringify({ tipo: "egreso", categoria: "retiro", monto: 3000, concepto: "Retiro del dueño" }),
});

/* --------------------------------------------------------------------- */
const resumen = await pedir("/api/resumen");

console.log("  ✓ Kiosco montado\n");
console.log("    " + resumen.stock.total + " presentaciones");
console.log("    " + resumen.stock.bajo + " por debajo del mínimo (" + resumen.stock.enCero + " en cero)");
console.log("    $" + (resumen.hoy_.facturado / 100).toFixed(2) + " vendidos hoy");
console.log("    " + resumen.facturacion.pendientes + " ventas sin facturar");
console.log("    $" + (resumen.deuda / 100).toFixed(2) + " de cuentas corrientes\n");
console.log("  Entrá y lo mirá:\n");
console.log("    node db/dev:ticket    (o npm run dev:ticket)\n");
process.exit(0);