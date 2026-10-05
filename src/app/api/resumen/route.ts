import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { exigeSessionApi } from "@/lib/acceso/sesion";
import { hoy, diasAtras } from "@/lib/dinero";

/* =========================================================
   GET /api/resumen — lo que se ve al entrar
   ---------------------------------------------------------
   TODO lo que sale en una consulta. No por vagancia: cada consulta por
   separado es un viaje a la base, y en un móvil con datos lentos se nota
   la diferencia.

   ⚠️  EL FILTRO DE STOCK SE HACE AQUÍ, NO EN LA CONSULTA
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

   LO QUE CALCULA, Y POR QUÉ
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

  /* ── Stock ── */

  /* ⚠️  POR QUÉ `inv_productos` PUEDE SER UN ARRAY
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
    inv_productos: ProductoAnidado;
  };

  /** El nombre del producto, venga como venga el JOIN anidado. */
  const nombreDe = (p: ProductoAnidado): string =>
    (Array.isArray(p) ? p[0]?.nombre : p?.nombre) || "Sin nombre";

  const { data: variantesRaw, error: eVar } = await db
    .from("inv_variantes")
    .select("id, stock, stock_minimo, nombre_variante, inv_productos(nombre)")
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

  /* ── Dinero ── */
  const [ventasHoy, treinta, caja, cuentas] = await Promise.all([
    db
      .from("inv_ventas")
      .select("total_cents")
      .eq("anulada", false)
      .gte("fecha", hoyIso + "T00:00:00.000Z"),

    db
      .from("inv_ventas")
      .select("total_cents")
      .eq("anulada", false)
      .gte("fecha", desde30),

    db
      .from("inv_caja")
      .select("tipo, monto_cents")
      .gte("fecha", hoyIso + "T00:00:00.000Z")
      .limit(500),

    db.from("inv_cuentas").select("tipo, monto_cents").limit(1000),
  ]);

  const sumar = (filas: any[], tipo?: string) =>
    (filas || [])
      .filter((f) => (tipo ? f.tipo === tipo : true))
      .reduce((s, f) => s + (f.monto_cents || 0), 0);

  const totalHoy = sumar(ventasHoy.data as any[], undefined);
  const total30 = sumar(treinta.data as any[], undefined);

  const cajaDelDia = sumar(caja.data as any[], "ingreso") - sumar(caja.data as any[], "egreso");
  const deuda = sumar(cuentas.data as any[], "debe") - sumar(cuentas.data as any[], "haber");

  /* ── Lo que falta por facturar ── */
  const { data: sinFacturar } = await db
    .from("inv_ventas")
    .select("id, total_cents, fecha")
    .eq("anulada", false)
    .eq("facturada", false)
    .gte("fecha", desde30)
    .order("fecha", { ascending: false })
    .limit(50);

  /* ── Las últimas ventas ── */
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
          })),
      },

      hoy_: {
        facturado: totalHoy,
        ventas: (ventasHoy.data || []).length,
        caja: cajaDelDia,
      },

      treintaDias: {
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