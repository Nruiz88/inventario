import { NextResponse } from "next/server";
import { exigeSessionApi, clienteDe, cuerpoDe, uuid, enteroEn, fallo } from "@/lib/api";

/* =========================================================
   GET/POST/PATCH /api/compras
   ---------------------------------------------------------
   Pedidos a proveedor.

   ⚠️  EL STOCK ENTRA AL RECIBIR, NO AL ANOTAR
   --------------------------------------------
   Es lo más importante de este módulo y no lo hace esta ruta: lo hace
   el trigger `tr_stock_compra`. Aquí solo se escribe el estado.

   La tentación es descontar aquí, "para que el dueño vea que llegó".
   Sería un error con consecuencias: el dueño abre el pedido por la
   mañana, se distrae, y nunca lo marca recibido. El inventario
   mostraría mercadería que no ha llegado, y "qué tengo" sería mentira.

   La consecuencia de esto se nota en las pruebas: no se puede volver de
   `recibida` a `borrador`. Una compra recibida se anula, que deja
   rastro. Es deliberado y da un error explícito.

   ⚠️  EL COSTO LO PONE EL SERVIDOR, Y SE CONGELA
   -----------------------------------------------
   Al recibir una compra, el costo unitario pasa a ser el de la variante
   (lo del trigger) y eso recalcula el margen de las ventas futuras.

   Por eso el costo de la COMPRA se congela en `inv_compra_items`: si el
   proveedor sube el precio mañana, lo que se pagó por esto sigue siendo
   esto. Y `inv_venta_items` congela el precio de venta por la misma
   razón, en el otro lado.

   Eso es lo que hace que un cambio de precios no reescriba el
   histórico: cada línea guarda lo que valía el día que se hizo.
   ========================================================= */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const g = await exigeSessionApi("/compras");
  if (g.error) return g.error;

  const db = clienteDe(g.sesion);
  const q = new URL(request.url).searchParams;

  let consulta = db
    .from("inv_compras")
    .select(
      "id, fecha, estado, factura_nro, total_cents, notas, recibido_en, " +
        "proveedor_id, proveedor:inv_proveedores(nombre), " +
        "inv_compra_items(id, cantidad, costo_unitario_cents, total_cents, variante_id)"
    )
    .order("fecha", { ascending: false })
    .limit(Number(q.get("limite") || 50));

  if (q.get("estado")) consulta = consulta.eq("estado", q.get("estado"));

  const { data, error } = await consulta;
  if (error) return fallo(error, "compras GET", "No se pudieron leer las compras.");

  /* El tipo va declarado. Sin él, `data` sale como unión con el error
     de PostgREST y hay que comprobar cada campo. Y el JOIN anidado
     `inv_compra_items` puede venir como objeto o como array según lo
     que PostgREST sepa de la relación, así que se normaliza igual que
     en el resumen. */
  type Linea = { variante_id: string; cantidad: number; costo_unitario_cents: number; total_cents: number };
  type Compra = {
    id: string;
    fecha: string;
    estado: string;
    factura_nro: string | null;
    total_cents: number;
    notas: string | null;
    recibido_en: string | null;
    proveedor: { nombre: string } | { nombre: string }[] | null;
    inv_compra_items: Linea[] | Linea | null;
  };
  const compras = (data || []) as unknown as Compra[];

  const variantes = new Set<string>();
  for (const c of compras) {
    const lineas = Array.isArray(c.inv_compra_items)
      ? c.inv_compra_items
      : c.inv_compra_items
        ? [c.inv_compra_items]
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
    data: compras.map((c) => ({
      id: c.id,
      fecha: c.fecha,
      estado: c.estado,
      facturaNro: c.factura_nro,
      total: c.total_cents,
      notas: c.notas,
      recibidoEn: c.recibido_en,
      proveedor: (Array.isArray(c.proveedor) ? c.proveedor[0] : c.proveedor)?.nombre || null,
      lineas: (Array.isArray(c.inv_compra_items)
        ? c.inv_compra_items
        : c.inv_compra_items
          ? [c.inv_compra_items]
          : []
      ).map((i) => ({
        nombre: nombres[i.variante_id] || "Producto borrado",
        cantidad: i.cantidad,
        costo: i.costo_unitario_cents,
        total: i.total_cents,
      })),
    })),
  });
}

/* ---------------------------------------------------------------------
   POST — anotar un pedido
   --------------------------------------------------------------------- */
