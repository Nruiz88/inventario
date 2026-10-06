/* =========================================================
   Ticket de acceso para desarrollo
   ---------------------------------------------------------
   Imprime un enlace `http://localhost:3010/entrar#ticket=...` listo
   para abrir en el navegador, con una sesión REAL.

   POR QUÉ ESTE SCRIPT EXISTE
   --------------------------
   Para llegar a este servicio hay que pasar por un ticket que firma el
   panel. En local eso significa: o levantar también el panel y entrar
   como una persona, o tener algo que te dé el enlace. Sin esto, ver el
   servicio en local es imposible salvo que tengas el panel delante.

   Y el paso de "levantar el panel y entrar" no es un detalle: es justo
   el camino entero, y es el que falló una vez en el bot sin que ninguna
   prueba lo notara. Este script hace las DOS mitades por separado.

   ⚠️  ES SOLO DE DESARROLLO
   -------------------------
   Hace tres cosas que en producción no deben pasar: usa la secret key
   para abrir una sesión sin contraseña, imprime el `access_token` de
   Supabase en la consola y el ticket en la URL.

   Por eso:
     · aborta si NODE_ENV === "production"
     · NO se ejecuta desde el panel: el botón "Abrir" del panel firma
       el ticket de verdad, con la sesión de la persona que está
       pulsando. Este script es el atajo de desarrollo, no el camino
       real.
     · el ticket vive 90 minutos en desarrollo, y en producción sigue
       siendo 5. La diferencia es deliberada y está explicada en
       `lib/tickets.js` del panel: el token que va dentro del ticket
       dura una hora, así que más de eso no sirve de nada.

   USO
     node db/dev-ticket.mjs                  # el primer cliente normal
     node db/dev-ticket.mjs --staff          # alguien del equipo
     node db/dev-ticket.mjs --email otro@x.com

   La cookie que deja es de `inv_sesion`, que es host-only: esto solo
   entra en `localhost:3010` y en ningún otro sitio.
   ========================================================= */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const RAIZ = path.resolve(import.meta.dirname, "..");

function leerEnv(ruta) {
  const salida = {};
  if (!fs.existsSync(ruta)) return salida;
  for (const linea of fs.readFileSync(ruta, "utf8").split("\n")) {
    const t = linea.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) salida[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return salida;
}

const env = { ...leerEnv(path.join(RAIZ, ".env.local")), ...process.env };

/* ---------------------------------------------------------------------
   Las tres cosas que este script necesita
   --------------------------------------------------------------------- */

if (process.env.NODE_ENV === "production") {
  console.error("\n✗ Esto es de desarrollo. En producción sale por el panel.\n");
  process.exit(1);
}

if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY || !env.SERVICE_SECRET) {
  console.error("\n✗ Faltan SUPABASE_URL, SUPABASE_SECRET_KEY o SERVICE_SECRET.\n");
  process.exit(1);
}

if (!env.SERVICE_SECRET || env.SERVICE_SECRET.length < 32) {
  console.error("\n✗ SERVICE_SECRET es demasiado corto.\n");
  console.error("  Si tiene menos de 32 caracteres, el panel y este servicio");
  console.error("  pueden acabar firmando con algo que se adivina.\n");
  process.exit(1);
}

/* ---------------------------------------------------------------------
   El acceso
   --------------------------------------------------------------------- */

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const esStaff = process.argv.includes("--staff");
const argEmail = process.argv.indexOf("--email");
const emailPedido = argEmail > -1 ? process.argv[argEmail + 1] : null;

async function usuarios() {
  /* `listUsers` con la secret key. Se pagina porque Supabase mete 50 por
     página y en un proyecto con más usuarios saldrían solo los
     primeros, que es el fallo clásico de esta llamada. */
  const salida = [];
  let pagina = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 100 });
    if (error) throw error;
    salida.push(...(data?.users || []));
    if (!data?.users?.length || salida.length >= (data.users?.length || 0) + pagina * 100) break;
    if (pagina > 20) break;
    pagina++;
  }
  return salida;
}

/**
 * Abre una sesión sin contraseña, con la secret key.
 *
 * `generateLink` devuelve un token ya hasheado que se canjea por un
 * access_token. Es la forma de conseguir una sesión real sin conocer la
 * contraseña, y por eso mismo es la que no debe existir en producción.
 */
