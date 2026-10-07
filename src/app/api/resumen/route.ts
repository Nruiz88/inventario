import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { exigeSessionApi } from "@/lib/acceso/sesion";
import { hoy, diasAtras, rangoDelDia } from "@/lib/dinero";

/* =========================================================
   GET /api/resumen  lo que se ve al entrar
   ---------------------------------------------------------
   TODO lo que sale en una consulta. No por vagancia: cada consulta por
   separado es un viaje a la base, y en un móvil con datos lentos se nota
   la diferencia.

   a️  EL FILTRO DE STOCK SE HACE AQUÍ, NO EN LA CONSULTA
   -----------------------------------------------------
   Stock bajo significa `stock <= stock_minimo`, y eso es una comparación
   entre DOS COLUMNAS DE LA MISMA FILA. La API de Supabase no lo
   soporta con `lte()`, que compara contra un valor.

   La primera versión pasó `undefined` en el `.lte()`, que además de no
   filtrar deja una llamada rota en el código. Se borra en vez de
   dejarse: un filtro a medias es peor que no filtrar, porque parece
   que filtra.

   Con 200 productos de un kiosco, traerlos todos y filtrar aquí es
   instantáneo. Cuando sean 20.000, esto se mueve a una vista de la
   base, y no antes: una vista por adelantado es más infraestructura
   que información.

   LO QUE CALCULA, Y POR QU0
   --------------------------
   · stock bajo: lo que está en o por debajo de su mínimo.
   · a reponer: lo que está en CERO. Es distinto de "se está acabando":
     uno se repone en dos días y el otro se acaba hoy, y son compras
     distintas.
   · facturado hoy: el dinero de hoy, con la fecha del NEGOCIO. `hoy()`
     no usa `toISOString()`, que devuelve la de UTC y entre las 21 y las
     3 de la mañana es la del día siguiente.
   · sin facturar: ventas sin comprobar. Este servicio NO emite
     comprobantes, solo apunta si alguien ya lo emitió en otro sistema.
     Lo que hace es decir "estas ocho de hoy no tienen número", que es
     lo que el dueño necesita para ir a emitirlas.
   · caja del día: cuánto dinero dice que hay.
   · deuda: cuánto deben los que compraron a cuenta.
   ========================================================= */

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await exigeSessionApi("/");
  if (g.error) return g.error;
  const sesion = g.sesion;

  const db = createClient(
    process.env.SUPABASE_URL || "",
    process.env.SUPABASE_PUBLISHABLE_KEY || "",
    {
      global: { headers: { Authorization: "Bearer " + sesion.accessToken } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );

  const zona = process.env.BUSINESS_TIMEZONE || "America/Argentina/Buenos_Aires";
  const hoyIso = hoy(zona);
  const desde30 = diasAtras(30, zona);

  /* El rango del día, como instantes UTC reales.
     `hoyIso` es la fecha local ("2026-10-06") y sirve para mostrarla y
     para agrupar por día. Para FILTRAR hace falta el instante, y
     `hoyIso + "T00:00:00Z"` sería medianoche UTC: en Argentina, las 21
     del día anterior. Ver `rangoDelDia()`. */
  const rango = rangoDelDia(hoyIso, zona);
  const inicio30 = rangoDelDia(desde30, zona).desde;

  /*  Stock  */

  /* a️  POR QU0 `inv_productos` PUEDE SER UN ARRAY
   ----------------------------------------------
   PostgREST devuelve el JOIN anidado como OBJETO cuando sabe que la
   relación es de uno a muchos (una variante pertenece a un producto),
   pero devuelve ARRAY cuando no conoce la cardinalidad. Con tipos
   generados se ve claro: el mismo campo aparece a veces como objeto y
   a veces como array.

   Por eso el tipo lo declara como `| null` y hay que normalizar. Lo que
   NO se puede hacer es escribir `as { nombre: string }` a pelo: TypeScript
   avisa, con razón, porque en algún caso sí venía array y el acceso
   daba `undefined` en vez de un error. */
  type ProductoAnidado = { nombre: string } | { nombre: string }[] | null;

  type VarianteResumen = {
    id: string;
    stock: number;
    stock_minimo: number;
    nombre_variante: string;
    /* Los dos precios, para valorar el depósito. Se piden porque sin
       ellos no hay forma de saber cuánto dinero hay parado en el stock,
       que es la primera pregunta de un almacén. */
    precio_venta_cents: number;
    precio_costo_cents: number;
    inv_productos: ProductoAnidado;
  };

  /** El nombre del producto, venga como venga el JOIN anidado. */
  const nombreDe = (p: ProductoAnidado): string =>
    (Array.isArray(p) ? p[0]?.nombre : p?.nombre) || "Sin nombre";

  const { data: variantesRaw, error: eVar } = await db
    .from("inv_variantes")
    .select(
      "id, stock, stock_minimo, nombre_variante, precio_venta_cents, precio_costo_cents, inv_productos(nombre)"
    )
    .eq("activo", true)
    .limit(2000);

  if (eVar) {
    console.error("[resumen] no se pudo leer el stock:", eVar.message);
    return NextResponse.json(
      { ok: false, error: "No se pudo leer el inventario." },
      { status: 500 }
    );
  }

  const todas = (variantesRaw || []) as unknown as VarianteResumen[];
  const bajo = todas.filter((v) => v.stock <= (v.stock_minimo || 0));
  const enCero = todas.filter((v) => v.stock === 0);

  /* ── Cuánto dinero hay parado en el stock ──

     Esta es la cifra que un almacén necesita y que no sale por ninguna
     parte: cuánto hay en el depósito y a qué precio se compró. Sin ella
     no se sabe si el negocio está sano o si lleva meses acumulando
     mercadería que no se mueve, que es como se muere un kiosco sin que
     se entere.

     Se calcula aquí y no en el servidor de la pantalla porque la
     consulta de variantes ya está hecha: pedir los dos precios no
     cuesta una vuelta, y pedirlos en otro sitio sí.

     `margenStock` es lo mismo visto como rentabilidad: la diferencia
     entre lo que costó y lo que se vendería, sobre lo que se vendería.
     Con un 30 % de margen, un depósito de $100.000 representa
     $142.857 de venta futura.

     OJO CON LAS VARIANTES SIN COSTE. Una variante con precio de coste
     cero no es gratis: es una variante a la que no se le ha puesto el
     coste. Entra en el valor de venta y baja el margen, que es
     exactamente lo que hay que ver: hay stock que no se puede valorar.
     Por eso se cuentan aparte. */
  const valorStockCosto = todas.reduce(
    (suma, v) => suma + (v.stock || 0) * (v.precio_costo_cents || 0),
    0
  );
  const valorStockVenta = todas.reduce(
    (suma, v) => suma + (v.stock || 0) * (v.precio_venta_cents || 0),
    0
  );
  const sinCoste = todas.filter((v) => (v.stock || 0) > 0 && !v.precio_costo_cents).length;

  /* ── Cuánto falta para llegar al mínimo ──

     En la lista de stock bajo se veía "3" y al lado "mín. 4", y había
     que restar mentalmente para saber que faltaba uno. La pregunta de
     un comprador es "cuántas unidades me faltan", no "cuál es el
     mínimo", así que se calcula la diferencia y se enseña la
     diferencia.

     Y en unidades, no en dinero: es lo que va escrito en el pedido. */

  /*  Dinero  */
  const [ventasHoy, treinta, caja, cuentas] = await Promise.all([
    db
      .from("inv_ventas")
      .select("total_cents")
      .eq("anulada", false)
      .gte("fecha", rango.desde)
      .lt("fecha", rango.hasta),

    db
      .from("inv_ventas")
      .select("fecha, total_cents")
      .eq("anulada", false)
      .gte("fecha", desde30),

    db
      .from("inv_caja")
      .select("tipo, monto_cents")
      .gte("fecha", rango.desde)
      .lt("fecha", rango.hasta)
      .limit(500),

    db.from("inv_cuentas").select("tipo, monto_cents").limit(1000),
  ]);

  /* Suma una columna, con filtro opcional por `tipo`.

     El NOMBRE DE LA COLUMNA es un argumento y no algo fijo: `inv_caja` tiene
     `monto_cents` y `inv_ventas` tiene `total_cents`. La primera versión
     usaba `monto_cents` para todo, y al reutilizarla para las ventas salía
     "$0,00 vendidos hoy" con ocho ventas registradas: el conteo salía
     bien porque cuenta filas, y la suma daba cero porque la columna no
     existía y el `|| 0` lo tapaba.

     Un `|| 0` sobre una columna mal nombrada es el peor ocultamiento que
     hay: no da error, da cero, y el cero parece un dato. */
  const sumar = (filas: any[], columna: string, tipo?: string) =>
    (filas || [])
      .filter((f) => (tipo ? f.tipo === tipo : true))
      .reduce((s, f) => s + (f[columna] || 0), 0);

  const totalHoy = sumar(ventasHoy.data as any[], "total_cents");
  const total30 = sumar(treinta.data as any[], "total_cents");

  /* ── La serie de treinta días ──

     Treinta entradas, siempre. Los días sin venta son un cero y no un
     hueco: si se saltaran, cuatro ventas en el mes se verían como una
     barra y parecería que se vendió mucho. Un eje de tiempo que se
     contrae no es un eje de tiempo.

     Se rellena desde el más antiguo al más reciente, para que la barra
     de la derecha sea siempre la de ayer. Un dueño que mira el resumen
     un viernes espera que lo último sea el viernes. */
  const porDia: { fecha: string; total: number }[] = [];
  {
    const porFecha = new Map<string, number>();
    for (const v of (treinta.data as any[]) || []) {
      if (!v?.fecha) continue;
      const dia = String(v.fecha).slice(0, 10);
      porFecha.set(dia, (porFecha.get(dia) || 0) + (v.total_cents || 0));
    }

    const hoyDate = new Date(hoyIso + "T12:00:00Z");
    for (let i = 29; i >= 0; i--) {
      const d = new Date(hoyDate);
      d.setUTCDate(d.getUTCDate() - i);
      const iso = d.toISOString().slice(0, 10);
      porDia.push({ fecha: iso, total: porFecha.get(iso) || 0 });
    }
  }

  const cajaDelDia =
    sumar(caja.data as any[], "monto_cents", "ingreso") -
    sumar(caja.data as any[], "monto_cents", "egreso");

  /* ⚠️  LO QUE HAY EN EL CAJÓN, NO LO QUE SE MOVIÓ HOY
   * ---------------------------------------------------
   * "Entró menos lo que salió HOY" no es lo que hay en el cajón: el
   * cajón empezó el día con algo y ese algo sigue ahí. Con el
   * arqueo abierto, lo que hay es esa cantidad más el movimiento del
   * día.
   *
   * La diferencia se ve enseguida: un kiosco que abre con $8.500 y
   * gasta $7.500 con lo que entra da $1.000, no -$6.000. Mostrar el
   * movimiento del día con el rótulo "en el cajón" hace creer que el
   * dueño está en quintaperdida cuando lo único que pasó es que aún no
   *CAE la primera venta del día.
   *
   * Sin arqueo abierto no hay con qué comparar, y se devuelve null para
   * que la pantalla diga "abrí el arqueo" en vez de inventar un número. */
  let saldoCaja: number | null = null;

  const { data: arqueoHoy } = await db
    .from("inv_arqueos")
    .select("saldo_inicial_cents")
    .eq("fecha", hoyIso)
    .maybeSingle();

  if (arqueoHoy) {
    saldoCaja = (arqueoHoy.saldo_inicial_cents || 0) + cajaDelDia;
  }

  const deuda =
    sumar(cuentas.data as any[], "monto_cents", "debe") -
    sumar(cuentas.data as any[], "monto_cents", "haber");

  /*  Lo que falta por facturar  */
  const { data: sinFacturar } = await db
    .from("inv_ventas")
    .select("id, total_cents, fecha")
    .eq("anulada", false)
    .eq("facturada", false)
    .gte("fecha", desde30)
    .order("fecha", { ascending: false })
    .limit(50);

  /*  Las últimas ventas  */
  const { data: ultimas } = await db
    .from("inv_ventas")
    .select("id, fecha, total_cents, metodo_pago, facturada, cliente:inv_clientes(nombre)")
    .eq("anulada", false)
    .order("fecha", { ascending: false })
    .limit(10);

  return NextResponse.json({
    ok: true,
    data: {
      hoy: hoyIso,

      stock: {
        total: todas.length,
        bajo: bajo.length,
        /* Cuántos están en cero, que es lo que hay que reponer HOY. */
        enCero: enCero.length,
        /* El dinero que hay parado en el deposito. Sin esto no se
           sabe si el negocio esta sano: se puede estar vendiendo bien
           con el deposito lleno de mercaderia que no se mueve, y el
           banco dice que no hay nada. */
        valorCosto: valorStockCosto,
        valorVenta: valorStockVenta,
        /* El margen que lleva ese deposito, sobre el precio de venta.
           Con 30 %, un deposito de $100.000 son $142.857 de venta
           futura. */
        margenStock: valorStockVenta > 0
          ? (valorStockVenta - valorStockCosto) / valorStockVenta
          : 0,
        /* Variantes con stock y sin coste puesto. Se cuentan aparte
           porque no es un error de calculo: es informacion que falta,
           y el margen de abajo ya sale falseado por ellas. */
        sinCoste,
        /* Los diez más urgentes, primero los que están en cero. */
        lista: bajo
          .slice()
          .sort((a, b) => a.stock - b.stock)
          .slice(0, 10)
          .map((v) => ({
            id: v.id,
            nombre: nombreDe(v.inv_productos),
            variante: v.nombre_variante,
            stock: v.stock,
            minimo: v.stock_minimo || 0,
            /* Lo que hay que pedir para llegar al minimo. Es la cifra
               que va escrita en el pedido, y es la que el dueno mira:
               el minimo solo sirve para saber si hay que pedir. */
            faltan: Math.max(0, (v.stock_minimo || 0) - (v.stock || 0)),
          })),
      },

      hoy_: {
        facturado: totalHoy,
        ventas: (ventasHoy.data || []).length,
        caja: cajaDelDia,
        saldoCaja,
      },

      treintaDias: {
      porDia,
        total: total30,
        /* El promedio diario es lo que compara con "cuánto vendí el mes
           pasado", que es la pregunta de un dueño con un kiosco. */
        promedio: Math.round(total30 / 30),
      },

      facturacion: {
        /* Solo apunta. Este servicio no emite comprobantes. */
        pendientes: (sinFacturar || []).length,
        monto: (sinFacturar || []).reduce((s, v) => s + (v.total_cents || 0), 0),
        lista: (sinFacturar || []).slice(0, 10),
      },

      deuda,

      ultimasVentas: (ultimas || []).map((v: any) => ({
        id: v.id,
        fecha: v.fecha,
        total: v.total_cents,
        metodo: v.metodo_pago,
        facturada: v.facturada,
        cliente: (v.cliente && v.cliente.nombre) || null,
      })),
    },
  });
}