Continuamos el rediseño de dos proyectos. Lee todo esto antes de tocar nada.

# Qué hay

Son **dos repositorios distintos**, no uno. Es lo primero que hay que
tener claro, porque la última vez se acabó trabajando en el que no
tocaba.

**`D:\webs\empresa`** — el portal y el panel de administración de un
estudio. Express + EJS, sin build. **Terminado y subido.**

**`D:\webs\inventario`** — un microservicio aparte: gestión de stock de
un kiosco. Next.js 16 + React 19 + Supabase. **A medias.** Es donde hay
que seguir.

Ambos en `main`. Los dos con árbol limpio al terminar esta sesión.

```
empresa    cc07a0a  Unificar las cajas del panel y reparar texto en otros alfabetos
inventario 0ddb1c3  Las ocho consultas del resumen, a la vez
```

---

# REGLAS QUE NO SE ROMPEN

Estas siete están porque el trabajo sale mal sin ellas, y la última vez
que faltaron, el coste fue un día entero perdido en un fichero roto.

## 1. Los comentarios se escriben en castellano, y se comprueba

`db/ver-idioma.js` busca cirílico, griego, hebreo, árabe, devanagari y
chino, más el símbolo de reemplazo. Va antes de vitest en `npm test`.

Está porque se colaron **diez veces**: cinco en código que ya existía y
cinco en comentarios que estaba escribiendo esa misma tarde. Ninguna
compilaba mal. Solo se ve leyendo, y "raro" no es un filtro fiable.

**No escribas nunca un trozo de otro idioma ni para citarlo como
ejemplo de lo que no hay que escribir.** Casa por el ancla en ASCII, y
el ejemplo del regex se escribe con escapes:

```js
// MAL: el carácter tecleado no es el que está en el fichero, y el
// patrón no casa. Passa igual con cualquier palabra extranjera.
[unaPalabraExtranjera, "cadena"]

// BIEN: una clase de caracteres y el ancla en ASCII alrededor
[new RegExp("\\u2e80-\\u9fff]+ que no había", "g"), "descubrió que no había"]
```

Los rangos van **con escapes de unicode**, nunca tecleados: tecleados
salen mal, y un rango mal da falso positivo y falso negativo a la vez.

## 2. Pasar `db/normalizar-finales.js` después de cada parche

Los scripts escriben LF sobre ficheros que en Windows tienen CRLF. Con
finales mezclados el editor no encuentra bloques y el error **no
menciona los finales de línea**, así que se acaba buscando un espacio de
más. Pasa a LF y avisa de los que mezcla.

## 3. Un script comprueba qué hay antes de escribir

No recorta ni sustituye por número de línea sin mirar. Busca el texto
que espera, y si no está donde dice, **no escribe y avisa**. Un script
que borra la línea equivocada sin enterarse es peor que no tener script.

Al mover código entre sitios, comprobar además el **orden de ejecución**:
declarar una promesa no la ejecuta, y un `|| 0` sobre algo que aún no
llegó sale un cero que parece un dato y no da ningún error.

## 4. `npm test` y `npx tsc --noEmit` antes de decir que está

En inventario los tres:

```
node db/ver-idioma.js && node db/ver-efectos.js && vitest run
npx tsc --noEmit
node capturar.js
```

## 5. `capturar.js` mide, no comprise

Mide las seis pantallas a 1440 y a 390, con datos dentro:

```
npm run capturar      # escribe en capturas/antes
$env:SALIDA="capturas/despues"; npm run capturar
```

Mide objetivos táctiles por debajo de 36 px, desborde horizontal y
tablas más anchas que su hueco. **Nombra el elemento que desborda**, y
descarta lo que vive dentro de un contenedor con scroll.

Antes de arreglar algo que marque, **comprobar que el aviso es real**.
Ya pasó dos veces: marcaba como rota una casilla que ya estaba arreglada
—medía el `input` cuando el objetivo real era su `label`— y marcaba
pestañas que se desplazan dentro de un contenedor con scroll.

## 6. `capturas/` está en `.gitignore`

Son datos del cliente de prueba. No se suben.

## 7. Nada de datos inventados

Sin teléfonos, sin CUIT, sin precios del estudio. Los que hay en las
migraciones y en las semillas son `[demo]` deliberados y no se tocan.
Los teléfonos y el NIF de `lib/site.js` son placeholders españoles sin
reemplazar: **no inventar el argentino**.

---

# Qué se ha hecho ya

## `empresa` — terminado

Un solo sistema de cajas donde había dos. `panel-box` → `panel-card`,
`panel-split` → `panel-rejilla`, `panel-subtitle` → `panel-card-titulo`,
`panel-clear` → botón pequeño fantasma.

También `db/auditar-panel.js` (qué página usa qué) y `db/ver-css.js`
(recorre catorce páginas con navegador de verdad y comprueba que dan
200, con 36 px de separación, sin desborde y sin que ninguna caja se
quede sin fondo).

## `inventario` — dos pantallas y una ruta

