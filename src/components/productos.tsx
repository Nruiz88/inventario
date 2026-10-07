"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, ArrowUp, ArrowDown, ChevronsUpDown, Package, Wallet, CircleSlash, Boxes } from "lucide-react";
import { useApi } from "@/lib/ui/datos";
import { dinero, margen as margenDe } from "@/lib/dinero";
import { cn } from "@/lib/utils";
import { Card, CardBody } from "@/components/ui/card";
import { Campo } from "@/components/ui/input";
import { Boton } from "@/components/ui/button";
import { Pastilla, textoStock } from "@/components/ui/badge";
import { Vacio } from "@/components/ui/vacio";
import { Tabla, Cabecera, CuerpoTabla, Fila as FilaTabla, Celda, CeldaCabecera } from "@/components/ui/table";
import { Formulario, MoverStock, Baja, type Producto, type Variante } from "@/components/productos-form";

/* =========================================================
   /productos — el listado
   ---------------------------------------------------------
   ⚠️  UNA FILA POR VARIANTE, Y EL PRODUCTO COMO COLUMNA
   ------------------------------------------------------
   Antes era una caja por producto, con las presentaciones dentro. Y era
   un problema que no se arreglaba poniendo las cajas unas encima de
   otras: **no se pueden comparar cosas**.

   El precio de un producto con el del de al lado, no: cada uno está en
   una caja, las cajas tienen anchos distintos y no hay columnas
   alineadas. Y comparar es la razón de ser de una tabla de inventario:
   la pregunta "cuál de estos es más barato y cuánto me quedo" no tiene
   respuesta en una rejilla de cajas, y sí la tiene en una tabla.

   El coste de aplanar es que el producto se repite en cada fila. Se
   paga con una columna estrecha y un nombre corto; se gana todo lo otro.

   El producto NO es un encabezado de grupo por la misma razón: con un
   encabezado, la columna de precio no tiene un orden, y sin orden no
   hay forma de responder "dame lo más barato primero".

   ⚠️  LA FILTRACIÓN VA EN EL SERVIDOR
   -----------------------------------
   No. Va aquí, en el cliente, y a propósito: `?todos=1` son todas las
   variantes del cliente, en un kiosco son unas doscientas filas, y el
   filtro tiene que ser instantáneo mientras se escribe en el buscador.
   Una ida a la base por cada tecla es lo que hace que una pantalla se
   sienta lenta en un mostrador. La cuenta la hace `useMemo`, no el
   render: son doscientas filas y cuatro filtros.

   ⚠️  LOS CONTADORES SE CUENTAN CON SU PROPIO CRITERIO
   ---------------------------------------------------
   «Por reponer» enseña 12 porque hay 12 por reponer, no porque haya 12
   filas. Un contador que va con el filtro equivocado es peor que no
   poner contador: el dueño pulsa «por reponer» esperando ver doce
   cosas y ve otra cosa, y pierde la fe en el filtro entero. Por eso
   aquí no hay un `total` reutilizado: hay cuatro cuentas, cada una con
   su predicado, y se cuentan sobre el conjunto YA filtrado por la
   búsqueda —contar sobre la lista entera daría un 3 junto a un buscador
   que dice «gaseosa», que es un número que no está contando nada.
   ========================================================= */

