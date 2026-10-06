import { NextResponse } from "next/server";
import { exigeSessionApi, clienteDe, cuerpoDe, uuid, enteroEn, fallo } from "@/lib/api";

/* =========================================================
   GET/POST/PATCH /api/cuentas
   ---------------------------------------------------------
   Las cuentas corrientes de los clientes del comercio.

   ⚠️  ESTA TABLA NO TIENE SALDO, TIENE UN LIBRO
   ----------------------------------------------
   Podría haber un `saldo` en la ficha del cliente, y sería un error.
   Con saldo guardado no se puede responder a la pregunta que más se
   hace: "desde cuándo me debe esto".

   Aquí cada movimiento dice qué es y cuándo. El saldo es la suma, y se
   puede mostrar la lista de los que lo componen. Un saldo en una
   columna no permite ninguna de las dos cosas.

   ⚠️  SOLO SE ESCRIBE "HABER" A MANO
   -----------------------------------
   El "debe" lo pone el trigger `tr_deuda_venta` cuando hay una venta a
   cuenta corriente, porque si se anotara a mano y se olvidara, el
   cliente aparecería debiendo cero y el dueño se despertaría con un
   fiado de hace seis meses que no está en ninguna parte.

   Lo que se escribe aquí a mano es el COBRO, que es un hecho que
   ocurre fuera del sistema: el cliente vino con plata.

   Y el pago NO toca la caja. El dinero entra, pero por qué y de qué es
   cosa del arqueo; si esta ruta escribiera también en `inv_caja`, cada
   cobro se contaría dos veces.
   ========================================================= */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const g = await exigeSessionApi("/cuentas");
  if (g.error) return g.error;

  const db = clienteDe(g.sesion);
  const q = new URL(request.url).searchParams;

  /* Los clientes del comercio con su saldo. El saldo se calcula con los
     movimientos de todos ellos, no con una subconsulta por cliente: con
     veinte clientes son veinte viajes, y se hace en dos consultas. */
  const { data: clientes, error: eCli } = await db
    .from("inv_clientes")
    .select("id, nombre, telefono, documento, notas, activo")
    .order("nombre");

  if (eCli) return fallo(eCli, "cuentas GET", "No se pudieron leer los clientes.");

  const ids = (clientes || []).map((c: any) => c.id);

  let movimientos: any[] = [];
  if (ids.length) {
    const { data: movs } = await db
      .from("inv_cuentas")
      .select("id, cliente_id, tipo, monto_cents, concepto, fecha, venta_id")
      .in("cliente_id", ids)
      .order("fecha", { ascending: false })
      .limit(Number(q.get("limite") || 500));
    movimientos = movs || [];
  }

  /* El saldo de cada uno: debe menos haber. En JavaScript y no con una
     vista, porque con veinte clientes esto son dos consultas y una
     vista sería más infraestructura que información. */
  const saldoDe = new Map<string, number>();
  for (const m of movimientos) {
    const previo = saldoDe.get(m.cliente_id) || 0;
    saldoDe.set(m.cliente_id, previo + (m.tipo === "haber" ? -m.monto_cents : m.monto_cents));
  }

  const conSaldos = (clientes || []).map((c: any) => ({
    ...c,
    saldo: saldoDe.get(c.id) || 0,
    movimientos: movimientos
      .filter((m) => m.cliente_id === c.id)
      .slice(0, Number(q.get("porCliente") || 20)),
  }));

  return NextResponse.json({
    ok: true,
    data: {
      clientes: conSaldos,
      /* El total de la deuda, que es lo que el dueño necesita saber de
         un vistazo: cuánto dinero le deben. */
      total: conSaldos.reduce((s, c) => s + c.saldo, 0),
      deben: conSaldos.filter((c) => c.saldo > 0).length,
    },
  });
}

/* ---------------------------------------------------------------------
   POST — alta de cliente, y cobro
   ---------------------------------------------------------------------
   Son dos cosas en una ruta porque son la misma pantalla: una lista de
   personas y, al lado de cada una, el botón de "cobró".
   --------------------------------------------------------------------- */
