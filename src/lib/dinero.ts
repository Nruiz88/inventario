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
 * El instante UTC de las 00:00 del día local, en ISO.
 *
 * ⚠️  POR QUÉ ESTA FUNCIÓN EXISTE, Y POR QUÉ NO BASTA CON `hoy()`
 * ------------------------------------------------
 * `hoy()` devuelve la FECHA local: "2026-10-06". Para preguntar a la base
 * por las ventas de hoy hay que convertirla en un instante, y la forma
 * fácil es `hoy() + "T00:00:00.000Z"`. Eso es medianoche UTC, que en
 * Buenos Aires son las 21:00 del día ANTERIOR.
 *
 * Consecuencia medida: el resumen decía "$0,00 vendidos hoy" con seis
 * ventas registradas. Las seis caían entre las 21 y las 24, que en un
 * kiosco es la hora punta: la del grocery, la de la prepaga y la de la
 * vuelta del trabajo.
 *
 * Y es el peor sitio posible para un fallo así, porque solo aparece
 * después de las nueve de la noche. Durante el día todo cuadra, el
 * dueño mira el resumen a las once, ve cero, y cree que le están
 * robando. O peor: no se le ocurre que el sistema esté mal y busca en
 * las ventas una por una.
 *
 * La conversión va en dos pasos y no en uno: se toma la fecha como si
 * fuera UTC, se lee qué fecha local es ese instante, y la diferencia
 * es el desfase de la zona. Se repite una vez porque hay zonas con
 * desfase de media hora, donde el primer cálculo se queda corto.
 */
export function inicioDelDia(fechaIso: string, timezone: string): string {
  /* El reloj de la zona, como si fuera UTC. Esta es la pieza clave.

     `muroComoUtc(instante)` es la hora local leída y pegada en un
     timestampa UTC. La diferencia con `instante` es el desfase de la
     zona, que es constante mientras no haya un cambio de hora en medio.

     Y el desfase es lo que hay que restar del objetivo:

         instante = objetivo - desfase

     La primera versión hacía `instante = instante - desfase`, que es
     otra cosa. Con el signo invertido, cada iteración se alejaba un día
     en vez de acercarse: para el 6 de octubre en Buenos Aires devolvía el
     8. Cinco pruebas lo cazaron, y una saying "cubre 24 horas" produjo
     un rango de -24. */
  const leerMuro = (instante: number) => {
    const d = new Date(instante);
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(d);

    const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
    /* `hour12: false` puede devolver "24" para medianoche en algunos
       navegadores. Es la medianoche del día, no del siguiente, y
       `Date.parse` lo interpretaría como 24 horas más. */
    const hora = g("hour") === "24" ? "00" : g("hour");
    return `${g("year")}-${g("month")}-${g("day")}T${hora}:${g("minute")}:${g("second")}Z`;
  };

  const objetivo = Date.parse(fechaIso + "T00:00:00.000Z");
  let instante = objetivo;

  /* Dos vueltas: la primera corrige, la segunda confirma que ya no se
     mueve. Con una sola no se puede comprobar nada. */
  for (let i = 0; i < 2; i++) {
    const desfase = Date.parse(leerMuro(instante)) - instante;
    const nuevo = objetivo - desfase;
    if (nuevo === instante) break;
    instante = nuevo;
  }

  return new Date(instante).toISOString();
}

/** El final del día local, en ISO. Exclusivo: el `lt` del día siguiente. */
export function finDelDia(fechaIso: string, timezone: string): string {
  return inicioDelDia(desplazarFecha(fechaIso, 1), timezone);
}

/**
 * La fecha `n` días después.
 *
 * El signo va en el `+`, y esa es la parte que estuvo mal: la función
 * restaba el día, así que "el fin de hoy" devolvía el principio de
 * AYER. El rango salía invertido —`hasta` un día antes de `desde`— y la
 * consulta con `.lt(hasta).gte(desde)` no devolvía nada.
 *
 * Lo detectó la prueba de "cubre 24 horas", que dio `-24`: un rango
 * invertido no es de cero horas, es de menos veinticuatro.
 */
function desplazarFecha(fechaIso: string, n: number): string {
  const [a, m, d] = fechaIso.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d + n));
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(f);
}

/**
 * El rango UTC que corresponde a un día local.
 *
 * Es lo que usan el resumen, el historial de ventas, la caja y el
 * arqueo. Los cuatro armaban "fecha local + T00:00Z", y los cuatro
 * perdían la tarde.
 */
export function rangoDelDia(fechaIso: string, timezone: string): { desde: string; hasta: string } {
  return {
    desde: inicioDelDia(fechaIso, timezone),
    hasta: finDelDia(fechaIso, timezone),
  };
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