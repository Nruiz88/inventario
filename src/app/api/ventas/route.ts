import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { exigeSessionApi } from "@/lib/acceso/sesion";
import { getAdmin } from "@/lib/db";
import { GET, PATCH } from "./historial";

/* El historial y las acciones sobre una venta existente. El POST de
   abajo es el que guarda una venta nueva. */
export { GET, PATCH };

/* =========================================================
   POST /api/ventas — guardar una venta
   ---------------------------------------------------------
   Las cuatro cosas que esta ruta hace bien, y que son las que la hacen
   distinta de "un INSERT más":

   1. TIRA SI NO HAY STOCK. Y no avisa al final: lo comprueba ANTES de
      escribir nada. Un trigger puede rechazar un INSERT, pero para
      entonces ya se escribió la venta y quedó una venta huérfana sin
      líneas.

   2. USA UNA TRANSACCIÓN. O entra la venta entera con sus líneas, o no
      entra nada. Sin esto, si falla la tercera línea de cinco, quedan
      la venta y dos ítems, y el stock de los dos está descontado. Se
      corrige a mano, o no se corrige.

   3. EL PRECIO LO PONE EL SERVIDOR. El cliente manda "quiero el
      producto X", no "me lo vendo a 1 peso". Si el precio viniera del
      navegador, cualquiera que abriera las herramientas deldeveloper
      podría vender todo a un peso.

   4. EL STOCK SE DESCUENTA EN LA BASE, CON UN TRIGGER. No aquí. Aquí
      solo se comprueba que hay, y la base descuenta. Si los dos lo
      hacen, cada venta descuenta dos veces.

   POR QUÉ `ejecutar_sql` Y NO LA API ENCADENADA
   ---------------------------------------------
   Porque hace falta una transacción con varias consultas y condicionales,
   y `ejecutar_sql` es la única vía que las tiene. La alternativa sería
   orquestar desde el servidor con la API encadenada, con una
   compensación a mano si algo falla, que es peor.

   Y porque el precio sale de la BASE dentro del `select`, no de un
   `select` aparte en JavaScript. Entre una consulta y otra, otro
   terminal puede cambiar el precio: en un kiosco con dos cajas, el
   precio que se leyó hace un segundo puede no ser el de ahora.
   ========================================================= */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const g = await exigeSessionApi("/");
  if (g.error) return g.error;
  const sesion = g.sesion;

  let cuerpo: {
    items?: { varianteId?: string; cantidad?: number }[];
    metodoPago?: string;
    clienteId?: string | null;
  };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la petición." }, { status: 400 });
  }

  const items = (cuerpo.items || [])
    .filter((i) => i && i.varianteId && Number(i.cantidad) > 0)
    .map((i) => ({ varianteId: String(i.varianteId), cantidad: Math.floor(Number(i.cantidad)) }));

  if (!items.length) {
    return NextResponse.json({ ok: false, error: "La venta no tiene nada." }, { status: 400 });
  }

  const METODOS = ["efectivo", "tarjeta", "transferencia", "cuenta_corriente"];
  const metodo = String(cuerpo.metodoPago || "");
  if (!METODOS.includes(metodo)) {
    return NextResponse.json(
      { ok: false, error: "Forma de pago no válida." },
      { status: 400 }
    );
  }

  /* ── Se ejecuta todo en una transacción ── */
  const sql = `
    begin;

    -- 1. Precio y stock, LEÍDOS de la base. El cliente no los manda.
    create temp table _lineas on commit drop as
      select v.id, v.precio_venta_cents, v.stock, v.precio_costo_cents,
             p.id as producto_id
        from inv_variantes v
        join inv_productos p on p.id = v.producto_id
       where v.id = any($1::uuid[])
         and p.client_id = $2
         and v.activo = true
         and p.activo = true;

    -- 2. Lo que se ha pedido tiene que existir y ser de este cliente.
    --    Sin esto, un cliente podría mandar el id de otro.
    if (select count(*) from _lineas) <> (select count(*) from unnest($1::uuid[])) then
      raise exception 'Alguno de los productos no existe o no es tuyo';
    end if;

    -- 3. Y tiene que haber stock. ESTO VA ANTES DE ESCRIBIR NADA, que es
    --    lo que evita dejar una venta a medias.
    if exists (
      select 1 from _lineas l
        join unnest($3::int[]) as q(cantidad) on true
      where l.stock < q.cantidad
    ) then
      raise exception 'No hay stock suficiente de algún producto';
    end if;

    -- 4. La venta, vacía. El total lo calcula el trigger de las líneas.
    insert into inv_ventas (client_id, cliente_id, metodo_pago, usuario_id)
    values ($2, $4, $5, $6)
    returning id into _venta;

    -- 5. Las líneas, con el precio de la BASE.
    insert into inv_venta_items (venta_id, variante_id, cantidad, precio_unitario_cents)
    select _venta, l.id, q.cantidad, l.precio_venta_cents
      from _lineas l
      join unnest($3::int[]) as q(cantidad) on true;

    -- 6. El total, y el motivo de la deuda si es a cuenta.
    --    (la deuda y el efectivo los genera el trigger de total_cents)

    update inv_ventas v
       set total_cents = (select coalesce(sum(total_cents), 0) from inv_venta_items where venta_id = v.id)
     where v.id = _venta;

    commit;

    select v.id, v.total_cents, v.facturada, v.metodo_pago
      from inv_ventas v where v.id = _venta;
  `;

  try {
    const { data, error } = await getAdmin().rpc("ejecutar_sql", {
      consulta: sql,
      args: [
        items.map((i) => i.varianteId),
        sesion.clientId,
        items.map((i) => i.cantidad),
        cuerpo.clienteId || null,
        metodo,
        sesion.userId,
      ],
    });

    if (error) {
      /* El mensaje de Postgres llega tal cual, y algunos son internos.
         Se traduce a algo que el dueño pueda leer, y el detalle se queda
         en el log. */
      const crudo = error.message || "";
      let mensaje = "No se pudo guardar la venta.";

      if (/no hay stock suficiente/i.test(crudo)) {
        mensaje = "No hay stock suficiente de algún producto.";
      } else if (/no existe o no es tuyo/i.test(crudo)) {
        mensaje = "Uno de los productos no existe o ya no está disponible.";
      } else if (/formato|uuid|invalid input/i.test(crudo)) {
        mensaje = "La venta tiene algún dato mal formado.";
      }

      console.error("[ventas] no se pudo guardar:", crudo);

      /* El detalle crudo de Postgres solo en desarrollo. En producción
         se queda en el log: un mensaje de la base puede decir qué
         columnas hay, y eso no va a un cliente. */
      const detalle = process.env.NODE_ENV === "production" ? undefined : crudo;

      return NextResponse.json(
        { ok: false, error: mensaje, detalle },
        { status: 409 }
      );
    }

    const venta = (data || [])[0] || {};
    return NextResponse.json({
      ok: true,
      data: {
        id: venta.id,
        total: venta.total_cents,
        metodo: venta.metodo_pago,
        facturada: venta.facturada,
      },
    });
  } catch (e) {
    console.error("[ventas] fallo inesperado:", e);
    return NextResponse.json(
      { ok: false, error: "No se pudo guardar la venta." },
      { status: 500 }
    );
  }
}