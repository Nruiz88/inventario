import { cookies } from "next/headers";
import crypto from "crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdmin, getScoped } from "@/lib/db";

/* =========================================================
   Sesiones del servicio
   ---------------------------------------------------------
   QUÉ HACE ESTO Y POR QUÉ ESTE ARCHIVO
   -------------------------------------
   Toda la conexión de un microservicio: qué es una sesión, cómo se
   crea, cómo se lee, y dónde se comprueba que la persona tiene el
   producto contratado.

   Lo que NO tiene este servicio, y es lo importante:

   · NINGÚN SISTEMA DE USUARIOS PROPIOS. No hay tabla de usuarios, ni
     contraseñas, ni bcrypt, ni login. La identidad es la de Supabase
     Auth del panel.

     Por qué: si el servicio tuviera usuarios propios, habría DOS
     contraseñas para la misma persona, DOS sitios donde perder el
     acceso, y el panel no podría darle entrada sin invented un tercero.
     Con un solo sistema de identidad, "entrar al panel" y "entrar al
     servicio" son la misma cosa.

   · NINGUNA COOKIE COMPARTIDA. La cookie del panel es host-only a
     propósito: si compartiera `Domain` con el resto de subdominios, un
     XSS en CUALQUIERA de ellos se llevaría la sesión de todos, y el
     panel es donde están todos los clientes.

     Cada servicio tiene su cookie y su tabla de sesiones. Una cookie
     válida en el panel no vale aquí, y al revés. Eso es lo que
     comprueba `db/test-aislamiento.js` en el panel.

   · NINGÚN REFRESH TOKEN GUARDADO. Cuando el access_token de Supabase
     caduca (una hora), el usuario vuelve a pasar por el panel. Es más
     simple que guardar un refresh_token, que sería un segundo sitio
     donde guardarlo. Para un servicio de uso corto es suficiente.

   ========================================================= */

export const COOKIE_NAME = "inv_sesion";

/** Cuánto vive la sesión. 4 horas. */
const HORAS_SESION = 4;

export interface Sesion {
  userId: string;
  /**
   * El cliente de esta sesión.
   *
   * El staff también tiene uno: cuando soporte entra en el servicio de
   * un cliente, su sesión ES de ese cliente. La diferencia no está en
   * este campo sino en `rol` y en `soporteDe`, que juntos dicen "es del
   * equipo y está atendiendo a este". Poner el cliente aquí es lo que
   * hace que el resto del código no necesite saber nada de soporte: ve
   * un cliente, como siempre.
   */
  clientId: string;
  rol: "staff" | "client";
  accessToken: string;
  csrfToken: string;
  expiraEn: string;

  /* ── SOPORTE ────────────────────────────────────────────────
     Presentes SOLO en sesiones de staff, y SOLO cuando ha elegido a qué
     cliente atiende. Son la razón por la que esa sesión puede ver datos
     que no son suyos: la BASE comprueba esta columna, no el código.

     Que el mismo registro diga a quién atiende y si es soporte no es
     redundancia. `rol` dice QUIÉN es; `soporteDe` dice sobre QUIÉN
     está trabajando. Con los dos juntos se puede preguntar quién tocó
     qué, y obtener una respuesta. */

  /** Cliente que esta sesión de staff atiende. */
  soporteDe?: string | null;
  /** Por qué entra. Nunca vacío si hay sesión de soporte. */
  soporteMotivo?: string | null;
}

/* ---------------------------------------------------------------------
   El id de tu servicio en `modules`
   ---------------------------------------------------------------------
   Es lo que se comprueba contra `modules.id` para saber si el cliente
   tiene el producto. Sale de la tabla `modules` del panel; no se
   inventa aquí.

   Y `MODULO_ID` tiene que ser el MISMO en la ruta que firma el ticket
   en el panel y en la que verifica aquí. */
export const MODULO_ID = "inventario";

/* =====================================================================
   Sesiones
   ===================================================================== */

function aleatorio(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}

function hash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Crea una sesión para quien acaba de pasar por el ticket.
 *
 * El token en claro se devuelve para ponerlo en la cookie y NO se
 * guarda: en la tabla solo va su hash. Si alguien lee
 * `inventario_sesiones` puede invalidar una sesión, no suplantarla.
 */
