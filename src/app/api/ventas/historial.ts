import { NextResponse } from "next/server";
import { exigeSessionApi, clienteDe, cuerpoDe, uuid, enteroEn, fallo } from "@/lib/api";
import { rangoDelDia } from "@/lib/dinero";

/* =========================================================
   GET/PATCH /api/ventas
   ---------------------------------------------------------
   El historial y las dos cosas que se le pueden hacer a una venta
   existente: anularla y marcarla como facturada.

   ⚠️  LAS VENTAS NO SE EDITAN
   ---------------------------
   Ni cantidad, ni producto, ni precio. Se anulan.

   Editar una venta parece más fácil y rompe más. Si cambias una línea,
   el stock ya se descontó con la cantidad antigua y hay que
   recalcularlo, y el movimiento de stock quedaría sin correspondencia
   con la venta. La solución es anular y volver a registrar, que deja
   los dos hechos en el historial: uno con su motivo y otro con su
   motivo.

   Es la misma razón por la que un movimiento no se edita nunca.

   LAS DOS COSAS QUE SÍ SE HACEN
   ------------------------------
   · anular: devuelve el stock, saca el dinero de la caja y deja el
     motivo. Todo eso lo hace el trigger, no esta ruta.
   · marcar como facturada: pone el número que escribió quien lo emitió
     en otro sistema. Este servicio no emite comprobantes.
   ========================================================= */

export const dynamic = "force-dynamic";

/* ---------------------------------------------------------------------
   GET — el historial
   --------------------------------------------------------------------- */
export async function GET(request: Request) {
  const g = await exigeSessionApi("/ventas");
  if (g.error) return g.error;

  const db = clienteDe(g.sesion);
  const q = new URL(request.url).searchParams;
  const zona = process.env.BUSINESS_TIMEZONE || "America/Argentina/Buenos_Aires";

  /* El filtro de fecha va en la base, no en JavaScript. Un histórico
     de un año son miles de filas y traerlas todas para descartar el
     95% en memoria funciona en local y se arrastra en un móvil. */
  const desde = q.get("desde") || "";
  const hasta = q.get("hasta") || "";

  let consulta = db
    .from("inv_ventas")
    .select(
      "id, fecha, total_cents, metodo_pago, facturada, factura_nro, anulada, " +
        "anulada_motivo, notas, cliente_id, cliente:inv_clientes(nombre), " +
        "inv_venta_items(id, cantidad, precio_unitario_cents, descuento_cents, total_cents, variante_id)"
    )
    .order("fecha", { ascending: false })
    .limit(Number(q.get("limite") || 50));

  /* El rango se convierte a instantes UTC antes de filtrar.
     `desde + "T00:00:00Z"` es medianoche UTC, que en Argentina son las 21
     del día anterior: el historial del viernes se cortaba a las nueve de
     la noche, que es justo cuando se mira. */
  if (desde) consulta = consulta.gte("fecha", rangoDelDia(desde, zona).desde);
  if (hasta) consulta = consulta.lt("fecha", rangoDelDia(hasta, zona).hasta);

  /* `soloPendientes=1` es la vista del final del día: las ventas sin
     comprobar. Es la que responde a la pregunta para la que existe el
     aviso de facturación, y por eso tiene su propio interruptor en vez
     de obliga a filtrar en el cliente. */
  if (q.get("soloPendientes") === "1") {
    consulta = consulta.eq("facturada", false).eq("anulada", false);
  }

  const { data, error } = await consulta;

  if (error) return fallo(error, "ventas GET", "No se pudieron leer las ventas.");

  /* Tipos declarados, y el JOIN normalizado: PostgREST devuelve el
     anidado como objeto o como array según lo que sepa de la relación,
     y el tipo que lo refleja es la mitad del trabajo de no leer
     `undefined` donde debería haber un nombre. */
  type LineaVenta = {
    id: string;
    variante_id: string;
    cantidad: number;
    precio_unitario_cents: number;
    descuento_cents: number;
    total_cents: number;
  };

  type Venta = {
    id: string;
    fecha: string;
    total_cents: number;
    metodo_pago: string;
    facturada: boolean;
    factura_nro: string | null;
    anulada: boolean;
    anulada_motivo: string | null;
    cliente: { nombre: string } | { nombre: string }[] | null;
    inv_venta_items: LineaVenta[] | LineaVenta | null;
  };

  const ventas = (data || []) as unknown as Venta[];

  /* Los datos del producto de cada línea vienen aparte: el anidado de
     PostgREST sobre `inv_venta_items` → variante → producto hace tres
     consultas implícitas y es lento con muchas filas. Con 50 ventas
     sale mejor hacerlo aquí y en una sola vuelta. */
  const variantes = new Set<string>();
  for (const v of ventas) {
    const lineas = Array.isArray(v.inv_venta_items)
      ? v.inv_venta_items
      : v.inv_venta_items
        ? [v.inv_venta_items]
        : [];
    for (const i of lineas) {
      if (i.variante_id) variantes.add(i.variante_id);
    }
  }

  let nombres: Record<string, string> = {};
  if (variantes.size) {
    const { data: vs } = await db
      .from("inv_variantes")
      .select("id, nombre_variante, inv_productos(nombre)")
      .in("id", [...variantes]);
    for (const v of vs || []) {
      const p = (v as any).inv_productos;
      nombres[v.id] = ((p && (Array.isArray(p) ? p[0] : p)?.nombre) || "") + " · " + (v.nombre_variante || "");
    }
  }

  return NextResponse.json({
    ok: true,
    data: ventas.map((v) => ({
      id: v.id,
      fecha: v.fecha,
      total: v.total_cents,
      metodo: v.metodo_pago,
      facturada: v.facturada,
      facturaNro: v.factura_nro,
      anulada: v.anulada,
      anuladaMotivo: v.anulada_motivo,
      cliente: (Array.isArray(v.cliente) ? v.cliente[0] : v.cliente)?.nombre || null,
      lineas: (Array.isArray(v.inv_venta_items)
        ? v.inv_venta_items
        : v.inv_venta_items
          ? [v.inv_venta_items]
          : []
      ).map((i) => ({
        nombre: nombres[i.variante_id] || "Producto borrado",
        cantidad: i.cantidad,
        precio: i.precio_unitario_cents,
        total: i.total_cents,
      })),
    })),
  });
}

