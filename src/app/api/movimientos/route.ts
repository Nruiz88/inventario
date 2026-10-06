import { NextResponse } from "next/server";
import { exigeSessionApi, clienteDe, cuerpoDe, uuid, enteroEn } from "@/lib/api";

/* =========================================================
   POST /api/movimientos
   ---------------------------------------------------------
   Corregir el stock a mano: mermas, devoluciones y ajustes de conteo.

   ⚠️  AQUÍ NO SE ESCRIBE EL STOCK
   -------------------------------
   Toda esta ruta delega en la función `inv_ajustar_stock()` de la
   base, y solo llama a esa función. El stock no se toca desde aquí.

   Y no es purismo. Un ajuste son DOS escrituras —cambiar el stock y
   escribir el movimiento— y hechas desde el servidor son dos
   transacciones con un hueco entre medias:

     · el stock baja a 24, el INSERT del movimiento falla → el sistema
       dice 24 y no hay nada que lo explique. Para siempre.
     · el movimiento se inserta y el UPDATE falla → el historial dice
       que salieron seis y el stock no bajó.

   Los dos estados son permanentes y silenciosos. El primero se
   descubre cuando el dueño compara el estante con el sistema; el
   segundo, cuando el arqueo no cuadra.

   Con una función de Postgres las dos escrituras van en la misma
   transacción y con la variante bloqueada (`for update`), así que dos
   cajas anotando merma a la vez no se pisan. O sale el ajuste entero, o
   no sale nada.

   ⚠️  NO HAY UN "PONER EL STOCK EN 42"
   -----------------------------------
   No existe, y es a propósito. Un campo que fija el stock a un número
   cualquiera rompe la relación entre el estante y el historial, y a
   partir de ahí el historial no explica nada.

   Aquí el movimiento dice QUÉ y POR QUÉ, y el stock lo recalcula la
   base. Si el dueño se equivocó y puso 6 de merma cuando eran 2, se
   corrige con otro ajuste de 4 hacia el otro lado, y los dos quedan a
   la vista.
   ========================================================= */

export const dynamic = "force-dynamic";

const TIPOS = ["merma", "ajuste", "devolucion"];

export async function POST(request: Request) {
  const g = await exigeSessionApi("/productos");
  if (g.error) return g.error;

  const { datos, error } = await cuerpoDe(request);
  if (error) return error;

  const varianteId = uuid((datos as any)?.varianteId);
  if (!varianteId) {
    return NextResponse.json(
      { ok: false, error: "No se sabe de qué producto es el movimiento." },
      { status: 400 }
    );
  }

  const tipo = String((datos as any)?.tipo || "");
  if (!TIPOS.includes(tipo)) {
    return NextResponse.json(
      { ok: false, error: "Tipo no válido." },
      { status: 400 }
    );
  }

  const motivo = String((datos as any)?.motivo || "").trim();
  if (!motivo) {
    return NextResponse.json(
      { ok: false, error: "Escribe qué pasó. Sin motivo, este número no se explica nunca." },
      { status: 400 }
    );
  }

  /* Positiva siempre: el tipo dice el sentido. Una cantidad negativa que
     además dice "merma" es una segunda forma de decirlo, y con dos
     formas siempre hay una mal. */
  const cantidad = enteroEn((datos as any)?.cantidad, 1, 100000);
  if (!cantidad.ok) {
    return NextResponse.json(
      { ok: false, error: "La cantidad tiene que ser un número mayor que cero." },
      { status: 400 }
    );
  }

  const db = clienteDe(g.sesion);

const { data, error: eRpc } = await db.rpc("inv_ajustar_stock", {
  p_variante: varianteId,
  p_tipo: tipo,
  p_cantidad: cantidad.valor,
  p_motivo: motivo.slice(0, 200),
  p_usuario: g.sesion.userId,
});

  if (eRpc) {
    /* Los errores de esta función están escritos para leerse, y esa es
       la razón de que viva en la base: el "no hay stock suficiente,
       quedan 4 y el movimiento es de 10" no se puede componer en
    JavaScript sin adivinar. */
    const crudo = eRpc.message || "";
    let mensaje = "No se pudo ajustar el stock.";

    if (/stock suficiente/i.test(crudo)) mensaje = crudo;
    else if (/motivo/i.test(crudo)) mensaje = "Falta el motivo del movimiento.";
    else if (/no es tuyo|no existe/i.test(crudo)) mensaje = "Ese producto no existe o no es tuyo.";
    else if (/cantidad/i.test(crudo)) mensaje = "La cantidad tiene que ser un número mayor que cero.";

    console.error("[movimientos]", crudo);

    return NextResponse.json(
      {
        ok: false,
        error: mensaje,
        detalle: process.env.NODE_ENV === "production" ? undefined : crudo,
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    /* `data` es el stock nuevo, que devuelve la función. La pantalla no
       tiene que releerlo. */
    data: { stock: data as number },
  });
}