export function Productos() {
  const { pedir } = useApi();
  const [lista, setLista] = useState<Producto[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [orden, setOrden] = useState<Orden>({ columna: "producto", sentido: "asc" });
  const [editando, setEditando] = useState<Producto | null>(null);
  const [creando, setCreando] = useState(false);
  const [moviendo, setMoviendo] = useState<Variante | null>(null);
  const [borrando, setBorrando] = useState<{ producto: Producto; variante: Variante | null } | null>(null);

  function cargar() {
    pedir<Producto[]>("/api/productos?todos=1").then((r) => {
      if (r.ok) setLista(r.datos);
    });
  }

  useEffect(cargar, []);

  /* ── Aplanar ──
     Aquí es donde el producto deja de ser un grupo y pasa a ser una
     columna. Se hace una vez por cada cambio de `lista`, no en cada
     render. */
  const lineas = useMemo<FilaLinea[]>(
    () =>
      lista.flatMap((p) =>
        p.variantes.map((v) => ({
          producto: p,
          variante: v,
          /* El nombre que se ordena es el del producto primero y el de
             la presentación después. Ordenar por "500 ml" solo, sin
             saber de qué producto es, no ordena nada útil. */
          nombre: `${p.nombre} ${v.nombre}`.trim(),
          /* "Faltan" es lo que va escrito en el pedido, que es lo que el
             dueño usa. Antes había que restar el mínimo a la vista, que
             es justo el cálculo que se hace mal un día de estos. */
          faltan: Math.max(0, v.minimo - v.stock),
          /* `p.activo !== false` y no `!p.activo`: el campo es opcional
             para que un producto viejo que venga sin él no cuente como
             inactivo. Con `!p.activo`, un `undefined` —que no significa
             "desactivado" sino "no vino"— dejaría toda la lista en el
             filtro de inactivos. */
          inactivo: !v.activo || p.activo === false,
        }))
      ),
    [lista]
  );

  const buscadas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return lineas;
    return lineas.filter(
      (l) =>
        l.producto.nombre.toLowerCase().includes(q) ||
        (l.producto.categoria || "").toLowerCase().includes(q) ||
        l.variante.nombre.toLowerCase().includes(q) ||
        (l.variante.sku || "").toLowerCase().includes(q)
    );
  }, [lineas, busqueda]);

  /* Las cuatro cifras de arriba. Se calculan sobre `buscadas`, no sobre
     `lineas`: un «valor del stock» con un buscador puesto tiene que
     ser el del conjunto que se está viendo, o el número de arriba y las
     filas de abajo son dos cosas distintas. */
  const cifras = useMemo(() => {
    let valor = 0;
    let reponer = 0;
    let sinStock = 0;
    let bajo = 0;

    for (const l of buscadas) {
      valor += l.variante.stock * l.variante.costo;
      reponer += l.faltan * l.variante.costo;
      if (l.variante.stock <= 0) sinStock++;
      if (textoStock(l.variante.stock, l.variante.minimo).tono !== "ok") bajo++;
    }

    return { valor, reponer, sinStock, bajo };
  }, [buscadas]);

  const contadores = useMemo(
    () => ({
      todos: buscadas.length,
      bajo: buscadas.filter((l) => !l.inactivo && l.variante.stock > 0 && l.variante.bajo).length,
      cero: buscadas.filter((l) => !l.inactivo && l.variante.stock <= 0).length,
      inactivos: buscadas.filter((l) => l.inactivo).length,
    }),
    [buscadas]
  );

  const visibles = useMemo(() => {
    const filtradas = buscadas.filter((l) => pasaElFiltro(l, filtro));
    return ordenar(filtradas, orden);
  }, [buscadas, filtro, orden]);

  function cambiarOrden(columna: Columna) {
    setOrden((o) =>
      o.columna === columna
        ? { columna, sentido: o.sentido === "asc" ? "desc" : "asc" }
        : { columna, sentido: columna === "producto" || columna === "sku" ? "asc" : "desc" }
    );
  }

  return (
    <div className="grid gap-4">
      {/* ── Las cuatro cifras ──
          Las del almacén, no las del día. Esta pantalla no es un
          informe de ventas: es la que se abre para saber qué hay, qué
          falta y cuánto vale. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra
          icono={<Wallet className="size-4" aria-hidden />}
          etiqueta="Valor en almacén"
          valor={dinero(cifras.valor)}
          pie="al coste"
        />
        <Cifra
          icono={<Package className="size-4" aria-hidden />}
          etiqueta="Por debajo del mínimo"
          valor={String(cifras.bajo)}
          pie={
            cifras.reponer > 0
              ? `reponer por ${dinero(cifras.reponer)}`
              : "nada que reponer"
          }
          tono={cifras.bajo > 0 ? "aviso" : undefined}
        />
        <Cifra
          icono={<CircleSlash className="size-4" aria-hidden />}
          etiqueta="Sin existencias"
          valor={String(cifras.sinStock)}
          pie={cifras.sinStock > 0 ? "no se pueden vender" : "todo con stock"}
          tono={cifras.sinStock > 0 ? "aviso" : undefined}
        />
        <Cifra
          icono={<Boxes className="size-4" aria-hidden />}
          etiqueta="Presentaciones"
          valor={String(buscadas.length)}
          pie={`${lista.length} productos`}
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-borde px-5 py-3.5">
          {/* ── El botón de nuevo, arriba a la derecha ──

              Va en la cabecera y no solo dentro del hueco vacío, y esto
              es un arreglo de una cosa que estaba rota: el botón estaba
              únicamente en el `Vacio`, así que en cuanto había un
              producto no había forma de crear otro desde la pantalla.
              Se llegaba al alta por el botón del hueco solo el primer
              día, y después nunca.

              En un mostrador el alta es la operación más frecuente de
              esta pantalla: llega un producto nuevo y hay que meterlo
              antes de que se cobre. Que el botón aparezca solo
              cuando no hay nada es justo lo contrario de lo que hace
              falta. */}
          <Boton variante="primario" onClick={() => setCreando(true)} className="ml-auto order-last">
            <Plus className="size-3.5" aria-hidden />
            Nuevo producto
          </Boton>

          {/* El buscador es un campo ancho y sin su marco propio: los
              filtros de al lado ya son botones con borde, y un segundo
              marco del mismo peso al lado compite con ellos en vez de
              ayudar a distinguirlos. */}
          <div className="min-w-[14rem] flex-1">
            {/* El `Campo` de `components/ui` es un `<input>` con las
                propiedades del `<input>`, no el del sistema viejo: por eso
                aquí van `value` y `onChange` de React y no `valor` y
                `onChange` con un texto. Se escribe de las dos formas y
                solo una compila, que es justo para lo que está. */}
            <Campo
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por producto, categoría, presentación o SKU"
              aria-label="Buscar productos"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <FiltroBoton
              activo={filtro === "todos"}
              onClick={() => setFiltro("todos")}
              n={contadores.todos}
            >
              Todos
            </FiltroBoton>
            <FiltroBoton
              activo={filtro === "bajo"}
              onClick={() => setFiltro("bajo")}
              n={contadores.bajo}
              tono="aviso"
            >
              Por reponer
            </FiltroBoton>
            <FiltroBoton
              activo={filtro === "cero"}
              onClick={() => setFiltro("cero")}
              n={contadores.cero}
              tono="mal"
            >
              Sin existencias
            </FiltroBoton>
            <FiltroBoton
              activo={filtro === "inactivos"}
              onClick={() => setFiltro("inactivos")}
              n={contadores.inactivos}
            >
              Inactivos
            </FiltroBoton>
          </div>
        </div>

        <CardBody sinRelleno>
          {/* Sin botón dentro del hueco: el de la cabecera está siempre,
              y dos botones que dicen lo mismo a la vez son dos botones
              que compiten. El hueco solo dice qué pasa. */}
          {visibles.length === 0 ? (
            <Vacio>
              {lineas.length === 0
                ? "No hay productos. Empezá por el que más vendés."
                : filtro !== "todos"
                  ? "Nada en este filtro."
                  : `Nada coincide con «${busqueda}».`}
            </Vacio>
          ) : (
            <>
              {/* En móvil la cabecera desaparece —la regla está en
                  `globals.css`, en el bloque `tabla-tarjeta`— y entonces
                  no hay forma de ordenar. Por eso el selector de
                  ordenación de abajo solo se ve en móvil: en escritorio
                  son las cabeceras y en móvil es esta fila. */}
              <div className="flex items-center gap-2 border-b border-borde px-4 py-2.5 sm:hidden">
                <span className="text-[0.7rem] font-bold tracking-[0.08em] uppercase text-apagado">
                  Ordenar por
                </span>
                <select
                  value={orden.columna}
                  onChange={(e) => cambiarOrden(e.target.value as Columna)}
                  className="ml-auto rounded-md border border-borde bg-hundido px-2 py-1.5 text-sm text-texto"
                >
                  <option value="producto">Producto</option>
                  <option value="sku">SKU</option>
                  <option value="venta">Venta</option>
                  <option value="costo">Costo</option>
                  <option value="margen">Margen</option>
                  <option value="stock">Stock</option>
                </select>
              </div>

              <Tabla className="tabla-tarjeta">
                <Cabecera>
                  <FilaTabla>
                    <ThOrden columna="producto" orden={orden} onClick={cambiarOrden} izquierda>
                      Producto
                    </ThOrden>
                    <ThOrden columna="sku" orden={orden} onClick={cambiarOrden}>
                      SKU
                    </ThOrden>
                    <ThOrden columna="venta" orden={orden} onClick={cambiarOrden} numerica>
                      Venta
                    </ThOrden>
                    <ThOrden columna="costo" orden={orden} onClick={cambiarOrden} numerica>
                      Costo
                    </ThOrden>
                    <ThOrden columna="margen" orden={orden} onClick={cambiarOrden} numerica>
                      Margen
                    </ThOrden>
                    <ThOrden columna="stock" orden={orden} onClick={cambiarOrden} numerica>
                      Stock
                    </ThOrden>
                    <CeldaCabecera>
                      <span className="sr-only">Acciones</span>
                    </CeldaCabecera>
                  </FilaTabla>
                </Cabecera>

                <CuerpoTabla>
                  {visibles.map((l) => {
                    const v = l.variante;
                    const estado = textoStock(v.stock, v.minimo);
                    const m = margenDe(v.precio, v.costo);

                    return (
                      <FilaTabla key={v.id}>
                        {/* `data-principal` es lo que le dice a la regla de
                            móvil que esta celda manda: sin etiqueta y con
                            el ancho entero. */}
                        <Celda data-principal data-col="">
                          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="font-semibold">{l.producto.nombre}</span>
                            {v.nombre && <span className="text-apagado">{v.nombre}</span>}
                            {l.inactivo && <Pastilla>Inactivo</Pastilla>}
                            {!l.producto.categoria && null}
                          </span>
                        </Celda>

                        <Celda data-col="SKU" className="text-apagado">
                          {v.sku || "—"}
                        </Celda>

                        {/* ⚠️  AQUÍ SÍ VAN CON NOMBRE, Y NO ES UNA EXCEPCIÓN
                            A LA REGLA DE LAS CIFRAS SIN ETIQUETA ──

                            La regla de `globals.css` apaga la
                            pseudo-etiqueta de las cifras con
                            `data-col=""`, y está bien justificada: en
                            una columna de importes, «Importe» repetido
                            ocho veces es un muro y la cabecera ya dice
                            qué es cada columna.

                            En la tarjeta de móvil no hay columna: cada
                            dato es una fila, y sin nombre un «$0,80»
                            debajo de un «$1,50» no se sabe si es el
                            costo o el precio de venta. Y esa
                            confusión es la que este mismo fichero
                            declara al principio como el error más caro
                            de un inventario: pones el costo donde va el
                            de venta y resulta que se está vendiendo a
                            pérdida.

                            O sea: la regla está bien para la tabla y
                            mal para la tarjeta. No es que se rompa, es
                            que son dos sitio distintos y la misma regla
                            no puede servir a los dos. */}
                        <Celda numerica data-col="Venta" className="font-semibold">
                          {dinero(v.precio)}
                        </Celda>

                        <Celda numerica data-col="Costo" className="text-claro">
                          {dinero(v.costo)}
                        </Celda>

                        {/* El margen va con su color. Es el número que
                            decide si algo está a la venta por debajo del
                            coste, y un número sin color ahí es un número
                            que hay que calcular otra vez con la
                            calculadora. */}
                        <Celda
                          numerica
                          data-col="Margen"
                          className={cn(
                            v.costo > 0 && m <= 0
                              ? "text-mal font-bold"
                              : m > 0 && m < 15
                                ? "text-aviso"
                                : "text-apagado"
                          )}
                        >
                          {v.costo > 0 ? `${m} %` : "—"}
                        </Celda>

                        {/* ── El stock, con las tres cosas JUNTAS ──
                            cuántas hay, si hay que reponer, y cuántas
                            faltan. Juntas, porque separadas obligan a
                            mirar tres columnas y a restar de memoria,
                            que es la operación que más falla. */}
                        <Celda numerica data-col="Stock">
                          <span className="flex items-baseline justify-end gap-2">
                            <span className="flex flex-col items-end">
                              <span data-cifra className="font-semibold">
                                {v.stock}
                              </span>
                              <span className="text-xs text-apagado">mín. {v.minimo}</span>
                            </span>
                            <Pastilla tono={l.inactivo ? "neutro" : estado.tono}>
                              {estado.texto}
                            </Pastilla>
                            {l.faltan > 0 && (
                              <span data-cifra className="w-20 text-right text-sm font-bold text-texto">
                                pedir {l.faltan}
                              </span>
                            )}
                          </span>
                        </Celda>

                        <Celda data-col="" className="text-right">
                          <span className="flex justify-end gap-1.5">
                            <Boton
                              variante="fantasma"
                              tamano="chico"
                              data-compacto
                              onClick={() => setEditando(l.producto)}
                              title="Editar el producto"
                            >
                              Editar
                            </Boton>
                            <Boton
                              variante="fantasma"
                              tamano="chico"
                              data-compacto
                              onClick={() => setMoviendo(v)}
                              title="Merma, devolución o corrección de conteo"
                            >
                              Mover
                            </Boton>
                            <Boton
                              variante="peligro"
                              tamano="chico"
                              data-compacto
                              onClick={() => setBorrando({ producto: l.producto, variante: v })}
                              title="Desactivar esta presentación"
                            >
                              ×
                            </Boton>
                          </span>
                        </Celda>
                      </FilaTabla>
                    );
                  })}
                </CuerpoTabla>
              </Tabla>
            </>
          )}
        </CardBody>
      </Card>

      {creando && (
        <Formulario
          onCerrar={() => setCreando(false)}
          onGuardado={() => {
            setCreando(false);
            cargar();
          }}
        />
      )}

      {editando && (
        <Formulario
          producto={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            cargar();
          }}
        />
      )}

      {moviendo && (
        <MoverStock
          variante={moviendo}
          onCerrar={() => setMoviendo(null)}
          onGuardado={() => {
            setMoviendo(null);
            cargar();
          }}
        />
      )}

      {borrando && (
        <Baja
          datos={borrando}
          onCerrar={() => setBorrando(null)}
          onGuardado={() => {
            setBorrando(null);
            cargar();
          }}
        />
      )}
    </div>
  );
}