/* ---------------------------------------------------------------------
   PATCH — anular, o marcar como facturada
   --------------------------------------------------------------------- */
export async function PATCH(request: Request) {
  const g = await exigeSessionApi("/ventas");
  if (g.error) return g.error;

  const { datos, error } = await cuerpoDe(request);
  if (error) return error;

  const id = uuid((datos as any)?.id);
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "No se sabe qué venta." },
      { status: 400 }
    );
  }

  const db = clienteDe(g.sesion);
  const accion = String((datos as any)?.accion || "");

  /* ── Anular ── */
  if (accion === "anular") {
    const motivo = String((datos as any)?.motivo || "").trim();

    /* El motivo es obligatorio, y no por llevar la cuenta.

       Una venta anulada sin motivo es una devolución que nadie sabe
       qué fue: si fue un error de tecleo, un producto devuelto, o una
       devolución de un cliente. Tres cosas muy distintas, y sin el
       motivo no hay forma de saber cuál, ni dos meses después.

       Y el motivo es lo que se le dice al cliente cuando pregunta por
       qué le devolvieron el dinero. */
    if (!motivo) {
      return NextResponse.json(
        { ok: false, error: "Anular una venta pide un motivo." },
        { status: 400 }
      );
    }

    /* El UPDATE no toca el stock ni la caja: lo hace el trigger
       `tr_anular_venta`, que devuelve las unidades y borra el dinero
       entrando. Si también se hiciera aquí, se devolvería dos veces.

       Esa es la razón de que los triggers sean la única vía: si dos
       sitios hacen lo mismo, cada venta anulada duplica el stock. */
    const { data, error: eUp } = await db
      .from("inv_ventas")
      .update({ anulada: true, anulada_motivo: motivo })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (eUp) return fallo(eUp, "ventas anular", "No se pudo anular la venta.");

    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Esa venta no existe o no es tuya." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: { id: data.id },
      aviso: "Venta anulada. Se devolvió el stock y se sacó el dinero de la caja.",
    });
  }

  /* ── Marcar como facturada ── */
  if (accion === "facturar") {
    const numero = String((datos as any)?.numero || "").trim();

    /* El número es obligatorio. Sin él, la venta quedaría marcada como
       facturada sin saying cuál, y el aviso de "lo que falta facturar"
       la daría por buena. Es peor no tener el aviso que tenerlo mal:
       el dueño iría a emitir otra vez algo ya emitido. */
    if (!numero) {
      return NextResponse.json(
        { ok: false, error: "Escribe el número del comprobante." },
        { status: 400 }
      );
    }

    const { data, error: eUp } = await db
      .from("inv_ventas")
      .update({ facturada: true, factura_nro: numero })
      .eq("id", id)
      .select("id, factura_nro")
      .maybeSingle();

    if (eUp) return fallo(eUp, "ventas facturar", "No se pudo marcar la venta.");
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Esa venta no existe o no es tuya." },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, data: { id: data.id, numero: data.factura_nro } });
  }

  /* ── Quitar la marca de facturada ──
     Existe por un caso real: se marcó con el número equivocado. Una
     vez marcado no se puede volver a marcar por el camino normal, así
     que sin esto habría que entrar a la base a mano. */
  if (accion === "desfacturar") {
    const { error: eUp } = await db
      .from("inv_ventas")
      .update({ facturada: false, factura_nro: null })
      .eq("id", id);

    if (eUp) return fallo(eUp, "ventas desfacturar", "No se pudo quitar la marca.");
    return NextResponse.json({ ok: true, data: { id } });
  }

  return NextResponse.json(
    { ok: false, error: "Acción no válida." },
    { status: 400 }
  );
}