/* =========================================================
   Mirar el dashboard en un navegador de verdad
   ---------------------------------------------------------
   ⚠️  ESTE SCRIPT ES LO QUE FALTA EN TODO EL PROYECTO
   --------------------------------------------------
   El bot tuvo el bug más caro de todo el sistema: la entrada NUNCA
   funcionó desde un navegador, y todas las pruebas daban verde. La
   página mandaba el ticket con el prefijo "ticket=" pegado; las pruebas
   hacían el POST ellas mismas y se saltaban el fragmento.

   Aquí no hay POST a mano. Se abre `localhost:3010/entrar#ticket=...` en
   un Chromium de verdad y se deja que el JavaScript de la página haga
   lo que tiene que hacer. Si el parseo del fragmento está roto, esta
   pantalla lo detecta y ninguna otra lo hace.

   Y además saca capturas, porque el render no se comprueba con un
   código de estado: una pantalla que sale en blanco responde 200.

   Uso:
     node db/mirar.mjs                    # las seis pantallas
     node db/mirar.mjs --pantalla ventas  # solo una
   ========================================================= */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

/* Playwright está instalado en el proyecto del bot, no en este. Se toma
   de ahí con `createRequire` en vez de instalar otra copia: dos
   navegadores descargados son 300MB de más por una herramienta que ya
   está en la máquina. */
const require = createRequire("D:/webs/wweb/");
const { chromium } = require("playwright");

const RAIZ = path.resolve(import.meta.dirname, "..");

/* ⚠️  `localhost` Y NO `127.0.0.1`
 * --------------------------------
 * El enlace que imprime `dev-ticket.mjs` dice `localhost`, así que la
 * cookie se pone en el host `localhost`. Si este script navegara a
 * `127.0.0.1` —que es la misma máquina y el mismo servidor— la cookie
 * NO viajaría: son dos hosts distintos para el navegador, y la cookie es
 * host-only a propósito.
 *
 * El síntoma es desconcertante y no dice nada de cookies: las seis
 * pantallas redirected a `/entrar` con HTTP 200, el texto era el de la
 * pantalla de entrada, y todo parecía funcionar. La comprobación de la
 * cookie decía "presente" porque la había puesto el propio `/entrar`, en
 * el host correcto, un momento antes.
 *
 * Es el mismo tipo de fallo que el del bot con el prefijo del ticket: un
 * detalle de una línea que hace que nada funcione y ninguna prueba de
 * código lo ve. */
const BASE = process.env.BASE || "http://localhost:3010";
const SALIDA = path.join(RAIZ, "capturas");
const ficha = path.join(RAIZ, "db", ".mirar-ticket.txt");

const PANTALLAS = [
  { ruta: "/", nombre: "resumen" },
  { ruta: "/ventas", nombre: "ventas" },
  { ruta: "/productos", nombre: "productos" },
  { ruta: "/compras", nombre: "compras" },
  { ruta: "/caja", nombre: "caja" },
  { ruta: "/cuentas", nombre: "cuentas" },
];

let ok = 0;
let fallos = 0;
const comprobar = (txt, cond, extra) => {
  console.log(`  ${cond ? "✓" : "✗"} ${txt}${extra ? "  → " + extra : ""}`);
  cond ? ok++ : fallos++;
};

/* ---------------------------------------------------------------------
   Un ticket
   --------------------------------------------------------------------- */
function ticket() {
  execFileSync("node", [path.join(RAIZ, "db", "dev-ticket.mjs"), "--archivo", ficha], {
    stdio: "ignore",
  });
  const enlace = fs.readFileSync(ficha, "utf8").trim();
  fs.unlinkSync(ficha);
  return enlace;
}

/* ---------------------------------------------------------------------
   Arranque
   --------------------------------------------------------------------- */
fs.mkdirSync(SALIDA, { recursive: true });

const solo = process.argv.indexOf("--pantalla");
const filtro = solo > -1 ? process.argv[solo + 1] : null;

