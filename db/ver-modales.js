/* Comprobar los cuatro modales de productos: que abren, que se
 * cierran y que guardan.
 *
 * ── POR QUÉ ──
 *
 * Los modales se han sacado de `productos.tsx` a `productos-form.tsx`
 * sin cambiar lo que hacen. Un cambio de fichero no tiene por qué
 * cambiar el comportamiento, y eso es justo lo que hay que comprobar:
 * si un modal deja de guardar y nadie lo nota hasta que el dueño está
 * en el mostrador, el arreglo ha sido un retroceso.
 *
 * Lo que hace, en la página de verdad:
 *
 *   1. Abrir «Nuevo producto», escribir y guardar. Tiene que aparecer
 *      en la lista y el contador tiene que subir en uno.
 *   2. Abrir «Editar» sobre uno que existe y cerrarlo con «Cancelar»:
 *      no debe cambiar nada.
 *   3. Abrir «Mover», comprobar que la previsión se mueve con la
 *      cantidad y que «Anotar» está apagado sin motivo.
 *   4. Cerrar con el aspa y con el fondo, y comprobar que el Escape
 *      también cierra.
 */
const { execFileSync } = require("child_process");
const { createRequire } = require("module");
const path = require("path");

const req = createRequire("file:///D:/webs/inventario/capturar.js");
const BASE = process.env.BASE || "http://localhost:3010";

let fallos = 0;

/* El nombre del producto de prueba, en una constante y no repetido.
   Es el que se busca para borrar y el que se comprueba en la lista: si
   se escribiera dos veces y una cambiara, el script dejaría un producto
   «Prueba de modal» en la base y no sabría por qué. */
const NOMBRE = "Prueba de modal";

function comprobar(ok, texto) {
  console.log("  " + (ok ? "ok   " : "FALLA") + "  " + texto);
  if (!ok) fallos++;
}

const espera = (p, ms) => p.waitForTimeout(ms ?? 300);

/** Espera a que una condición sea cierta, en vez de esperar una cuenta
 *  de milisegundos.
 *
 *  ── POR QUÉ ──
 *
 *  El alta tarda lo que tarda la API y no lo que se supone: en la
 *  primera versión el script esperaba 700 ms y fallaba la mitad de las
 *  veces, porque la fila aparece entre 300 y 800 ms según lo que haya
 *  hecho la conexión antes. Un plazo fijo convierte una prueba en una
 *  lotería y, cuando falla, señala al sitio equivocado.
 *
 *  La alternativa —esperar hasta que se cumpla o hasta un tope— es lo
 *  que distingue «tardó» de «no pasó». El tope está porque si la
 *  condición no se cumple nunca, hay que decir que no se cumplió en vez
 *  de quedarse esperando. */
async function hasta(pagina, condicion, ms = 15000, arg) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await pagina.evaluate(condicion, arg)) return true;
    await pagina.waitForTimeout(200);
  }
  return false;
}

