/* Normalizar los finales de línea.

   ── POR QUÉ ESTE SCRIPT EXISTE ──

   `src/app/api/resumen/route.ts` tenía 56 líneas terminadas en CRLF y
   281 en LF. El editor de texto no encuentra un bloque porque el texto
   que se le pasa tiene un `CR` donde el fichero no lo tiene, y el
   error que dice —"no encuentro esta cadena"— no menciona los finales
   de línea. Se pierde un rato buscando un espacio de más.

   Los LF se colaron porque los scripts quedoo patchear este repositorio
   escriben `\n` sobre ficheros que en el checkout tienen `\r\n`, que es
   lo que deja `core.autocrlf` en Windows.

   ── POR QUÉ LF Y NO CRLF ──

   Porque es lo que hay en el repositorio: git guarda LF y el checkout
   escribe CRLF. Un fichero con las dos cosas tiene la mitad de sus
   líneas con una marca invisible al final, y esa marca aparece en los
   `git diff` como un cambio entero.

   ── LO QUE HACE ──

   Nada Creative: quita los `\r` que sobran. Y solo a ficheros de texto
   del proyecto, nunca a lo que hay en `node_modules` ni a las capturas,
   que son binarios. */
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");

const IGNORAR = new Set([
  "node_modules",
  ".git",
  ".next",
  "capturas",
  "_prueba",
  "_imagen",
  "public",
]);

const EXT = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".css", ".json", ".sql", ".md"];

function recorrer(dir) {
  const salida = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) salida.push(...recorrer(p));
    else if (EXT.includes(path.extname(e.name))) salida.push(p);
  }
  return salida;
}

let arreglados = 0;

for (const f of recorrer(RAIZ)) {
  const antes = fs.readFileSync(f);

  /* Un `\0` dentro significa que el fichero no es texto. No se toca. */
  if (antes.includes(0)) continue;

  const texto = antes.toString("utf8");
  if (!/\r\n/.test(texto)) continue;

  const limpio = texto.replace(/\r\n/g, "\n");
  fs.writeFileSync(f, limpio, "utf8");

  const n = (texto.match(/\r\n/g) || []).length;
  console.log("  " + path.relative(RAIZ, f).padEnd(42) + n + " lineas");
  arreglados++;
}

console.log("");
console.log(arreglados
  ? "  " + arreglados + " ficheros normalizados a LF"
  : "  no habia ficheros con finales mezclados");