export async function POST(request: Request) {
  const g = await exigeSessionApi("/compras");
  if (g.error) return g.error;

  const { datos, error } = await cuerpoDe(request);
  if (error) return error;

  const db = clienteDe(g.sesion);

  const lineas = Array.isArray((datos as any)?.lineas) ? (datos as any).lineas : [];
  if (!lineas.length) {
    return NextResponse.json(
      { ok: false, error: "El pedido no tiene productos." },
      { status: 400 }
    );
  }

  /* Cada línea se valida y se limpia ANTES de tocar la base. Validar
     sobre la marcha, línea a línea, es como se acaba guardando medio
     pedido: la tercera línea falla y las dos primeras ya están
     escritas. */
  const limpias: { varianteId: string; cantidad: number; costo: number }[] = [];

  for (const l of lineas) {
    const varianteId = uuid(l?.varianteId);
    if (!varianteId) {
      return NextResponse.json(
        { ok: false, error: "Hay una línea sin producto." },
        { status: 400 }
      );
    }

    const cantidad = enteroEn(l?.cantidad, 1, 100000);
    if (!cantidad.ok) {
      return NextResponse.json(
        { ok: false, error: "Hay una línea con cantidad inválida." },
        { status: 400 }
      );
    }

    const costo = enteroEn(l?.costo, 0, 100000000);
    if (!costo.ok) {
      return NextResponse.json(
        { ok: false, error: "Hay una línea con costo inválida." },
        { status: 400 }
      );
    }

    limpias.push({ varianteId, cantidad: cantidad.valor, costo: costo.valor });
  }

  /* El precio de venta NO se toca aquí. Es lo que hace el trigger al
     recibirse, y solo si no viene en cero. */
  const proveedorId = uuid((datos as any)?.proveedorId);

  const { data: compra, error: eCompra } = await db
    .from("inv_compras")
    .insert({
      client_id: g.sesion.clientId,
      proveedor_id: proveedorId,
      factura_nro: String((datos as any)?.facturaNro || "").trim() || null,
      notas: String((datos as any)?.notas || "").trim() || null,
      usuario_id: g.sesion.userId,
    })
    .select("id")
    .single();

  if (eCompra) return fallo(eCompra, "compras POST", "No se pudo anotar el pedido.");

  const { error: eItems } = await db.from("inv_compra_items").insert(
    limpias.map((l) => ({
      compra_id: compra.id,
      variante_id: l.varianteId,
      cantidad: l.cantidad,
      costo_unitario_cents: l.costo,
    }))
  );

  if (eItems) {
    /* La compra se queda creada y sin líneas, que es un estado que no
       significa nada y en el que el trigger no puede hacer su trabajo.
       Se deshace. */
    await db.from("inv_compras").delete().eq("id", compra.id);
    return NextResponse.json(
      { ok: false, error: "No se pudieron guardar los productos. No se anotó nada." },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: { id: compra.id },
    aviso: "Pedido anotado. El stock entra cuando lo marques como recibido.",
  });
}

/* ---------------------------------------------------------------------
   PATCH — recibir o anular
   --------------------------------------------------------------------- */
export async function PATCH(request: Request) {
  const g = await exigeSessionApi("/compras");
  if (g.error) return g.error;

  const { datos, error } = await cuerpoDe(request);
  if (error) return error;

  const id = uuid((datos as any)?.id);
  const accion = String((datos as any)?.accion || "");

  if (!id) {
    return NextResponse.json(
      { ok: false, error: "No se sabe qué compra." },
      { status: 400 }
    );
  }

  const db = clienteDe(g.sesion);

  /* ── Recibida: el stock entra ──
     Solo se cambia el estado. Todo lo demás lo hace el trigger. */
  if (accion === "recibir") {
    const { data, error: eUp } = await db
      .from("inv_compras")
      .update({ estado: "recibida" })
      .eq("id", id)
      .eq("estado", "borrador")
      .select("id")
      .maybeSingle();

    if (eUp) return fallo(eUp, "compras recibir", "No se pudo marcar como recibida.");

    /* 0 filas: o no existe, o no estaba en borrador. Si ya estaba
       recibida, el trigger no vuelve a mover el stock (comprueba que
       venía de no recibida), así que repetir la acción es inofensivo.
       Pero si vino en blanco no se puede saber cuál de las dos cosas es,
       y el mensaje lo cubre sin decir cuál. */
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Esa compra no existe, no es tuya o ya estaba recibida." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: { id: data.id },
      aviso: "Recibida. El stock ya entró.",
    });
  }

  /* ── Anulada ──
     Anular una compra recibida saca el stock que entró, igual que
     anular una venta devuelve lo que se vendió. Un trigger
     (`tr_stock_compra`) lo hace cuando el estado pasa a 'anulada'. */
  if (accion === "anular") {
    const motivo = String((datos as any)?.motivo || "").trim();
    if (!motivo) {
      return NextResponse.json(
        { ok: false, error: "Anular una compra pide un motivo." },
        { status: 400 }
      );
    }

    const { data, error: eUp } = await db
      .from("inv_compras")
      .update({ estado: "anulada", notas: motivo })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (eUp) return fallo(eUp, "compras anular", "No se pudo anular la compra.");
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Esa compra no existe o no es tuya." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: { id: data.id },
      aviso: "Compra anulada. Se sacó el stock que había entrado.",
    });
  }

  return NextResponse.json(
    { ok: false, error: "Acción no válida." },
    { status: 400 }
  );
}