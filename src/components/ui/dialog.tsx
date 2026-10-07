import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/* =========================================================
   El diálogo
   ---------------------------------------------------------
   ── POR QUÉ NO ES UN `<dialog>` DE HTML ──

   El nativo se puede abrir con un clic y no se puede cerrar con `Esc`
   en Safari, y ese `Esc` es exactamente la tecla que se pulsa sin
   querer con la mano de medio. Radix lo hace bien y además hace lo que
   un modal de verdad tiene que hacer: encerrar el foco dentro mientras
   está abierto, para que el tabulador no se vaya a la página de detrás.

   ── LA ANCHURA ──

   `ancho` va en el componente y no como clase suelta en cada sitio,
   porque un formulario de venta y una nota no pueden medir lo mismo y
   basta uno de los dos mal puesto para que se vea. */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ancho = "md",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  ancho?: "sm" | "md" | "lg";
}) {
  const anchos = {
    sm: "max-w-sm",
    md: "max-w-lg",
    lg: "max-w-3xl",
  };

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2",
          "max-h-[calc(100dvh-4rem)] overflow-y-auto",
          "rounded-lg border border-borde-fuerte bg-panel text-texto shadow-2xl",
          anchos[ancho],
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          /* Icono y no un texto: el botón está en la esquina, y un
             "Cerrar" de 80 px ahí se lee como un segundo botón
             principal. */
          data-compacto
          className="absolute top-3 right-3 rounded-md p-2 text-apagado transicion hover:bg-panel-2 hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Cerrar"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        /* El hueco a la derecha es para el aspa, que va encima. Sin él,
           el título se puede meter debajo del aspa. */
        "flex flex-col gap-1 border-b border-borde px-5 py-4 pr-14",
        className
      )}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-base font-semibold", className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn("text-sm text-apagado", className)} {...props} />
  );
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid gap-4 p-5", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
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