async function sesionDe(email) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw error;

  const tokenHash = data?.properties?.hashed_token;
  if (!tokenHash) throw new Error("generateLink no devolvió token");

  /* ⚠️  EL CANJE SE HACE CON LA CLAVE PÚBLICA, NO CON LA SECRET
   * -------------------------------------------------------
   * Es un cliente anónimo. Con la secret key, `verifyOtp` responde bien
   * pero sin `access_token`: no hay usuario al que dárselo, porque la
   * secret key es una identidad de servicio, no de persona.
   *
   * El resultado del primer intento fue un error que no lo dice:
   * "verifyOtp no devolvió access_token", sin mencionar que el cliente
   * era el equivocado. Con la clave pública funciona, y es el mismo
   * camino que recorre el botón del panel.
   */
  const publico = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || "",
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  if (!env.SUPABASE_PUBLISHABLE_KEY && !env.SUPABASE_ANON_KEY) {
    console.error("\n✗ Falta SUPABASE_PUBLISHABLE_KEY.\n");
    console.error("  Sin ella no hay cliente anónimo con el que canjear el");
    console.error("  token, y sin canje no hay access_token.\n");
    process.exit(1);
  }

  const { data: canje, error: eCanje } = await publico.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (eCanje) throw eCanje;

  /* ⚠️  EL TOKEN VIENE ANIDADO EN `session`
   * ---------------------------------------
   * La versión de `@supabase/supabase-js` que hay instalada devuelve
   * `{ user, session }`, y el `access_token` está en
   * `session.access_token`. Las versiones antiguas lo devolvían plano, en
   * la raíz del objeto.
   *
   * Leer `data.access_token` da `undefined` sin error, y el síntoma es
   * "no devolvió access_token", que no dice que lo que se busca está un
   * nivel más abajo. Por eso se aceptan las dos formas: así el script
   * aguanta una actualización de la librería sin romperse, que es lo que
   * va a pasar sooner o later.
   */
  const accessToken = canje?.session?.access_token || canje?.access_token;
  const userId = canje?.session?.user?.id || canje?.user?.id;

  if (!accessToken) {
    console.error("\n✗ verifyOtp respondió sin access_token.");
    console.error("  Lo que devolvió: " + JSON.stringify(Object.keys(canje || {})));
    console.error("  Si aparece una clave nueva, el token mudou de sitio.\n");
    process.exit(1);
  }

  return { accessToken, userId };
}

/** El cliente al que pertenece este usuario en la tabla `clients`. */
async function clienteDe(userId, email) {
  const { data: perfil, error } = await admin
    .from("profiles")
    .select("id, nombre, rol, client_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!perfil) {
    console.error(`\n✗ ${email} no tiene fila en profiles.\n`);
    console.error("  Sin ella no hay cliente asociado y no se puede firmar el");
    console.error("  ticket: el servicio no sabría de quién es la sesión.\n");
    process.exit(1);
  }

  if (esStaff) return { clientId: null, nombre: `${perfil.nombre} (staff)` };

  if (!perfil.client_id) {
    console.error(`\n✗ ${email} es ${perfil.rol} y no tiene client_id.\n`);
    console.error("  Un staff entra en el servicio de un cliente Concrete, así");
    console.error("  que este script necesita un cliente normal.\n");
    process.exit(1);
  }

  const { data: cliente } = await admin
    .from("clients")
    .select("id, nombre")
    .eq("id", perfil.client_id)
    .maybeSingle();

  if (!cliente) {
    console.error(`\n✗ ${perfil.client_id} no está en clients.\n`);
    process.exit(1);
  }

  /* El módulo tiene que estar contratado, o el servicio va a redirigir a
     /sin-acceso. Mejor decirlo aquí, con el nombre del módulo, que
     dejar que el dueño descubra que tiene que comprarlo. */
  const { data: sub } = await admin
    .from("suscripciones")
    .select("estado")
    .eq("client_id", perfil.client_id)
    .eq("module_id", "inventario")
    .in("estado", ["activo", "prueba"])
    .maybeSingle();

  if (!sub) {
    console.error(`\n✗ ${cliente.nombre} no tiene el módulo "inventario" contratado.\n`);
    console.error("  El enlace se firmaría bien, pero el servicio respondería");
    console.error("  402 y mandaría a /sin-acceso. Se comprueba con:\n");
    console.error("    node scripts/comprobacion-modulo.mjs\n");
    process.exit(1);
  }

  return { clientId: perfil.client_id, nombre: cliente.nombre };
}

/* ---------------------------------------------------------------------
   Firmar
   ---------------------------------------------------------------------
   Es el MISMO formato que firma el panel, a mano, para que este enlace
   pruebe el camino real y no una versión suya.

   Si esto se copió del panel y no coincide, el canje da 401 y el error
   dice "ese enlace no vale", que no señala que el problema sea la
   firma. Por eso está al lado y no escondido en una librería. */