const navegador = await chromium.launch();
const contexto = await navegador.newContext({
  viewport: { width: 1280, height: 900 },
  locale: "es-AR",
  timezoneId: "America/Argentina/Buenos_Aires",
});

/* Se recogen los errores de consola y los fallos de red de TODO lo que
   se abra, y se muestran al final.

   Sin esto, un `console.error` de React sale en la consola del navegador
   —que no ve nadie— y la pantalla se queda a medio pintar con un 200.
   Ese es el otro fallo que no se ve mirando códigos de estado. */
const problemas = [];

/* El WebSocket del hot-reload no se considera un problema.
   `next dev` lo intenta abrir en cada navegación y en un Windows con
   el proxy devuelve una respuesta que no es un WebSocket. Es ruido de
   desarrollo, no un fallo de la aplicación, y dejarlo dentro hace que
   las seis pantallas "fallen" siempre y el aviso deje de significar
   algo. */
const RUIDO = /hmr|WebSocket|hot-reload|favicon|DevTools/i;

contexto.on("page", (pagina) => {
  pagina.on("console", (m) => {
    if (m.type() === "error" && !RUIDO.test(m.text())) {
      problemas.push("consola: " + m.text().slice(0, 160));
    }
  });
  pagina.on("pageerror", (e) => problemas.push("excepción: " + String(e.message).slice(0, 160)));
  pagina.on("requestfailed", (r) => {
    const url = r.url();
    if (url.includes(BASE) && !RUIDO.test(url)) {
      problemas.push("red: " + url.replace(BASE, "") + " → " + (r.failure()?.errorText || "?"));
    }
  });
});

const pagina = await contexto.newPage();

console.log("\n═══ En un navegador de verdad ═══\n");

/* ---------------------------------------------------------------------
   1. La entrada, por el FRAGMENTO
   ---------------------------------------------------------------------
   Este es el paso que nunca se había probado. Se abre el enlace tal
   cual, con el `#ticket=` al final, y no se manda ningún POST a mano:
   lo que tiene que funcionar es el JavaScript de la página. */
console.log("── Entrando con el enlace ──\n");

const enlace = ticket();
await pagina.goto(enlace, { waitUntil: "domcontentloaded" });

/* Se espera a que la navegación termine. Si el canje falla, la página se
   queda en /entrar mostrando el error; si funciona, aterriza en `/`. */
let destino = "/";
try {
  await pagina.waitForURL((u) => !u.pathname.startsWith("/entrar"), { timeout: 15000 });
  destino = new URL(pagina.url()).pathname;
} catch {
  destino = new URL(pagina.url()).pathname;
}

comprobar("el fragmento se procesó y se entró", destino === "/", "quedó en " + destino);