**Tailwind v4** instalado y funcionando. Los tokens están en
`src/app/globals.css`, que es CSS primero: no hay `tailwind.config.js`.
**Ojo:** Tailwind v4 solo escribe en la hoja las variables de `@theme`
que se usan. Si `--color-panel` no aparece, no es que el fichero no se
lea: es que nadie la usa todavía.

**shadcn está escrito a mano** en `src/components/ui/`. La CLI no
funciona en esta máquina: `npx shadcn add` lanza
`npm install -- cn radix-ui`, y `cn` y `radix-ui` son paquetes que
existen en npm y no son Radix. Instaló 28 paquetes basura. **No la
uses.** Escrito a mano es exactamente lo que shadcn es: código copiado
al proyecto.

También hay un `allowScripts` en `package.json` porque el `.npmrc` del
usuario tiene `allow-scripts=all` y npm 12 lo rechaza en instalaciones
locales. Avisa en cada `npm install`; no es un error.

**Migradas:** `marco.tsx` (navegación que se desliza en móvil) y
`resumen.tsx`. `productos`, `ventas`, `compras`, `caja` y `cuentas`
siguen con estilos en línea.

**`/api/resumen`** hacía cinco idas y venidas en serie; ahora las ocho
consultas salen en un solo `await`. Manda un `Server-Timing` con el
desglose por consulta; se lee con `npm run tiempos`.

**Las cifras que faltaban en un inventario**, ya enseñadas:
- **Valor del stock** al coste, con el margen que lleva.
- **«Pedir 8»** en vez de «3 · mín. 4»: lo que va en el pedido.
- **Treinta barras** en vez del total y el promedio, que juntos no
  dicen nada.

---

# Lo que sigue, en este orden

## 1. Extraer los modales de `productos.tsx`

**Esto es lo primero y es lo que desbloquea todo lo demás.**

`productos.tsx` tiene 1000 líneas: el listado y, en el mismo fichero,
los modales `Formulario`, `MoverStock`, `Baja` y `Capa` —430 líneas que
usan la API vieja.

**Una pantalla no se puede migrar por partes si los modales viven en el
mismo fichero**, porque los dos sistemas comparten nombres: `Boton`,
`Campo`, `Pastilla`, `Vacio` y `Fila`. Se intentó y dio quince errores de
tipo, el peor que `Formulario` usa `Fila` como tipo de sus datos y el
nuevo de fila le pisa el suyo. Se revertió.

Sacar los modales a `productos-form.tsx` deja cada pieza con una sola
API y permite verificar pantalla por pantalla. Lo mismo para `ventas.tsx`,
`caja.tsx`, `cuentas.tsx` y `compras.tsx`.

## 2. El listado de productos

Ya está diseñado, que es lo que costó:

- **Una fila por variante**, con el producto como columna y no como
  encabezado de grupo: un encabezado de grupo impide ordenar, y ordenar
  es lo que hace contestable «dame lo más barato primero».
- Columnas: producto, SKU, venta, coste, **margen** y stock. Ordenables
  con `aria-sort`.
- **En el stock, las tres cosas juntas**: cuántas hay, si hay que
  reponer, y cuántas faltan.
- Filtros en botones: todos / por reponer / sin existencias / inactivos,
  cada uno con su contador **contado con el mismo criterio que el
  filtro**, no con el de la lista entera.
- Cuatro cifras arriba: valor en almacén, por debajo del mínimo con el
  **coste de la reposición**, sin existencias, y presentaciones.

El problema que resuelve: el listado actual es una caja por producto y
**no se pueden comparar precios**, porque las cajas no comparten
columnas. Comparar es la razón de ser de una tabla de inventario.

## 3. La pantalla de movimientos — el agujero de fondo

**No existe, y la API sí.** El stock se descuenta con un trigger que
escribe un movimiento por cada venta, cada compra y cada merma. Nadie
puede verlo.

Un almacén sin historial de stock a la vista es un agujero: cuando el
número no cuadra, no hay forma de averiguar por qué.

Y las compras a medio recibir **no generan stock**, así que no se sabe
qué está en camino ni qué hay que pedir la semana que viene.

## 4. Los datos de prueba se limpian al terminar

`node db/demo-kiosco.mjs --limpiar`. Está en `.gitignore` sus
capturas, pero los datos de la base no se limpian solos.

---

# Sobre medir antes de afirmar

Dos veces en esta sesión se afirmó algo que al medir resultó falso, y
las dos veces por no mirar la parte difícil:

**«`/api/resumen` tarda 4,4 segundos.»** Cierto en frío. Con la conexión
caliente son 790 ms, y las otras rutas están entre 743 y 1.182: está en
el suelo, no es lenta. Lo que sí estaba mal era pagar cinco vueltas a
la base en vez de una.

**«Las pantallas no cargan.»** `resumen` y `compras` no se quedaban en
«Cargando» por un bucle de `useEffect`, que era la hipótesis, sino
porque la captura esperaba 900 ms fijos y esa ruta tarda más.

Regla: **si una cifra viene de una primera petición, di que es de
arranque o no la digas.** Y antes de dar un bug por real, tener un test
o una medición que lo sostenga.