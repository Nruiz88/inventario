import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* ⭐ LOS TYPESCRIPT
   * ------------------------
   * Esto parece un detalle y no lo es. Next.js lo pone a `false` para
   * que la compilación no tarde un minuto y medio cada vez que tocas un
   * fichero.
   *
   * El problema es que entonces un error de tipos NO IMPIDE desplegar: la
   * app se levanta, y el error aparece en producción, en un sitio, o en
   * un POST que nadie probó. Con `ignoreBuildErrors: false` el
   * despliegue falla en el sitio correcto, que es el ordenador de quien
   * lo changed.
   *
   * No se va a poner. La lentitud de un typecheck es un coste de un
   * minuto; un fallo de tipos en producción es un cliente que no puede
   * entrar.
   *
   * ⚠️  POR QUÉ YA NO HAY CLAVE `eslint`
   * ------------------------------------
   * Next 16 la eliminó de `NextConfig`. No es que dejara de comprobar:
   * es que el lint ya no se ejecuta en el build, se ejecuta aparte
   * (`next lint`). Antes, con `ignoreDuringBuilds: false`, los errores de
   * ESLint cortaban la compilación; ahora hay que acordarse de correrlo,
   * o no se mira.
   *
   * Y esto no es hipotético: `D:\webs\wweb\next.config.ts` tiene
   * `ignoreBuildErrors: true`, así que el bot que está en producción
   * desplega con los errores de tipos que quiera. Por eso este
   * servicio los tiene en `false`: la diferencia entre los dos es
   * deliberada.
   */
  typescript: {
    ignoreBuildErrors: false,
  },

  /* ⭐ `standalone`: SIN ESTO LA IMAGEN NO ARRANCA
   * ------------------------------------------------------
   * Next genera una copia mínima de lo que hace falta para arrancar, en
   * vez de llevar `node_modules` entero a la imagen final.
   *
   * Sin esto, el `Dockerfile` copia `.next/standalone`, esa carpeta no
   * existe, y el build falla. Es el primer error que da un despliegue con
   * Dockerfile y no dice nada de por qué.
   *
   * El bot (`D:\webs\wweb`) ya lo tiene. Este servicio nació de la
   * plantilla, y la plantilla no lo traía, porque no traía Dockerfile.
   */
  output: "standalone",
};

export default nextConfig;