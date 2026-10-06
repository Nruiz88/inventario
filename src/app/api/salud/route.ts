/* =========================================================
   /api/salud — cómo está este servicio
   ---------------------------------------------------------
   Lo consulta el panel de empresa para saber, antes de que un
   cliente llame a la puerta, si este servicio está vivo y si comparte
   secreto con él.

   QUÉ DEVUELVE Y QUÉ NO
   ---------------------
   Devuelve el md5 del SERVICE_SECRET, no el secreto.

   Es deliberado, y merece la pena razonarlo:

     · Un md5 de un secreto de 64 caracteres aleatorios no se puede
       deshacer por fuerza bruta. El espacio de búsqueda es 2^256.
     · Lo que el panel necesita es COMPARAR, no leer. Con el md5
       basta: si los dos dan el mismo, los secretos coinciden.
     · Guardar el secreto en la base para comparar sería meterlo en
       un sitio donde antes no estaba.

   Y qué NO lleva: nada de datos de clientes, ni conteos de negocio,
   ni la url de la base. Un endpoint sin sesión es público por
   definición, así que lo que devuelva tiene que poder enseñarse sin
   vergüenza.

   Por qué el md5 y no el secreto: si el panel guardara el secreto
   para comparar, y el panel es la máquina donde más se toca, el
   secreto acabaría en más sitios del que le tocan. Con el md5, cada
   despliegue solo tiene el suyo.

   ── POR QUÉ ESTO EXISTE ──
   El fallo de esta noche: el panel y este servicio tenían un
   SERVICE_SECRET distinto en una de las dos filas duplicadas de
   Coolify. El botón "Abrir" firmaba con uno y este servicio
   verificaba con el otro. El síntoma era un 401 "ese enlace no vale",
   que es el mismo texto que da un ticket manipulado: durante horas
  BUSCABA UN ATAQUE QUE NO HABÍA.

   Con esta ruta, el panel lo ve en un segundo y dice "el secreto de
   inventario no coincide". Que es lo que era.
   ========================================================= */

import { NextResponse } from "next/server";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* Lo que hace el servicio. */
const NOMBRE = "inventario";

function md5(texto: string): string {
  return crypto.createHash("md5").update(texto).digest("hex");
}

export async function GET() {
  const inicio = performance.now();
  const secreto = (process.env.SERVICE_SECRET || "").trim();

  /* Sin secreto no hay nada que comparar, y decirlo es más útil que
   * devolver un md5 de cadena vacía, que parecería que todo bien. */
  if (!secreto) {
    return NextResponse.json(
      {
        ok: false,
        servicio: NOMBRE,
        error: "SERVICE_SECRET no está en el entorno.",
      },
      { status: 503 }
    );
  }

  /* Las tres cosas que el panel necesita: que está vivo, que comparte
   * secreto, y qué versión es. */
  const cosas = {
    ok: true,
    servicio: NOMBRE,

    /* md5 del secreto, recortado a 16: suficiente para comparar y
     * bastante menos de lo que alguien podría intentar buscar. */
    secret_md5: md5(secreto).slice(0, 16),

    /* Qué variables críticas hay. Solo si están: el panel prefiere
     * "falta X" a un 500 sin explicación. */
    configuracion: {
      supabase_url: Boolean(process.env.SUPABASE_URL),
      supabase_secret_key: Boolean(process.env.SUPABASE_SECRET_KEY),
      supabase_publishable_key: Boolean(process.env.SUPABASE_PUBLISHABLE_KEY),
      service_secret: true,
      app_url: Boolean(process.env.APP_URL),
      panel_url: Boolean(process.env.NEXT_PUBLIC_PANEL_URL),
    },

    /* El build. Si el panel lo compara con lo que espera, se ve
     * cuando se ha desplegado una imagen vieja sin darse cuenta. */
    version: process.env.VERSCION || null,
  };

  /* El tiempo que tardó en contestar va en la cabecera, no en el
   * cuerpo: así el panel lo enseña sin tener que parsear el json.
   *
   * Antes aquí iba un 2500 fijo, que era mentira: un número constante
   * de "cuánto tardó" no dice nada. Si la pantalla de salud muestra
   * "va lento", tiene que enseñar el tiempo de verdad. */
  const respuesta = NextResponse.json(cosas, {
    headers: { "Cache-Control": "no-store" },
  });
  respuesta.headers.set("X-Tiempo-Ms", String(Math.round(performance.now() - inicio)));

  return respuesta;
}

/* OPTIONS y HEAD: los proxy y los health checks loscea también. Que no
 * los rechace, o el panel verá un 405 y pensará que el servicio está
 * mal cuando lo único que hizo fue preguntar con el verbo
 * equivocado. */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

export async function HEAD() {
  return new NextResponse(null, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}