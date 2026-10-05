import crypto from "crypto";

/* =========================================================
   Verificación del ticket que firma el panel
   ---------------------------------------------------------
   POR QUÉ EXISTE
   -------------
   Este servicio no tiene usuarios propios. Quien entra es alguien que
   ya se autenticó en el panel, y la forma de probarlo es un ticket
   firmado: el panel lo firma con SERVICE_SECRET y este servicio lo
   comprueba con el mismo secreto.

   Es lo mismo que se hace con dos servicios que no se llaman entre sí:
   uno firma, el otro verifica. No hace falta que este servicio sepa la
   contraseña de nadie, ni que el panel sepa las claves de aquí.

   EL FORMATO, QUE NO SE PUEDE CAMBIAR
   ------------------------------------
       <base64url(payload)>.<base64url(HMAC-SHA256(payload))>

   El panel firma con el MISMO formato. Si cambia una cosa de un lado,
   nada funciona y el error es "ese enlace no vale", que no dice cuál de
   las dos cosas se rompió.

   ⚠️  EL SECRETO
   -------------
   `SERVICE_SECRET` tiene que ser el MISMO en el panel y aquí, y
   DISTINTO de `SESSION_SECRET`.

   Si compartieran secreto, una firma válida del panel valdría como
   cookie de sesión de este servicio. Y `SESSION_SECRET` distinto es lo
   que hace que la cookie de aquí no valga en ningún otro sitio.

   Es la causa de un fallo que costó tiempo: los dos servicios con
   secretos distintos dan 401 sin decir por qué. Si te pasa, compara
   las longitudes de los dos secretos antes que nada.

   ⚠️  LA FIRMA SE COMPRUEBA ANTES DE LEER NADA
   -------------------------------------------
   Si primero deserializas el payload y luego compruebas la firma,
   alguien puede mandarte un payload arbitrario y lo deserializas antes
   de comprobar nada. Aquí va al revés, y no es un detalle de estilo.
   ========================================================= */

/** Cuánto margen se deja al token de Supabase que va dentro del ticket. */
const MARGEN_TOKEN_MS = 2 * 60 * 1000;

function b64urlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

function firma(cuerpo: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(cuerpo).digest("base64url");
}

/**
 * Comparación en tiempo constante.
 *
 * Comparar con `===` filtra información por tiempo: permite ir forzando
 * la firma byte a byte, porque se tarda menos cuando los primeros
 * bytes NO coinciden.
 */
function comparacionSegura(a: string, b: string): boolean {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export interface TicketPayload {
  /** id del usuario en Supabase Auth */
  uid: string;
  /** id del cliente. NULL si es staff. */
  cid: string | null;
  rol: "staff" | "client";
  /** id de la sesión del panel, para auditar y revocar */
  sid: string | null;
  /** access_token de Supabase, para reconstruir la sesión */
  at: string;
  /** caduca en SEGUNDOS. */
  exp: number;
  /** único por ticket */
  jti: string;

  /**
   * Por qué entra un member del equipo. Solo lo pone el panel cuando el
   * rol es staff, y llega dentro del cuerpo firmado: si alguien lo
   * cambia, la firma deja de cuadrar y el ticket se rechaza entero.
   *
   * No es adorno. Es el texto que queda guardado y que se lee cuando
   * alguien pregunta por qué soporte tocó la configuración de un cliente.
   */
  mot?: string | null;
}

/**
 * Valida un ticket. NO lanza: devuelve null si algo no cuadra.
 *
 * Que devuelva null en vez de lanzar es a propósito: un ticket
 * manipulado es un evento NORMAL (alguien que cambia un carácter por
 * curiosidad, un escáner de seguridad, un enlace caducado). Quien llama
 * decide qué hacer con eso.
 */
export function verificar(ticket: string, secret?: string): TicketPayload | null {
  const clave = (secret ?? process.env.SERVICE_SECRET ?? "").trim();
  if (!clave) return null;
  if (!ticket || typeof ticket !== "string") return null;

  const corte = ticket.lastIndexOf(".");
  if (corte < 1) return null;

  const cuerpo = ticket.slice(0, corte);
  const firmaRecibida = ticket.slice(corte + 1);
  if (!firmaRecibida) return null;

  /* La firma va PRIMERO. Ver la nota de arriba del fichero. */
  if (!comparacionSegura(firmaRecibida, firma(cuerpo, clave))) return null;

  let payload: TicketPayload;
  try {
    payload = JSON.parse(b64urlDecode(cuerpo).toString("utf8"));
  } catch {
    return null;
  }

  /* Que la firma cuadre no significa que el contenido sea lo que
     esperamos: alguien con el secret podría haber firmado otra cosa.
     Estas comprobaciones son de FORMA. */
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.uid !== "string" || !payload.uid) return null;
  if (payload.rol !== "staff" && payload.rol !== "client") return null;
  if (typeof payload.exp !== "number") return null;
  if (payload.rol === "client" && (typeof payload.cid !== "string" || !payload.cid)) return null;

  /* Caducado, con 5 s de margen: un ticket que expira justo mientras se
     procesa no sirve de nada. */
  if (payload.exp + 5 < Math.floor(Date.now() / 1000)) return null;

  return payload;
}

