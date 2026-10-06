import { NextResponse } from "next/server";
import { exigeSessionApi, clienteDe, cuerpoDe, enteroEn, uuid, fallo } from "@/lib/api";

/* =========================================================
   PATCH/DELETE /api/productos
   ---------------------------------------------------------
   Las tres operaciones de modificar, y por qué NO hay un DELETE que
   borre de verdad.

   ⚠️  BORRAR UN PRODUCTO NO ES LO MISMO QUE DEJAR DE VENDERLO
   ----------------------------------------------------------
   Un producto con movimientos no se borra, se desactiva. Y no es una
   decisión de diseño, es una consecuencia de lo que ya está en la base:

   `inv_movimientos` referencia a la variante y no se borra nunca (es un
   hecho que ocurrió). Si se borrara el producto en cascada, se llevarían
   por delante los movimientos, y con ellos la respuesta a la pregunta
   más importante de un almacén: "por qué tengo 3 si ayer tenía 20".

   Con `on delete cascade` en `inv_variantes`, un DELETE borra el
   historial entero. Sin errores, sin aviso. El stock se queda como
   estaba, los movimientos desaparecen, y a partir de ahí el número del
   estante no tiene explicación.

   Por eso DELETE aquí significa DESACTIVAR: `activo = false`. Deja de
   aparecer en la venta, sigue apareciendo en el histórico y se puede
   volver a activar. Y si el producto nunca tuvo movimientos, entonces
   sí se borra, porque no hay nada que perder.

   MODIFICAR QUÉ SÍ Y QUÉ NO
   -------------------------
   Se puede: nombre, categoría, descripción, precio de venta, precio de
   coste, mínimo de stock, si está activo.

   NO se puede: el stock. El stock no se edita, se corrige con un
   movimiento, que es lo que hace `/api/movimientos`. Si se dejara
   escribir `stock` aquí, el número de la pantalla y el de la base
   divergirían sin que nadie lo notara, y eso es exactamente el problema
   que `inv_movimientos` existe para evitar.

   Y el precio de venta SÍ se puede cambiar: solo afecta a las ventas
   futuras. Las viejas guardan el precio con el que se vendieron, que es
   lo que hace que un cambio de precios no reescriba el histórico.
   ========================================================= */

export const dynamic = "force-dynamic";

/* PATCH — modificar */
export async function PATCH(request: Request) {
  const g = await exigeSessionApi("/productos");
  if (g.error) return g.error;

  const { datos, error } = await cuerpoDe(request);
  if (error) return error;

  const idProducto = uuid((datos as any)?.id);
  if (!idProducto) {
    return NextResponse.json(
      { ok: false, error: "No se sabe qué producto modificar." },
      { status: 400 }
    );
  }

  const db = clienteDe(g.sesion);

  /* Solo los campos que se pueden cambiar. El `stock` no está en la
     lista a propósito, y no es un olvido: si estuviera, un `update`
     con `stock` reescribiría la caché y el historial dejaría de
     cuadrar sin que nadie se entere. */
  const cambios: Record<string, unknown> = {};

  if ((datos as any).nombre !== undefined) {
    const nombre = String((datos as any).nombre).trim();
    if (!nombre) {
      return NextResponse.json(
        { ok: false, error: "El producto necesita un nombre." },
        { status: 400 }
      );
    }
    cambios.nombre = nombre;
  }

  if ((datos as any).descripcion !== undefined) {
    cambios.descripcion = String((datos as any).descripcion).trim() || null;
  }

  if ((datos as any).categoria !== undefined) {
    cambios.categoria = String((datos as any).categoria).trim() || null;
  }

  if ((datos as any).activo !== undefined) {
    cambios.activo = Boolean((datos as any).activo);
  }

  if (!Object.keys(cambios).length) {
    return NextResponse.json(
      { ok: false, error: "No hay nada que cambiar." },
      { status: 400 }
    );
  }

  /* El UPDATE va filtrado por id SOLO. El `client_id` no se pone en el
     `where` a propósito: no hace falta, porque RLS ya comprueba que la
     fila es de este cliente, y si no lo es el UPDATE no afecta a nada
     y devuelve 0 filas.

     Esa es la diferencia entre ponerlo y no ponerlo: con RLS, ponerlo
     es redundante; sin RLS, es la única defensa. Como aquí hay RLS, se
     depende de ella a propósito, y `modificado: 0` es la señal de que
     alguien intentó tocar algo ajeno. */
  const { data, error: eUp } = await db
    .from("inv_productos")
    .update(cambios)
    .eq("id", idProducto)
    .select("id")
    .maybeSingle();

  if (eUp) return fallo(eUp, "productos PATCH", "No se pudo guardar el producto.");

  if (!data) {
    /* 0 filas: o no existe, o es de otro cliente. Se dice lo mismo en
       los dos casos a propósito. Distinguirlos diría a un atacante qué
       productos existen en la plataforma. */
    return NextResponse.json(
      { ok: false, error: "Ese producto no existe o no es tuyo." },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, data: { id: data.id } });
}

