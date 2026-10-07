import * as React from "react";
import { cn } from "@/lib/utils";

/* =========================================================
   Los campos
   ---------------------------------------------------------
   Los tres: `Campo`, `Area` y `Etiqueta`.

   ── POR QUÉ SIGUEN SIENDO COMPONENTES Y NO UN `<input>` SUELTO ──

   Porque el `inputMode` va en el tipo y no en el elemento, y ese es
   justo el detalle que se olvida: en un móvil, un campo de cantidad con
   el teclado normal obliga a ir a buscar el número. Un componente que
   ya lo pone por ti es la diferencia entre cobrar en diez segundos y en
   cuarenta.

   ── LA ETIQUETA, POR ARRIBA Y EN VERSALITAS ──

   shadcn usa `<label className="text-sm font-medium">` debajo del
   campo, y su `Label` es un `<label>` a secas.

   Aquí la etiqueta va en `Campo` y no suelta, porque hay un caso en el
   que separarlas estorba: el formulario de venta, donde el campo y su
   etiqueta tienen que ir juntos al moverlos. Cuando sí hace falta
   suelta, está `Etiqueta`.
   ========================================================= */

const caja = "w-full rounded-md border border-borde bg-hundido px-3 text-texto transicion";

export const Campo = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & {
    etiqueta?: string;
    /** El aviso va debajo, del mismo ancho, en el color que le toque. */
    error?: string;
    ayuda?: string;
    /** Lo que va a la derecha de la etiqueta: un contador, un "0" de
     *  referencia. Se usa en las cantidades. */
    extra?: React.ReactNode;
  }
>(
  ({ className, etiqueta, error, ayuda, extra, type = "text", id, ...props }, ref) => {
    const generado = React.useId();
    const campoId = id || generado;
    const descrito = error || ayuda;

    return (
      <div className="w-full">
        {etiqueta && (
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label
              htmlFor={campoId}
              className="text-[0.7rem] font-bold tracking-[0.08em] uppercase text-apagado"
            >
              {etiqueta}
            </label>
            {extra && <span className="text-xs text-apagado">{extra}</span>}
          </div>
        )}

        <input
          ref={ref}
          id={campoId}
          type={type}
          /* El teclado del móvil, en el tipo y no en el elemento. Con
             `decimal` aparece el teclado numérico con coma, que es lo
             que se usa aquí: los importes se escriben con coma
             decimal. */
          inputMode={type === "number" ? "decimal" : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={descrito ? campoId + "-ayuda" : undefined}
          className={cn(
            caja,
            "px-3 py-2",
            "placeholder:text-apagado/60",
            "focus-visible:border-acento focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-acento",
            "disabled:opacity-50",
            error && "border-mal focus-visible:border-mal focus-visible:ring-mal",
            className
          )}
          {...props}
        />

        {descrito && (
          <p
            id={campoId + "-ayuda"}
            className={cn("mt-1.5 text-xs", error ? "text-mal" : "text-apagado")}
          >
            {error || ayuda}
          </p>
        )}
      </div>
    );
  }
);
Campo.displayName = "Campo";

export const Area = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { etiqueta?: string; error?: string }
>(({ className, etiqueta, error, id, rows = 3, ...props }, ref) => {
  const generado = React.useId();
  const campoId = id || generado;

  return (
    <div className="w-full">
      {etiqueta && (
        <label
          htmlFor={campoId}
          className="mb-1.5 block text-[0.7rem] font-bold tracking-[0.08em] uppercase text-apagado"
        >
          {etiqueta}
        </label>
      )}
      <textarea
        ref={ref}
        id={campoId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        className={cn(
          caja,
          "resize-y py-2",
          "placeholder:text-apagado/60",
          "focus-visible:border-acento focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-acento",
          error && "border-mal",
          className
        )}
        {...props}
      />
    </div>
  );
});
Area.displayName = "Area";

export function Etiqueta({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "block text-[0.7rem] font-bold tracking-[0.08em] uppercase text-apagado",
        className
      )}
      {...props}
    />
  );
}