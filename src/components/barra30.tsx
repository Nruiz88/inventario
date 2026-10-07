import { cn } from "@/lib/utils";

/* =========================================================
   La serie de treinta días
   ---------------------------------------------------------
   Treinta barras y el total por encima. Nada más.

   ── POR QUÉ BARRAS Y NO UNA LÍNEA ──

   Una línea sugiere continuidad entre un día y el siguiente: que si el
   martes fue $3.000 y el miércoles $0, el jueves está "subiendo desde
   el martes". No es verdad. El día que no hubo venta es un cero, y el
   cero está ahí.

   Con barras, la altura es la magnitud y el hueco es el cero. Es menos
   elegante y dice la verdad.

   ── POR QUÉ NO UNA LIBRERÍA DE GRÁFICOS ──

   Porque esto es un histograma de treinta barras y una librería de
   gráficos son cuatrocientos kilobytes, un `ResizeObserver`, un
   contenedor con altura calculada y un modo en el que la animación de
   entrada tarda más que la respuesta de la API. Todo eso para dibujar
   treinta rectángulos.

   Y no es una decisión de vaguedad: si algún día hace falta un gráfico
   de verdad —una serie continua, un eje de horas, un zoom— entonces sí,
   y se añade la librería. El criterio es qué hay que dibujar, no qué
   herramienta hay.

   ── EL MÁXIMO ──

   Se escala al día más alto del mes, no al total. Con el total, un mes
   parejo se ve como una línea plana pegada al suelo, que es
   exactamente lo contrario de lo que quiere decir "ha ido parejo". */
export function Barra30({
  datos,
  className,
}: {
  datos: { fecha: string; total: number }[];
  className?: string;
}) {
  if (!datos.length) return null;

  const maximo = Math.max(...datos.map((d) => d.total), 1);

  return (
    <div
      className={cn("mt-4", className)}
      /* Un `role` y un texto, para quien no ve las barras. Un gráfico
         sin alternativa es un gráfico que no existe para una parte de
         la gente, y esto va en una pantalla que se mira de lado en un
         mostrador. */
      role="img"
      aria-label={`Ventas de los últimos ${datos.length} días. ` +
        `El día más alto fue ${Math.round((maximo / 100)).toLocaleString("es-AR")}.` +
        ` Total del mes: ${Math.round(datos.reduce((s, d) => s + d.total, 0) / 100).toLocaleString("es-AR")}.`}
    >
      <div className="flex h-20 items-end gap-[2px]">
        {datos.map((d, i) => {
          const vacio = d.total === 0;
          /* Un mínimo de 2 px para que el día sin venta se vea como
             cero y no como si no estuviera. La barra nula sí que dice
             "no hubo venta", pero un hueco entero parece un dato que
             falta. */
          const alto = vacio ? 2 : Math.max(4, (d.total / maximo) * 80);

          return (
            <span
              key={d.fecha}
              title={`${d.fecha}: ${vacio ? "sin venta" : Math.round(d.total / 100)}`}
              className={cn(
                "flex-1 rounded-[2px] transicion",
                vacio ? "bg-borde" : "bg-acento/70 hover:bg-acento"
              )}
              style={{ height: alto }}
              data-ultimo={i === datos.length - 1 ? "" : undefined}
            />
          );
        })}
      </div>

      <div className="mt-1.5 flex justify-between text-[0.65rem] text-apagado">
        <span>Hace 30 días</span>
        <span>Hoy</span>
      </div>
    </div>
  );
}