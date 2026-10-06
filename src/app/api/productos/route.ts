import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { exigeSessionApi } from "@/lib/acceso/sesion";

import { PATCH, DELETE } from "./modificar";

/* PATCH y DELETE viven en `modificar.ts` porque Next solo admite un
   `route.ts` por directorio, y el canje del ticket ya ocupa la mitad de
   este. Lo que hay aquí es GET y POST. */
export { PATCH, DELETE };

/* =========================================================
   GET/POST /api/productos
   ---------------------------------------------------------
   Productos y sus variantes, juntos.

   Van en la misma ruta porque siempre se piden juntos: la pantalla
   necesita el nombre del producto PARA CADA variante, y con dos rutas
   había que esperar a una y luego a la otra, con el nombre parpadeando.

   ⚠️  `client_id` NUNCA VIENE DEL CLIENTE
   -------------------------------------
   Viene de la sesión. Always.

   Un `eq("client_id", req.query.client)` devuelve 0 filas si el cliente
   no tiene nada, y da la impresión de que el filtro funciona. Un
   `eq("client_id", sesion.clientId)` devuelve 0 filas si el cliente no
   tiene nada, y las tiene todas si tiene. Solo uno de los dos hace lo
   que dice.

   ⚠️  LA VARIANTE TIENE PRODUCTO, EL PRODUCTO TIENE VARIANTES
   -------------------------------------------------------
   Relación de uno a muchos en las dos direcciones, y RLS obliga a
   revisar las dos. `inv_productos` se filtra por su `client_id`;
   `inv_variantes` subiendo por su producto.

   Una consulta a `inv_variantes` con `.eq("client_id", ...)` da error:
   esa columna NO existe. Con `|| []` ese error se traduce en "no hay
   variantes", que es un fallo silencioso en lugar de un error.

   ⚠️  EL STOCK INICIAL ENTRA POR MOVIMIENTO
   ----------------------------------------
   `inv_variantes.stock` es una caché de los movimientos. Si se escribe
   a mano al crear el producto, el historial no cuadra con el estante
   desde el primer día, y ya no hay forma de saber por qué.

   Por eso se inserta con 0 y se registra una entrada. Se hace en dos
   pasos y no en uno porque la base no tiene "insertar y mover stock"
   atómico desde la API: el movimiento va a `inv_movimientos` y el
   descuento lo hace un trigger, y para el alta hay que hacerlo a mano
   con las dos cosas agreeing.
   ========================================================= */

export const dynamic = "force-dynamic";

