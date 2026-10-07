/* Averiguar por qué /api/resumen no responde.

   `resumen` y `compras` se quedan en "Cargando..." para siempre, y las
   otras cuatro cargan bien. Las dos cuelgan de la misma sesión y del
   mismo proveedor de datos, así que la diferencia está en la petición:
   si fuera la sesión, fallarían todas.

   Se mira la respuesta cruda, no la pantalla: la pantalla solo sabe
   decir "no llegó", y lo interesante es si la petición devuelve un
   error, si devuelve 200 con algo que no es lo que espera el cliente,
   o si simplemente no termina. */
const { execFileSync } = require("child_process");
const { createRequire } = require("module");

const req = createRequire("file:///D:/webs/inventario/sonda.js");
const BASE = process.env.BASE || "http://localhost:3010";

const RUTAS = ["/api/resumen", "/api/productos", "/api/compras", "/api/caja", "/api/cuentas"];

(async () => {
  const salida = execFileSync("node", ["db/dev-ticket.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1 << 24,
  });
  const enlace = (salida.match(/http:\/\/\S+#ticket=\S+/) || [])[0];
  const ticket = enlace.split("#ticket=")[1].trim();

  const { chromium } = req("D:/webs/wweb/node_modules/playwright");
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext();
  const pagina = await ctx.newPage();

  /* Todo lo que sale de la página, con su código y su cuerpo. */
  const peticiones = [];
  pagina.on("response", async (r) => {
    const u = r.url();
    if (!u.includes("/api/")) return;
    let cuerpo = "";
    try {
      cuerpo = (await r.text()).slice(0, 200);
    } catch {
      cuerpo = "(no se pudo leer el cuerpo)";
    }
    peticiones.push({ u: u.replace(BASE, ""), estado: r.status(), cuerpo });
  });

  pagina.on("console", (m) => {
    if (m.type() === "error") console.log("  [consola] " + m.text().slice(0, 140));
  });
  pagina.on("pageerror", (e) => console.log("  [excepción] " + e.message.slice(0, 140)));

  await pagina.goto(BASE + "/entrar#ticket=" + ticket, { waitUntil: "domcontentloaded" });
  await pagina.waitForTimeout(2500);
  peticiones.length = 0;

  for (const r of RUTAS) {
    const t0 = Date.now();
    const resp = await pagina.evaluate(
      (url) =>
        fetch(url)
          .then(async (x) => ({ estado: x.status, cuerpo: (await x.text()).slice(0, 260) }))
          .catch((e) => ({ estado: 0, cuerpo: String(e).slice(0, 200) })),
      r
    );
    console.log("  " + r.padEnd(18) + "HTTP " + resp.estado + "  " + (Date.now() - t0) + "ms");
    console.log("      " + resp.cuerpo.replace(/\s+/g, " ").slice(0, 220));
  }

  /* Y ahora qué pide la pantalla de resumen al entrar en ella. */
  console.log("");
  console.log("=== lo que pide / al entrar ===");
  await pagina.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await pagina.waitForTimeout(4000);
  if (!peticiones.length) console.log("  no sale ninguna petición a /api/");
  for (const p of peticiones) {
    console.log("  " + p.u.padEnd(20) + "HTTP " + p.estado);
    console.log("      " + p.cuerpo.replace(/\s+/g, " ").slice(0, 200));
  }

  await navegador.close();
})().catch((e) => {
  console.log("  *** " + e.message);
  process.exit(1);
});