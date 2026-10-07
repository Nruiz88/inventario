import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* =========================================================
   El botón
   ---------------------------------------------------------
   Las variantes son las de shadcn, con dos cambios que son de este
   programa y no de shadcn.

   ── 1. `peligro` NO ES ROJO SOBRE ROJO ──

   shadcn lo pinta con `--destructive`, un rojo fuerte. Aquí es un fondo
   rojo apagado con el texto del rojo de alerta y el borde un punto más
   claro. La razón es que "Desactivar" o "Anular" se pulsan mientras se
   hacen otras cosas: un botón rojo entero en una pantalla oscura se
   queda con lo que hay detrás, y lo que hay detrás es una lista de
   clientes.

   ── 2. LA ALTURA NO LA DECIDE shadcn ──

   shadcn pone `h-9`, que son 36 px. Aquí el mínimo lo pone
   `globals.css` en una capa base, con `!important`, para que todos los
   botones del proyecto midan lo mismo sin que cada pantalla lo
   recuerde. Por eso aquí no hay `h-9` ni `h-10`: hay `min-h-` y se
   deja que la base imponga el suelo.
   ========================================================= */

const variantes = cva(
  "inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 " +
    "font-medium whitespace-nowrap transicion " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
    "disabled:pointer-events-none disabled:opacity-50 " +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variante: {
        /* La acción principal de una pantalla. Solo una por vista: si
           hay dos botones azules, no hay ninguno que sea el principal. */
        primario:
          "bg-primary text-primary-foreground border-transparent hover:brightness-110 active:brightness-95",

        normal:
          "bg-panel-2 text-texto border-borde hover:bg-borde hover:border-borde-fuerte",

        /* Acción secundaria. En un mostrador es la que más se usa:
           cobrar, aplicar. Con bordered se distingue de la principal
           sin gritar. */
        secundario:
          "bg-panel-2 border-borde-fuerte text-texto hover:bg-borde",

        fantasma:
          "bg-transparent text-apagado border-transparent hover:bg-panel-2 hover:text-texto",

        peligro:
          "bg-[#3a1a1e] text-mal border-[#6b2b32] hover:bg-[#4a2028] hover:border-mal",

        /* Lo que destruye datos sin poder deshacerlo: separar una
           variante, anular una venta. El aviso va con el icono, no
           solo con el color, porque el color solo no se ve. */
        destructivo:
          "bg-mal text-[#2a0d10] border-transparent hover:brightness-110",

        enlace:
          "bg-transparent border-transparent text-acento underline-offset-4 hover:underline p-0 h-auto min-h-0",
      },
      tamano: {
        normal: "text-sm",
        chico: "text-xs px-3",
        grande: "text-base px-6",
        icono: "px-3",
      },
    },
    defaultVariants: {
      variante: "normal",
      tamano: "normal",
    },
  }
);

export interface BotonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof variantes> {
  /** Se pinta como el elemento que contiene, para que un `<Link>` pueda
   *  llevar la misma piel que un `<button>` sin dos implementaciones. */
  como?: React.ComponentProps<typeof Slot>;
  /** While it saves. The label is kept, and only the size changes: swapping
   *  it for "…" makes the button narrower mid-press, and the finger that
   *  was already on its way misses. */
  cargando?: boolean;
}

const Boton = React.forwardRef<HTMLButtonElement, BotonProps>(
  ({ className, variante, tamano, como, cargando, children, ...props }, ref) => {
    const Comp: any = como || "button";
    return (
      <Comp
        className={cn(variantes({ variante, tamano, className }))}
        ref={ref}
        {...props}
      >
        {cargando ? (
          <>
            <span
              aria-hidden
              className="size-3.5 shrink-0 rounded-full border-2 border-current border-t-transparent"
              style={{ animation: "giro 700ms linear infinite" }}
            />
            <span>{children}</span>
          </>
        ) : (
          children
        )}
      </Comp>
    );
  }
);
Boton.displayName = "Boton";

export { Boton, variantes as variantesBoton };