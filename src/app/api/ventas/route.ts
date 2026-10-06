import { NextResponse } from "next/server";
import { exigeSessionApi, clienteDe, cuerpoDe } from "@/lib/api";
import { GET, PATCH } from "./historial";

/* El historial y las acciones sobre una venta existente. El POST de
   abajo es el que guarda una venta nueva. */
export { GET, PATCH };

/* =========================================================
   POST /api/ventas — guardar una venta
   ---------------------------------------------------------
   ⚠️  AQUÍ NO HAY UNA TRANSACCIÓN ESCRITA A MANO: LA HACE LA BASE
   ---------------------------------------------------------
   La venta la registra la función `inv_registrar_venta()` (migración
   008), que valida, crea la venta y sus líneas en una transacción, con
   las variantes bloqueadas.

   Esta ruta solo: valida lo obvio, llama a la función y traduce el
   error. No escribe nada.

   POR QUÉ, Y NO CON VARIAS LLAMADAS A LA API
   -----------------------------------------
   Porque tres escrituras encadenadas dejan estados intermedios que no
   son ningún estado válido:

     · el precio se leía antes de escribir, y entre la lectura y el
       `insert` otro terminal podía cambiarlo. En un kiosco con dos cajas,
       el precio que se leyó hace un segundo puede no ser el de ahora, y
       la venta queda al precio viejo sin que nadie lo note.

     · el stock se comprobaba antes y se escribía después. Con dos cajas
       vendiendo lo mismo a la vez, las dos veían 10, las dos pasaban el
       control, y la segunda escribía sobre un stock ya descontado.

     · y si la tercera línea fallaba, quedaban la venta y dos ítems, con
       el stock de esos dos descontado. Se corrige a mano, o no se
       corrige.

   Se intentó con `ejecutar_sql` del panel y no podía funcionar: es de
   SOLO LECTURA y rechaza cualquier cosa que no sea un `SELECT`. El error
   sale al probar una venta de verdad y dice
   "ejecutar_sql: solo permite SELECT, recibido: begin;".

   Un RPC propio es la única vía que tiene transacciones de escritura en
   este sistema, y es la que ya usa `inv_ajustar_stock()`.

   ⚠️  EL PRECIO NO LO MANDA EL CLIENTE, Y NI SE PIDE
   -------------------------------------------------
   El precio sale de la base dentro de la función. No es descuido: si
   aceptara un precio del navegador, abrir las herramientas del
   desarrollador y vender todo a un peso sería cuestión de un minuto.

   Y el precio queda CONGELADO en el ítem, así que subir la lista de
   precios mañana no reescribe el histórico de hoy.
   ========================================================= */

export const dynamic = "force-dynamic";

const METODOS = ["efectivo", "tarjeta", "transferencia", "cuenta_corriente"];

export async function POST(request: Request) {
  const g = await exigeSessionApi("/ventas");
  if (g.error) return g.error;

  const { datos, error: eBody } = await cuerpoDe(request);
  if (eBody) return eBody;

  const crudos = Array.isArray((datos as any)?.items) ? (datos as any).items : [];

  /* Solo se filtra lo que está vacío. No se rechazan las cantidades
     raras aquí: eso lo normaliza la función, y duplicar las reglas en
     dos sitios es como se desincronizan. Aquí solo se hace lo que evita
     mandar una petición inútil a la base. */
  const items = crudos
    .filter((i: any) => i && i.varianteId)
    .map((i: any) => ({ varianteId: String(i.varianteId), cantidad: Number(i.cantidad) || 1 }));

  if (!items.length) {
    return NextResponse.json({ ok: false, error: "La venta no tiene nada." }, { status: 400 });
  }

  const metodo = String((datos as any)?.metodoPago || "");
  if (!METODOS.includes(metodo)) {
    return NextResponse.json(
      { ok: false, error: "Forma de pago no válida." },
      { status: 400 }
    );
  }

  const db = clienteDe(g.sesion);

  const { data, error } = await db.rpc("inv_registrar_venta", {
    p_cliente: g.sesion.clientId,
    p_cliente_id: metodo === "cuenta_corriente" ? (datos as any)?.clienteId || null : null,
    p_metodo: metodo,
    p_usuario: g.sesion.userId,
    p_items: items,
    p_notas: (datos as any)?.notas ? String((datos as any).notas).slice(0, 300) : null,
  });

  if (error) {
    /* Los mensajes de la función están escritos para leerse, y eso es la
       razón de que la validación viva en la base: "No hay stock
       suficiente: quedan 8 y se quieren vender 12" no se puede componer
       en JavaScript sin adivinar qué producto era.

       Lo que se traduce aquí es lo que NO depende del negocio: errores de
       sintaxis del JSON y de permisos. */
    const crudo = error.message || "";
    let mensaje = "No se pudo guardar la venta.";

    if (/no hay stock suficiente/i.test(crudo)) {
      mensaje = crudo.replace(/^.*?:\s*/, "");
      mensaje = "No hay stock suficiente: " + mensaje;
    } else if (/producto\(s\) no existen/i.test(crudo)) {
      mensaje = "Uno de los productos no existe, no es tuyo, o está desactivado.";
    } else if (/no tiene productos/i.test(crudo)) {
      mensaje = "La venta no tiene nada.";
    } else if (/cuenta corriente/i.test(crudo)) {
      mensaje = "Para vender a cuenta corriente hay que elegir un cliente.";
    } else if (/forma de pago/i.test(crudo)) {
      mensaje = "Forma de pago no válida.";
    } else if (/invalid input|syntax|json/i.test(crudo)) {
      mensaje = "La venta tiene algún dato mal formado.";
    } else if (/row-level|permission denied/i.test(crudo)) {
      mensaje = "No tenés acceso a estos datos.";
    }

    console.error("[ventas] no se pudo guardar:", crudo);

    /* 409 y no 500: no es una avería del servicio, es que esta venta
       no se puede hacer ahora. Con 500 el dueño cree que la app está
       rota, y con 409 entiende que tiene que cambiar algo. */
    return NextResponse.json(
      {
        ok: false,
        error: mensaje,
        detalle: process.env.NODE_ENV === "production" ? undefined : crudo,
      },
      { status: 409 }
    );
  }

  const r = data as { id: string; total: number; lineas: number } | null;

  return NextResponse.json({
    ok: true,
    data: {
      id: r?.id,
      total: r?.total,
      lineas: r?.lineas,
      metodo,
    },
  });
}