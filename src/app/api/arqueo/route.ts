import { NextResponse } from "next/server";
import { exigeSessionApi, clienteDe, cuerpoDe, enteroEn, fallo } from "@/lib/api";
import { hoy } from "@/lib/dinero";

/* =========================================================
   GET/POST/PATCH /api/arqueo
   ---------------------------------------------------------
   Abrir y cerrar el día.

   ⚠️  LA DIFERENCIA NO LA ESCRIBE NADIE
   ------------------------------------
   Es lo único de todo el servicio que el dueño NO controla, y es a
   propósito.

   Si el dueño escribiera la diferencia, el arqueo no serviría para nada:
   contaría 50.000, el sistema diría 60.000, y pondría "-10.000" a mano.
   Cada día saldría exactamente la diferencia que le conviene, y el
   arqueo se volvería un trámite.

   Para que valga algo tiene que poder salir un número que no cuadre. El
   trigger `calcular_diferencia_arqueo` la calcula como real − calculado
   al cerrar, y no hay forma de escribirla a mano.

   POR QUÉ ES UN `INSERT` Y LUEGO UN `UPDATE`
   ------------------------------------------
   Porque el flujo real es en dos momentos: se abre la caja por la
   mañana con lo que hay, y se cierra por la noche con lo que se contó.

   Abrir y cerrar de una vez, como se puede hacer en un formulario, es
   el atajo: el dueño abre el día, no ve un número, y escribe el saldo
   final. El sistema no tiene con qué comparar, y la diferencia siempre
   sale 0.

   UN ARQUEO POR DÍA
   -----------------
   Hay un índice único en `(client_id, fecha)`. Sin él se pueden abrir
   dos y "el saldo del día" deja de significar nada: ¿sumo los dos?
   ¿el último? No hay respuesta, y por eso no se permite.
   ========================================================= */

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await exigeSessionApi("/caja");
  if (g.error) return g.error;

  const db = clienteDe(g.sesion);
  const zona = process.env.BUSINESS_TIMEZONE || "America/Argentina/Buenos_Aires";
  const hoyIso = hoy(zona);

  const { data: hoyRow, error } = await db
    .from("inv_arqueos")
    .select(
      "id, fecha, saldo_inicial_cents, saldo_calculado_cents, saldo_real_cents, " +
        "diferencia_cents, notas, cerrado_en"
    )
    .eq("fecha", hoyIso)
    .maybeSingle();

  if (error) return fallo(error, "arqueo GET", "No se pudo leer el arqueo.");

  /* Los últimos, para ver la serie. Un commerce normal quiere ver si
     mañana faltó dinero, y eso solo se ve en la lista. */
  const { data: ultimos } = await db
    .from("inv_arqueos")
    .select("fecha, saldo_inicial_cents, saldo_real_cents, diferencia_cents, cerrado_en")
    .order("fecha", { ascending: false })
    .limit(14);

  /* El saldo que dice la caja de hoy, que es lo que se compara con lo
     que se cuenta. */
  const { data: movimientos } = await db
    .from("inv_caja")
    .select("tipo, monto_cents")
    .gte("fecha", hoyIso + "T00:00:00.000Z")
    .limit(500);

  const ingresos = (movimientos || [])
    .filter((m: any) => m.tipo === "ingreso")
    .reduce((s: number, m: any) => s + m.monto_cents, 0);
  const egresos = (movimientos || [])
    .filter((m: any) => m.tipo === "egreso")
    .reduce((s: number, m: any) => s + m.monto_cents, 0);

  /* El tipo va declarado. Sin él, `hoyRow` sale como unión con el error
     de PostgREST y hay que comprobar cada propiedad, que es ruido que
     esconde el caso real: que no hay arqueo. */
  type Arqueo = {
    id: string;
    fecha: string;
    saldo_inicial_cents: number;
    saldo_calculado_cents: number | null;
    saldo_real_cents: number | null;
    diferencia_cents: number | null;
    notas: string | null;
    cerrado_en: string | null;
  };

  const arqueo = hoyRow as Arqueo | null;
  const inicial = arqueo?.saldo_inicial_cents ?? 0;

  return NextResponse.json({
    ok: true,
    data: {
      fecha: hoyIso,
      /* `null` = abierto. La pantalla sabe si tiene que preguntar por el
         saldo inicial o por el saldo contado. */
      abierto: Boolean(arqueo && !arqueo.cerrado_en),
      cerrado: Boolean(arqueo?.cerrado_en),
      arqueo: arqueo
        ? {
            id: arqueo.id,
            inicial,
            calculado: arqueo.saldo_calculado_cents,
            real: arqueo.saldo_real_cents,
            diferencia: arqueo.diferencia_cents,
            notas: arqueo.notas,
          }
        : null,
      caja: { ingresos, egresos, saldo: ingresos - egresos },
      /* Lo que el sistema dice que hay: lo que se abrió más lo que ha
         entrado menos lo que ha salido. Es el número con el que se
         compara lo que se cuenta. */
      esperado: inicial + ingresos - egresos,
      ultimos: (ultimos || []).map((a: any) => ({
        fecha: a.fecha,
        diferencia: a.diferencia_cents,
        cerrado: Boolean(a.cerrado_en),
      })),
    },
  });
}

