"use client";

import { useEffect, useState } from "react";
import { ticketDelHash } from "@/lib/acceso/hash-ticket";
import { MIS_SERVICIOS } from "@/lib/panel";

/* =========================================================
   /entrar#<ticket>
   ---------------------------------------------------------
   El ticket viene en el FRAGMENTO, que el navegador no manda al
   servidor. Por eso no puede canjearse en el servidor: tiene que leerlo
   este JavaScript y hacer POST a /api/entrar.

   Si el ticket fuera un query param (?ticket=...), el access_token que
   lleva dentro acabaría en los logs del proxy, en el historial del
   navegador y en las cabeceras de petición.

   ⚠️  EL PARSEO ESTÁ EN `lib/hash-ticket.ts`, NO AQUÍ
   -----------------------------------------------
   Antes estaba aquí, y era:

       window.location.hash.replace(/^#/, "").trim()

   Eso quita la almohadilla pero deja el "ticket=" pegado: el servidor
   recibía "ticket=eyJ1aWQi..." en vez de "eyJ1aWQi...", que no es
   base64url, y contestaba 401. A todo el mundo, siempre.

   La entrada NO funcionó nunca desde un navegador, y todas las pruebas
   daban verde porque hacen el POST ellas mismas y se saltan el
   fragmento. Nadie ejecutó esa línea hasta que alguien abrió el
   enlace.

   Está fuera para que se pueda probar sin React: importar el componente
   arrastraría el `useEffect`, que no corre sin un DOM. Y la prueba usa
   ESE fichero, no una copia, que es lo que evita que la copia se quede
   vieja y siga dando verde.
   ========================================================= */

export default function Entrar() {
  const [error, setError] = useState<string | null>(null);
  const [caducado, setCaducado] = useState(false);

  /* ⚠️  POR QUÉ `useEffect` Y NO `useState` CON UNA FUNCIÓN
   * -------------------------------------------------
   * La primera versión hacía `useState(() => { ... window.location ... })`
   * para "correr esto al montar".
   *
   * No funciona, y falla de la forma más difícil de ver: `useState`
   * evalúa su inicializador TAMBIÉN en el servidor, y ahí `window` no
   * existe. El error sale durante el prerenderizado y dice
   * `ReferenceError: window is not defined`, que no señala que el
   * problema es un `useState` usado como `useEffect`.
   *
   * Para "correr una vez al montar" es `useEffect(() => { ... }, [])`.
   * Eso solo corre en el navegador.
   */
  useEffect(() => {
    /* El canje ocurre una sola vez. */
    const ticket = ticketDelHash(window.location.hash);
    const destino =
      new URLSearchParams(window.location.search).get("next") || "/";

    if (!ticket) {
      /* Sin ticket: el enlace vino mal, o se recargó la página después
         de canjear. Se vuelve al panel, que rehace el viaje. */
      window.location.replace(MIS_SERVICIOS);
      return;
    }

    let vivo = true;

    (async () => {
      try {
        const r = await fetch("/api/entrar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket }),
        });

        const datos = (await r.json()) as {
          ok?: boolean;
          error?: string;
          caducado?: boolean;
        };

        if (!vivo) return;

        if (!r.ok || !datos.ok) {
          /* El 401 con `caducado` es el ticket viejo, que es el caso más
             común y el que más confunde: la página del panel congela el
             JavaScript en segundo plano y el POST sale tarde.

             Por eso el mensaje dice lo que pasó y no "tu enlace no vale",
             que hace pensar que alguien lo manipuló o que la cuenta
             está mal. */
          if (r.status === 401 && datos.caducado) {
            setCaducado(true);
          } else {
            setError(datos.error || "No se pudo iniciar la sesión.");
          }
          return;
        }

        /* El token ya está canjeado. Se quita el fragmento ANTES de
           navegar, para que no acabe en el historial. */
        window.history.replaceState(null, "", "/entrar");

        /* `next` viene de la URL, así que solo se aceptan rutas
           internas. Aceptarlo tal cual sería una redirección abierta:
           un enlace del panel podría mandar al usuario a cualquier
           sitio. Y tiene que empezar por UN barra: "//ejemplo.com" es
           una URL absoluta disfrazada. */
        const volver =
          destino.startsWith("/") && !destino.startsWith("//") ? destino : "/";

        window.location.replace(volver);
      } catch {
        if (vivo) setError("No se pudo conectar. Revisa la conexión e inténtalo otra vez.");
      }
    })();

    return () => {
      vivo = false;
    };
  }, []);

  return (
    <main
      data-panel={MIS_SERVICIOS}
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        fontFamily: "system-ui, sans-serif",
        background: "#0b0f14",
        color: "#e6edf3",
      }}
    >
      <div style={{ maxWidth: "28rem", textAlign: "center" }}>
        {caducado ? (
          <>
            <h1 style={{ fontSize: "1.25rem", marginBottom: ".75rem" }}>
              El enlace ya no vale
            </h1>
            <p style={{ opacity: 0.75, lineHeight: 1.6 }}>
              Estos enlaces duran poco. Vuelve a tu panel y pulsa{" "}
              <strong>Abrir</strong> otra vez: se abre al momento.
            </p>
            <a
              href={MIS_SERVICIOS}
              style={{
                display: "inline-block",
                marginTop: "1.5rem",
                padding: ".6rem 1.2rem",
                borderRadius: ".6rem",
                background: "#4da3ff",
                color: "#0b0f14",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Volver al panel
            </a>
          </>
        ) : error ? (
          <>
            <h1 style={{ fontSize: "1.25rem", marginBottom: ".75rem" }}>
              No se pudo entrar
            </h1>
            <p style={{ opacity: 0.75, lineHeight: 1.6 }}>{error}</p>
            <a
              href={MIS_SERVICIOS}
              style={{ display: "inline-block", marginTop: "1.5rem", color: "#4da3ff" }}
            >
              Volver al panel
            </a>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: "1.25rem", marginBottom: ".75rem" }}>
              Abriendo el inventario…
            </h1>
            <p style={{ opacity: 0.75 }}>Un momento.</p>
          </>
        )}
      </div>
    </main>
  );
}