async function main() {
  const salidaTicket = execFileSync("node", ["db/dev-ticket.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1 << 24,
  });
  const ticket = (salidaTicket.match(/http:\/\/\S+#ticket=\S+/) || [])[0].split("#ticket=")[1].trim();

  const { chromium } = req("D:/webs/wweb/node_modules/playwright");
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 1100 } });
  const pagina = await ctx.newPage();

  const errores = [];
  pagina.on("pageerror", (e) => errores.push(e.message.slice(0, 100)));

  await pagina.goto(BASE + "/entrar#ticket=" + ticket, { waitUntil: "domcontentloaded" });
  await pagina.waitForTimeout(2500);
  await pagina.goto(BASE + "/productos", { waitUntil: "domcontentloaded" });
  await pagina.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await espera(pagina, 400);

  const filas = () => pagina.evaluate(() => document.querySelectorAll("tbody tr").length);
  const abierto = () =>
    pagina.evaluate(() => !!document.querySelector('div[style*="z-index: 200"]'));

  /* ── Limpiar lo que hayan dejado las corridas anteriores ──

   El script borra su producto al final, pero una corrida que falla a
   mitad se lo deja. Y la segunda corrida se encuentra con un producto
   más y falla por el motivo equivocado, que es la peor forma de
   fallar: el aviso señala a la parte que está bien.

   Por eso antes de contar nada se llama a `db/limpiar-prueba-productos.js`,
   y no se intenta por la API.

   La razón es la regla de la propia API, que está a propósito: un
   producto con movimientos no se borra, se DESACTIVA. Y un producto
   creado con stock genera un movimiento de entrada, así que pedírselo
   a la API con `borrar: true` lo deja ahí, como una fila inactiva, y
   la cuenta de filas no cuadra. Ese script borra los movimientos antes
   que las variantes, que es el orden que impone la clave ajena.

   Y no se llama a `limpiar-demo.js`, que también sabe ese orden pero
   además se lleva el kiosco de ejemplo entero: estas pruebas necesitan
   los datos del demo, porque «Mover» se comprueba sobre un producto que
   tiene stock. */
  try {
    const salida = execFileSync("node", [path.join(__dirname, "limpiar-prueba-productos.js")], {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const linea = (salida || "").trim().split("\n").pop();
    if (linea) console.log("  (" + linea.trim() + ")");
  } catch (e) {
    console.log("  *** no se pudo limpiar la base: " + (e.stderr || e.message || "").toString().trim());
    process.exit(1);
  }

  await pagina.reload({ waitUntil: "domcontentloaded" });
  await pagina.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await espera(pagina, 500);

  const antes = await filas();

  /* ── 1. Alta ── */
  await pagina.click('button:has-text("Nuevo producto")');
  await espera(pagina);
  comprobar(await abierto(), "«Nuevo producto» abre una capa");

  const nombre = NOMBRE;
  await pagina.fill('div[style*="z-index: 200"] input >> nth=0', nombre);
  await pagina.fill('div[style*="z-index: 200"] input >> nth=1', "Modal");

  /* Las filas de presentación empiezan por el nombre de la
     presentación. Es el campo que decide si hay alta o no: sin él, la
     API borra el producto y devuelve un error. */
  /* Los campos, por el orden en que están en el formulario: nombre del
     producto, categoría, y luego una fila por presentación con nombre,
     SKU, venta, costo, stock y mínimo. */
  const campos = pagina.locator('div[style*="z-index: 200"] input');
  const cuantos = await campos.count();
  /* Nombre, categoría, y seis por presentación: nombre, SKU, venta,
     costo, stock y mínimo. Con una presentación son ocho. */
  comprobar(cuantos === 8, "el formulario tiene nombre, categoría y los seis campos de la presentación (" + cuantos + ")");

  await campos.nth(2).fill("unidad");
  await campos.nth(3).fill("MODAL1");
  /* El stock a cero, a propósito.

     Un producto creado con stock genera un movimiento de entrada, y
     un producto con movimientos no se borra: se DESACTIVA. Con eso el
     producto de prueba se quedaba en la base entre corrida y corrida,
     como una fila inactiva, y la cuenta de filas de esta corrida no
     cuadraba por un motivo que no era del listado.

     Con el stock a cero no hay movimiento, y `borrar: true` sí lo
     borra. La comprobación del campo de stock, que sí importa, se hace
     en la fila del `demo`, donde el stock ya viene de la semilla. */
  await campos.nth(4).fill("10");
  await campos.nth(5).fill("6");
  await campos.nth(6).fill("0");
  await campos.nth(7).fill("2");

  await pagina.click('div[style*="z-index: 200"] button:has-text("Crear producto")');

  /* Se espera a que la fila esté, no a que pase un rato. */
  const salio = await hasta(pagina, (n) => document.body.innerText.includes(n), 20000, nombre);
  comprobar(salio, "el nombre escrito aparece en la lista");

  const cerrada = await hasta(pagina, () => !document.querySelector('div[style*="z-index: 200"]'), 10000);
  comprobar(cerrada, "el alta cierra la capa al guardar");
  comprobar((await filas()) === antes + 1, `aparece la fila nueva (${antes} -> ${await filas()})`);

  /* ── 2. Editar y cancelar ──
     Editar sobre la fila del producto nuevo, para no tocar los datos
     `[demo]` de la semilla. */
  await pagina.click(`tbody tr:has-text("${nombre}") button:has-text("Editar")`);
  await espera(pagina);
  comprobar(await abierto(), "«Editar» abre una capa");

  const nombreEnElFormulario = await pagina.inputValue(
    'div[style*="z-index: 200"] input >> nth=0'
  );
  comprobar(
    nombreEnElFormulario === nombre,
    `el formulario de editar viene con el nombre («${nombreEnElFormulario}»)`
  );

  await pagina.click('div[style*="z-index: 200"] button:has-text("Cancelar")');
  await espera(pagina);
  comprobar(!(await abierto()), "«Cancelar» cierra sin guardar");
  comprobar((await filas()) === antes + 1, "no se ha creado ni perdido ninguna fila");

  /* ── 3. Mover stock ──

     Se hace sobre una fila del `[demo]` y no sobre la del producto de
     prueba, por una razón concreta: el producto de prueba se crea con
     stock cero para que se pueda borrar, y con stock cero la previsión
     de una merma de una unidad es negativa. Saldría el aviso de «no se
     puede» en vez de la previsión, y la comprobación pasaría por
     casualidad o fallaría por un motivo que no es el del código.

     Con una fila que tiene stock de verdad, la previsión es una cuenta
     normal: 44 menos 1 son 43. */
  const CON_STOCK = "Agua mineral";

  await pagina.click(`tbody tr:has-text("${CON_STOCK}") button:has-text("Mover")`);
  await espera(pagina);
  comprobar(await abierto(), "«Mover» abre una capa");

  /* El stock que dice el diálogo, para comprobar la cuenta con el
     número que hay y no con uno supuesto. */
  const ahora = await pagina.evaluate(() => {
    const t = document.querySelector('div[style*="z-index: 200"]')?.innerText || "";
    const m = t.match(/Ahora hay (\d+)/);
    return m ? Number(m[1]) : NaN;
  });
  comprobar(Number.isFinite(ahora), `el diálogo dice el stock que hay (${ahora})`);

  const prevista = await pagina.evaluate(() => {
    const t = document.querySelector('div[style*="z-index: 200"]')?.innerText || "";
    const m = t.match(/Quedará en (\d+)/);
    return m ? Number(m[1]) : NaN;
  });
  comprobar(prevista === ahora - 1, `la previsión de una merma de 1 sobre ${ahora} es ${ahora - 1} (dice ${prevista})`);

  /* Sin motivo, el botón de anotar tiene que estar apagado: el motivo
     es obligatorio en la API y sin él el error llega después de
     pulsar. */
  const apagado = await pagina.isDisabled('div[style*="z-index: 200"] button:has-text("Anotar")');
  comprobar(apagado, "sin motivo, «Anotar» está apagado");

  /* Con una cantidad mayor que el stock, la previsión avisa y sigue
     apagado. El campo se busca por la etiqueta y no por la posición:
     el índice se movería con cada campo que se añadiera al formulario. */
  await pagina.getByLabel("Cuántas").fill("9999");
  await espera(pagina);
  const conAviso = (await pagina.innerText('div[style*="z-index: 200"]')) || "";
  comprobar(/no se puede/i.test(conAviso), "una cantidad imposible avisa antes de guardar");
  comprobar(
    await pagina.isDisabled('div[style*="z-index: 200"] button:has-text("Anotar")'),
    "una cantidad imposible deja «Anotar» apagado"
  );

  await pagina.keyboard.press("Escape");
  await espera(pagina);
  comprobar(!(await abierto()), "la tecla Escape cierra el modal");

  /* ── 4. El fondo y el aspa ── */
  await pagina.click(`tbody tr:has-text("${CON_STOCK}") button:has-text("Mover")`);
  await espera(pagina);

  /* Tocar DENTRO no puede cerrar: si cerrara, cada toque para escribir
     un motivo perdería lo escrito. */
  await pagina.getByLabel("Cuántas").click();
  await espera(pagina, 150);
  comprobar(await abierto(), "tocar dentro del formulario no lo cierra");

  /* Tocar FUERA sí cierra. */
  await pagina.mouse.click(20, 300);
  await espera(pagina);
  comprobar(!(await abierto()), "tocar en el fondo cierra");

  /* ── Limpiar lo que se ha creado ──
     Por el mismo script del principio, por el mismo motivo: la API
     desactivaría el producto en vez de borrarlo.

     Y esta limpieza no es opcional: si el script termina antes, el
     producto se queda y la siguiente corrida falla por su culpa. Por
     eso va después del último `comprobar` y no antes, y por eso el
     fallo se cuenta: si no se pudo limpiar, la corrida no está bien. */
  let borrado = "no se ha limpiado";
  try {
    const salida = execFileSync("node", [path.join(__dirname, "limpiar-prueba-productos.js")], {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    borrado = (salida || "").trim();
  } catch (e) {
    borrado = "no se pudo: " + (e.stderr || e.message || "").toString().trim();
  }
  comprobar(/1 producto/.test(borrado), "el producto de prueba se ha borrado (" + borrado + ")");

  comprobar(!errores.length, "sin errores de página" + (errores.length ? ": " + errores[0] : ""));

  await navegador.close();

  console.log("");
  console.log(fallos ? "  " + fallos + " fallos" : "  los cuatro modales funcionan");
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.log("  *** " + e.message);
  process.exit(1);
});