"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  LayoutGrid,
  ShoppingCart,
  Package,
  Truck,
  Wallet,
  Users,
  Store,
  LogOut,
} from "lucide-react";
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

   ── POR QUÉ CADA SECCIÓN LLEVA ICONO ──

   Seis pestañas con solo texto obligan a LEER para encontrar una.
   Con un icono por sección, el ojo reconoce la forma antes que la
   palabra: es la diferencia entre buscar «Caja» y reconocer la
   cartera. El icono va a la izquierda del texto y nunca solo, porque
   un icono suelto es ambiguo —una cartera puede ser Caja o Pago—.

   ── LO QUE CAMBIA Y POR QUÉ ──

   La navegación es una fila que **se desliza** en horizontal en móvil
   y no se envuelve: envolver hace que la posición de cada pestaña
   cambie según la pantalla, y eso obliga a buscarla. En escritorio es
   la misma fila, en un solo línea, con la barra fija arriba.

   Todo va con clases de Tailwind y los tokens del proyecto. Los
   estilos en línea no se pueden sobrescribir desde la hoja ni
   combinar con `hover:` de Tailwind, y la versión anterior acabó con
   manejadores `onMouseEnter` escritos a mano para cada enlace, que es
   exactamente lo que la hoja hace con una clase.

   ── EL MÍNIMO DE 36 PX ──

   shadcn pone los botones en 36 px. Aquí lo pone la capa base de
   `globals.css`, no este fichero, para que todos los botones midan lo
   mismo sin que cada pantalla lo recuerde. Por eso no hay `h-9` aquí:
   hay un token.
   ========================================================= */

const SECCIONES = [
  { href: "/", texto: "Resumen", exacto: true, icono: LayoutGrid },
  { href: "/ventas", texto: "Ventas", icono: ShoppingCart },
  { href: "/productos", texto: "Productos", icono: Package },
  { href: "/compras", texto: "Compras", icono: Truck },
  { href: "/caja", texto: "Caja", icono: Wallet },
  { href: "/cuentas", texto: "Cuentas", icono: Users },
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
      <div className="mx-auto flex w-full max-w-[76rem] flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 md:px-4">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 rounded-md px-2 py-2 text-[0.95rem] font-bold text-texto transicion hover:bg-panel-2 hover:text-claro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento"
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
          className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto px-1 pb-1 md:order-none md:mx-0 md:w-auto md:flex-1 md:overflow-visible md:px-0 md:pb-0"
        >
          {SECCIONES.map((s) => {
            const activo = s.exacto ? ruta === s.href : ruta.startsWith(s.href);
            const Icono = s.icono;
            return (
              <Link
                key={s.href}
                href={s.href}
                aria-current={activo ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-2 text-sm transicion",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento",
                  activo
                    ? "border-borde bg-panel-2 font-semibold text-texto"
                    : "border-transparent font-medium text-apagado hover:border-borde/60 hover:bg-panel-2 hover:text-texto"
                )}
              >
                <Icono
                  className={cn("size-4 shrink-0", activo ? "text-acento" : "text-apagado")}
                  aria-hidden
                />
                {s.texto}
              </Link>
            );
          })}
        </nav>

        <a
          href={MIS_SERVICIOS}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-2 text-sm text-apagado transicion hover:bg-panel-2 hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento"
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
