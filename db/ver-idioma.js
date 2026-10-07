/* Buscar texto que no es castellano.
 *
 * ── POR QUÉ ESTÁ AQUÍ Y NO SÓLO EN EL OTRO REPO ──
 *
 * Porque se coló cuatro veces en una sola tarde, y no en ficheros
 * viejos: en comentarios que se estaban escribiendo para este trabajo.
 *
 *   · "benefitа" y "unCOLUMNAS" y "cambiarOU", con cirílico dentro de
 *     comentarios nuevos de un repositorio que ya tenía el aviso.
 *   · "阁" en mitad de un párrafo sobre botones rojos.
 *   · "cambiarOU" otra vez, y "dos_significa", y "Se#+ve".
 *   · "unfollowed-up" donde iba "un cobro pendiente".
 *
 * Ninguna lapillars un error: el fichero compila, la página responde
 * 200 y las pruebas pasan. Solo se ve leyendo, y solo si la frase
 * resulta rara. "Raro" no es un filtro fiable — las cuatro veces las
 * escribió quien ya sabía que el problema existía.
 *
 * ── POR QUÉ SE SALTA A SÍ MISMO ──
 *
 * La lista de alfabetos son letras de esos alfabetos. Un detector que
 * se aplica a sí mismo se acusa a sí mismo, y las dos salidas son malas:
 * borrar las letras y dejar de detectar el cirílico, o dejarlas y
 * silenciar el aviso cada vez que se ejecuta.
 *
 * ── LO QUE NO CUENTA COMO ERROR ──
 *
 * Los acentos y la eñe, la raya de caja, el guion largo, la flecha y
 * los palitos de las tablas ASCII se usan a diario en los comentarios y
 * no son un idioma. Por eso los alfabetos se nombran uno a uno en vez
 * de marcar "todo lo que no sea ASCII", que daría medio fichero.
 */
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");

const ALFABETOS = [
  { nombre: "cirílico", patron: "[\\u0400-\\u04ff]" },
  { nombre: "griego", patron: "[\\u0370-\\u03ff]" },
  { nombre: "hebreo", patron: "[\\u0530-\\u058f]" },
  { nombre: "árabe", patron: "[\\u0600-\\u06ff]" },
  { nombre: "devanagari", patron: "[\\u0900-\\u097f]" },
  { nombre: "chino", patron: "[\\u2e80-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef]" },

  /* El coreano y el japonés, añadidos después de que se colara un
     «여기» —un Hangul de.coreano— dentro de un párrafo sobre la tecla
     `Esc`, y porque la lista se había quedado corta: los seis
     alfabetos de arriba son los que se cuentan en el mundo, no los que
     se pueden teclear.

     Elkana va con el chino porque comparte el rango de Extensión A y
     el de medio ancho, pero por si acaso va en su propia entrada con su
     propio nombre: quien lo vea en un aviso sabe de una qué ha pasado.

     Esto es lo que avisa la regla 1 del `ENTREGA.md`: que el filtro
     tenga la lista que le conviene a quien lo escribió es la forma
     más discreta de que el filtro no sirva. */
  { nombre: "coreano", patron: "[\\uac00-\\ud7af\\u1100-\\u11ff\\u3130-\\u318f]" },
  { nombre: "japonés", patron: "[\\u3040-\\u30ff]" },
];

/* El símbolo de reemplazo: indica que algo se leyó con otra codificación
 * y una letra se perdió. Con la misma razón que los alfabetos, es un
 * aviso aparte y no "otro idioma". */
const REEMPLAZO = "\\ufffd";

const EXT = [".tsx", ".ts", ".js", ".mjs", ".cjs", ".css", ".json", ".sql", ".md"];

const YO = path.basename(__filename);

const IGNORAR = new Set(["node_modules", ".git", ".next", "capturas", "_prueba", "_imagen"]);

function recorrer(dir) {
  const salida = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) salida.push(...recorrer(p));
    else if (EXT.includes(path.extname(e.name)) && e.name !== YO) salida.push(p);
  }
  return salida;
}

function revisar(ruta) {
  const texto = fs.readFileSync(ruta, "utf8");
  const fallos = [];

  texto.split(/\r?\n/).forEach((linea, i) => {
    for (const a of ALFABETOS) {
      const re = new RegExp(a.patron + "+", "g");
      const hallados = linea.match(re);
      if (!hallados) continue;
      const codes = [...new Set(hallados)]
        .map((c) => "U+" + c.charCodeAt(0).toString(16).toUpperCase())
        .join(" ");
      fallos.push({ linea: i + 1, alfabeto: a.nombre, codes, texto: linea.trim().slice(0, 96) });
    }
    if (linea.includes(REEMPLAZO)) {
      const n = (linea.match(new RegExp(REEMPLAZO, "g")) || []).length;
      fallos.push({ linea: i + 1, alfabeto: "reemplazo", codes: "U+FFFD x" + n, texto: linea.trim().slice(0, 96) });
    }
  });

  return fallos;
}

module.exports = { recorrer, revisar };

if (require.main === module) {
  const ficheros = recorrer(RAIZ);
  let total = 0;

  for (const f of ficheros) {
    const fallos = revisar(f);
    if (!fallos.length) continue;
    total += fallos.length;
    console.log("  " + path.relative(RAIZ, f));
    for (const x of fallos) {
      console.log("    L" + x.linea + "  [" + x.alfabeto + "]  " + x.codes);
      console.log("        " + x.texto);
    }
  }

  console.log("");
  console.log("  " + ficheros.length + " ficheros revisados, " + total + " lineas con texto extranjero");
  if (total) {
    console.log("  Esto no rompe nada: el fichero compila y la pagina responde 200.");
    console.log("  Solo se ve leyendo, y solo si la frase resulta rara.");
  }
  process.exit(total ? 1 : 0);
}