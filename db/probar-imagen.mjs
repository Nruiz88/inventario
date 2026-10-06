/* =========================================================
   ¿El ARTEFACTO de Docker funciona?
   ---------------------------------------------------------
   Compila, monta lo que el Dockerfile copia, y arranca el bundle con
   las MISMAS variables que lleva el contenedor. Después entra y llama a
   la API con una sesión de verdad.

   Es distinto de `db/mirar.mjs`, que prueba contra el servidor de
   desarrollo. Este prueba el bundle: lo que de verdad se despliega.

   Por qué importa: `output: "standalone"` produce un `server.js` que
   lleva su propia copia de las dependencias. Una app que funciona en
   `next dev` y revienta en el contenedor es el fallo más caro que hay,
   y no lo detecta ni el build ni los tests: los dos corren en un
   entorno que tiene `node_modules` completo.

   Lo que se encontró aquí: el standalone se montó y arrancó sin
  -modules`, y eso NO es un fallo. Las dependencias que se importan en
   código de servidor van Empaquetadas dentro de `.next/server`, y las
   de `node_modules` son solo para los `require` en runtime que el
   empaquetador no pudo resolver. Por eso `pg` tampoco está, y eso sí es
   lo correcto: `pg` solo lo usan las migraciones, que no corren en el
   contenedor.

   Uso:
     node db/probar-imagen.mjs [--base http://127.0.0.1:3099]
*/

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";

const RAIZ = path.resolve(import.meta.dirname, "..");

const argBase = process.argv.indexOf("--base");
const BASE =
  argBase > -1 ? process.argv[argBase + 1] : `http://127.0.0.1:${PUERTO()}`;

function PUERTO() {
  return process.env.PUERTO_IMAGEN || 3099;
}

let ok = 0;
let fallos = 0;
const comprobar = (txt, cond, extra) => {
  console.log(`  ${cond ? "✓" : "✗"} ${txt}${extra ? "  → " + extra : ""}`);
  cond ? ok++ : fallos++;
};

/* ---------------------------------------------------------------------
   El montaje, como el Dockerfile
   --------------------------------------------------------------------- */
console.log("\n═══ El artefacto que se despliega ═══\n");

const DESTINO = path.join(RAIZ, "_imagen");

console.log("── Montando ──\n");

if (!fs.existsSync(path.join(RAIZ, ".next", "standalone", "server.js"))) {
  console.log("  ✗ No hay build. Corré `npm run build` primero.\n");
  process.exit(1);
}

comprobar("existe .next/standalone/server.js", true);

fs.rmSync(DESTINO, { recursive: true, force: true });
fs.mkdirSync(DESTINO, { recursive: true });

/* Las cuatro copias del runner, en el mismo orden. */
fs.cpSync(path.join(RAIZ, ".next", "standalone"), DESTINO, { recursive: true });
fs.mkdirSync(path.join(DESTINO, ".next"), { recursive: true });
fs.cpSync(path.join(RAIZ, ".next", "static"), path.join(DESTINO, ".next", "static"), {
  recursive: true,
});
fs.cpSync(path.join(RAIZ, "public"), path.join(DESTINO, "public"), { recursive: true });

comprobar("copiado standalone, static y public", true);

/* Lo que el `.dockerignore` saca. Si algo de esto estuviera, el
   contenedor lo tendría y no debería.

   Y el `node_modules` se comprueba de una forma menos ingenua. El
   standalone SÍ lleva un `node_modules` recortado —Next pone ahí solo
   lo que hace falta en runtime—, así que comprobar que no exista da
   falso: la primera versión de esta comprobación falló por eso.

   Lo que tiene que faltar son las devDependencies. `typescript` es la
   que importa, porque es la que corre el typecheck del build: si
   llegara a la imagen final, la imagen sería cuatro veces más grande
   para nada. */
for (const fuera of [".env.local", "capturas", "db/demo-kiosco.mjs"]) {
  comprobar(`no está ${fuera} en el montaje`, !fs.existsSync(path.join(DESTINO, fuera)));
}

const tieneTs = fs.existsSync(path.join(DESTINO, "node_modules", "typescript"));
comprobar("no hay devDependencies (typescript) en el montaje", !tieneTs);

const conSupabase = fs.existsSync(path.join(DESTINO, "node_modules", "@supabase"));
comprobar(
  "y el standalone no trae @supabase en node_modules",
  !conSupabase,
  conSupabase
    ? "está: se empaquetó aparte"
    : "va empaquetado en .next/server, que es lo correcto"
);

/* ---------------------------------------------------------------------
   Las variables del contenedor
   ---------------------------------------------------------------------
   Se lee el `.env.local` y se pasa al proceso. Es lo que Coolify hace:
   el fichero no viaja, las variables sí.

   Y se comprueba algo importante: que NO esté `DATABASE_URL`. Esa lleva
   la contraseña de la base y no la usa la aplicación; si llegara al
   contenedor, sería un secreto en un sitio donde antes no estaba. */
console.log("\n── Variables ──\n");

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

