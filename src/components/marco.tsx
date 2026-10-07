"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LogOut, Store } from "lucide-react";
import { MIS_SERVICIOS } from "@/lib/panel";
import { ProveedorDatos } from "@/lib/ui/datos";
import { cn } from "@/lib/utils";
import { color } from "@/lib/ui/controles";

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
    <header style={{ position: "sticky", top: 0, zIndex: 50, borderBottom: "1px solid " + color.borde, background: color.panel + "ee", backdropFilter: "blur(8px)" }} className="">
      <div className="mx-auto flex w-full max-w-[76rem]">
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            borderRadius: "0.5rem",
            padding: "0.45rem 0.5rem",
            fontSize: "0.95rem",
            fontWeight: "700",
            color: color.texto,
            textDecoration: "none",
            transition: "background-color 120ms ease, color 120ms ease",
          }}
          className=""
          onMouseEnter={(e) => {
            e.currentTarget.style.background = color.panel2;
            e.currentTarget.style.color = color.claro;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = color.texto;
          }}
        >
          <Store style={{ width: "16px", height: "16px", color: color.acento }} aria-hidden />
          Inventario
        </Link>

        {/* Con <Link>, no con <a>. Con <a> hacia una ruta interna, Next
            descarga la página entera y la vuelve a pedir: en el mostrador
            eso es medio segundo en blanco cada vez que el dueño cambia
            de pestaña. Con <Link> ya está el JavaScript y solo va el
            dato. */}
        <nav
          aria-label="Secciones"
          style={{ order: 3, marginLeft: "-1px", display: "flex", width: "100%", gap: "1px", overflowX: "auto", paddingLeft: "1px", paddingRight: "1px", paddingBottom: "0.5rem", WebkitOverflowScrolling: "touch" }}
          className=""
        >
          {SECCIONES.map((s) => {
            const activo = s.exacto ? ruta === s.href : ruta.startsWith(s.href);
            return (
              <Link
                key={s.href}
                href={s.href}
                aria-current={activo ? "page" : undefined}
                style={{
                  flexShrink: 0,
                  borderRadius: "0.6rem",
                  border: "1px solid transparent",
                  padding: "0.55rem 0.8rem",
                  fontSize: "0.875rem",
                  fontWeight: "600",
                  background: activo ? color.panel2 : "transparent",
                  color: activo ? color.texto : color.apagado,
                  transition: "background-color 120ms ease, color 120ms ease, border-color 120ms ease",
                  textDecoration: "none",
                }}
                className=""
                onMouseEnter={(e) => {
                  if (!activo) {
                    e.currentTarget.style.borderColor = color.borde;
                    e.currentTarget.style.background = color.panel2;
                    e.currentTarget.style.color = color.texto;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!activo) {
                    e.currentTarget.style.borderColor = "transparent";
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = color.apagado;
                  }
                }}
              >
                {s.texto}                </Link>
            );
          })}
        </nav>

        <a
          href={MIS_SERVICIOS}
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            borderRadius: "0.6rem",
            padding: "0.45rem 0.65rem",
            fontSize: "0.8rem",
            color: color.apagado,
            textDecoration: "none",
            transition: "background-color 120ms ease, color 120ms ease",
          }}
          className=""
          onMouseEnter={(e) => {
            e.currentTarget.style.background = color.panel2;
            e.currentTarget.style.color = color.texto;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = color.apagado;
          }}
        >
          {/* Con icono y con texto, y no solo con texto. "Mi panel" sin
              contexto es una de esas palabras que en una barra con seis
              pestañas no se sabe si es un enlace o el nombre de la
              sección de al lado. */}
          <LogOut style={{ width: "14px", height: "14px" }} aria-hidden />
          Mi panel
        </a>
      </div>
    </header>
  );
}