/* Capturar todas las pantallas del inventario, con datos dentro.

   ── POR QUÉ HACE FALTA ──

   Las capturas que había en `capturas/` están hechas con la base vacía:
   diez ceros y "No hay productos". Con eso no se puede juzgar nada. Una
   tabla con veinte columnas se ve bien con veinte filas y con cero no se
   ve.

   ── POR QUÉ ESTE SCRIPT MIDÓ MAL LA PRIMERA VEZ ──

   Contaba las filas con `document.querySelectorAll("tbody tr")`, que
   da cero en todas las pantallas. Y no porque estén vacías: el listado
   de productos no es una tabla, es una rejilla de divs. Con seis
   productos en pantalla, el contador decía cero.

   Un contador que dice "no hay datos" cuando hay seis es peor que no
   medir, porque además parece una afirmación sobre el estado. Ahora se
   cuentan las filas por las dos vías y se queda la mayor, y se cuenta
   también cuántos números hay en pantalla, que es lo único que no
   depende de cómo esté construido el listado.

   ── LO QUE SE MIDE, Y POR QUÉ NO ES ESTÉTICA ──

   · Objetivos táctiles por debajo de 32 px. En un mostrador se usa
     con el dedo y con una mano ocupada. Un botón de 24 px falla
     cuando estás apurado, que es cuando más se usa.

   · Desborde horizontal. Un inventario se mira en un móvil colgado al
     lado de la caja: una fila con venta, coste, stock, mínimo y tres
     acciones no cabe en 390 px, y lo que hay que decidir es qué se
     oculta, no si se estira.

   · Tablas más anchas que su contenedor: es como se nota que una
     columna no cabe.

   ── CÓMO ENTRAR ──

   Se pide un ticket a `db/dev-ticket.mjs`, que firma uno de verdad y
   tiene una sesión real detrás. No se pone la cookie a mano: esa es la
   mitad del camino que no se prueba, y es justo la que se rompió una
   vez en el bot sin que ninguna prueba lo notara. */
const fs = require("fs");
const { execFileSync } = require("child_process");
const { createRequire } = require("module");

const req = createRequire("file:///D:/webs/inventario/capturar.js");
const BASE = process.env.BASE || "http://localhost:3010";
const CARPETA = process.env.SALIDA || "capturas/antes";

const PANTALLAS = [
  { ruta: "/", nombre: "resumen" },
  { ruta: "/ventas", nombre: "ventas" },
  { ruta: "/productos", nombre: "productos" },
  { ruta: "/compras", nombre: "compras" },
  { ruta: "/caja", nombre: "caja" },
  { ruta: "/cuentas", nombre: "cuentas" },
];

/* 390 es un móvil de verdad, que es donde este programa más se usa.
   1440 es el escritorio del almacén. */
const VISTAS = [
  { ancho: 1440, alto: 1000, etiqueta: "" },
  { ancho: 390, alto: 844, etiqueta: "-movil" },
];

