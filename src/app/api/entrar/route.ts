import { NextResponse } from "next/server";
import { verificar, tokenDe, diagnosticoDeTicket } from "@/lib/acceso/tickets";
import {
  crearSesion,
  tieneElModulo,
  esSesionDeSoporte,
  MODULO_ID,
  COOKIE_NAME,
  opcionesCookie,
} from "@/lib/acceso/sesion";

/* =========================================================
   POST /api/entrar — canjea el ticket por una sesión
   ---------------------------------------------------------
   El flujo completo:

     1. panel.midominio.com/panel/servicios/:id/entrar
        Firma un ticket y redirige a MI-DOMINIO/entrar#<ticket>

     2. /entrar (esta app) sirve una página cuyo JavaScript lee el
        FRAGMENTO y hace POST a este endpoint con el ticket.

     3. Este endpoint verifica la firma, comprueba que el cliente tiene
        el módulo contratado, y pone una cookie propia.

   POR QUÉ EL TICKET VIENE EN EL FRAGMENTO Y NO EN LA URL
   ------------------------------------------------------
   El ticket lleva dentro el access_token de Supabase. En el fragmento
   (#) el navegador no lo manda al servidor, así que no acaba en los
   logs del proxy, ni en el historial, ni en las cabeceras de petición.
   Con `?ticket=...` acabaría en todas partes.

   POR QUÉ SE COMPRUEBA LA SUSCRIPCIÓN SI EL TICKET ES AUTÉNTICO
   --------------------------------------------------------------
   Porque la firma solo dice QUIÉN es el usuario, no qué ha contratado.
   Si alguien le pasa a un cliente el ticket de otro, su suscripción no
   cuadra y se le rechaza aquí.

   El panel ya hizo la comprobación, pero repetirla es lo que hace que un
   enlace reenviado no sirva.

   EL STAFF NO ENTRA POR AQUÍ
   -------------------------
   Entra por una pantalla aparte donde elige a qué cliente atiende y
   escribe por qué. Sin motivo obligatorio no hay sesión de soporte: no
   es un trámite, es lo que queda guardado y lo que contesta a la
   pregunta de por qué alguien del equipo tocó la configuración de un
   cliente.
   ========================================================= */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let ticket = "";
  try {
    const cuerpo = (await request.json()) as { ticket?: unknown };
    ticket = String(cuerpo.ticket ?? "");
  } catch {
    return NextResponse.json(
      { ok: false, error: "No se pudo leer la petición." },
      { status: 400 }
    );
  }

  const p = verificar(ticket);

  if (!p) {
    /* No se le dice al usuario si el ticket caducó o si alguien lo
       manipuló: distinguirlo sería una guía para ir probando.

       Pero internamente SÍ se distingue, y esa diferencia es la que
       hace falta para diagnosticar. Este fallo era el más probable del
       sistema y era invisible: la respuesta era siempre la misma.

       El caso real: los tickets duran pocos minutos, y el navegador
       congela el JavaScript de las pestañas en segundo plano. Si
       alguien pulsa "Abrir" y cambia de pestaña, el POST sale tarde,
       cuando el ticket ya caducó. El mensaje culpaba al enlace.

       El TICKET NO SE ESCRIBE en el log: lleva el access_token
       dentro. */
    const motivo = diagnosticoDeTicket(ticket);
    console.warn("[entrar] ticket rechazado:", motivo);

    return NextResponse.json(
      {
        ok: false,
        error: "Ese enlace no vale o ha caducado. Vuelve a entrar desde el panel.",
        /* Para la página, que sí sabe decirle a la persona que fue un
           enlace viejo. No le dice NADA que sirva para manipular nada:
           solo si caducó o no. */
        caducado: motivo === "caducado",
      },
      { status: 401 }
    );
  }

  /* Sin `cid` no hay cliente, y sin cliente no hay nada que mirar. */
  if (!p.cid) {
    return NextResponse.json(
      { ok: false, error: "Este enlace no es de una cuenta de cliente." },
      { status: 403 }
    );
  }

  /* La suscripción se comprueba al cliente, no al staff. Support entra
     justamente cuando algo va mal, y un cliente al que se le ha caducado
     la suscripción es de los que más support necesitan. */
  if (!(await tieneElModulo(p.cid, MODULO_ID))) {
    return NextResponse.json(
      {
        ok: false,
        error: "Tu cuenta no tiene este servicio contratado o está vencido.",
      },
      { status: 403 }
    );
  }

  let sesion;
  try {
    sesion = await crearSesion({
      userId: p.uid,
      clientId: p.cid,
      rol: p.rol,
      accessToken: tokenDe(p),
    });
  } catch (e) {
    console.error("[entrar] no se pudo crear la sesión", e);
    return NextResponse.json(
      { ok: false, error: "No se pudo iniciar la sesión. Inténtalo otra vez." },
      { status: 500 }
    );
  }

  const respuesta = NextResponse.json({ ok: true, volver: "/dashboard" });

  /* Host-only a propósito: sin `domain`, esta cookie no viaja a ningún
     otro subdominio. Es lo que evita que un XSS en el panel (o en
     cualquier otro servicio) se lleve esta sesión. */
  respuesta.cookies.set(COOKIE_NAME, sesion.token, opcionesCookie(4 * 3600));

  /* Marca de que el ticket se usó. Con esto, una recarga de /entrar
     detecta que ya no hay ticket y manda al panel en vez de intentar
     canjear otra vez. */
  respuesta.cookies.set("ticket_usado", "1", {
    ...opcionesCookie(60),
    httpOnly: true,
  });

  return respuesta;
}