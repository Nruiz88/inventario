/* =========================================================
   La dirección del panel de Nexo Studio
   ---------------------------------------------------------
   Este servicio necesita volver al panel en tres sitios: cuando el
   ticket caducó, cuando no se tiene el servicio contratado y cuando
   uno se equivoca de URL.

   La dirección sale de una variable, NEXT_PUBLIC_PANEL_URL.

   El prefijo NEXT_PUBLIC_ no es opcional: esta pantalla se pinta en el
   navegador, donde el process.env del servidor no existe. Next.js lo
   sustituye al compilar, y eso tiene un precio: el valor queda DENTRO
   del JavaScript que baja el usuario, así que no puede ser un secreto.
   Y no lo es: es la dirección pública del panel. Lo que no puede acabar
   en ese bundle es SERVICE_SECRET.
   ========================================================= */

const configurada = (process.env.NEXT_PUBLIC_PANEL_URL || "").trim().replace(/\/+$/, "");

/* Si no está puesta, sale el de desarrollo. Es un valor que se ve
   enseguida al probar, y peor que un dominio equivocado es un enlace
   que no lleva a ninguna parte. */
const PANEL = configurada || "http://127.0.0.1:3000";

/** La pantalla de servicios del cliente, que es a donde se vuelve
    siempre: tanto si el problema es de la suscripción como si solo es
    que el enlace del servicio llegó mal. */
export const MIS_SERVICIOS = PANEL + "/panel/mis-servicios";

export const MI_CUENTA = PANEL + "/panel/mi-cuenta";