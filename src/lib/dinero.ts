/* =========================================================
   Inventario — Utilidades de dinero y fechas
   ---------------------------------------------------------
   Lo mínimo que hace falta en todas partes. Está aquí y no en cada
   archivo porque la duplicación de esto es la que produce un error de
   redondeo que aparece tres meses después, cuando ya no se puede
   saber de dónde salió.
   ========================================================= */

/** Pesos con el formato que usa un comercio. "$1.234,50" */
export function dinero(cents: number): string {
  const n = Math.round(cents || 0) / 100;
  return (
    "$" +
    n.toLocaleString("es-AR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** Igual que `dinero` pero sin el símbolo, para cuando va en una etiqueta. */
export function numero(cents: number): string {
  return (Math.round(cents || 0) / 100).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Centavos → número plano. Para mandar a un <input type="number">. */
export function aNumero(cents: number | string): number {
  const n = typeof cents === "string" ? parseFloat(cents) : cents;
  return Number.isFinite(n) ? n / 100 : 0;
}

/** Número plano → centavos. Redondea a entero: los centavos no admiten
    decimales, y guardar 225.5 centavos es guardar un número que no
    existe. */
export function aCentavos(valor: number | string): number {
  const n = typeof valor === "string" ? parseFloat(valor) : valor;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * La fecha de HOY en la zona horaria del comercio.
 *
 * `new Date().toISOString().slice(0,10)` da la fecha en UTC, que entre
 * las 21 y las 3 de la mañana es la del día siguiente. Para un negocio
 * que cierra a las 23, el arqueo del viernes acabaría en sábado sin que
 * nadie lo note.
 */
export function hoy(timezone: string): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return partes;
}

/** Hace N días. Para los informes de "los últimos 30 días". */
export function diasAtras(n: number, timezone: string): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Cuánto margen hay en una venta.
 *
 * El dueño lo necesita constantly y con un solo número: "esto lo vendí
 * a 225 y me costó 150, saqué 75". Es la pregunta que justifica el
 * módulo entero, y si hay que sacarla de tres sitios cada vez que se
 * mira una venta, nadie la hace.
 */
export function margen(venta: number, costo: number): number {
  if (costo <= 0) return 0;
  return Math.round(((venta - costo) / costo) * 100);
}

/** El margen en dinero, no en porcentaje. */
export function ganancia(venta: number, costo: number): number {
  return venta - costo;
}