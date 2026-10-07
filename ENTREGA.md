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

`db/ver-idioma.js` busca cirílico, griego, hebreo, árabe, devanagari,
chino, **coreano y japonés**, más el símbolo de reemplazo. Va antes de
vitest en `npm test`.

Está porque se colaron **diez veces**: cinco en código que ya existía y
cinco en comentarios que estaba escribiendo esa misma tarde. Ninguna
compilaba mal. Solo se ve leyendo, y "raro" no es un filtro fiable.

**Y se colaron tres más en la sesión de `productos`, con el filtro
funcionando.** La lista de alfabetos era la que se le había ocurrido a
quien lo escribió, no la que hace falta. Un filtro con la lista que le
conviene a quien lo hizo es la forma más discreta de que el filtro no
sirva: no da ningún aviso, da la sensación de que todo está revisado.

Por eso el script que quita un trozo de otro idioma **no puede
teclearlo**: se localiza por un ancla en ASCII y la letra se nombra con
`new RegExp("\\uac00-\\ud7af", "g")`. Teclear el carácter para borrarlo es
justo el error que delata. Y todos esos scripts son de un solo uso: se
borran después de que han hecho su trabajo, porque un script de
limpieza que se queda es un script que se vuelve a ejecutar sin querer
contra un fichero que ya no tiene nada que limpiar.

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

**Y hay que mirar lo que NO marca.** En `productos` la captura dio «sin
desbordes ni objetivos pequeños» y aun así la tarjeta de móvil no
servía: los importes salían apilados sin nombre y era ilegible. Eso no
lo puede ver un medidor de desbordes, porque la página no se sale de la
pantalla. La captura dice que la pantalla no se rompe; no dice que se
pueda leer.

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

**Migradas:** `marco.tsx` (navegación que se desliza en móvil),
`resumen.tsx` y **el listado de `productos.tsx`**. `ventas`,
`compras`, `caja` y `cuentas` siguen con estilos en línea, y sus
modales también.

**Los modales de productos están fuera.** `Formulario`, `MoverStock`,
`Baja` y `Capa` viven en `productos-form.tsx`, y `caja`, `compras` y
`cuentas` importan `Capa` de ahí. Los tipos (`Producto`, `Variante`)
también, para que la dependencia vaya en un solo sentido: si vivieran
en `productos.tsx`, `productos-form.tsx` lo importaría y `productos.tsx`
importaría los modales, y un ciclo entre los dos compila hoy y rompe en
cuanto uno de los dos crece.

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

## 1. ~~Extraer los modales de `productos.tsx`~~ — hecho

Están en `productos-form.tsx`, sin cambios de comportamiento. Lo mismo
para `ventas.tsx`, `caja.tsx`, `cuentas.tsx` y `compras.tsx`.

## 2. ~~El listado de productos~~ — hecho

Lo que estaba diseñado, y además cuatro cosas que estaban rotas y que
solo se vieron al mirar la pantalla con datos:

- **Una fila por variante**, con el producto como columna y no como
  encabezado de grupo.
- Columnas: producto, SKU, venta, coste, **margen** y stock. Ordenables,
  con el `aria-sort` en el `<th>` y no en el botón de dentro.
- **En el stock, las tres cosas juntas**: cuántas hay, si hay que
  reponer, y cuántas faltan.
- Filtros en botones con su contador, cada uno contado con su propio
  predicado y no con el de la lista entera.
- Cuatro cifras arriba: valor en almacén, por debajo del mínimo con el
  **coste de la reposición**, sin existencias, y presentaciones.

### Lo que estaba roto y no se veía leyendo

1. **El botón de «Nuevo producto» solo existía dentro del hueco
   vacío.** Con diez productos no había forma de crear uno desde la
   pantalla: se llegaba al alta por el botón del `Vacio`, y ese botón
   solo sale el primer día. Ahora está en la cabecera, siempre.
2. **No había forma de poner el mínimo de stock en el alta.** El estado
   del formulario lo tenía y el POST lo mandaba, pero el campo no
   existía. Todo producto creado desde la pantalla salía con
   `stock_minimo = 0`, y con mínimo cero la condición del filtro «por
   reponer» (`stock <= mínimo`) no tiene nada que mirar: un producto
   nuevo nunca salía entre los que hay que comprar.
3. **La tecla `Esc` no cerraba los modales.** `Capa` era un overlay
   hecho a mano, sin teclado. Afectaba a las cuatro pantallas que la
   importan. Ahora cierra con `Esc`, avisa el nombre del diálogo y
   devuelve el foco a donde estaba.
4. **La tarjeta de móvil apilaba los importes sin nombre.** `$1,50` y
   `$0,80` uno debajo del otro, sin decir cuál es el de venta y cuál el
   de costo — que es el error que el propio fichero declara como el más
   caro de un inventario. Los `data-col` de las cifras pasan a llevar
   nombre, y el de la tabla ancha no cambia: en la tabla los nombres los
   pone la cabecera.

### Lo que se comprobó, y cómo

Tres scripts nuevos, porque leer el código no dice si un contador
cuadra:

- `npm run test:listado` — los cuatro filtros, sus contadores y el
  orden, en la página de verdad. Los contadores se comparan con lo que
  devuelve la API, no con un número escrito a mano.
- `npm run test:modales` — los cuatro modales abren, guardan, avisan
  antes de guardar lo que la base va a rechazar, y cierran.
- `npm run test:consola` — los errores de consola enteros. `capturar.js`
  los corta a 80 caracteres, y con eso un fallo de hidratación salía
  como «Hydration failed…» sin decir dónde. Ese fallo era real: el
  servidor de desarrollo llevaba un rato sirviendo un `vacio.tsx` viejo.

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

Y hay un segundo tipo de basura: **los productos que dejan las pruebas
de los modales**. `npm run test:modales` crea uno para comprobar que el
alta funciona, y lo borra al terminar con `npm run limpiar:prueba`.

**El borrado va por script y no por la API, y no es por gusto.** La API
tiene una regla a propósito: un producto con movimientos no se borra, se
desactiva. Y un producto creado con stock genera un movimiento de
entrada. O sea, que si la prueba pide el borrado por la API, su producto
se queda en la base para siempre como una fila inactiva, y la corrida
siguiente falla por su culpa y no por la del código. Eso pasó tres
veces seguidas antes de entenderlo.

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

**«El detector de idioma pasa, así que está bien.»** Pasaba con dos
letras chinas en el mismo fichero que llevaba diez minutos escribiendo,
y con un Hangul de coreano dentro de un párrafo sobre la tecla `Esc`,
que el detector no miraba porque el coreano no estaba en su lista. No es
que el filtro fallara: es que la lista era la que se le había ocurrido a
quien lo escribió.

Lo del coreano tiene además una moraleja para este mismo fichero: la
letra que cito aquí no se puede escribir, y por eso se nombra por su
nombre. En `.md` no hay forma de poner `\\uac00` en un ejemplo sin que se
vea el escape, que tampoco sirve. Cada fichero tiene que decirlo con lo
que tiene.

Regla: **si una cifra viene de una primera petición, di que es de
arranque o no la digas.** Y antes de dar un bug por real, tener un test
o una medición que lo sostenga.