/* =========================================================
   Los tipos del listado
   ---------------------------------------------------------
   Se declaran aquí y no en el fichero de los modales a propósito: los
   modales no los necesitan, y un tipo que nadie más usa no tiene por
   qué vivir en el fichero de otro.
   ========================================================= */
type Columna = "producto" | "sku" | "venta" | "costo" | "margen" | "stock";
type Sentido = "asc" | "desc";
type Orden = { columna: Columna; sentido: Sentido };
type Filtro = "todos" | "bajo" | "cero" | "inactivos";

type FilaLinea = {
  producto: Producto;
  variante: Variante;
  nombre: string;
  faltan: number;
  inactivo: boolean;
};

/** El predicado de cada filtro, en un sitio y no repetido tres veces. */
function pasaElFiltro(l: FilaLinea, filtro: Filtro): boolean {
  if (filtro === "inactivos") return l.inactivo;
  /* Los tres filtros de stock miran solo lo activo. Una presentación
     dada de baja que está en cero no está "sin existencias": está
     apagada, y se ve en el filtro de inactivos. Mezclarlos hacía que
     «sin existencias» fuera contando cosas que nadie puede vender. */
  if (l.inactivo) return false;
  if (filtro === "bajo") return l.variante.stock > 0 && l.variante.bajo;
  if (filtro === "cero") return l.variante.stock <= 0;
  return true;
}