export async function POST(request: Request) {
  const g = await exigeSessionApi("/cuentas");
  if (g.error) return g.error;

  const { datos, error } = await cuerpoDe(request);
  if (error) return error;

  const db = clienteDe(g.sesion);
  const accion = String((datos as any)?.accion || "");

  /* ── Alta de cliente del comercio ── */
  if (accion === "cliente" || (datos as any)?.nombre) {
    const nombre = String((datos as any)?.nombre || "").trim();

    if (!nombre) {
      return NextResponse.json(
        { ok: false, error: "El cliente necesita un nombre." },
        { status: 400 }
      );
    }

    const { data, error: eIns } = await db
      .from("inv_clientes")
      .insert({
        client_id: g.sesion.clientId,
        nombre: nombre.slice(0, 120),
        telefono: String((datos as any)?.telefono || "").trim() || null,
        documento: String((datos as any)?.documento || "").trim() || null,
        notas: String((datos as any)?.notas || "").trim() || null,
      })
      .select("id")
      .single();

    if (eIns) return fallo(eIns, "cuentas cliente", "No se pudo crear el cliente.");
    return NextResponse.json({ ok: true, data: { id: data.id } });
  }

  /* ── Un cobro ── */
  if (accion === "cobro") {
    const clienteId = uuid((datos as any)?.clienteId);
    if (!clienteId) {
      return NextResponse.json(
        { ok: false, error: "No se sabe de qué cliente es el cobro." },
        { status: 400 }
      );
    }

    const monto = enteroEn(Math.abs(Number((datos as any)?.monto || 0)), 1, 100000000);
    if (!monto.ok || monto.valor <= 0) {
      return NextResponse.json(
        { ok: false, error: "El monto tiene que ser mayor que cero." },
        { status: 400 }
      );
    }

    const { data, error: eIns } = await db
      .from("inv_cuentas")
      .insert({
        cliente_id: clienteId,
        tipo: "haber",
        monto_cents: monto.valor,
        concepto: String((datos as any)?.concepto || "pago a cuenta").trim().slice(0, 200),
        usuario_id: g.sesion.userId,
      })
      .select("id")
      .single();

    if (eIns) return fallo(eIns, "cuentas cobro", "No se pudo anotar el cobro.");

    return NextResponse.json({
      ok: true,
      data: { id: data.id },
      /* El aviso dice que no tocó la caja, porque es lo que más
         confunde: el dueño ve el saldo bajar y el número de la caja no
         cambiar, y piensa que no se registró. */
      aviso: "Cobro anotado. La deuda bajó; el dinero entra a caja por separado.",
    });
  }

  return NextResponse.json({ ok: false, error: "No se sabe qué hacer." }, { status: 400 });
}

/* ---------------------------------------------------------------------
   PATCH — un ajuste sin movimiento de dinero
   ---------------------------------------------------------------------
   Para lo que no es ni venta ni cobro: un perdón, una carga que se
   anotó de más, un error de tipeo.

   El `tipo` es 'nota' y no toca ni stock ni caja: solo el saldo. Por eso
   es la única operación aquí que se puede hacer sin más.
   --------------------------------------------------------------------- */
export async function PATCH(request: Request) {
  const g = await exigeSessionApi("/cuentas");
  if (g.error) return g.error;

  const { datos, error } = await cuerpoDe(request);
  if (error) return error;

  const clienteId = uuid((datos as any)?.clienteId);
  if (!clienteId) {
    return NextResponse.json({ ok: false, error: "No se sabe de qué cliente." }, { status: 400 });
  }

  const monto = enteroEn(Math.abs(Number((datos as any)?.monto || 0)), 1, 100000000);
  if (!monto.ok || monto.valor <= 0) {
    return NextResponse.json({ ok: false, error: "El monto tiene que ser mayor que cero." }, { status: 400 });
  }

  const db = clienteDe(g.sesion);

  const { data, error: eIns } = await db
    .from("inv_cuentas")
    .insert({
      cliente_id: clienteId,
      tipo: "nota",
      /* El signo va en la dirección del ajuste. 'debe' suma deuda,
         'haber' la resta. Igual que en los movimientos de stock: el
         tipo dice el sentido y el número es positivo. */
      monto_cents: monto.valor,
      concepto: String((datos as any)?.concepto || "ajuste").trim().slice(0, 200),
      usuario_id: g.sesion.userId,
    })
    .select("id")
    .single();

  if (eIns) return fallo(eIns, "cuentas nota", "No se pudo anotar el ajuste.");
  return NextResponse.json({ ok: true, data: { id: data.id } });
}