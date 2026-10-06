/* =========================================================
   Genera un enlace de entrada y lo abre
   ---------------------------------------------------------
   Por qué existe esto, y no basta con `npm run dev:ticket`:

   El ticket dura CINCO MINUTOS y se gasta en cuanto se canjea. Entre
   que el comando imprime el enlace y que alguien pega ese enlace de
   1.300 caracteres en la barra del navegador, se va el tiempo. Cuando
   pasa, el canje responde 401 y sale "ese enlace no vale o ha caducado",
   que parece un problema de sesión y es un problema de reloj.

   Y el mensaje confunde más de lo que ayuda: el que llega tarde tiene
   una sesión perfectamente buena, lo que no tiene es el ticket nuevo.
   Por eso el paso va atado: generar, abrir, entrar.

   Lo que NO hace:
     · no guarda nada en disco (el ticket lleva el access_token de
       Supabase dentro y no tiene por qué quedar en un fichero)
     · no comprueba nada, solo abre. Los avisos los pone el servicio.

   Uso:
     node db/abrir.mjs                # el cliente de la demo
     node db/abrir.mjs --staff        # staff
     node db/abrir.mjs --email otro@x.com
     node db/abrir.mjs --port 3010
   ========================================================= */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const RAIZ = path.resolve(import.meta.dirname, "..");

/* El puerto sale del mismo sitio que el resto, para que no haya que
   acordarse. `PORT` es lo que usa `next dev` cuando no se le pasa -p. */
const argPuerto = process.argv.indexOf("--port");
const PUERTO = argPuerto > -1 ? process.argv[argPuerto + 1] : process.env.PORT || "3010";

/* `dev-ticket.mjs` tiene toda la lógica de firmar y de buscar el
   usuario. Este script solo lo llama y abre lo que devuelve.

   Duplicar la firma sería peor: dos copias del HMAC que tienen que
   coincidir, y la que se desincroniza es la que no se nota. */
const ficha = path.join(os.tmpdir(), `nexo-ticket-${process.pid}.txt`);

const args = [path.join(RAIZ, "db", "dev-ticket.mjs"), "--archivo", ficha];
if (process.argv.includes("--staff")) args.push("--staff");
const iEmail = process.argv.indexOf("--email");
if (iEmail > -1) args.push("--email", process.argv[iEmail + 1]);

let enlace = "";
try {
  execFileSync("node", args, { stdio: ["ignore", "inherit", "inherit"] });
  enlace = fs.readFileSync(ficha, "utf8").trim();
} finally {
  /* Se borra pase lo que pase. El enlace contiene el access_token del
     usuario dentro, y un fichero temporal en el disco es un sitio más
     donde puede quedar. */
  fs.rmSync(ficha, { force: true });
}

if (!enlace) {
  console.error("\n✗ No se pudo generar el enlace. Mira el mensaje de arriba.\n");
  process.exit(1);
}

if (!enlace.includes(":" + PUERTO)) {
  enlace = enlace.replace(/:\d+\/entrar/, ":" + PUERTO + "/entrar");
}

console.log("\n  Abriendo el inventario en el navegador…\n");

/* `start` con un argumento que empieza por `http` se trata como URL.
   En PowerShell hace falta el `""` vacío antes, o `start` lo interpreta
   como título de ventana. Por eso se llama a `cmd` y no a `Start-Process`. */
try {
  execFileSync("cmd", ["/c", "start", "", enlace], { stdio: "ignore" });
  console.log("  ✓ Abierto.");
} catch {
  /* Si el comando del sistema falla, al menos queda el enlace en
     consola para copiarlo a mano. */
  console.log("  No se pudo abrir solo. Copiá este enlace:\n");
  console.log("  " + enlace + "\n");
}

console.log("  El enlace vive 90 minutos. Si al entrar dice que no vale,");
console.log("  volvé a correr este comando: se genera uno nuevo.\n");
console.log("  Una vez dentro, la sesión dura 4 horas.\n");

process.exit(0);