/* ── Los minutos de vida ──
   Por defecto 90 en desarrollo, y el tope también es 90.

   El motivo del tope es el mismo que en el panel: el `access_token` de
   Supabase que va DENTRO del ticket vive una hora. Pedir cuatro horas
   produce un enlace firmado válido cuatro horas que en realidad no
   sirve para nada después de la primera, y lo que queda es un enlace en
   el historial del navegador durante cuatro horas.

   Es decir: alargar el ticket NO alarga la sesión. La sesión son las
   cuatro horas de la cookie, y esa se crea al entrar. Lo que dura cinco
   minutos es el.bootstrap. */
const MINUTOS_POR_DEFECTO = 90;
const MINUTOS_TOPE = 90;

function minutosPedidos() {
  const i = process.argv.indexOf("--minutos");
  if (i < 0) return MINUTOS_POR_DEFECTO;

  const n = Number(process.argv[i + 1]);
  if (!Number.isFinite(n) || n <= 0) {
    console.error("\n✗ --minutos necesita un número mayor que cero.\n");
    process.exit(1);
  }

  if (n > MINUTOS_TOPE) {
    console.log(
      `\n  · Pediste ${n} minutos y el tope es ${MINUTOS_TOPE}.\n` +
        `    El token de Supabase que va dentro del ticket dura una hora, así\n` +
        `    que más de eso no sirve de nada.\n`
    );
  }

  return Math.min(Math.round(n), MINUTOS_TOPE);
}

function firmar({ userId, clientId, rol, accessToken, minutos }) {
  const segundos = minutos * 60;
  const ahora = Math.floor(Date.now() / 1000);
  const payload = {
    uid: userId,
    cid: clientId || null,
    rol,
    sid: null,
    at: accessToken,
    exp: ahora + segundos,
    jti: crypto.randomBytes(9).toString("base64url"),
  };

  const cuerpo = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const firma = crypto.createHmac("sha256", env.SERVICE_SECRET).update(cuerpo).digest("base64url");
  return cuerpo + "." + firma;
}

/* ---------------------------------------------------------------------

   --------------------------------------------------------------------- */

const todos = await usuarios();
if (!todos.length) {
  console.error("\n✗ No hay usuarios en Supabase Auth.\n");
  process.exit(1);
}

let elegido;
if (emailPedido) {
  elegido = todos.find((u) => (u.email || "").toLowerCase() === emailPedido.toLowerCase());
  if (!elegido) {
    console.error(`\n✗ No existe ${emailPedido}.\n`);
    console.error("  Los que hay:\n");
    for (const u of todos) console.error("    " + u.email);
    process.exit(1);
  }
} else {
  /* Sin --email: el primero que sea cliente de verdad. Elegir el
     primero de la lista seríastaff o un usuario sin perfil, y fallaría
     con un error que no explica que el problema es la elección. */
  elegido = todos.find((u) => (u.email || "").endsWith("@ejemplo.com")) || todos[0];
}

const { accessToken, userId } = await sesionDe(elegido.email);
const { clientId, nombre } = await clienteDe(userId, elegido.email);

const ticket = firmar({
  userId,
  clientId,
  rol: esStaff ? "staff" : "client",
  accessToken,
  minutos: minutosPedidos(),
});

const puerto = process.env.PORT || "3010";
const enlace = `http://localhost:${puerto}/entrar#ticket=${ticket}`;

/* `--archivo <ruta>` escribe el enlace ahí y no imprime nada más.

   Existe por una razón concreta: el enlace es una línea de 1.500
   caracteres con puntos, que PowerShell parte al copiarla de una salida
   con color, y al partirla el ticket deja de.verify y el canje da 401
   sin decir por qué. Escribiéndolo a fichero no hay forma de que se
   corrompa por el camino, y el script de pruebas puede leerlo. */
const argArchivo = process.argv.indexOf("--archivo");
if (argArchivo > -1) {
  fs.writeFileSync(process.argv[argArchivo + 1], enlace, "utf8");
  process.exit(0);
}

console.log("\n══════════════════════════════════════════════════════");
console.log(`  Cliente: ${nombre}`);
console.log(`  Usuario: ${elegido.email}`);
console.log(`  Rol:     ${esStaff ? "staff" : "client"}`);
console.log("  Caduca:  en " + minutosPedidos() + " minutos  (--minutos N lo cambia, hasta 90)");
console.log("══════════════════════════════════════════════════════\n");
console.log("  Ábrelo en el navegador:\n");
console.log("  " + enlace + "\n");
console.log(
  "  Si da 401, es que llegó tarde. Corré otra vez el comando.\n" +
    "  Una vez dentro, la sesión dura 4 horas.\n"
);
console.log("  Ojo: este enlace lleva el access_token de Supabase dentro, en el");
console.log("  fragmento. No lo mandes a nadie y no lo pegues en un chat.\n");
process.exit(0);