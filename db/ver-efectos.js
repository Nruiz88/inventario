/* Buscar los `useEffect` que se ejecutan en cada render.

   ── POR QUÉ ──

   Un `useEffect` sin array de dependencias se ejecuta después de CADA
   render. En una pantalla que al cargar llama a `pedir`, y `pedir`
   cambia un estado del proveedor, el efecto vuelve a dispararse, el
   estado cambia, hay otro render... y la pantalla se queda en
   "Cargando" para siempre pidiendo la misma cosa.

   ── LAS DOS FORMAS EN QUE ESTA COMPROBACIÓN MINTIÓ ──

   La primera versión partía el fichero por líneas y cortaba al primer
   balancedo de paréntesis. Con `useEffect(cargar, [])` el primer `)` es
   el de `useEffect(`, así que comparaba desde ahí y nunca veía el
   corchete: marcaba los diez de diez.

   La segunda emparejaba bien los paréntesis sobre el fichero entero,
   pero buscaba "la primera coma del contenido" para decidir dónde
   acaban los argumentos. En `resumen` el contenido es:

       pedir<Datos>("/api/resumen").then((r) => { ... });
       /* Sin dependencias a propósito: se pide UNA vez al entrar.
          Con `[pedir]` en la lista, cada render vuelve a pedir...
       }, []);

   La primera coma está dentro del comentario. La herramienta concluded
   que no había array y marcó un efecto que sí lo tiene, con un
   comentario que explica justamente por qué.

   Así que los comentarios se quitan ANTES de mirar nada. Un detector
   que lee el texto que quiere explicar no está midiendo el código.

   ── LO QUE NO COMPRUEBA ──

   Que el efecto tenga array no lo hace correcto. Un array con lo que
   cambia en cada render, o un `cargar` recreado en cada render, siguen
   dando el mismo bucle. Esto marca los que NO tienen array, que es el
   fallo claro, y no certifica los que sí. */
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const CARPETAS = ["src/components", "src/app"];

/** Sustituye por espacios lo que es comentario, para no contarlo. */
function sinComentarios(t) {
  return (
    t
      /* De bloque y de línea, de una pasada. Se conservan los saltos de
         línea para que los números de línea sigan valiendo. */
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length))
  );
}

/** El texto entre el paréntesis de apertura y su pareja. */
function llamada(texto, desde) {
  const abre = texto.indexOf("(", desde);
  if (abre < 0) return null;
  let nivel = 0;
  for (let i = abre; i < texto.length; i++) {
    if (texto[i] === "(") nivel++;
    else if (texto[i] === ")") {
      nivel--;
      if (nivel === 0) return texto.slice(abre + 1, i);
    }
  }
  return null;
}

/**
 * La coma que separa los argumentos de la llamada, ignorando las que
 * están dentro de otro paréntesis, corchete o llave.
 *
 * ── POR QUÉ HACE FALTA ──
 *
 * La versión anterior cogía la primera coma del contenido, y eso
 * marca dos efectos que sí tienen array. No por casualidad: el cuerpo
 * de un `useEffect` es un callback, y un callback lleva comas dentro
 * de sus propias llamadas.
 *
 *     useEffect(() => {
 *       pedir("/api/productos").then((r) => {
 *         plana.push({ id: v.id, nombre: p.nombre, costo: v.costo });
 *       });
 *     }, []);
 *
 * La primera coma es la de `push({ id: …`. La que separa los
 * argumentos de verdad es la última, después del `}, []`.
 *
 * Es la tercera versión de esta función y las tres fallaban por lo
 * mismo: por mirar el texto en lugar de la estructura. Un analizador
 * que no distingue una coma de código de una coma de comentario —o de
 * una coma de dato— no sabe qué está contando.
 */
function comaDeArgumentos(interior) {
  let nivel = 0;
  for (let i = 0; i < interior.length; i++) {
    const c = interior[i];
    if (c === "(" || c === "[" || c === "{") nivel++;
    else if (c === ")" || c === "]" || c === "}") nivel--;
    else if (c === "," && nivel === 0) return i;
  }
  return -1;
}

function walk(dir) {
  const salida = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) salida.push(...walk(p));
    else salida.push(p);
  }
  return salida;
}

let bucles = 0;
let total = 0;

for (const carpeta of CARPETAS) {
  const dir = path.join(RAIZ, carpeta);
  if (!fs.existsSync(dir)) continue;

  for (const archivo of walk(dir)) {
    if (!archivo.endsWith(".tsx")) continue;

    const crudo = fs.readFileSync(archivo, "utf8");
    const limpio = sinComentarios(crudo);
    const relativo = path.relative(RAIZ, archivo);

    for (const m of limpio.matchAll(/useEffect\(/g)) {
      const linea = limpio.slice(0, m.index).split("\n").length;
      const interior = llamada(limpio, m.index);
      if (interior === null) continue;

      total++;

      const coma = comaDeArgumentos(interior);
      const cola = coma < 0 ? "" : interior.slice(coma + 1).trim();
      const tieneArray = cola.startsWith("[");

      if (tieneArray) {
        console.log("  ok     " + relativo.padEnd(34) + " L" + linea);
      } else {
        bucles++;
        console.log("  BUCLE  " + relativo.padEnd(34) + " L" + linea);
        console.log("         " + crudo.split("\n")[linea - 1].trim().slice(0, 74));
      }
    }
  }
}

console.log("");
console.log("  " + total + " efectos, " + bucles + " sin array de dependencias");
if (bucles) {
  console.log("");
  console.log("  Los marcados BUCLE se ejecutan despues de cada render. Si el efecto");
  console.log("  pide datos, se pide una vez y otra vez sin parar, y la pantalla se");
  console.log("  queda en Cargando aunque la respuesta llegue bien.");
}

process.exit(bucles ? 1 : 0);