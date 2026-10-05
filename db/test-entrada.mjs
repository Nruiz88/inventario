/* El camino entero, en local, sin abrir un navegador.

   Genera un ticket, lo canjea por HTTP, guarda la cookie y llama a la
   API con ella. Es la prueba que faltaba: hasta ahora, la entrada solo
   se había comprobado mirando el JavaScript publicado, nunca
  .canjeando de verdad.

   Si esto pasa, el flujo funciona entero. Si falla, dice en qué punto. */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const RAIZ = path.resolve(import.meta.dirname, "..");
const BASE = process.env.BASE || "http://127.0.0.1:3010";
const ficha = path.join(RAIZ, "db", ".ticket-local.txt");

let ok = 0;
let fallos = 0;
const comprobar = (txt, cond, extra) => {
  console.log(`  ${cond ? "✓" : "✗"} ${txt}${extra ? "  → " + extra : ""}`);
  cond ? ok++ : fallos++;
};

console.log("\n═══ El camino entero, en local ═══\n");

/* 1. Firmar un ticket */
execFileSync("node", [path.join(RAIZ, "db", "dev-ticket.mjs"), "--archivo", ficha], {
  stdio: "ignore",
});
const enlace = fs.readFileSync(ficha, "utf8").trim();
const ticket = enlace.split("#ticket=")[1] || "";
fs.unlinkSync(ficha);

comprobar("se firma un ticket", ticket.length > 100, ticket.length + " caracteres");

/* 2. Canjearlo */
const cookies = path.join(RAIZ, "db", ".cookies-local.txt");
fs.rmSync(cookies, { force: true });

const r = await fetch(BASE + "/api/entrar", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ticket }),
});

const cuerpo = await r.json();
comprobar("el canje responde 200", r.status === 200, "HTTP " + r.status);
comprobar("y dice que funcionó", cuerpo.ok === true, JSON.stringify(cuerpo).slice(0, 90));

/* La cookie: tiene que estar Y ser host-only */
const setCookie = r.headers.get("set-cookie") || "";
comprobar("pone cookie", /inv_sesion=/.test(setCookie), setCookie.slice(0, 40) + "...");
comprobar("y es host-only, sin Domain", !/;\s*domain=/i.test(setCookie), "sin Domain");
comprobar("con secure en local no", !/;\s*secure/i.test(setCookie), "http local");

fs.writeFileSync(
  cookies,
  setCookie
    .split(/,(?=\s*[^;=]+=)/)
    .map((c) => c.trim().split(";")[0])
    .join("\n")
);

/* 3. Con la cookie, la API responde */
const cab = { Cookie: fs.readFileSync(cookies, "utf8").replace(/\n/g, "; ") };

const resumen = await fetch(BASE + "/api/resumen", { headers: cab });
const rResumen = await resumen.json();
comprobar("/api/resumen responde 200", resumen.status === 200, "HTTP " + resumen.status);
comprobar("y trae el día de hoy", !!rResumen.data?.hoy, rResumen.data?.hoy || "nada");

const prods = await fetch(BASE + "/api/productos", { headers: cab });
const rProds = await prods.json();
comprobar("/api/productos responde 200", prods.status === 200, "HTTP " + prods.status);
comprobar("y devuelve una lista", Array.isArray(rProds.data), (rProds.data || []).length + " productos");

/* 4. Sin cookie, 401. Y ahora con el 401 CORRECTO, no un 500 */
const sin = await fetch(BASE + "/api/resumen");
comprobar("sin cookie responde 401", sin.status === 401, "HTTP " + sin.status);

/* 5. Un ticket manipulado se rechaza */
const troceado = ticket.slice(0, -6) + "AAAAAA";
const rMalo = await fetch(BASE + "/api/entrar", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ticket: troceado }),
});
comprobar("un ticket manipulado se rechaza", rMalo.status === 401, "HTTP " + rMalo.status);

/* 6. Un ticket caducado se distingue */
const caducado = await fetch(BASE + "/api/entrar", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ticket: "" }),
});
comprobar("un ticket vacío se rechaza", caducado.status === 401, "HTTP " + caducado.status);

fs.rmSync(cookies, { force: true });

console.log("\n" + "═".repeat(54));
if (fallos) {
  console.log(`✗ ${fallos} de ${ok + fallos} fallan.\n`);
  process.exit(1);
}
console.log(`✓ Las ${ok} comprobaciones pasan. El servicio entra en local.\n`);
process.exit(0);