/**
 * El orden.
 *
 * Los números van en orden numérico y el texto con `localeCompare` de
 * "es": con la ordenación por defecto, "Gaseosa" va antes que "Agua"
 * porque la G mayúscula va antes que la A minúscula en el código, y eso
 * es un orden que no le dice nada a nadie.
 *
 * Y las columnas numéricas empiezan en `desc` la primera vez que se
 * pulsan: el que pulsa «Venta» en un inventario quiere ver lo caro
 * primero, que es el que llama la atención.
 */
function ordenar(filas: FilaLinea[], orden: Orden): FilaLinea[] {
  const dir = orden.sentido === "asc" ? 1 : -1;

  const valor = (l: FilaLinea): string | number => {
    const v = l.variante;
    switch (orden.columna) {
      case "producto":
        return l.nombre;
      case "sku":
        return v.sku || "";
      case "venta":
        return v.precio;
      case "costo":
        return v.costo;
      case "margen":
        return margenDe(v.precio, v.costo);
      case "stock":
        return v.stock;
    }
  };

  return [...filas].sort((a, b) => {
    const x = valor(a);
    const y = valor(b);

    if (typeof x === "string" || typeof y === "string") {
      return String(x).localeCompare(String(y), "es") * dir;
    }
    /* Sin `|| 1`: si dos filas valen lo mismo, la ordenación estable de
       JavaScript las deja como estaban, que es lo que se quiere. Poner
       un desempate por nombre haría que dos presentaciones del mismo
       producto con el mismo precio cambiaran de sitio al reordenar por
       stock. */
    return (x - y) * dir;
  });
}

