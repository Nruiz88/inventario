/* PostCSS: Tailwind v4 va como un plugin de PostCSS.
 *
 * En Tailwind v4 no se escribe un `tailwind.config.js` por defecto: la
 * configuración son las variables de `@theme` de `globals.css`. Este
 * fichero solo existe para decir que PostCSS tiene que pasar por
 * Tailwind, y es lo único que hay que tocar de aquí si algún día
 * cambia la versión.
 *
 * Se escribe como `.mjs` y no como `.js` porque el proyecto no declara
 * `"type": "module"`: un `.js` con `export` no arranca. */
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};