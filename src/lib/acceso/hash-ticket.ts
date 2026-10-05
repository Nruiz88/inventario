/* =========================================================
   Leer el ticket del fragmento
   ---------------------------------------------------------
   Un archivo para una línea. Existe porque esa línea estuvo mal en el
   bot de WhatsApp y costó que nadie pudiera entrar.

   QUÉ PASÓ
   --------
   La página hacía esto:

       window.location.hash.replace(/^#/, "").trim()

   Eso quita la almohadilla pero deja el `ticket=` pegado: el servidor
   recibía `ticket=eyJ1aWQi...` en vez de `eyJ1aWQi...`. No es base64url,
   así que la verificación fallaba y la respuesta era 401. Siempre.

   O sea: la entrada NO funcionó nunca desde un navegador. Y todas las
   pruebas daban verde, porque hacen el POST ellas mismas con el ticket ya
   limpio y se saltan el fragmento entero. Nadie ejecutó esa línea hasta
   que una persona abrió el enlace.

   POR QUÉ ESTÁ EN UN ARCHIVO
   --------------------------
   Para que se pueda probar de verdad. Importar el componente entero
   arrastraría React, y el `useEffect` no se ejecuta sin un DOM. Con el
   parseo aquí, la prueba usa ESTE código y no una copia.

   Y una copia es exactamente el problema: se queda vieja el primer día
   que cambia el original y sigue dando verde mientras el bug vuelve.
   ========================================================= */

export function ticketDelHash(hash: string): string {
  const bruto = (hash || "").replace(/^#/, "").trim();

  /* El `&` corta por si el fragmento trae más pares. Hoy no los trae,
     pero mandarlos pegados haría que el servidor lo rechazara por algo
     que no es el ticket. */
  return bruto.replace(/^ticket=/, "").split("&")[0].trim();
}