/** El access_token que va dentro del ticket. */
export const tokenDe = (payload: TicketPayload): string => payload.at;

/**
 * Por qué no vale un ticket, PARA LOS LOGS.
 *
 * Devuelve una de estas: `vacio`, `malformado`, `caducado`,
 * `no-verifica`.
 *
 * ⚠️  POR QUÉ NO SE USA `verificar()` PARA ESTO
 * -------------------------------------------
 * `verificar()` devuelve null en los tres casos de fallo y no dice cuál.
 * Reimplementar aquí la comprobación de caducidad significaría volver a
 * hacer la lectura del base64url y el JSON en otro fichero, que puede
 * desincronizarse del verificador: si mañana cambia una regla, el
 * diagnóstico se queda diciendo lo contrario, y eso es peor que no decir
 * nada.
 *
 * ⚠️  AL USUARIO NO SE LE DICE EL MOTIVO COMPLETO
 * ----------------------------------------------
 * Al navegador solo se le dice si caducó, porque eso le sirve para saber
 * qué hacer. Distinguir más sería un oráculo: con un enlace
 * manipulado, decir "no caducado" frente a "caducado" revelaría si su
 * firma era correcta.
 *
 * Y el ticket NO se escribe en el log, entero ni por partes: lleva el
 * access_token de Supabase dentro, y el log de un contenedor es de los
 * sitios donde un token se queda puesto mucho tiempo.
 */
export function diagnosticoDeTicket(ticket: string): string {
  if (!ticket) return "vacio";

  const corte = ticket.lastIndexOf(".");
  if (corte < 1 || corte === ticket.length - 1) return "malformado";

  try {
    const payload = JSON.parse(b64urlDecode(ticket.slice(0, corte)).toString("utf8"));
    if (!payload || typeof payload !== "object") return "malformado";
    if (typeof payload.exp !== "number") return "malformado";
    if (payload.exp + 5 < Math.floor(Date.now() / 1000)) return "caducado";

    /* Se lee bien y no está caducado, pero verificar() falló: la firma
       no cuadra. Es el caso de los secretos distintos entre servicios,
       que es el que más cuesta encontrar a ciegas. */
    return "no-verifica";
  } catch {
    return "malformado";
  }
}

/**
 * ¿Caduca pronto el access_token?
 *
 * El panel lo comprueba ANTES de firmar. Aquí no hace falta porque no
 * firmamos, pero se deja exportado por si este servicio llega a firmar
 * algo, donde el mismo error aparecería igual.
 */
export function tokenPorExpirar(accessToken: string, margenMs = MARGEN_TOKEN_MS): boolean {
  if (!accessToken) return true;
  try {
    const partes = String(accessToken).split(".");
    if (partes.length !== 3) return true;
    const payload = JSON.parse(b64urlDecode(partes[1]).toString("utf8"));
    if (!payload.exp) return true;
    return payload.exp * 1000 - Date.now() < margenMs;
  } catch {
    return true;
  }
}