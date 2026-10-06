import { NextResponse } from "next/server";
import { exigeSessionApi } from "@/lib/acceso/sesion";

/* =========================================================
   Un cliente HTTP del navegador, con la sesión.
   ---------------------------------------------------------
   Todo lo que las pantallas hacen acaba en un fetch a una de estas
   rutas, y se repite en cada una:

     const g = await exigeSessionApi();
     if (g.error) return g.error;
     const db = clienteDe(sesion);

   Y cada vez que se olvida el `if (g.error)` la ruta compila igual y
   revienta en cuanto se llama sin sesión, con un error que habla de
   `clientId` de un undefined y no de sesiones.

   Aquí está todo junto una vez, para que el patrón se copie.

   ⚠️  EL PRECIO LO PONE SIEMPRE EL SERVIDOR
   ------------------------------------------
   Ninguna de estas rutas acepta un precio del cliente. Ni al crear una
   venta, ni al crear una compra, ni al editar un producto.

   No es desconfianza: es que un navegador puede mandar lo que quiera, y
   un `<input>` se cambia en la consola en dos clics. Si el precio lo
   mandara el cliente, abriría las herramientas del desarrollador y
   vendería todo a un peso. Los precios se LEEN de la base y se
   escriben congelados en el movimiento, que es lo que hace que la
   venta de ayer siga valiendo lo que valía ayer.
   ========================================================= */

import { createClient } from "@supabase/supabase-js";

export function clienteDe(sesion: { accessToken: string }) {
  return createClient(
    process.env.SUPABASE_URL || "",
    process.env.SUPABASE_PUBLISHABLE_KEY || "",
    {
      global: { headers: { Authorization: "Bearer " + sesion.accessToken } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}

/* ---------------------------------------------------------------------
   Lectura del cuerpo
   --------------------------------------------------------------------- */

/**
 * Lee el cuerpo de la petición, o devuelve un 400.
 *
 * Un `await request.json()` sin `try` en una ruta se traduce en un 500
 * cuando el cuerpo no es JSON. Y eso pasa: un curl sin `-d`, un proxy
 * que corta el cuerpo, un `fetch` con un error de red a medio escribir.
 * 400 es lo que corresponde, y además dice qué pasó.
 */
export async function cuerpoDe<T = any>(request: Request): Promise<{ datos: T; error: null } | { datos: null; error: NextResponse }> {
  try {
    return { datos: (await request.json()) as T, error: null };
  } catch {
    return {
      datos: null,
      error: NextResponse.json(
        { ok: false, error: "No se pudo leer la petición." },
        { status: 400 }
      ),
    };
  }
}

/* ---------------------------------------------------------------------
   Números
   --------------------------------------------------------------------- */

/**
 * Convierte a entero acotado, y devuelve el límite si no es un número.
 *
 * El patrón dangerous es `Math.max(0, parseInt(x) || 0)`: si `x` es
 * "abc", sale 0 y se guarda 0 sin avisar. Un campo de precio que se
 * guarda en 0 es un producto gratis que el dueño no sabe que tiene.
 *
 * Por eso el default es un error, no 0: si viene mal, se dice.
 */
export function enteroEn(
  valor: unknown,
  min: number,
  max: number,
  porDefecto?: number
): { ok: true; valor: number } | { ok: false } {
  const n = typeof valor === "string" ? Number(valor.trim()) : Number(valor);

  if (!Number.isFinite(n)) {
    if (porDefecto !== undefined) return { ok: true, valor: porDefecto };
    return { ok: false };
  }

  return { ok: true, valor: Math.min(max, Math.max(min, Math.round(n))) };
}

/** Un id de uuid. Si no lo es, se rechaza antes de llegar a la base. */
export function uuid(valor: unknown): string | null {
  const s = String(valor ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}

/* ---------------------------------------------------------------------
   Errores
   --------------------------------------------------------------------- */

/**
 * Convierte un error de la base en algo que se pueda mostrar.
 *
 * Un `error.message` de Postgres a un cliente es filtrar el esquema: dice
 * nombres de tabla, de columna y a veces el fragmento de una consulta.
 * El texto para la persona va en `mensaje`; el original va al log y se
 * devuelve solo en desarrollo.
 */
export function fallo(e: unknown, donde: string, mensaje?: string): NextResponse {
  const crudo = e instanceof Error ? e.message : String(e);
  console.error(`[${donde}]`, crudo);

  return NextResponse.json(
    {
      ok: false,
      error: mensaje || "No se pudo guardar. Inténtalo otra vez.",
      detalle: process.env.NODE_ENV === "production" ? undefined : crudo,
    },
    { status: 500 }
  );
}

/** Atajo para el guard de sesión, sin repetir el import. */
export { exigeSessionApi };