import { NextResponse, type NextRequest } from "next/server";
import {
  leerSesion,
  tieneElModulo,
  esSesionDeSoporte,
  MODULO_ID,
  COOKIE_NAME,
} from "@/lib/acceso/sesion";

/* =========================================================
   Proxy (middleware) del servicio
   ---------------------------------------------------------
   Qué hace: no deja pintar páginas del panel a quien no tiene sesión,
   y pone las cabeceras de seguridad.

   ⚠️  LO QUE ESTO NO ES
   ---------------------
   No es la barrera de seguridad. Solo evita pintar una página vacía a
   alguien que no tiene sesión.

   La barrera son las políticas de RLS en la base. Aunque alguien llegara
   aquí con una cookie inventada, las consultas con el cliente de
   Supabase no devolverían filas.

   La diferencia: el middleware mejora la experiencia; RLS impide de
   verdad ver datos ajenos. Son dos capas y hacen falta las dos. Con solo
   el middleware, un `searchParams.get("id")` sin comprobar sería un
   fallo de seguridad con todas las apariencias de funcionar.

   Y con soporte sigue siendo cierto: que el proxy deje pasar a un
   member del equipo no le da acceso a nada. Lo que se lo da es la fila
   de `inventario_sesiones` con su `soporte_de`, y eso lo comprueba RLS
   en cada consulta.
   ========================================================= */

/**
 * Rutas públicas.
 *
 * Una: la que canjea el ticket.
 *
 * Aquí también caerían las públicas DE VERDAD del negocio (una catálogo
 * abierto, un formulario de pedidos para clientes sin cuenta). Esas las
 * usan clientes finales que no tienen cuenta en ningún sitio, así que no
 * pueden exigir sesión. Lo que importa es que lo público sea público a
 * propósito y esté en ESTA lista, no en una excepción repartida por el
 * código.
 */
const PUBLICAS: string[] = ["/entrar"];

function conCabeceras(respuesta: NextResponse): NextResponse {
  /* frame-ancestors 'none' evita el clickjacking sobre acciones que
     cambian datos: alguien puede poner un iframe invisible encima del
     botón de "anular venta" y que el dueño pulse sin querer. */
  respuesta.headers.set("X-Frame-Options", "DENY");
  respuesta.headers.set("X-Content-Type-Options", "nosniff");
  respuesta.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  respuesta.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  const esDev = process.env.NODE_ENV !== "production";
  const scriptSrc = "script-src 'self' 'unsafe-inline'" + (esDev ? " 'unsafe-eval';" : ";");

  respuesta.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; " +
      scriptSrc +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https: blob:; " +
      "font-src 'self' data:; " +
      "connect-src 'self' https: wss:; " +
      "frame-ancestors 'none'; " +
      "base-uri 'self'; " +
      "form-action 'self'"
  );
  return respuesta;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /* Las rutas de API se dejan pasar: cada una decide en su interior si
     exige sesión. Una webhook, por ejemplo, no tiene sesión porque la
     llama una máquina, y por eso se valida con una firma. */
  if (pathname.startsWith("/api")) {
    return conCabeceras(NextResponse.next({ request }));
  }

  if (PUBLICAS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return conCabeceras(NextResponse.next({ request }));
  }

  const sesion = await leerSesion(request.cookies.get(COOKIE_NAME)?.value);

  if (!sesion) {
    /* Sin sesión no hay entrada. Se manda a `/entrar` conservando la
       página pedida, con `?next=` para volver a ella después. */
    const destino = new URL("/entrar", request.url);
    destino.searchParams.set("next", pathname);
    return conCabeceras(NextResponse.redirect(destino));
  }

  /* La suscripción se comprueba en cada petición, no solo al entrar. Ver
     la nota larga en exigeSession(): el caso feo del SaaS es el cliente
     que sigue usando lo que ya pagó después de cancelar. */
  if (!esSesionDeSoporte(sesion) && !(await tieneElModulo(sesion.clientId, MODULO_ID))) {
    const r = NextResponse.redirect(new URL("/sin-acceso", request.url));
    r.cookies.delete(COOKIE_NAME);
    return conCabeceras(r);
  }

  return conCabeceras(NextResponse.next({ request }));
}

export const config = {
  /* Sin esto pasa también por los ficheros estáticos y por las
     imágenes, y cada una paga una consulta a la base.
     `.*\\..*` saca de la lista todo lo que tiene un punto. */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};