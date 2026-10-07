import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/* =========================================================
   El hueco
   ---------------------------------------------------------
   ── POR QUÉ NO ES "NO HAY DATOS" ──

   Un mensaje de "no hay datos" dice qué ha pasado. Un mensaje que dice
   qué hacer, y por qué está vacío, es lo único que hace que avance la
   persona que lo está mirando.

   Aquí hay tres huecos que son de tres clases distintas y cada uno pide
   una cosa distinta, y por eso `Vacio` acepta un `accion`:

     · "Todavía no hay ventas"        -> crear la primera venta
     · "Este cliente aún no debe"     -> nada que hacer, es un estado
                                          bueno
     · "No hay movimientos con ese filtro" -> quitar el filtro

   En el segundo caso, un botón sería ruido. Por eso el botón es
   opcional y quien lo usa decide si lo pone.

   ── LA ALTURA ──

   Con `padding: 2rem` y sin nada más, un hueco dentro de una caja
   pequeña empuja la caja y descuadra la rejilla de al lado. Con
   `py-10` en una caja de 300 px se nota mucho más. Por eso el relleno
   es medio y no dos rem: bastante para que se lea como un hueco, poco
   para que estire la página. */
export function Vacio({
  className,
  children,
  accion,
  ...props
}: HTMLAttributes<HTMLDivElement> & { accion?: ReactNode }) {
  return (
    <div
      className={cn(
        "px-4 py-8 text-center text-sm leading-relaxed text-apagado",
        className
      )}
      {...props}
    >
      {children}

      {/* El botón va debajo del texto y no al lado. En el hueco de un
          listado, un «nuevo producto» a la derecha de «no hay
          productos» se lee como una acción de la fila de al lado, que
          es justo lo que un hueco no es. */}
      {accion && <div className="mt-3 flex justify-center">{accion}</div>}
    </div>
  );
}