const local = leerEnv(path.join(RAIZ, ".env.local"));

/* Solo las siete que van al contenedor. */
const AL_CONTENEDOR = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SERVICE_SECRET",
  "BUSINESS_TIMEZONE",
  "APP_URL",
  "NEXT_PUBLIC_PANEL_URL",
];

for (const k of AL_CONTENEDOR) {
  comprobar(`${k} está`, Boolean(local[k]), local[k] ? local[k].length + " chars" : "FALTA");
}

comprobar(
  "DATABASE_URL NO va al contenedor",
  !("DATABASE_URL" in { ...Object.fromEntries(AL_CONTENEDOR.map((k) => [k, 1])) }),
  "solo la usan las migraciones"
);

/* ---------------------------------------------------------------------
   Arrancar
   --------------------------------------------------------------------- */
console.log("\n── Arrancando ──\n");

const env = {
  PATH: process.env.PATH,
  NODE_ENV: "production",
  PORT: String(PUERTO()),
  HOSTNAME: "0.0.0.0",
  ...Object.fromEntries(AL_CONTENEDOR.map((k) => [k, local[k] || ""])),
};

const hijo = spawn(process.execPath, ["server.js"], {
  cwd: DESTINO,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

let salida = "";
hijo.stdout.on("data", (d) => (salida += d.toString()));
hijo.stderr.on("data", (d) => (salida += d.toString()));

/* Esperar a que escuche. */
let listens = false;
for (let i = 0; i < 40; i++) {
  listens = await new Promise((res) => {
    const req = http.get(BASE + "/entrar", (r) => {
      r.resume();
      res(true);
    });
    req.on("error", () => res(false));
    req.setTimeout(1500, () => {
      req.destroy();
      res(false);
    });
  });
  if (listens) break;
  await new Promise((r) => setTimeout(r, 500));
}

comprobar("arranca y escucha", listens, listens ? BASE : "no escucha");
comprobar("no tira al arrancar", !/Error|Cannot find module/i.test(salida), salida.slice(0, 90));

if (!listens) {
  console.log("\n  ── Salida ──\n");
  console.log(salida.split("\n").slice(0, 20).map((l) => "  " + l).join("\n"));
  hijo.kill();
  process.exit(1);
}

/* ---------------------------------------------------------------------
   La prueba que importa: entrar y leer datos
   --------------------------------------------------------------------- */
console.log("\n── Con sesión de verdad ──\n");

const ficha = path.join(os.tmpdir(), `nexo-imagen-${process.pid}.txt`);
let cookie = "";

try {
  execFileSync("node", [path.join(RAIZ, "db", "dev-ticket.mjs"), "--archivo", ficha], {
    stdio: "ignore",
    env: { ...process.env },
  });
  const enlace = fs.readFileSync(ficha, "utf8").trim();
  const ticket = enlace.split("#ticket=")[1] || "";

  const r = await fetch(BASE + "/api/entrar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  const sc = r.headers.get("set-cookie") || "";
  cookie = sc
    .split(/,(?=\s*[^;=]+=)/)
    .map((c) => c.trim().split(";")[0])
    .join("; ");

  comprobar("el canje responde 200", r.status === 200, "HTTP " + r.status);
  comprobar("y pone la cookie", cookie.includes("inv_sesion"), cookie ? "inv_sesion presente" : "no");
} finally {
  fs.rmSync(ficha, { force: true });
}

const H = { "Content-Type": "application/json", Cookie: cookie };

const resumen = await fetch(BASE + "/api/resumen", { headers: H });
const rResumen = await resumen.json();
comprobar("/api/resumen responde 200", resumen.status === 200, "HTTP " + resumen.status);
comprobar(
  "y lee la base de verdad",
  Array.isArray(rResumen.data?.stock?.lista),
  (rResumen.data?.stock?.total ?? "?") + " presentaciones"
);

const prods = await fetch(BASE + "/api/productos", { headers: H });
const rProds = await prods.json();
comprobar("/api/productos responde 200", prods.status === 200, (rProds.data || []).length + " productos");

/* El proxy, que es lo único que no se prueba por API. */
const raiz = await fetch(BASE + "/", { headers: H, redirect: "manual" });
comprobar("/ responde 200 con sesión", raiz.status === 200, "HTTP " + raiz.status);

/* Y sin sesión, que tiene que ser 401 y no un 500. */
const sin = await fetch(BASE + "/api/resumen");
comprobar("sin sesión responde 401", sin.status === 401, "HTTP " + sin.status);

/* --------------------------------------------------------------------- */
hijo.kill();
await new Promise((r) => setTimeout(r, 500));

console.log("\n" + "═".repeat(54));
console.log("  Para repetirlo:\n");
console.log("    npm run test:imagen\n");

if (fallos) {
  console.log(`✗ ${fallos} de ${ok + fallos} fallan.\n`);
  process.exit(1);
}
console.log(`✓ Las ${ok} comprobaciones pasan. El artefacto de Docker funciona.\n`);
process.exit(0);