/* POST — abrir el día */
export async function POST(request: Request) {
  const g = await exigeSessionApi("/caja");
  if (g.error) return g.error;

  const { datos, error } = await cuerpoDe(request);
  if (error) return error;

  const db = clienteDe(g.sesion);
  const zona = process.env.BUSINESS_TIMEZONE || "America/Argentina/Buenos_Aires";
  const fecha = String((datos as any)?.fecha || hoy(zona));

  /* Un arqueo por día. El error si ya existe lo deja claro el índice
     único, y no se comprueba antes: sería una carrera, y una carrera en
     la que dos cajas abren el mismo día a la vez deja dos arqueos. */
  const inicial = enteroEn((datos as any)?.saldoInicial, 0, 100000000);
  if (!inicial.ok) {
    return NextResponse.json(
      { ok: false, error: "El saldo inicial tiene que ser un número." },
      { status: 400 }
    );
  }

  const { data, error: eIns } = await db
    .from("inv_arqueos")
    .insert({
      client_id: g.sesion.clientId,
      fecha,
      saldo_inicial_cents: inicial.valor,
      notas: String((datos as any)?.notas || "").trim() || null,
    })
    .select("id, fecha")
    .single();

  if (eIns) {
    /* 23505 = índice único violado: ya hay arqueo de ese día. */
    if (String(eIns.message).includes("duplicate") || eIns.code === "23505") {
      return NextResponse.json(
        { ok: false, error: "Ese día ya tiene arqueo." },
        { status: 409 }
      );
    }
    return fallo(eIns, "arqueo POST", "No se pudo abrir el arqueo.");
  }

  return NextResponse.json({ ok: true, data: { id: data.id, fecha: data.fecha } });
}

/* PATCH — cerrar el día */
export async function PATCH(request: Request) {
  const g = await exigeSessionApi("/caja");
  if (g.error) return g.error;

  const { datos, error } = await cuerpoDe(request);
  if (error) return error;

  const id = String((datos as any)?.id || "");
  const real = enteroEn((datos as any)?.saldoReal, 0, 100000000);

  if (!id) {
    return NextResponse.json({ ok: false, error: "No se sabe qué arqueo cerrar." }, { status: 400 });
  }
  if (!real.ok) {
    return NextResponse.json(
      { ok: false, error: "El saldo contado tiene que ser un número." },
      { status: 400 }
    );
  }

  const db = clienteDe(g.sesion);

  /* Solo se manda `saldo_real_cents`. El `diferencia_cents` NO se
     escribe: la calcula el trigger. Si se mandara, el UPDATE lo
     pisaría después de pasarlo por el trigger, y volvería a ser un
     número que el dueño elige. */
  const { data, error: eUp } = await db
    .from("inv_arqueos")
    .update({
      saldo_real_cents: real.valor,
      notas: (datos as any)?.notas !== undefined
        ? String((datos as any).notas).trim() || null
        : undefined,
    })
    .eq("id", id)
    .select("id, saldo_calculado_cents, saldo_real_cents, diferencia_cents, cerrado_en")
    .single();

  if (eUp) return fallo(eUp, "arqueo PATCH", "No se pudo cerrar el arqueo.");

  return NextResponse.json({
    ok: true,
    data: {
      id: data.id,
      calculado: data.saldo_calculado_cents,
      real: data.saldo_real_cents,
      /* Se devuelve para que la pantalla la muestre. Es el momento en
         que el dueño ve si el día cerró bien, y si no lo ve, el arqueo
         se archivó sin que nadie mirara el número. */
      diferencia: data.diferencia_cents,
    },
  });
}