"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { MIS_SERVICIOS } from "@/lib/panel";
import { ProveedorDatos } from "@/lib/ui/datos";
import { color, radio, Contenedor } from "@/lib/ui/controles";

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
   qué grupo va. Con una lista de dos rutas, es menos surprising.
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
      <Contenedor>{children}</Contenedor>
    </ProveedorDatos>
  );
}

function Cabecera({ ruta }: { ruta: string }) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: color.panel,
        borderBottom: `1px solid ${color.borde}`,
      }}
    >
      <div
        style={{
          maxWidth: "76rem",
          margin: "0 auto",
          padding: ".7rem 1rem",
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: ".95rem", color: color.texto }}>Inventario</span>

        {/* Con <Link>, no con <a>. Con <a> hacia una ruta interna, Next
            descarga la página entera y la vuelve a pedir: en el mostrador
            eso es medio segundo en blanco cada vez que el dueño cambia
            de pestaña. Con <Link> ya está el JavaScript y solo va el
            dato. */}
        <nav style={{ display: "flex", gap: ".25rem", flexWrap: "wrap", flex: 1 }}>
          {SECCIONES.map((s) => {
            const activo = s.exacto ? ruta === s.href : ruta.startsWith(s.href);
            return (
              <Link
                key={s.href}
                href={s.href}
                style={{
                  padding: ".45rem .75rem",
                  borderRadius: radio.md,
                  textDecoration: "none",
                  fontSize: ".875rem",
                  fontWeight: activo ? 700 : 500,
                  color: activo ? color.texto : color.apagado,
                  background: activo ? color.panel2 : "transparent",
                  border: `1px solid ${activo ? color.borde : "transparent"}`,
                }}
              >
                {s.texto}
              </Link>
            );
          })}
        </nav>

        <a
          href={MIS_SERVICIOS}
          style={{
            fontSize: ".8rem",
            color: color.apagado,
            textDecoration: "none",
            padding: ".4rem .6rem",
          }}
        >
          Mi panel
        </a>
      </div>
    </header>
  );
}