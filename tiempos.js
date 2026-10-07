/* Leer el `Server-Timing` de cada ruta.

   ── POR QUÉ DESDE EL NAVEGADOR ──

   Porque hace falta una sesión, y la sesión sale de canjear un ticket.
   Con `fetch` desde la línea de órdenes no hay sesión, y la ruta
   contesta 401 antes de hacer nada: no se mide el tiempo de las
   consultas, se mide el tiempo que se tarda en decir que no.

   El navegador ya tiene la sesión porque `dev-ticket.mjs` la canjeó, y
   desde ahí se leen las cabeceras de la respuesta.

   ── LO QUE DEVUELVE ──

   Cada ruta con su total y, si la manda, el desglose por consulta. El
   total que sale del `fetch` es el que ve la persona; el desglose es lo
   que explica ese total. */
const { execFileSync } = require("child_process");
const path = require("path");
const { createRequire } = require("module");

const req = createRequire("file:///D:/webs/inventario/tiempos.js");
const BASE = process.env.BASE || "http://localhost:3010";

const RUTAS = ["/api/resumen", "/api/productos", "/api/compras", "/api/caja", "/api/cuentas"];

(async () => {
  const salida = execFileSync("node", [path.join(__dirname, "db", "dev-ticket.mjs")], {
    cwd: __dirname,
    encoding: "utf8",
    maxBuffer: 1 << 24,
  });
  const enlace = (salida.match(/http:\/\/\S+#ticket=\S+/) || [])[0];
  const ticket = enlace.split("#ticket=")[1].trim();

  const { chromium } = req("D:/webs/wweb/node_modules/playwright");
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext();
  const pagina = await ctx.newPage();

  await pagina.goto(BASE + "/entrar#ticket=" + ticket, { waitUntil: "domcontentloaded" });
  await pagina.waitForTimeout(2500);

  console.log("");

  for (const ruta of RUTAS) {
    /* Dos vueltas. La segunda va con la conexión caliente, y es la que
       dice si una consulta es lenta de verdad o solo de arranque. */
    const r1 = await medir(pagina, ruta);
    const r2 = await medir(pagina, ruta);

    const mejor = r1.ms <= r2.ms ? r1 : r2;
    const desglose = mejor.timing
      ? mejor.timing
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean)
          .sort((a, b) => Number(b.split("dur=")[1]) - Number(a.split("dur=")[1]))
          .join("  ")
      : "(sin Server-Timing)";

    console.log("  " + ruta.padEnd(20) + String(r1.ms).padStart(5) + " ms / " + String(r2.ms).padStart(5) + " ms");
    console.log("      " + desglose);
    console.log("");
  }

  await navegador.close();

  async function medir(pagina, ruta) {
    return pagina.evaluate(async (url) => {
      const t0 = performance.now();
      const r = await fetch(url);
      const cuerpo = await r.text();
      return {
        ms: Math.round(performance.now() - t0),
        timing: r.headers.get("server-timing") || "",
        bytes: cuerpo.length,
      };
    }, ruta);
  }
})().catch((e) => {
  console.log("  *** " + e.message);
  process.exit(1);
});