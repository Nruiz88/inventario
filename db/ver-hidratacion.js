/* Ver el error de hidratación entero, no las 80 primeras letras.
 *
 * ── POR QUÉ ESTE SCRIPT ──
 *
 * `capturar.js` corta el mensaje de error a 80 caracteres, y con eso
 * sale «Hydration failed because the server rendered HTML didn't match
 * the client. As a…»: dice que hay un fallo y no dice dónde. Este
 * script pide la página y saca el texto entero y el HTML alrededor de
 * donde el navegador dice que no cuadra.
 */
const { execFileSync } = require("child_process");
const { createRequire } = require("module");

const req = createRequire("file:///D:/webs/inventario/capturar.js");
const BASE = process.env.BASE || "http://localhost:3010";
const RUTA = process.argv[2] || "/productos";

async function main() {
  const salidaTicket = execFileSync("node", ["db/dev-ticket.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1 << 24,
  });
  const enlace = (salidaTicket.match(/http:\/\/\S+#ticket=\S+/) || [])[0];
  const ticket = enlace.split("#ticket=")[1].trim();

  const { chromium } = req("D:/webs/wweb/node_modules/playwright");
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 1000 } });
  const pagina = await ctx.newPage();

  const errores = [];
  pagina.on("pageerror", (e) => errores.push(e.message));
  pagina.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errores.push(m.type() + ": " + m.text());
  });

  await pagina.goto(BASE + "/entrar#ticket=" + ticket, { waitUntil: "domcontentloaded" });
  await pagina.waitForTimeout(2500);
  await pagina.goto(BASE + RUTA, { waitUntil: "domcontentloaded" });
  await pagina.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await pagina.waitForTimeout(500);

  for (const e of errores) {
    console.log("  ────────────────────────────────────────");
    console.log(
      e
        .split("\n")
        .map((l) => "  " + l)
        .join("\n")
    );
  }

  if (!errores.length) console.log("  sin errores en " + RUTA);

  await navegador.close();
}

main().catch((e) => {
  console.log("  *** " + e.message);
  process.exit(1);
});