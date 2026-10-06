"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/* =========================================================
   Un cliente para el fetch, en un sitio
   ---------------------------------------------------------
   Todas las pantallas hacen lo mismo: llamar a la API, mirar si `ok`,
   y si no, enseñar el error. Repetido en cada una, cada una lo hace
   un poco distinto, y la diferencia es siempre la misma: una muestra un
   error vacío en vez de un mensaje.

   Y hay un caso que hay que tratar bien: el 402.

   ⚠️  EL 402 NO ES UN ERROR QUE SE ENSEÑE EN UNA ESQUINA
   ------------------------------------------------------
   El 402 es "no tienes este módulo contratado". No es que algo falló:
   es que la sesión es válida pero la suscripción no. La respuesta
   lleva `sinModulo: true`, y eso significa una sola cosa: sacarle a la
   persona de la pantalla y mandarla a su panel, no enseñarle un cartel
   de error que puede intentar cerrar.

   Si se enseña como un error normal, el dueño ve "algo falló" en una
   pantalla que hace treinta segundos funcionaba, y la conclusión que
   saca es que el servicio está roto.
   ========================================================= */

export type Resultado<T> =
  | { ok: true; datos: T; aviso?: string }
  | { ok: false; error: string; sinModulo?: boolean; estado?: number };

type Ctx = {
  pedir: <T = any>(url: string, init?: RequestInit) => Promise<Resultado<T>>;
};

const Contexto = createContext<Ctx | null>(null);

export function ProveedorDatos({ children, panel }: { children: ReactNode; panel: string }) {
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<{ texto: string; tono: "ok" | "error" } | null>(null);

  const pedir = useCallback(
    async function pedir<T = any>(url: string, init?: RequestInit): Promise<Resultado<T>> {
      setCargando(true);
      try {
        const r = await fetch(url, {
          ...init,
          headers: {
            "Content-Type": "application/json",
            /* `...init` y este bloque: el orden importa. Si los headers
               de `init` fueran los últimos, un `Content-Type` propio
               del que llama se pisaría con `application/json` y mandaría
               un GET con `Content-Type` a un servidor que no lo espera.
               Con el orden este, gana quien llama. */
            ...(init?.headers || {}),
          },
        });

        /* El cuerpo puede no ser JSON. Pasa cuando el proxy devuelve una
           redirección a `/entrar`: llega HTML donde se esperaba JSON, y
           `res.json()` lanza. Sin esto, una sesión caducada se ve como
           un fallo de red en vez de como "vuelve a entrar". */
        let cuerpo: any = null;
        const texto = await r.text();
        if (texto) {
          try {
            cuerpo = JSON.parse(texto);
          } catch {
            cuerpo = null;
          }
        }

        if (r.status === 401) {
          /* Sesión caducada o revocada. Es lo único que justifica sacarle
             de la pantalla sin preguntar. */
          window.location.replace("/entrar?next=" + encodeURIComponent(window.location.pathname));
          return { ok: false, error: "Tu sesión caducó.", estado: 401 };
        }

        if (r.status === 402 || cuerpo?.sinModulo) {
          /* Pocas ventas sin el módulo. Se manda al panel y no hay
             vuelta atrás desde aquí: reintentar es futile. */
          window.location.replace(panel);
          return {
            ok: false,
            error: "Este módulo no está activo en tu cuenta.",
            sinModulo: true,
            estado: 402,
          };
        }

        if (!r.ok || !cuerpo?.ok) {
          const msg = cuerpo?.error || "No se pudo completar la operación.";
          setMensaje({ texto: msg, tono: "error" });
          return { ok: false, error: msg, estado: r.status };
        }

        if (cuerpo.aviso) setMensaje({ texto: cuerpo.aviso, tono: "ok" });
        return { ok: true, datos: cuerpo.data as T, aviso: cuerpo.aviso };
      } catch {
        const msg = "No se pudo conectar. Revisa la conexión.";
        setMensaje({ texto: msg, tono: "error" });
        return { ok: false, error: msg };
      } finally {
        setCargando(false);
      }
    },
    [panel]
  );

  return (
    <Contexto.Provider value={{ pedir }}>
      {children}
      <Aviso mensaje={mensaje} />
    </Contexto.Provider>
  );
}

function Aviso({ mensaje }: { mensaje: { texto: string; tono: "ok" | "error" } | null }) {
  if (!mensaje) return null;
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        left: "50%",
        bottom: "1.5rem",
        transform: "translateX(-50%)",
        maxWidth: "min(34rem, calc(100vw - 2rem))",
        padding: ".85rem 1.1rem",
        borderRadius: ".6rem",
        background: mensaje.tono === "error" ? "#5c1f1f" : "#1c3d24",
        border: "1px solid " + (mensaje.tono === "error" ? "#8b3535" : "#2f6b3d"),
        color: "#f3f6f9",
        fontSize: ".9rem",
        lineHeight: 1.5,
        boxShadow: "0 8px 24px rgba(0,0,0,.45)",
        zIndex: 100,
      }}
    >
      {mensaje.texto}
    </div>
  );
}

/**
 * El `pedir` de fuera.
 *
 * Lanza si se usa fuera del proveedor, y el error lo dice. Devolver
 * `null` y que el que llama se quede con un `undefined` silencioso es
 * la forma de que un fallo aparezca tres pantallas más abajo como una
 * pantalla vacía.
 */
export function useApi(): Ctx {
  const ctx = useContext(Contexto);
  if (!ctx) {
    throw new Error("useApi() se usó fuera de <ProveedorDatos>. Envuelve la pantalla con él.");
  }
  return ctx;
}