export async function crearSesion(params: {
  userId: string;
  /* NULL solo para staff antes de elegir a quién atiende. */
  clientId: string | null;
  rol: "staff" | "client";
  accessToken: string;
  /** Cliente al que atiende. Solo staff. */
  soporteDe?: string | null;
  /** Motivo de la entrada. Obligatorio si hay soporteDe. */
  soporteMotivo?: string | null;
}): Promise<{ token: string; csrfToken: string; expiraEn: string }> {
  const token = aleatorio(32);
  const csrfToken = aleatorio(24);
  const expiraEn = new Date(Date.now() + HORAS_SESION * 3600 * 1000).toISOString();

  /* El motivo se comprueba AQUÍ y no en la ruta que llama. Que no pueda
     dejarse en blanco es una propiedad de la sesión, y ponerlo en el
     punto de creación significa que ninguna ruta nueva pueda olvidarlo. */
  if (params.soporteDe && !params.soporteMotivo?.trim()) {
    throw new Error("Una sesión de soporte necesita un motivo.");
  }

  const { error } = await getAdmin().from("inventario_sesiones").insert({
    token_hash: hash(token),
    user_id: params.userId,
    client_id: params.clientId,
    rol: params.rol,
    access_token: params.accessToken,
    csrf_token: csrfToken,
    expira_en: expiraEn,
    soporte_de: params.soporteDe ?? null,
    soporte_motivo: params.soporteMotivo ?? null,
    soporte_abierto_en: params.soporteDe ? new Date().toISOString() : null,
  });

  if (error) throw new Error("No se pudo crear la sesión: " + error.message);

  return { token, csrfToken, expiraEn };
}

/**
 * Lee la sesión de la cookie.
 *
 * Devuelve null si no hay, si caducó o si se revocó. No lanza: la
 * ausencia de sesión es lo normal en casi todas las peticiones.
 */
export async function leerSesion(token?: string | null): Promise<Sesion | null> {
  if (!token) return null;

  const { data, error } = await getAdmin()
    .from("inventario_sesiones")
    .select(
      "user_id, client_id, rol, access_token, csrf_token, expira_en, revocado_en, soporte_de, soporte_motivo"
    )
    .eq("token_hash", hash(token))
    .maybeSingle();

  if (error || !data) return null;
  if (data.revocado_en) return null;
  if (new Date(data.expira_en).getTime() <= Date.now()) return null;

  return {
    userId: data.user_id,
    clientId: data.client_id,
    rol: data.rol,
    accessToken: data.access_token,
    csrfToken: data.csrf_token,
    expiraEn: data.expira_en,
    soporteDe: data.soporte_de,
    soporteMotivo: data.soporte_motivo,
  };
}

/** La sesión de la petición actual, o null. */
export async function getSession(): Promise<Sesion | null> {
  const store = await cookies();
  return leerSesion(store.get(COOKIE_NAME)?.value);
}

/** Cierra la sesión. Idempotente. */
export async function cerrarSesion(token?: string | null): Promise<void> {
  if (!token) return;
  await getAdmin()
    .from("inventario_sesiones")
    .update({ revocado_en: new Date().toISOString() })
    .eq("token_hash", hash(token));
}

/* =====================================================================
   El cliente de Supabase
   ===================================================================== */

/**
 * El cliente de Supabase de ESTE usuario, con su token.
 *
 * Es el que tienen que usar las rutas y las páginas: pasa por RLS, no
 * por la secret key.
 *
 * Si el token caducó (una hora de vida, y la sesión vive 4), esto NO
 * lo arregla. Se devuelve null y quien llama manda al panel a
 * renovarla. Preferible a refrescar en silencio: un refresh_token aquí
 * sería un segundo sitio donde guardar uno.
 */
export function clienteDeLaSesion(sesion: Sesion): SupabaseClient | null {
  if (!sesion.accessToken) return null;
  return getScoped(sesion.accessToken);
}

/**
 * Exige sesión. Para las PÁGINAS.
 *
 * Lanza `SIN_SESION:<destino>` en vez de devolver un 401, porque quien
 * está sin sesión es una persona que acaba de pulsar un enlace, no una
 * máquina: lo que quiere es una redirección, no un 401.
 *
 * ⚠️  PARA LAS RUTAS DE API, USA `exigeSessionApi`
 * ------------------------------------------------
 * Este `throw` solo lo convierte alguien en una redirección, y en las
 * páginas lo hace el proxy (que comprueba la cookie antes de llegar
 * aquí). Para las rutas de API no hay quien lo convierta: el proxy deja
 * pasar `/api` a propósito, porque un webhook la llama una máquina que
 * no tiene cookie, y cada ruta decide en su interior.
 *
 * Medido: con este `throw` solo, `/api/resumen` sin sesión contestaba
 * **500**, que es mentira. No es un error del servidor: es que no hay
 * sesión. Y un 500 ensucia los logs con algo que no es una avería, que
 * es justo lo que tapa averías de verdad.
 *
 * Ojo con el otro síntoma: la suscripción caducada lanza
 * `SIN_SUSCRIPCION`, y ese mensaje tampoco distingue "caducada" de
 * "nunca la tuvo". Ver `exigeSessionApi`.
 */
