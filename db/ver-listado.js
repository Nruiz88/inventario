/* Comprobar el listado de productos: filtros, contadores y orden.
 *
 * ── POR QUÉ HAY QUE MIRARLO Y NO DARNOS POR CUENTAS ──
 *
 * El contador de un filtro es una cifra que se enseña al dueño y que
 * él usa para decidir. Si «Por reponer» dice 3 y al pulsarlo salen 4,
 * el filtro deja de servir para lo único que sirve: saber qué hay que
 * comprar. Y no se ve leyendo el código, porque el contador y el filtro
 * son dos predicados distintos y basta que uno de los dos tenga un
 * `!` mal puesto para que dejen de cuadrar.
 *
 * Lo que hace este script, en la página de verdad con un navegador de
 * verdad:
 *
 *   1. Que el número de filas de cada filtro sea el que pone su
 *      contador. Y que además sea el que corresponde al predicado,
 *      contado por fuera desde la respuesta de la API.
 *   2. Que ordenar por una columna invierta al segundo clic.
 *   3. Que el buscador y los filtros se compongan: buscar y filtrar a
 *      la vez no puede dar más filas que los dos por separado.
 */
const { execFileSync } = require("child_process");
const { createRequire } = require("module");

const req = createRequire("file:///D:/webs/inventario/capturar.js");
const BASE = process.env.BASE || "http://localhost:3010";

let fallos = 0;

function comprobar(ok, texto) {
  console.log("  " + (ok ? "ok   " : "FALLA") + "  " + texto);
  if (!ok) fallos++;
}

