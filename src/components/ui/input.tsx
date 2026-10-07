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

const cajaBase = "w-full rounded-md border border-borde bg-hundido text-texto transicion";

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
            cajaBase,
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
          cajaBase,
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

/* =========================================================
   La casilla
   ---------------------------------------------------------
   ── POR QUÉ NO ES UN `<input type="checkbox">` SUELTO ──

   Una casilla por defecto mide unos 13 píxeles. Es un blanco pequeño:
   se ve, pero pulsarla con el dedo es acertar. Y `capturar.js` la
   llevaba marcando como problema en las dos capturas de `ventas` desde
   el principio, con el tamaño exacto, que es la clase de hallazgo que
   no se ve leyendo el código.

   Aquí la casilla se agranda y, sobre todo, **la etiqueta es lo que se
   pulsa**: el `<label>` mide lo que mide el objetivo táctil, así que
   pulsar en la palabra cuenta igual que pulsar en la casilla.

   ── EL `accent-color` ──

   Pinta la casilla con el color de la marca sin tocar el
   `appearance`, que es lo que hace que siga siendo una casilla nativa
   en lugar de un rectángulo dibujado. La nativa es la que el sistema
   sabe pulsar con el dedo y la que funciona con el lector de pantalla.
   ========================================================= */
export function Casilla({
  etiqueta,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { etiqueta: string }) {
  return (
    <label
      className={cn(
        /* El objetivo táctil va en el label, no en el input. El input
           se queda pequeño y el label es el que cubre los 36 px. */
        "flex min-h-[2.25rem] cursor-pointer items-center gap-2.5 text-sm text-apagado transicion hover:text-texto",
        "focus-within:text-texto"
      )}
    >
      <input
        type="checkbox"
        style={{ accentColor: "var(--color-acento)", width: 18, height: 18, flex: "none" }}
        className={cn("cursor-pointer", className)}
        {...props}
      />
      {etiqueta}
    </label>
  );
}

/* ── El esqueleto ──
   Un hueco con la forma de lo que va a llegar, mostrado mientras se
   espera. Es mejor que un spinner por una razón concreta: en un
   mostrador lo que se mira es la tabla, y con un spinner hay un hueco
   y después una tabla: dos cambios de forma. Con el esqueleto hay un
   hueco y después una tabla con la misma forma. */
export function Esqueleto({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-panel-2", className)}
      {...props}
    />
  );
}

export function ayudaFooter({ children, error }: { children: React.ReactNode; error?: string }) {
  return (
    <p
      className={cn(
        "mt-1.5 text-xs",
        error ? "text-mal" : "text-apagado"
      )}
    >
      {children}
    </p>
  );
}