export async function exigeSession(origen = "/"): Promise<Sesion> {
  const sesion = await getSession();

  if (!sesion) {
    const destino = encodeURIComponent(origen);
    throw new Error(`SIN_SESION:${destino}`);
  }

  /* Se comprueba la suscripción en CADA petición, no solo al entrar.

     Si alguien cancela con el navegador ya abierto, tiene que dejar de
     funcionar en la siguiente llamada, no cuando le dé la gana. Es el
     caso más feo del SaaS: el cliente sigue usando lo que ya pagó y ya
     no tiene.

     El staff NO se comprueba, y es deliberado: si se comprobara, un
     member del equipo no podría entrar en el servicio de un cliente cuya
     suscripción acaba de caducar, que es justo el caso por el que más
     falta suele hacer. Además, aquí no se concede nada: RLS es la que
     decide si esa sesión ve los datos, y solo si `soporteDe` coincide
     con el cliente.

     Con la secret key a propósito: es una comprobación de NEGOCIO
     ("¿tiene el producto contratado?"), no de datos. Los DATOS del
     cliente siempre van por RLS. */
  if (!esSesionDeSoporte(sesion) && !(await tieneElModulo(sesion.clientId, MODULO_ID))) {
    throw new Error("SIN_SUSCRIPCION");
  }

  return sesion;
}

/** ¿Esta sesión es de soporte? Es decir, staff atendiendo a un cliente. */
export function esSesionDeSoporte(sesion: Sesion): boolean {
  return sesion.rol === "staff" && Boolean(sesion.soporteDe);
}

/** ¿Este cliente tiene este módulo contratado y al día? */
export async function tieneElModulo(clientId: string, moduleId: string): Promise<boolean> {
  if (!clientId || !moduleId) return false;

  /* La función `tiene_modulo` la crea el panel (migración 007). Es LA
     regla: usarla evita que cada servicio tenga la suya y que se
     desincronicen. */
  const { data, error } = await getAdmin().rpc("tiene_modulo", {
    cliente_uuid: clientId,
    modulo: moduleId,
  });

  if (error) {
    console.error("[sesion] tiene_modulo falló:", error.message);
    return false;
  }
  return data === true;
}

/* =====================================================================
   El guard de las rutas de API
   ===================================================================== */

/**
 * Exige sesión EN UNA RUTA DE API, y devuelve la respuesta si falla.
 *
 * La diferencia con `exigeSession` es que aquí NO lanza: devuelve un
 * 401 listo para devolver, porque una ruta de API no redirige a nadie.
 * Un `fetch` que sigue una redirección a `/entrar` recibe HTML donde
 * esperaba JSON, y el error que ve el que programa es `Unexpected token
 * <`, que no dice nada de la sesión.
 *
 * Uso, y es la parte que hay que respetar:
 *
 *   const g = await exigeSessionApi();
 *   if (g.error) return g.error;
 *   const { sesion } = g;
 *
 * Ojo al nombre de la propiedad: es `error`, no `sesion` a null, para
 * que quien se lo salte no compile. Un `const sesion = await
 * getSession()` sin comprobar devuelve `undefined` y `sesion.clientId`
 * revienta con un error que no menciona la sesión.
 */
export async function exigeSessionApi(
  origen = "/"
): Promise<{ sesion: Sesion; error: null } | { sesion: null; error: NextResponse }> {
  const sesion = await getSession();

  if (!sesion) {
    /* 401 y no 403: 403 dice "no puedes aunque entres", 401 dice "no has
       entrado". Es lo que espera un cliente HTTP, y lo que permite a un
       `fetch` reintentar después de canjear el ticket. */
    return {
      sesion: null,
      error: NextResponse.json(
        { ok: false, error: "Sin sesión.", destino: origen },
        { status: 401 }
      ),
    };
  }

  if (!esSesionDeSoporte(sesion) && !(await tieneElModulo(sesion.clientId, MODULO_ID))) {
    /* 402, no 403. 402 es "payment required": el servicio está pagado y
       este cliente no lo tiene. Es el único código que dice exactamente
       eso, y evita el "accedes a algo que no puedes" que lleva a
       pensar en un fallo de permisos en vez de en una suscripción. */
    return {
      sesion: null,
      error: NextResponse.json(
        { ok: false, error: "Este módulo no está activo en tu cuenta.", sinModulo: true },
        { status: 402 }
      ),
    };
  }

  return { sesion, error: null };
}

/* =====================================================================
   Cookies
   ===================================================================== */

/**
 * Las opciones con las que se pone la cookie de sesión.
 *
 * `secure` en producción. Detrás de un proxy HTTPS, `request.url` puede
 * decir `http` aunque el navegador venga por https, así que esta función
 * se llama con el `request` real y no con `headers()`: si te olvidas de
 * esto, en producción la cookie no se pone y no sabes por qué.
 */
export function opcionesCookie(maxAgeSegundos: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSegundos,
    /* SIN `domain`. A propósito.

       Si se pusiera `Domain=.midominio.com`, la cookie viajaría a todos
       los subdominios, y un XSS en CUALQUIERO de ellos —incluidos los
       que no tienen nada que ver con esto— podría leerla. Es el
       motivo por el que cada servicio tiene su propia cookie y su
       propia tabla de sesiones. */
  };
}