/* ---------------------------------------------------------------------
   DELETE — desactivar, o borrar si nunca se movió
   --------------------------------------------------------------------- */
export async function DELETE(request: Request) {
  const g = await exigeSessionApi("/productos");
  if (g.error) return g.error;

  const { datos, error } = await cuerpoDe(request);
  if (error) return error;

  const idProducto = uuid((datos as any)?.id);
  const idVariante = uuid((datos as any)?.varianteId);
  const borrarFisico = Boolean((datos as any)?.borrar);

  if (!idProducto && !idVariante) {
    return NextResponse.json(
      { ok: false, error: "No se sabe qué borrar." },
      { status: 400 }
    );
  }

  const db = clienteDe(g.sesion);

  /* Las variantes de las que se puede borrar: las que NO tienen
     movimientos. Con un movimiento, desactivar. */
  let variantes: any[] = [];
  if (idVariante) {
    variantes = [idVariante];
  } else {
    const { data: vs } = await db
      .from("inv_variantes")
      .select("id")
      .eq("producto_id", idProducto);
    variantes = vs || [];
  }

  if (!variantes.length) {
    return NextResponse.json(
      { ok: false, error: "Ese producto no tiene presentaciones." },
      { status: 404 }
    );
  }

  /* ¿Alguna tiene movimientos? Una sola basta: si hay un historial,
     el producto entero tiene que quedarse. */
  const { data: conMovimientos } = await db
    .from("inv_movimientos")
    .select("variante_id")
    .in("variante_id", variantes);

  const conHistorial = (conMovimientos || []).length > 0;

  /* Se pide borrar a propósito y se puede: entonces sí se borra. */
  if (borrarFisico && !conHistorial) {
    if (idVariante) {
      const { error: eDel } = await db.from("inv_variantes").delete().eq("id", idVariante);
      if (eDel) return fallo(eDel, "productos DELETE", "No se pudo borrar.");
    } else {
      const { error: eDel } = await db.from("inv_variantes").delete().eq("producto_id", idProducto);
      if (eDel) return fallo(eDel, "productos DELETE", "No se pudo borrar.");
      const { error: eDel2 } = await db.from("inv_productos").delete().eq("id", idProducto);
      if (eDel2) return fallo(eDel2, "productos DELETE", "No se pudo borrar.");
    }
    return NextResponse.json({ ok: true, data: { borrado: true } });
  }

  /* Con historial, desactivar. Es lo que se devuelve, y el mensaje
     explica por qué, que es la parte que evita que el dueño piense que
     el botón no funciona. */
  if (idVariante) {
    const { error: eUp } = await db
      .from("inv_variantes")
      .update({ activo: false })
      .eq("id", idVariante);
    if (eUp) return fallo(eUp, "productos DELETE", "No se pudo desactivar.");
  } else {
    const { error: eUp1 } = await db
      .from("inv_productos")
      .update({ activo: false })
      .eq("id", idProducto);
    if (eUp1) return fallo(eUp1, "productos DELETE", "No se pudo desactivar.");
    const { error: eUp2 } = await db
      .from("inv_variantes")
      .update({ activo: false })
      .eq("producto_id", idProducto);
    if (eUp2) return fallo(eUp2, "productos DELETE", "No se pudo desactivar.");
  }

  return NextResponse.json({
    ok: true,
    data: { desactivado: true, conHistorial },
    aviso: conHistorial
      ? "No se borró: tiene movimientos de stock. Se desactivó, y sigue apareciendo en el histórico."
      : undefined,
  });
}