async function main() {
  fs.mkdirSync(CARPETA, { recursive: true });

  const salidaTicket = execFileSync("node", ["db/dev-ticket.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1 << 24,
  });
  const enlace = (salidaTicket.match(/http:\/\/\S+#ticket=\S+/) || [])[0];
  if (!enlace) {
    console.log("  *** dev-ticket.mjs no ha impreso el enlace");
    process.exit(1);
  }
  const ticket = enlace.split("#ticket=")[1].trim();
  console.log("  ticket de " + ticket.length + " caracteres");
  console.log("");

  const { chromium } = req("D:/webs/wweb/node_modules/playwright");
  const navegador = await chromium.launch();
  const problemas = [];

  for (const v of VISTAS) {
    const ctx = await navegador.newContext({
      viewport: { width: v.ancho, height: v.alto },
      deviceScaleFactor: 1,
    });
    const pagina = await ctx.newPage();
    let errores = [];
    pagina.on("pageerror", (e) => errores.push(e.message.slice(0, 80)));

    /* Entrar por la ruta real: se navega a /entrar con el ticket en el
       fragmento, que es lo que hace la persona al pegar el enlace. */
    await pagina.goto(BASE + "/entrar#ticket=" + ticket, { waitUntil: "domcontentloaded" });
    await pagina.waitForTimeout(2500);

    for (const p of PANTALLAS) {
      const r = await pagina.goto(BASE + p.ruta, { waitUntil: "domcontentloaded" });

      /* Se espera a que se callen las peticiones, no a que el texto
         deje de decir "Cargando".

         La primera versión esperó 900 ms fijos y capturó `resumen` a
         medias: `/api/resumen` tarda unos cuatro segundos y la captura
         se hizo antes. La segunda esperó a que el cuerpo no empezara
         por "Cargando", y eso nunca es cierto: el cuerpo empieza por la
         barra de navegación, así que la espera terminaba en el acto y
         las seis pantallas salían worse, con una cifra cada una.

         `networkidle` es lo que se quiere: la pantalla ya no está
         pidiendo nada. Con un tope, porque si una pantalla se queda
         colgada la captura tiene que guardarse igual —si no, el fallo
         no deja rastro y parece que todo funciona. */
      await pagina.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      await pagina.waitForTimeout(300);

      const m = await pagina.evaluate(() => {
        const chicos = [];
        for (const e of document.querySelectorAll("button, a, input, select, [role=button]")) {
          /* ── El objetivo real, no el elemento ──

             Una casilla de 18 píxeles dentro de una etiqueta de 36 no es
             un problema: lo que se pulsa es la etiqueta. Medir el
             `input` da un falso positivo que hides el arreglo, y como
             el arreglo estaba hecho, el aviso iba a quedarse ahí para
             siempre y a enseñar a ignorar la herramienta.

             Para un `input` o un `select` lo que se mide es su
             `label`, o su padre si no hay etiqueta. */
          let objetivo = e;
          if ((e.tagName === "INPUT" || e.tagName === "SELECT") && e.closest("label")) {
            objetivo = e.closest("label");
          }

          const c = objetivo.getBoundingClientRect();
          if (c.width === 0 || c.height === 0) continue;
          if (c.height < 32) {
            chicos.push({
              etiqueta: (objetivo.textContent || e.getAttribute("aria-label") || objetivo.tagName)
                .trim()
                .slice(0, 20),
              alto: Math.round(c.height),
              que: objetivo === e ? "" : " (dentro de " + e.tagName.toLowerCase() + ")",
            });
          }
        }

        const tablas = [...document.querySelectorAll("table")].map((t) => ({
          ancho: Math.round(t.getBoundingClientRect().width),
          padre: Math.round(t.parentElement.getBoundingClientRect().width),
        }));

        const porTabla = document.querySelectorAll("tbody tr").length;
        const rejillas = document.querySelectorAll("[data-fila]").length;

        /* ── Quién es el que desborda ──

           Saber que la página se sale 24 píxeles no sirve de nada: hay
           que saber qué elemento es. Se recorren los nodos y se busca
           el último cuyo borde derecho pasa de la ventana.

           El ÚLTIMO y no el primero a propósito. El primero es casi
           siempre el `body` o un contenedor, porque todos se estiran
           con el contenido. El que se sale de verdad es el más interno,
           y por eso se baja hasta el fondo del árbol.

           Y se acota a cinco: si hay veinte nodos que se salen, lo que
           importa es el primero de ellos, que es el que empuja a todos
           los demás. */
        const limite = window.innerWidth + 1;
        const culpables = [];

        /* Lo que vive dentro de un contenedor con scroll horizontal no
           se está saliendo: se puede llegar a ello desplazando. La
           barra de secciones es exactamente eso, y sin esta excepción
           salía marcada en las seis pantallas, con cuatro pestañas
           "demasiado anchas" que no lo están. */
        const enScroll = (nodo) => {
          let p = nodo.parentElement;
          while (p && p !== document.body) {
            const ov = getComputedStyle(p).overflowX;
            if (ov === "auto" || ov === "scroll" || ov === "hidden") return true;
            p = p.parentElement;
          }
          return false;
        };

        (function buscar(nodo) {
          if (culpables.length >= 5) return;
          for (const hijo of nodo.children || []) {
            const r = hijo.getBoundingClientRect();
            if (r.width > 0 && r.right > limite && !enScroll(hijo)) {
              culpables.push({
                etiqueta: hijo.tagName.toLowerCase() +
                  (typeof hijo.className === "string" && hijo.className
                    ? "." + hijo.className.split(/\s+/).slice(0, 3).join(".")
                    : ""),
                derecha: Math.round(r.right),
                ancho: Math.round(r.width),
                texto: (hijo.textContent || "").trim().slice(0, 28),
              });
            }
            buscar(hijo);
          }
        })(document.body);

        return {
          desborde: document.documentElement.scrollWidth - window.innerWidth,
          culpables,
          chicos: chicos.slice(0, 5),
          totalChicos: chicos.length,
          tablas,
          filas: Math.max(porTabla, rejillas),
          cifras: (document.body.innerText.match(/\d/g) || []).length,
          alto: document.documentElement.scrollHeight,
        };
      });

      const archivo = CARPETA + "/" + p.nombre + v.etiqueta + ".png";
      await pagina.screenshot({ path: archivo, fullPage: true });

      console.log(
        "  " + (r.status() < 400 ? "OK  " : "FALLA") +
        " " + (p.nombre + v.etiqueta).padEnd(16) +
        String(v.ancho).padStart(5) + "px" +
        "  filas " + String(m.filas).padStart(3) +
        "  cifras " + String(m.cifras).padStart(4) +
        "  alto " + String(m.alto).padStart(5) +
        (m.desborde > 0 ? "  DESBORDE +" + m.desborde + "px" : "")
      );

      const donde = p.nombre + v.etiqueta;
      if (m.totalChicos) {
        problemas.push(
          "  " + donde + ": " + m.totalChicos + " objetivos por debajo de 32px" +
          m.chicos.map((c) => "\n      " + c.etiqueta + (c.que || "") + " (" + c.alto + "px)").join("")
        );
      }
      for (const t of m.tablas) {
        if (t.ancho > t.padre + 2) {
          problemas.push("  " + donde + ": tabla de " + t.ancho + "px en un hueco de " + t.padre);
        }
      }
      if (m.desborde > 0) {
        problemas.push(
          "  " + donde + ": desborde de " + m.desborde + "px. Los que se salen:" +
          m.culpables.map((c) =>
            "\n      " + c.etiqueta + "  (" + c.ancho + "px, llega a " + c.derecha + ")" +
            (c.texto ? "  \"" + c.texto + "\"" : "")
          ).join("")
        );
      }
      if (errores.length) {
        problemas.push("  " + donde + ": " + errores.length + " errores de consola: " + errores[0]);
        errores = [];
      }
    }

    await ctx.close();
  }

  await navegador.close();

  console.log("");
  console.log("  capturas en " + CARPETA);
  console.log("");

  if (problemas.length) {
    console.log("=== LO QUE HAY QUE ARREGLAR ===");
    problemas.forEach((x) => console.log(x));
    console.log("");
    console.log("  " + problemas.length + " problemas");
  } else {
    console.log("  sin desbordes ni objetivos pequeños");
  }
}

main().catch((e) => {
  console.log("  *** " + e.message);
  process.exit(1);
});