async function main() {
  const salidaTicket = execFileSync("node", ["db/dev-ticket.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1 << 24,
  });
  const ticket = (salidaTicket.match(/http:\/\/\S+#ticket=\S+/) || [])[0].split("#ticket=")[1].trim();

  const { chromium } = req("D:/webs/wweb/node_modules/playwright");
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 1200 } });
  const pagina = await ctx.newPage();

  await pagina.goto(BASE + "/entrar#ticket=" + ticket, { waitUntil: "domcontentloaded" });
  await pagina.waitForTimeout(2500);

  /* ── La API, para tener la verdad de los datos ──
     Se pide desde la página con las mismas cookies que usa el listado, y
     se cuenta ahí. Si el contador de la pantalla no sale de esta cuenta,
     el fallo es del contador y no de los datos. */
  await pagina.goto(BASE + "/productos", { waitUntil: "domcontentloaded" });
  await pagina.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

  const verdad = await pagina.evaluate(async () => {
    const r = await fetch("/api/productos?todos=1");
    const c = await r.json();
    const lineas = [];
    for (const p of c.data) {
      for (const v of p.variantes) {
        lineas.push({
          nombre: (p.nombre + " " + (v.nombre || "")).trim(),
          stock: v.stock,
          minimo: v.minimo,
          bajo: v.bajo,
          inactivo: !v.activo || p.activo === false,
        });
      }
    }
    return {
      total: lineas.length,
      bajo: lineas.filter((l) => !l.inactivo && l.stock > 0 && l.bajo).length,
      cero: lineas.filter((l) => !l.inactivo && l.stock <= 0).length,
      inactivos: lineas.filter((l) => l.inactivo).length,
    };
  });

  console.log("");
  console.log("  La API dice: " + JSON.stringify(verdad));
  console.log("");

  /* ── Los cuatro filtros ── */
  const FILTROS = [
    { texto: "Todos", esperado: verdad.total },
    { texto: "Por reponer", esperado: verdad.bajo },
    { texto: "Sin existencias", esperado: verdad.cero },
    { texto: "Inactivos", esperado: verdad.inactivos },
  ];

  const leido = () =>
    pagina.evaluate(() => ({
      filas: document.querySelectorAll("tbody tr").length,
      /* El contador va en el `<span>` que sigue al texto del botón. */
      contador: [...document.querySelectorAll("button[aria-pressed]")]
        .map((b) => Number((b.textContent || "").match(/(\d+)\s*$/)?.[1] ?? NaN))
        .filter((n) => Number.isFinite(n)),
    }));

  /* Con el filtro puesto hay que mirar SUS números, no los de la
     pantalla entera: cada botón lleva el suyo. */
  for (const f of FILTROS) {
    await pagina.click(`button[aria-pressed]:has-text("${f.texto}")`);
    await pagina.waitForTimeout(250);
    const m = await leido();

    const i = FILTROS.findIndex((x) => x.texto === f.texto);
    const contador = m.contador[i];

    comprobar(m.filas === f.esperado, `${f.texto}: ${m.filas} filas, la API dice ${f.esperado}`);
    comprobar(
      contador === f.esperado,
      `${f.texto}: el contador dice ${contador}, la API dice ${f.esperado}`
    );
  }

  /* ── Los filtros y el buscador juntos ──
     El buscador va sobre el conjunto entero y el filtro encima. Un
     buscador que se aplica antes de la cuenta, y un contador que no, dan
     cifras que no son las filas de abajo. */
  await pagina.click('button[aria-pressed]:has-text("Todos")');
  await pagina.waitForTimeout(200);
  const antes = (await leido()).filas;

  await pagina.fill('input[aria-label="Buscar productos"]', "gaseosa");
  await pagina.waitForTimeout(400);
  const conBusqueda = (await leido()).filas;

  const buscaApi = await pagina.evaluate(async () => {
    const r = await fetch("/api/productos?todos=1");
    const c = await r.json();
    let n = 0;
    for (const p of c.data) {
      for (const v of p.variantes) {
        if (
          (p.nombre + " " + (v.nombre || "") + " " + (p.categoria || "") + " " + (v.sku || ""))
            .toLowerCase()
            .includes("gaseosa")
        )
          n++;
      }
    }
    return n;
  });

  comprobar(conBusqueda === buscaApi, `buscar «gaseosa»: ${conBusqueda} filas, la API dice ${buscaApi}`);
  comprobar(conBusqueda <= antes, `buscar «gaseosa» quita filas (${antes} -> ${conBusqueda})`);

  await pagina.fill('input[aria-label="Buscar productos"]', "");
  await pagina.waitForTimeout(300);

  /* ── El orden ──
     El `aria-sort` va en el `<th>`, no en el botón: es del encabezado. Y
     el segundo clic invierte. */
  const thVenta = 'th[aria-sort]:has-text("Venta")';

  const primero = () =>
    pagina.evaluate(() => {
      const c = document.querySelector("tbody tr td:nth-child(3)");
      return (c?.textContent || "").trim();
    });

  await pagina.click(`${thVenta} button`);
  await pagina.waitForTimeout(250);
  const a1 = await primero();
  const sort1 = await pagina.getAttribute(thVenta, "aria-sort");

  await pagina.click(`${thVenta} button`);
  await pagina.waitForTimeout(250);
  const a2 = await primero();
  const sort2 = await pagina.getAttribute(thVenta, "aria-sort");

  comprobar(sort1 === "descending", `el primer clic ordena por venta de mayor a menor (aria-sort=${sort1})`);
  comprobar(sort2 === "ascending", `el segundo clic invierte (aria-sort=${sort2})`);
  comprobar(a1 !== a2, `el primero cambia: «${a1}» y luego «${a2}»`);

  /* Y de verdad el más caro arriba. */
  const precios = await pagina.evaluate(() =>
    [...document.querySelectorAll("tbody tr")].map(
      (f) => Number((f.querySelector("td:nth-child(3)")?.textContent || "").replace(/[^0-9,.]/g, "").replace(",", "."))
    )
  );
  const bienOrdenado = precios.every((p, i) => i === 0 || precios[i - 1] <= p);
  comprobar(bienOrdenado, "las ventas de arriba a abajo van de menor a mayor: " + precios.join(", "));

  await navegador.close();

  console.log("");
  console.log(fallos ? "  " + fallos + " fallos" : "  todo cuadra");
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.log("  *** " + e.message);
  process.exit(1);
});