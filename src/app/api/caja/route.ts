import { NextResponse } from "next/server";
import { exigeSessionApi, clienteDe, cuerpoDe, uuid, enteroEn, fallo } from "@/lib/api";
import { hoy } from "@/lib/dinero";

/* =========================================================
   GET/POST /api/caja
   ---------------------------------------------------------
   Lo que entra y sale del cajón.

   ⚠️  ESTA TABLA NO SE TOCA NUNCA A MANO DESDE AQUÍ
   ---------------------------------------------------
   Escribir en `inv_caja` directamente es el error más fácil de
   cometer y el que más caro sale, porque el arqueo cuadra o no cuadra
   según lo que haya en esta tabla.

   Lo que se permite anotar a mano es lo que NO viene de una venta:

     · gasto      luz, agua, el alcoolero, el cartonero
     · retiro     el dueño se lleva dinero. Es la causa más común de
                  que falte caja sin que nadie entienda por qué.
     · compra     el pago al proveedor
     · pago_deuda lo que un cliente paga de su cuenta corriente
     · otro       lo que no encaja en ninguno

   Y lo que se anota SOLO es lo de las ventas en efectivo, y lo pone el
   trigger `tr_deuda_venta`. Si también se pusiera aquí, cada venta en
   efectivo sumaría dos veces al cajón.

   La diferencia entre el ingreso y el egreso la dice `tipo`, y el
   `monto_cents` es SIEMPRE positivo. Nunca se escribe un negativo: es
   la forma de tener dos maneras de decir lo mismo y que una de ellas
   esté mal.

   Y el `concepto` es obligatorio, porque una entrada de 5000 sin decir
   de qué es un arqueo que no sirve para encontrar el error.
   ========================================================= */

export const dynamic = "force-dynamic";

const CATEGORIAS = ["gasto", "retiro", "compra", "pago_deuda", "otro"];

export async function GET(request: Request) {
  const g = await exigeSessionApi("/caja");
  if (g.error) return g.error;

  const db = clienteDe(g.sesion);
  const q = new URL(request.url).searchParams;
  const zona = process.env.BUSINESS_TIMEZONE || "America/Argentina/Buenos_Aires";

  /* Por defecto, HOY. Es la pregunta que se hace el dueño: "cuánto
     tengo en el cajón". El rango abierto se pide explícitamente. */
  const desde = q.get("desde") || hoy(zona);
  const hasta = q.get("hasta") || hoy(zona);

  const { data, error } = await db
    .from("inv_caja")
    .select("id, fecha, tipo, categoria, monto_cents, concepto, venta_id, compra_id")
    .gte("fecha", desde + "T00:00:00.000Z")
    .lt("fecha", new Date(Date.parse(hasta + "T00:00:00.000Z") + 86400000).toISOString())
    .order("fecha", { ascending: false })
    .limit(Number(q.get("limite") || 200));

  if (error) return fallo(error, "caja GET", "No se pudieron leer los movimientos.");

  const filas = data || [];
  const ingresos = filas.filter((f: any) => f.tipo === "ingreso").reduce((s: number, f: any) => s + f.monto_cents, 0);
  const egresos = filas.filter((f: any) => f.tipo === "egreso").reduce((s: number, f: any) => s + f.monto_cents, 0);

  return NextResponse.json({
    ok: true,
    data: {
      desde,
      hasta,
      ingresos,
      egresos,
      /* El saldo es la suma de lo de este rango. NO es "el dinero que hay
         en el cajón": eso es el saldo del arqueo, que suma desde la
         apertura. Confundir los dos hace que el dueño.compare el número
         del cajón con uno que no incluye lo de ayer y piense que falta
         dinero. */
      saldo: ingresos - egresos,
      movimientos: filas.map((f: any) => ({
        id: f.id,
        fecha: f.fecha,
        tipo: f.tipo,
        categoria: f.categoria,
        monto: f.monto_cents,
        concepto: f.concepto,
        deVenta: Boolean(f.venta_id),
      })),
    },
  });
}

export async function POST(request: Request) {
  const g = await exigeSessionApi("/caja");
  if (g.error) return g.error;

  const { datos, error } = await cuerpoDe(request);
  if (error) return error;

  const db = clienteDe(g.sesion);

  const tipo = String((datos as any)?.tipo || "");
  if (tipo !== "ingreso" && tipo !== "egreso") {
    return NextResponse.json(
      { ok: false, error: "El movimiento tiene que ser ingreso o egreso." },
      { status: 400 }
    );
  }

  const categoria = String((datos as any)?.categoria || "");
  if (!CATEGORIAS.includes(categoria)) {
    return NextResponse.json(
      { ok: false, error: "Categoría no válida." },
      { status: 400 }
    );
  }

  const concepto = String((datos as any)?.concepto || "").trim();
  if (!concepto) {
    /* Sin concepto, una entrada de 5000 no dice de qué es. Y el
       arqueo sirve justo para encontrar el movimiento raro, que es el
       único para el que está. */
    return NextResponse.json(
      { ok: false, error: "Escribe de qué es el movimiento." },
      { status: 400 }
    );
  }

  /* El monto es positivo siempre, y el `tipo` dice la dirección. Se
     acepta un negativo del cliente y se le quita el signo, porque quien
     lo escribe piensa en "salen 200", no en "un egreso de 200". */
  const monto = enteroEn(Math.abs(Number((datos as any)?.monto || 0)), 1, 100000000);
  if (!monto.ok || monto.valor <= 0) {
    return NextResponse.json(
      { ok: false, error: "El monto tiene que ser un número mayor que cero." },
      { status: 400 }
    );
  }

  const { data, error: eIns } = await db
    .from("inv_caja")
    .insert({
      client_id: g.sesion.clientId,
      tipo,
      categoria,
      monto_cents: monto.valor,
      concepto: concepto.slice(0, 200),
      usuario_id: g.sesion.userId,
    })
    .select("id")
    .single();

  if (eIns) return fallo(eIns, "caja POST", "No se pudo anotar el movimiento.");

  return NextResponse.json({ ok: true, data: { id: data.id } });
}

/* ---------------------------------------------------------------------
   DELETE — quitar un movimiento
   ---------------------------------------------------------------------
   Existe, y solo para los de tipo `otro`, que son los que se anotan
   por error. Los de una venta NO se borran: los pone un trigger, y
   borrarlos a mano rompe la correspondencia entre la venta y el
   dinero.
   --------------------------------------------------------------------- */
export async function DELETE(request: Request) {
  const g = await exigeSessionApi("/caja");
  if (g.error) return g.error;

  const { datos, error } = await cuerpoDe(request);
  if (error) return error;

  const id = uuid((datos as any)?.id);
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "No se sabe qué movimiento." },
      { status: 400 }
    );
  }

  const db = clienteDe(g.sesion);

  const { data, error: eDel } = await db
    .from("inv_caja")
    .delete()
    .eq("id", id)
    .is("venta_id", null)
    .is("compra_id", null)
    .select("id")
    .maybeSingle();

  if (eDel) return fallo(eDel, "caja DELETE", "No se pudo quitar el movimiento.");

  if (!data) {
    /* 0 filas: o no existe, o es el movimiento de una venta. Las dos
       cosas se dicen igual a propósito. */
    return NextResponse.json(
      { ok: false, error: "Ese movimiento no se puede quitar: viene de una venta o una compra." },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true, data: { id: data.id } });
}