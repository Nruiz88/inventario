import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* =========================================================
   La pastilla
   ---------------------------------------------------------
   ── POR QUÉ UNA PASTILLA, Y POR QUÉ CON UN PUNTO ──

   Un inventario tiene tres cosas que hay que distinguir de un vistazo, y
   ninguna es "una etiqueta":

     · Agotado      el producto no está. No es un aviso, es un hecho.
     · Por debajo   el producto está, pero hay que comprar. No es un
                    error, es una decisión de compra.
     · Sin factura  la venta está hecha y no cobrada. Es un cobro
                    pendiente.

   Las tres son "cosas que hay que mirar", y por eso comparten forma.
   Lo que las separa es el color, y el color solo no se ve. Por eso
   todas llevan un punto delante: es el punto el que dice "esto es un
   estado", y el color el que dice cuál.

   El punto no es decoración por gusto: un rojo para un daltónico es
   indistinguible de un ámbar, y en una columna de stock la diferencia
   entre "hay que comprarlo ya" y "no hay" es la diferencia entre abrir
   el pedido y cerrar el mostrador.
   ========================================================= */

const variantes = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 " +
    "text-[0.7rem] font-bold tracking-wide uppercase whitespace-nowrap",
  {
    variants: {
      tono: {
        neutro: "border-borde-fuerte bg-panel-2 text-apagado",
        ok: "border-ok/40 bg-ok/12 text-ok",
        mal: "border-mal/45 bg-mal/12 text-mal",
        aviso: "border-aviso/40 bg-aviso/12 text-aviso",

        /* Los dos estados de stock, aparte del rojo y del ámbar
           generales. Ver el comentario de arriba: no son errores. */
        stockBajo: "border-stock-bajo/45 bg-stock-bajo/12 text-stock-bajo",
        stockAgotado: "border-stock-agotado/55 bg-stock-agotado/16 text-stock-agotado",
      },
    },
    defaultVariants: { tono: "neutro" },
  }
);

/* El punto. Se pinta como hijo y no como parte del texto para que
   quien lo usa no pueda olvidarlo: es lo que hace que el color no sea
   el único canal. */
function Punto({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-1.5 shrink-0 rounded-full bg-current", className)}
    />
  );
}

export function Pastilla({
  className,
  tono,
  conPunto = true,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof variantes> & { conPunto?: boolean }) {
  return (
    <span className={cn(variantes({ tono }), className)} {...props}>
      {conPunto && <Punto />}
      {children}
    </span>
  );
}

/* =========================================================
   La etiqueta de estado, con su texto
   ---------------------------------------------------------

   Lo que va pegado a una cifra. El texto va dentro y no se lo pone
   quien lo usa, porque el de cada estado tiene que ser el mismo en las
   siete pantallas: si uno escribe "bajo" y otro "por debajo", el dueño
   tarda un segundo más en cada uno y no sabe si son lo mismo. */
export function ayudaEstado({ children, error }: { children: React.ReactNode; error?: string }) {
  return (
    <p className={cn("mt-1.5 text-xs", error ? "text-mal" : "text-apagado")}>
      {children}
    </p>
  );
}

export const textoStock = (stock: number, minimo: number) => {
  if (stock <= 0) return { texto: "agotado", tono: "stockAgotado" as const };
  if (minimo > 0 && stock <= minimo) return { texto: "bajo", tono: "stockBajo" as const };
  return { texto: "ok", tono: "ok" as const };
};