/** El cliente de la sesión, con el token del usuario. Aplica RLS. */
function dbDe(sesion: { accessToken: string }) {
  return createClient(
    process.env.SUPABASE_URL || "",
    process.env.SUPABASE_PUBLISHABLE_KEY || "",
    {
      global: { headers: { Authorization: "Bearer " + sesion.accessToken } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}

/* ── Listar ── */
export async function GET(request: Request) {
  const g = await exigeSessionApi("/");
  if (g.error) return g.error;
  const sesion = g.sesion;
  const db = dbDe(sesion);

  const soloActivos = new URL(request.url).searchParams.get("todos") !== "1";

  const { data, error } = await db
    .from("inv_variantes")
    .select(
      "id, nombre_variante, sku, precio_venta_cents, precio_costo_cents, " +
        "stock, stock_minimo, orden, activo, producto_id, " +
        "inv_productos!inner(id, nombre, categoria, activo, client_id)"
    )
    .order("orden", { ascending: true });

  /* El error se COMPRUEBA. Con `|| []`, un fallo de PostgREST se
     traduce en "no hay productos", que es lo que ve el dueño: una
     pantalla vacía sin decir que ha fallado nada. */
  if (error) {
    console.error("[productos] no se pudieron leer:", error.message);
    return NextResponse.json(
      { ok: false, error: "No se pudieron leer los productos." },
      { status: 500 }
    );
  }

  /* Se agrupa en JavaScript porque lo que se quiere ver es: los
     productos en su orden, y dentro de cada uno las variantes en su
     orden. La consulta viene ordenada por el orden de la variante, y
     eso no agrupa.

     Con 200 variantes —un kiosco— es instantáneo. Cuando un comercio
     llegue a 20.000, esto se mueve a una vista de la base. No antes:
     es más infraestructura que información. */
  const porProducto = new Map<string, any>();

  for (const v of (data || []) as any[]) {
    const p = v.inv_productos;
    if (!p) continue;

    /* Esta comprobación es la que sustituye a filtrar por `client_id`
       en la consulta: la política ya lo hace, pero una variante cuyo
       producto viniera de otro cliente (por un JOIN mal hecho) se
       cuela aquí sin esta línea. */
    if (p.client_id !== sesion.clientId) continue;
    if (soloActivos && (!v.activo || !p.activo)) continue;

    if (!porProducto.has(p.id)) {
      porProducto.set(p.id, {
        id: p.id,
        nombre: p.nombre,
        categoria: p.categoria,
        variantes: [],
      });
    }

    porProducto.get(p.id).variantes.push({
      id: v.id,
      nombre: v.nombre_variante,
      sku: v.sku,
      precio: v.precio_venta_cents,
      costo: v.precio_costo_cents,
      stock: v.stock,
      minimo: v.stock_minimo || 0,
      orden: v.orden,
      activo: v.activo,
      /* Esto se calcula en el servidor para que el cliente no tenga que
         decidir qué es "se está acabando": es `stock <= minimo`, y si
         cada pantalla lo calcula por su cuenta, un día uno lo calcula
         al revés. */
      bajo: v.stock <= (v.stock_minimo || 0),
    });
  }

  return NextResponse.json({ ok: true, data: [...porProducto.values()] });
}

/* ── Crear ── */
export async function POST(request: Request) {
  const g = await exigeSessionApi("/");
  if (g.error) return g.error;
  const sesion = g.sesion;
  const db = dbDe(sesion);

  let cuerpo: {
    nombre?: string;
    categoria?: string;
    descripcion?: string;
    variantes?: {
      nombre?: string;
      sku?: string;
      precio?: number;
      costo?: number;
      stock?: number;
      minimo?: number;
    }[];
  };

  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer la petición." }, { status: 400 });
  }

  const nombre = String(cuerpo.nombre || "").trim();
  if (!nombre) {
    return NextResponse.json(
      { ok: false, error: "El producto necesita un nombre." },
      { status: 400 }
    );
  }

  const { data: producto, error: eProd } = await db
    .from("inv_productos")
    .insert({
      client_id: sesion.clientId,
      nombre,
      descripcion: cuerpo.descripcion || null,
      categoria: cuerpo.categoria || null,
    })
    .select("id")
    .single();

  if (eProd) {
    console.error("[productos] no se pudo crear:", eProd.message);
    return NextResponse.json({ ok: false, error: "No se pudo crear el producto." }, { status: 500 });
  }

  /* Se guarda en una variable con nombre en vez de usar `cuerpo.variantes`
     más abajo: TypeScript estrecha el tipo del objeto a lo que se le
     acaba de asignar, y desde ahí `cuerpo.variantes` es un array vacío
     que no tiene ninguna propiedad. */
  const pedidas: any[] = Array.isArray(cuerpo.variantes) ? cuerpo.variantes : [];

  const variantes = pedidas
    .filter((v) => v && String(v.nombre || "").trim())
    .map((v, i) => ({
      producto_id: producto.id,
      nombre_variante: String(v.nombre).trim(),
      sku: v.sku ? String(v.sku).trim() : null,
      precio_venta_cents: Math.max(0, Math.round(Number(v.precio) || 0)),
      precio_costo_cents: Math.max(0, Math.round(Number(v.costo) || 0)),
      /* Se insertan con 0. El stock de verdad entra después, como
         movimiento, para que el historial cuadre desde el día uno. */
      stock: 0,
      stock_minimo: Math.max(0, Math.floor(Number(v.minimo) || 0)),
      orden: i * 10,
    }));

  /* Sin variantes no se crea el producto. Un producto sin ninguna no
     se puede vender ni valorar, y queda en la lista haciendo ruido. */
  if (!variantes.length) {
    await db.from("inv_productos").delete().eq("id", producto.id);
    return NextResponse.json(
      { ok: false, error: "El producto necesita al menos una presentación." },
      { status: 400 }
    );
  }

  const { data: creadas, error: eVar } = await db
    .from("inv_variantes")
    .insert(variantes)
    .select("id, orden");

  if (eVar || !creadas?.length) {
    /* El producto se queda sin variantes, que no es un estado válido.
       Se borra y se avisa, en vez de dejar un producto fantasma que
       aparece en la lista y no se puede usar. */
    await db.from("inv_productos").delete().eq("id", producto.id);
    return NextResponse.json(
      { ok: false, error: "No se pudieron crear las presentaciones. No se creó nada." },
      { status: 400 }
    );
  }

  /* El stock inicial, como movimiento.

     Se empareja cada variante con SU cantidad POR EL ORDEN, no con un
     `.find()` que devuelve el primer elemento que encuentra: con tres
     variantes de 10, 5 y 2, el `find` les ponía 10 a las tres. */
  const ordenadas = [...(creadas as any[])].sort((a, b) => a.orden - b.orden);

  for (let i = 0; i < ordenadas.length; i++) {
    const cantidad = Math.max(0, Math.floor(Number(pedidas[i]?.stock) || 0));
    if (cantidad <= 0) continue;

    await db.from("inv_movimientos").insert({
      variante_id: ordenadas[i].id,
      tipo: "entrada",
      cantidad,
      motivo: "stock inicial",
      usuario_id: sesion.userId,
    });

    await db.from("inv_variantes").update({ stock: cantidad }).eq("id", ordenadas[i].id);
  }

  return NextResponse.json({ ok: true, data: { id: producto.id } });
}