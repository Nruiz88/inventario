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
   */
  typescript: {
    ignoreBuildErrors: false,
  },

  /* ⭐ LOS ERRORES DE ESLINT
   * -------------------------
   * Los errores (los que cortan la compilación) sí se miran. Los avisos no
   * se usan como puerta: si lo fueran, la primera vez que un aviso venga
   * de una librería de terceros, alguien pone `ignoreWarnings: true` y a
   * partir de ahí no vuelve a mirar ninguno.
   */
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;