/* ── El encabezado que ordena ──

   El `<th>` y su botón van juntos aquí y no sueltos en la cabecera, por
   una razón práctica: el `aria-sort` tiene que ir en el `<th>` y va
   determinado por la misma columna que el botón. Si cada columna
   escribiera su `aria-sort` a mano, bastaría que una se olvidara para que
   el atributo quedara mintiendo sobre el estado del orden. */
function ThOrden({
  columna,
  orden,
  onClick,
  children,
  numerica,
  izquierda,
}: {
  columna: Columna;
  orden: Orden;
  onClick: (c: Columna) => void;
  children: React.ReactNode;
  numerica?: boolean;
  izquierda?: boolean;
}) {
  return (
    <CeldaCabecera
      numerica={numerica}
      /* `none` y no `undefined`: es un valor de `aria-sort`, y
         `undefined` en React no pone el atributo, que es lo mismo que no
         declarar nada. Con `none` el atributo está y dice que esa
         columna no es la que ordena ahora. */
      aria-sort={orden.columna === columna ? (orden.sentido === "asc" ? "ascending" : "descending") : "none"}
    >
      <BotonOrden
        columna={columna}
        orden={orden}
        onClick={onClick}
        alineado={izquierda ? "izquierda" : "derecha"}
      >
        {children}
      </BotonOrden>
    </CeldaCabecera>
  );
}

