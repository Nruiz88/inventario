import * as React from "react";
import { cn } from "@/lib/utils";

/* =========================================================
   La caja
   ---------------------------------------------------------
   La misma estructura de shadcn, con una diferencia que importa aquí:
   la cabecera lleva la acción a la derecha y el título a la izquierda,
   pero no lleva fondo propio.

   ── POR QUÉ NO ──

   shadcn pone `bg-muted` en la cabecera. En una aplicación de escritorio
   eso da una jerarquía bonita; en una pantalla de inventario da una
   franja gris más en un programa que ya es gris entero, y el resultado
   es que todas las cajas se ven iguales y ninguna destaca.

   Aquí la separación la hace la línea de abajo del borde, y el color de
   fondo es el de la caja. Si alguna pantalla necesita una cabecera que
   se distinga, se marca con `tono`, no con un fondo por defecto que
   aplica a todas.
   ========================================================= */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-borde bg-panel text-texto",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    /* `flex-wrap` en la cabecera y no solo en la acción.

       Es lo que faltaba: con la acción arrugada, el título y la acción
       seguían en la misma fila, y a 390 px no caben. El resultado era
       que la caja se salía de la pantalla por la derecha, que es
       justo lo que un móvil no perdona porque no hay forma de
       desplazarse y ver lo que falta.

       El salto de línea va entre el título y la acción, no dentro del
       título: si estuviera dentro, "Stock bajo" se partiría en dos
       líneas de cuarenta píxeles, que es peor que bajarlo entero. */
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-borde px-5 py-3.5",
        className
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-base font-semibold leading-tight", className)} {...props} />;
}

/* ── El cintillo ──

   El grupo al que pertenece la caja, encima del título. Es lo que
   separa "Servicios · 12" de "Servicios activos · 12", y va en 0.7rem
   en versalitas porque no compite con el título: aunque los dos sean
   grandes, el título gana por tamaño. */
export function CardEyebrow({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "block text-[0.7rem] font-bold tracking-[0.1em] uppercase text-apagado",
        className
      )}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-apagado", className)} {...props} />;
}

export function CardAction({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    /* `flex-wrap` y no una fila fija. La acción de una cabecera es la
       parte que más crece: un texto que dice "4 de 10 · faltan 12
       unidades" más un botón, en 390 px, no caben en una fila y se van
       fuera de la pantalla. Al envolverse, el botón baja a una segunda
       línea y la caja crece, que es lo que tiene que pasar.

       El `shrink-0` era lo que rompía: el texto se encogía hasta
       partirse en vez de dejar que la acción bajara de línea. */
    <div className={cn("flex shrink-0 flex-wrap items-center gap-2", className)} {...props} />
  );
}

/* ── El cuerpo ──

   `sinRelleno` para cuando lo que va dentro es una tabla o una rejilla
   que tiene que llegar al borde. Con relleno, la primera y la última
   fila quedan metidas hacia dentro y la caja parece más pequeña de lo
   que es. */
export function CardBody({
  className,
  sinRelleno,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { sinRelleno?: boolean }) {
  return (
    <div className={cn(sinRelleno ? "" : "p-5", className)} {...props} />
  );
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 border-t border-borde px-5 py-3.5",
        className
      )}
      {...props}
    />
  );
}