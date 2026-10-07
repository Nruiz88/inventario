"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LogOut, Store } from "lucide-react";
import { MIS_SERVICIOS } from "@/lib/panel";
import { ProveedorDatos } from "@/lib/ui/datos";
import { cn } from "@/lib/utils";

/* =========================================================
   El marco: navegación y proveedor de datos
   ---------------------------------------------------------
   Lo usan todas las pantallas menos las de entrada, y lo envuelve el
   layout raíz para que no haya que acordarse en cada página nueva.

   ⚠️  LAS PANTALLAS DE ENTRADA NO LLEVAN NAVEGACIÓN
   -------------------------------------------------
   `/entrar` y `/sin-acceso` cuelgan del mismo layout raíz, y si el marco
   se la pusiera a todo, un dueño sin sesión vería una barra con seis
   enlaces a páginas que no puede abrir. Es peor que no ver nada: le
   dice que el problema es de navegación cuando es de acceso.

   Por eso se decide por ruta y no por composición. Lo otro —una ruta
   `(pub)` con su propio layout— es más limpio, pero obliga a mover las
   carpetas y a que quien añada una pantalla nueva tenga que saber en
   qué grupo va. Con una lista de dos rutas, es menos sorprendente.


   ── LO QUE CAMBIA Y POR QUÉ ──

   La barra era una fila que se envolvía. En un móvil, seis secciones
   más el nombre y el enlace al panel no caben en una fila, y al
   envolverse salen tres filas de pestañas: la barra se come media
   pantalla y el contenido baja.

   Aquí la navegación es una fila que **se desliza** en horizontal y no
   se envuelve, y el enlace al panel baja con el contenido. Se desliza
   en vez de envolver porque envolver hace que la posición de cada
   pestaña cambie según la pantalla, y eso obliga a buscarla.

   En escritorio no cambia nada: misma fila, mismo sitio.

   ── EL MÍNIMO DE 36 PX ──

   shadcn pone los botones en 36 px. Aquí lo pone la capa base de
   `globals.css`, no este fichero, para que todos los botones midan lo
   mismo sin que cada pantalla lo recuerde. Por eso no hay `h-9` aquí:
   hay un token.
   ========================================================= */

const SECCIONES = [
  { href: "/", texto: "Resumen", exacto: true },
  { href: "/ventas", texto: "Ventas" },
  { href: "/productos", texto: "Productos" },
  { href: "/compras", texto: "Compras" },
  { href: "/caja", texto: "Caja" },
  { href: "/cuentas", texto: "Cuentas" },
];

/* Las rutas sin marco. Coinciden con el `PUBLICAS` del proxy: si una
   ruta es pública para el servidor, tampoco lleva la barra. */
const SIN_MARCO = ["/entrar", "/sin-acceso"];

export function Marco({ children }: { children: ReactNode }) {
  const ruta = usePathname();

  if (SIN_MARCO.some((p) => ruta === p || ruta.startsWith(p + "/"))) {
    /* Sin proveedor de datos tampoco: esas pantallas hacen su propio
       POST y no leen nada. Un proveedor que no se usa no cuesta mucho,
       pero sí pone un estado que puede generar un aviso en pantalla en
       una pantalla que no tiene dónde enseñarlo. */
    return <>{children}</>;
  }

  return (
    <ProveedorDatos panel={MIS_SERVICIOS}>
      <Cabecera ruta={ruta} />
      <main className="mx-auto w-full max-w-[76rem] px-4 pt-5 pb-20">{children}</main>
    </ProveedorDatos>
  );
}

function Cabecera({ ruta }: { ruta: string }) {
  return (
    <header className="sticky top-0 z-50 border-b border-borde bg-panel/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[76rem] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md px-2 py-2 text-[0.95rem] font-bold text-texto transicion hover:bg-panel-2 hover:text-claro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento"
        >
          <Store className="size-4 text-acento" aria-hidden />
          Inventario
        </Link>

        {/* Con <Link>, no con <a>. Con <a> hacia una ruta interna, Next
            descarga la página entera y la vuelve a pedir: en el mostrador
            eso es medio segundo en blanco cada vez que el dueño cambia
            de pestaña. Con <Link> ya está el JavaScript y solo va el
            dato. */}
        <nav
          aria-label="Secciones"
          className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto px-1 pb-0.5 md:order-none md:mx-0 md:w-auto md:flex-1 md:overflow-visible md:px-0 md:pb-0"
        >
          {SECCIONES.map((s) => {
            const activo = s.exacto ? ruta === s.href : ruta.startsWith(s.href);
            return (
              <Link
                key={s.href}
                href={s.href}
                aria-current={activo ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-md border px-3 py-2 text-sm transicion",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento",
                  activo
                    ? "border-borde bg-panel-2 font-bold text-texto"
                    : "border-transparent font-medium text-apagado hover:bg-panel-2 hover:text-texto"
                )}
              >
                {s.texto}
              </Link>
            );
          })}
        </nav>

        <a
          href={MIS_SERVICIOS}
          className="ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm text-apagado transicion hover:bg-panel-2 hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento"
        >
          {/* Con icono y con texto, y no solo con texto. "Mi panel" sin
              contexto es una de esas palabras que en una barra con seis
              pestañas no se sabe si es un enlace o el nombre de la
              sección de al lado. */}
          <LogOut className="size-3.5" aria-hidden />
          Mi panel
        </a>
      </div>
    </header>
  );
}