/* =========================================================
   La cabecera que ordena
   ---------------------------------------------------------
   Es un `<button>` dentro del `<th>`, y el `aria-sort` va en el `<th>`.

   ⚠️  POR QUÉ EL ARIA-SORT NO VA EN EL BOTÓN ──

   `aria-sort` es del encabezado, no del control que hay dentro. Puesto
   en el botón, un lector de pantalla anuncia «Venta, botón» y nada
   más: se pierde lo único que dice cómo está ordenado. Y es
   exactamente el dato que un lector de pantalla necesita de una tabla
   ordenable, porque sin él no hay forma de saber si el 22 de arriba es
   el primero o el último.
   ========================================================= */
function BotonOrden({
  columna,
  orden,
  onClick,
  children,
  alineado = "derecha",
}: {
  columna: Columna;
  orden: Orden;
  onClick: (c: Columna) => void;
  children: React.ReactNode;
  alineado?: "izquierda" | "derecha";
}) {
  const activa = orden.columna === columna;

  return (
    <button
      type="button"
      onClick={() => onClick(columna)}
      aria-label={
        activa
          ? `Ordenado por ${String(children).toLowerCase()}, ${orden.sentido === "asc" ? "de menor a mayor" : "de mayor a menor"}. Pulsar para invertir.`
          : `Ordenar por ${String(children).toLowerCase()}`
      }
      className={cn(
        "-mx-2 flex w-[calc(100%+1rem)] items-center gap-1 rounded px-2 py-0.5",
        alineado === "derecha" ? "justify-end" : "justify-start",
        activa ? "text-texto" : "hover:text-claro",
        "transicion"
      )}
    >
      {children}
      {activa ? (
        orden.sentido === "asc" ? (
          <ArrowUp className="size-3 shrink-0" aria-hidden />
        ) : (
          <ArrowDown className="size-3 shrink-0" aria-hidden />
        )
      ) : (
        /* La flecha apagada dice que la columna se puede ordenar sin
           gritar que lo está: cinco flechas encendidas a la vez en
           una tabla no significan nada. */
        <ChevronsUpDown className="size-3 shrink-0 opacity-35" aria-hidden />
      )}
    </button>
  );
}