if (destino !== "/") {
  /* Si no entró, esto es el bug del bot: el ticket llegó entero, con
     el prefijo, y el servidor lo rechazó. Se saca el texto de la
     pantalla porque es lo único que explica nada. */
  const texto = await pagina.textContent("body").catch(() => "");
  console.log("\n  LA PÁGINA DIJO:");
  console.log("    " + (texto || "(nada)").trim().slice(0, 300) + "\n");
} else {
  const cookies = await contexto.cookies();
  const miCookie = cookies.find((c) => c.name === "inv_sesion");
  comprobar("y dejó la cookie", Boolean(miCookie), miCookie ? "inv_sesion presente" : "no");
  comprobar(
    "que es host-only, sin Domain",
    Boolean(miCookie && !miCookie.domain.startsWith(".")),
    miCookie ? "domain " + miCookie.domain : "—"
  );
  comprobar("y no es httpOnly-cualquiera", Boolean(miCookie?.httpOnly), miCookie ? "httpOnly" : "—");

  /* -------------------------------------------------------------------
     2. Las pantallas
     -------------------------------------------------------------------
     Se comprueba que pintan algo, no que devuelven 200. Un panel vacío
     con un 200 es un fallo que ningún código de estado ve, y es lo que
     pasa cuando un componente lanza durante el render. */
  console.log("\n── Las pantallas ──\n");

  for (const p of PANTALLAS) {
    if (filtro && p.nombre !== filtro) continue;

    problemas.length = 0;

    const respuesta = await pagina.goto(BASE + p.ruta, { waitUntil: "networkidle" });
    const status = respuesta?.status() || 0;

    /* `innerText` y no `textContent`. La diferencia es lo que hace que esta
       comprobación sirva:
       
       `textContent` devuelve también el contenido de los `<script>`,
       y Next mete ahí el payload RSC: siete mil caracteres de
       `self.__next_r=...`. Con eso, una pantalla que muestra
       "Abriendo el inventario…Un momento." —que es lo que ve una persona
       — daba "7768 caracteres" y pasaba la comprobación de contenido.
       
       `innerText` es solo lo que se ve. Un `div` con
       `display:none` tampoco cuenta, que es lo que debe pasar. */
    const texto = (await pagina.evaluate(() => document.body?.innerText || "")).trim();
    const limpio = texto.replace(/\s+/g, " ").trim();

    const errores = problemas.filter((x) => !RUIDO.test(x));

    comprobar(
      `${p.nombre} responde 200`,
      status === 200,
      "HTTP " + status
    );
    comprobar(
      `${p.nombre} pinta algo`,
      limpio.length > 40,
      limpio.length + " caracteres"
    );
    comprobar(
      `${p.nombre} sin errores de consola`,
      errores.length === 0,
      errores.length ? errores[0] : "ninguno"
    );

    /* Que no esté en blanco: el caso de "cargando…" que nunca resuelve.
       Es el síntoma de una llamada a la API que quedó colgada. */
    if (/Cargando|Abriendo el inventario/.test(limpio) && limpio.length < 120) {
      comprobar(`${p.nombre} no se quedó en "Cargando…"`, false, limpio.slice(0, 60));
    }

    const archivo = path.join(SALIDA, p.nombre + ".png");
    await pagina.screenshot({ path: archivo, fullPage: true });

    console.log(`      ${path.relative(RAIZ, archivo)}  (${limpio.slice(0, 70)})`);
  }

  /* -------------------------------------------------------------------
     3. Un móvil
     -------------------------------------------------------------------
     Un kiosco se usa en un móvil. No es un detalle: es el caso de uso.
     Lo que se mira es que nada desborde horizontalmente, porque en un
     móvil eso significa que la columna de precios queda fuera de la
     pantalla y el dueño no la ve. */
  console.log("\n── En un móvil (390px) ──\n");

  const movil = await contexto.newPage();
  await movil.setViewportSize({ width: 390, height: 844 });

  for (const p of ["/", "/ventas", "/productos"]) {
    if (filtro) break;
    await movil.goto(BASE + p, { waitUntil: "networkidle" });

    const desborde = await movil.evaluate(() => {
      const d = document.documentElement;
      /* `scrollWidth > clientWidth` en el documento es la forma barata
         de detectar que algo se sale. Y se mide en píxeles de más, que
         es lo que dice el dueño: "se me va de la pantalla". */
      return d.scrollWidth - d.clientWidth;
    });

    comprobar(`${p} no desborda`, desborde <= 2, desborde + "px de más");
  }

  await movil.screenshot({ path: path.join(SALIDA, "movil-ventas.png"), fullPage: true });
  await movil.close();
}

await navegador.close();

console.log("\n" + "═".repeat(54));
console.log(`  Capturas en ${path.relative(RAIZ, SALIDA)}\n`);
if (fallos) {
  console.log(`✗ ${fallos} de ${ok + fallos} fallan.\n`);
  process.exit(1);
}
console.log(`✓ Las ${ok} comprobaciones pasan.\n`);
process.exit(0);