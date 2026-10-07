import * as React from "react";
import { cn } from "@/lib/utils";

/* =========================================================
   La tabla
   ---------------------------------------------------------
   ── POR QUÉ ESTA NO ES UN `<div>` CON `display: grid` ──

   El listado de productos que había antes era una rejilla de cajas: una
   caja por producto, y las variantes dentro. Con veinte productos y
   tres variantes cada uno, el resultado son veinte cajas altas con huecos
   y sin una sola columna alineada.

   Y el problema no es que quede feo: es que **no se pueden comparar
   cosas**. El precio de venta de un producto con el de al lado, no,
   porque cada uno está en una caja y las cajas tienen anchos distintos.
   Comparar es la razón de ser de una tabla.

   ── LAS TRES DECISIONES QUE IMPORTAN ──

   1. LA CABECERA SE QUEDA FIJA. En una tabla de cuarenta filas, sin
      cabecera fija hay que subir a comprobar de qué columna es el
      número que se está leyendo. En un mostrador eso es un segundo por
      fila.

   2. LOS NÚMEROS A LA DERECHA, CON CIFRAS FIJAS. Es lo único que hace
      que "22,00" y "3,50" se puedan comparar: alineados por el decimal,
      el ojo ve la diferencia de largo sin leer.

   3. LA TABLA SE CONVIERTE EN TARJETA EN MÓVIL. Un inventario se mira
      en un móvil colgado al lado de la caja. Con `overflow-x: auto` las
      columnas se salen de la pantalla y no hay forma de saber que
      existe algo a la derecha. Con la fila entera como tarjeta, cada
      dato conserva su etiqueta y no hay que recordar la cabecera.
   ========================================================= */

export function Tabla({
  className,
  pegada,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & { pegada?: boolean }) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table
        className={cn("w-full border-collapse text-sm", pegada && "table-fixed")}
        {...props}
      />
    </div>
  );
}

export function Cabecera({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("", className)} {...props} />;
}

export function CuerpoTabla({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("", className)} {...props} />;
}

export function Fila({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("border-b border-borde last:border-0 transicion hover:bg-panel-2/60", className)}
      {...props}
    />
  );
}

export function Celda({
  className,
  numerica,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numerica?: boolean }) {
  return (
    <td
      className={cn(
        "px-4 py-3 align-middle",
        /* `tabular-nums` no se pone en la tabla entera en el CSS de la
           aplicación, sino aquí: una tabla cuenta, y una tabla con
           cifras de ancho variable baila cada vez que entra un 1. */
        numerica && "text-right tabular-nums",
        className
      )}
      {...props}
    />
  );
}

export function CeldaCabecera({
  className,
  numerica,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numerica?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-borde bg-panel-2 px-4 py-2.5 text-left",
        "text-[0.7rem] font-bold tracking-[0.08em] uppercase text-apagado",
        numerica && "text-right",
        className
      )}
      {...props}
    />
  );
}

/* =========================================================
   La tabla que se vuelve tarjeta
   ---------------------------------------------------------
   Las reglas están en `globals.css`, en el bloque `tabla-tarjeta`.
   Aquí está solo el nombre de la clase y el `data-col` de cada celda.

   ── POR QUÉ NO PUEDE SER UN `content: attr()` ──

   La idea sería poner el nombre de la columna con
   `td::before { content: attr(data-col) }`, y está a medias: se puede
   leer el atributo de la propia celda, pero el texto de la cabecera no
   está en la celda. Por eso hay que escribirlo dos veces —una en la
   cabecera y otra en cada celda—, y por eso lo que va en `data-col`
   es el nombre corto, no el de la cabecera.

   ── POR QUÉ NO SE USA `overflow-x: auto` ──

   Porque no avisa de que hay algo más a la derecha. En un móvil, una
   tabla que se desborda teaches la primera columna y una franja, y
   quien no sepa que la tabla continúa se queda con la mitad de los
   datos sin darse cuenta. Con la fila como tarjeta, cada dato conserva
   su etiqueta y no hay nada que descubrir.
   ========================================================= */

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