/* El filtro, con su contador al lado del nombre y no dentro. */
function FiltroBoton({
  activo,
  onClick,
  n,
  children,
  tono,
}: {
  activo: boolean;
  onClick: () => void;
  n: number;
  children: React.ReactNode;
  tono?: "aviso" | "mal";
}) {
  const color = tono === "mal" ? "text-mal" : tono === "aviso" ? "text-aviso" : null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transicion",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento",
        activo
          ? "border-borde-fuerte bg-panel-2 font-semibold text-texto"
          : "border-transparent text-apagado hover:bg-panel-2 hover:text-texto"
      )}
    >
      {children}
      {/* El contador en apagado y no en negro: es un dato secundario al
          lado del nombre, y si compite con el nombre se lee el número en
          vez del filtro. */}
      <span data-cifra className={cn("text-xs", color || "text-apagado")}>
        {n}
      </span>
    </button>
  );
}

/* La cifra de arriba. Copia de la de `resumen.tsx` y no una importada:
   cada pantalla tiene su idea de qué va en la esquina de la caja, y
   atar las dos sería atar dos pantallas que pueden necesitar
   separarse. */
function Cifra({
  icono,
  etiqueta,
  valor,
  pie,
  tono,
}: {
  icono: React.ReactNode;
  etiqueta: string;
  valor: string;
  pie?: string;
  tono?: "ok" | "mal" | "aviso";
}) {
  const color = tono === "mal" ? "text-mal" : tono === "aviso" ? "text-aviso" : "text-texto";

  return (
    <Card>
      <CardBody className="p-4">
        <div className="mb-1.5 flex items-center gap-1.5 text-apagado">
          <span aria-hidden>{icono}</span>
          <span className="truncate text-[0.7rem] font-bold tracking-[0.08em] uppercase">
            {etiqueta}
          </span>
        </div>
        <div data-cifra className={cn("text-[1.6rem] leading-tight font-bold", color)}>
          {valor}
        </div>
        {pie && <div className="mt-1 text-xs text-apagado">{pie}</div>}
      </CardBody>
    </Card>
  );
}