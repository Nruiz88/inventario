"use client";

import { useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/ui/datos";
import { aCentavos } from "@/lib/dinero";
import { cn } from "@/lib/utils";
import { Panel, Boton, Campo, Area, Fila, BotonFila } from "@/lib/ui/controles";

/* =========================================================
   Los modales de productos
   ---------------------------------------------------------
   `Formulario`, `MoverStock`, `Baja` y `Capa`, en su propio fichero.

   ── POR QUÉ ESTÁN FUERA DE `productos.tsx` ──

   Porque mientras conviven en el mismo fichero hay dos sistemas de
   nombres: el viejo, de `lib/ui/controles`, y el nuevo, de
   `components/ui`. Los dos se llaman `Boton`, `Campo`, `Pastilla`,
   `Vacio` y `Fila`.

   Y el choque más caro no es que el compilador se queje quince veces: es
   que `Formulario` usa `Fila` como el TIPO de sus datos de
   presentación. Con el `Fila` de la tabla importado en el mismo
   fichero, el nombre le pisa al suyo y `Fila` deja de ser lo que el
   autor cree que es.

   Con los modales en un fichero propio, cada pieza tiene una sola API
   y una pantalla se puede migrar sin las otras.

   Los tipos van aquí y no en `productos.tsx` para que la dependencia
   vaya en un solo sentido: quien los necesita los importa de aquí, y
   `productos.tsx` importa los modales de aquí. Un ciclo entre los dos
   compila hoy y rompe en cuanto uno de los dos crece.
   ========================================================= */

export type Variante = {
  id: string;
  nombre: string;
  sku: string | null;
  precio: number;
  costo: number;
  stock: number;
  minimo: number;
  orden: number;
  activo: boolean;
  bajo: boolean;
};

/** El producto. `activo` es el del PRODUCTO, no el de la variante: hay
 *  que distinguir una presentación dada de baja de un producto entero
 *  dado de baja, y son dos operaciones distintas. */
export type Producto = {
  id: string;
  nombre: string;
  categoria: string | null;
  activo?: boolean;
  variantes: Variante[];
};

/* =========================================================
   Alta y edición
   ---------------------------------------------------------
   Un formulario, y las variantes son filas editables.

   ⚠️  AL EDITAR NO SE TOCAN LAS PRESENTACIONES
   ------------------------------------------
   Solo el nombre del producto, la categoría y la descripción. Las
   variantes no se editan en el formulario de producto, y eso puede
   parecer una carencia.

   La razón: cambiar el precio de una presentación es lo frecuente, y
   hacerlo aquí mezclaría dos cosas que se rompen de forma distinta.
   Una presentación nueva es un alta; una existente es un cambio de
   precio, y el precio lo cambia quien lleva la caja, no quien arma el
   catálogo.
   ========================================================= */

/**
 * Una fila del formulario de una presentación.
 *
 * TODO es texto, incluso los números. No es descuido: es lo que hace que
 * el formulario pueda mostrar una fila a medio llenar, con el precio
 * puesto y el stock todavía vacío. Con números, ese estado no se puede
 * representar y el `input` se queda con `NaN` o con `0` puesto solo.
 *
 * El precio va en PESOS y no en centavos porque es lo que se escribe. La
 * conversión a centavos va en `guardar()`, una vez, y no en el `input`:
 * si dividiera en cada tecla, el cursor saltaría de sitio a mitad de
 * "2,50".
 */
type Fila = {
  id?: string;
  nombre: string;
  sku: string;
  precio: string;
  costo: string;
  stock: string;
  minimo: string;
};

const FILA_VACIA: Fila = { nombre: "", sku: "", precio: "", costo: "", stock: "", minimo: "" };

export function Formulario({
  producto,
  onCerrar,
  onGuardado,
}: {
  producto?: Producto;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const { pedir } = useApi();
  const editando = Boolean(producto);

  const [nombre, setNombre] = useState(producto?.nombre || "");
  const [categoria, setCategoria] = useState(producto?.categoria || "");
  const [descripcion, setDescripcion] = useState("");
  const [variantes, setVariantes] = useState<Fila[]>(
    /* Al editar, las variantes vienen de la lista con los precios en
       CENTAVOS. Se convierten a pesos aquí, una vez, para que el
       formulario muestre «2,25» y no «225». */
    producto
      ? producto.variantes.map((v) => ({
          id: v.id,
          nombre: v.nombre,
          sku: v.sku || "",
          precio: v.precio ? String(v.precio / 100) : "",
          costo: v.costo ? String(v.costo / 100) : "",
          stock: String(v.stock ?? 0),
          minimo: String(v.minimo ?? 0),
        }))
      : [{ ...FILA_VACIA }]
  );
  const [guardando, setGuardando] = useState(false);

  function nuevaVariante() {
    setVariantes((v) => [...v, { ...FILA_VACIA }]);
  }

  function cambiarV(i: number, campo: keyof Fila, valor: string) {
    setVariantes((vs) => vs.map((v, j) => (j === i ? { ...v, [campo]: valor } : v)));
  }

  async function guardar() {
    if (!nombre.trim()) return;

    if (editando) {
      const r = await pedir("/api/productos", {
        method: "PATCH",
        body: JSON.stringify({ id: producto!.id, nombre, categoria, descripcion }),
      });
      if (r.ok) onGuardado();
      return;
    }

    /* Las cantidades del alta se mandan como texto y las convierte el
       servidor. El precio de venta y el de costo se mandan EN PESOS y
       los pasa a centavos `aCentavos`, que redondea.

       La conversión va AQUÍ y no en el servidor a propósito: el servidor
       acepta lo que le llega y este es el único sitio donde se escribe
       un precio a mano. Si se dividiera por 100 en los dos lados, un
       cambio futuro haría que los dos dividasen dos veces y todo valiera
       un céntimo. */
    const r = await pedir("/api/productos", {
      method: "POST",
      body: JSON.stringify({
        nombre,
        categoria,
        descripcion,
        variantes: variantes
          .filter((v) => String(v.nombre || "").trim())
          .map((v) => ({
            nombre: String(v.nombre).trim(),
            sku: v.sku || null,
            precio: aCentavos(v.precio || 0),
            costo: aCentavos(v.costo || 0),
            stock: Number(v.stock || 0),
            minimo: Number(v.minimo || 0),
          })),
      }),
    });

    if (r.ok) onGuardado();
  }

  const hayPresentaciones = variantes.some((v) => String(v.nombre || "").trim());

  return (
    <Capa onCerrar={onCerrar} titulo={editando ? `Editar ${producto!.nombre}` : "Nuevo producto"}>
      <Panel titulo={editando ? `Editar ${producto!.nombre}` : "Nuevo producto"}>
        <div className="grid gap-3 p-4">
          <Campo etiqueta="Nombre" valor={nombre} onChange={setNombre} placeholder="Gaseosa" autoFocus />

          {/* ⚠️  NO HAY UN CAMPO DE «STOCK INICIAL» AQUÍ ──

              Estaba, y era un campo que no escribía en nada: `valor=""
              onChange={() => {}}`. Escribía un número en el sitio del
              stock y no pasaba nada, y quien lo rellenaba creía que el
              producto salía con esa cantidad.

              La culpa no es del campo: es que el stock inicial va en las
              filas de presentación, una por presentación, y un campo
              único arriba no puede rellenar veinte filas de veinte cosas
              distintas. Está donde tiene que estar, y aquí no cabe otro
              sitio sin repetirlo.

              La categoría se queda sola en su fila porque el otro hueco
              estaba ocupado por este campo que no hacía nada. */}

          <Campo etiqueta="Categoría" valor={categoria} onChange={setCategoria} placeholder="Bebidas" />

          {!editando && (
            <>
              <div className="my-1 h-px bg-borde" />
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Presentaciones</span>
                <Boton tamano="chico" onClick={nuevaVariante}>
                  Agregar
                </Boton>
              </div>

              {variantes.map((v, i) => (
                <div
                  key={i}
                  /* Seis campos y el botón. El ancho del nombre es mayor porque es el
                     único que es texto de verdad; los otros cinco son
                     números de tres o cuatro cifras, y con el mismo
                     ancho que el nombre quedan apiñados. */
                  className="grid grid-cols-[1.4fr_1fr_1fr_1fr_.8fr_.8fr_auto] items-end gap-1.5"
                >
                  <Campo
                    etiqueta={i === 0 ? "Presentación" : undefined}
                    valor={v.nombre || ""}
                    onChange={(x) => cambiarV(i, "nombre", x)}
                    placeholder="500 ml"
                  />
                  <Campo
                    etiqueta={i === 0 ? "SKU" : undefined}
                    valor={v.sku || ""}
                    onChange={(x) => cambiarV(i, "sku", x)}
                  />
                  <Campo
                    etiqueta={i === 0 ? "Venta $" : undefined}
                    valor={v.precio}
                    onChange={(x) => cambiarV(i, "precio", x)}
                    tipo="number"
                    step={0.01}
                  />
                  <Campo
                    etiqueta={i === 0 ? "Costo $" : undefined}
                    valor={v.costo}
                    onChange={(x) => cambiarV(i, "costo", x)}
                    tipo="number"
                    step={0.01}
                  />
                  <Campo
                    etiqueta={i === 0 ? "Stock" : undefined}
                    valor={v.stock}
                    onChange={(x) => cambiarV(i, "stock", x)}
                    tipo="number"
                  />
                  {/* ⚠️  EL MÍNIMO FALTABA, Y NO ES UN CAMPO MÁS ──

                      El estado de `Fila` lo tenía desde antes (`minimo`)
                      y el POST lo mandaba: `minimo: Number(v.minimo || 0)`.
                      Lo que no existía era el campo para escribirlo.

                      Consecuencia medida: todo producto creado desde esta
                      pantalla salía con `stock_minimo = 0`, y con
                      mínimo cero el filtro «por reponer» del listado no
                      tiene nada que mirar — la condición es
                      `stock <= mínimo`, y con cero solo salta cuando el
                      stock está en cero. Un producto nuevo nunca aparece
                      entre los que hay que comprar, que es justo lo que
                      se lo pide a una pantalla de alta.

                      Y en la semilla se ve: los productos `[demo]` traen
                      mínimos de 3 a 12, escritos a mano en la base. Los
                      que se añaden desde la pantalla, no. */}
                  <Campo
                    etiqueta={i === 0 ? "Mín." : undefined}
                    valor={v.minimo}
                    onChange={(x) => cambiarV(i, "minimo", x)}
                    tipo="number"
                  />
                  <Boton
                    tamano="chico"
                    tipo="fantasma"
                    onClick={() => setVariantes((vs) => vs.filter((_, j) => j !== i))}
                    disabled={variantes.length === 1}
                  >
                    ×
                  </Boton>
                </div>
              ))}

              <div className="text-xs leading-relaxed text-apagado">
                El stock inicial entra como movimiento, para que el historial cuadre
                desde el primer día. Si lo pones en cero, contá después con «Mover».
              </div>
            </>
          )}

          {editando && producto!.variantes.length > 0 && (
            <div className="rounded-md bg-panel-2 px-3 py-2.5 text-[0.85rem] leading-relaxed text-apagado">
              Las presentaciones no se editan desde acá. Para cambiar un precio,
              usá «Mover» no: eso mueve stock. Editá la presentación en su propia
              ficha.
            </div>
          )}
        </div>

        <BotonFila>
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton
            tipo="primario"
            cargando={guardando}
            disabled={!nombre.trim() || (!editando && !hayPresentaciones)}
            onClick={guardar}
          >
            {editando ? "Guardar" : "Crear producto"}
          </Boton>
        </BotonFila>
      </Panel>
    </Capa>
  );
}

/* =========================================================
   Mover stock
   ---------------------------------------------------------
   Merma, devolución o corrección de conteo.

   ⚠️  NO HAY UN CAMPO QUE PONGA EL NÚMERO FINAL
   ---------------------------------------------
   Solo "cuánto" y "qué pasó". El stock lo recalcula la base.

   Es la diferencia entre un inventario que explica su stock y uno que
   no: un ajuste de -6 con motivo "se rompieron seis" se puede leer y
   corregir; un stock puesto en 42 sin más no se puede ni entender ni
   deshacer.
   ========================================================= */
export function MoverStock({
  variante,
  onCerrar,
  onGuardado,
}: {
  variante: Variante;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const { pedir } = useApi();
  const [tipo, setTipo] = useState("merma");
  const [cantidad, setCantidad] = useState("1");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    const r = await pedir("/api/movimientos", {
      method: "POST",
      body: JSON.stringify({ varianteId: variante.id, tipo, cantidad, motivo }),
    });
    setGuardando(false);
    if (r.ok) onGuardado();
  }

  const n = Number(cantidad) || 0;
  const despues = tipo === "merma" ? variante.stock - n : variante.stock + n;

  return (
    <Capa onCerrar={onCerrar} titulo={`Mover stock · ${variante.nombre || "Producto"}`}>
      <Panel titulo={variante.nombre || "Producto"}>
        <div className="grid gap-3 p-4">
          <div className="text-xs text-apagado">
            Ahora hay <strong className="text-texto">{variante.stock}</strong>.
          </div>

          <Fila cols={2}>
            <label className="block">
              <span className="mb-1.5 block text-[0.7rem] font-bold tracking-[0.08em] text-apagado uppercase">
                Qué pasó
              </span>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="w-full min-h-[2.6rem] rounded-md border border-borde bg-hundido px-3 text-texto transicion focus-visible:border-acento focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-acento"
              >
                <option value="merma">Se rompió o se venció (resta)</option>
                <option value="devolucion">Nos devolvieron (suma)</option>
                <option value="ajuste">Conté mal (suma)</option>
              </select>
            </label>

            <Campo
              etiqueta="Cuántas"
              valor={cantidad}
              onChange={setCantidad}
              tipo="number"
              autoFocus
            />
          </Fila>

          {/* La previsión del resultado va ANTES de guardar, y avisa cuando no
              se puede. Un trigger que lo rechaza deja al dueño con el
              formulario lleno y un error de Postgres arriba. */}
          <div
            className={cn(
              "rounded-md px-3 py-2.5 text-[0.85rem]",
              despues < 0 ? "bg-mal/12 text-mal" : "bg-panel-2 text-apagado"
            )}
          >
            {despues < 0
              ? `No se puede: quedan ${variante.stock} y el movimiento es de ${n}.`
              : `Quedará en ${despues}.`}
          </div>

          <Area
            etiqueta="Motivo (obligatorio)"
            valor={motivo}
            onChange={setMotivo}
            placeholder="Se rompieron seis en el traslado"
            filas={2}
          />
        </div>

        <BotonFila>
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton
            tipo="primario"
            cargando={guardando}
            disabled={!motivo.trim() || n <= 0 || despues < 0}
            onClick={guardar}
          >
            Anotar
          </Boton>
        </BotonFila>
      </Panel>
    </Capa>
  );
}

/* =========================================================
   La baja
   ---------------------------------------------------------
   Explica la diferencia antes de preguntar, y no ofrece borrar si hay
   historial.

   El botón dice «Desactivar» y no «Borrar», porque es lo que va a
   pasar. Un botón que promete una cosa y hace otra es la forma más
   rápida de que alguien deje de confiar en la pantalla.
   ========================================================= */
export function Baja({
  datos,
  onCerrar,
  onGuardado,
}: {
  datos: { producto: Producto; variante: Variante | null };
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const { pedir } = useApi();
  const [guardando, setGuardando] = useState(false);

  const nombre = datos.variante ? datos.variante.nombre : datos.producto.nombre;

  async function confirmar() {
    setGuardando(true);
    const r = await pedir("/api/productos", {
      method: "DELETE",
      body: JSON.stringify({
        id: datos.producto.id,
        varianteId: datos.variante?.id || null,
      }),
    });
    setGuardando(false);
    if (r.ok) onGuardado();
  }

  return (
    <Capa
      onCerrar={onCerrar}
      titulo={datos.variante ? `Desactivar presentación · ${nombre}` : `Desactivar producto · ${nombre}`}
    >
      <Panel titulo={datos.variante ? "Desactivar presentación" : "Desactivar producto"}>
        <div className="grid gap-3 p-4 text-sm leading-relaxed">
          <p className="m-0">
            Vas a desactivar <strong>{nombre}</strong>.
          </p>
          <p className="m-0 text-apagado">
            Deja de aparecer en la caja, pero sigue en el histórico y en los informes.
            Podés volver a activarlo.
          </p>
          <p className="m-0 text-[0.85rem] text-apagado">
            No se borra nunca: si tiene ventas registradas, borrarlo se llevaría
            por delante el historial de por qué el stock está como está.
          </p>
        </div>

        <BotonFila>
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton tipo="peligro" cargando={guardando} onClick={confirmar}>
            Desactivar
          </Boton>
        </BotonFila>
      </Panel>
    </Capa>
  );
}

/* =========================================================
   La capa de encima
   ---------------------------------------------------------
   Un overlay, en un solo sitio, para que los formularios sean iguales.
   Y `align-items: start` con un margen arriba: centrado exacto se sale
   de la pantalla en un móvil cuando el formulario es alto, y el botón
   de abajo queda inalcanzable.

   ⚠️  ESTA ES LA QUE TODAVÍA USA ESTILOS EN LÍNEA ──

   `caja`, `compras` y `cuentas` la importan de aquí, así que no se
   puede tocar su piel hasta que las tres estén migradas. Cambiarla
   sola dejaría cuatro modales con dos capas distintas, que es
   exactamente el problema que sacó estos modales de `productos.tsx`.
   ========================================================= */
export function Capa({
  children,
  onCerrar,
  titulo,
}: {
  children: React.ReactNode;
  onCerrar: () => void;
  titulo?: string;
}) {    /* ⚠️  LA ESCAPERA DEBE CERRAR ──

     No lo hacía, y aquí se mide: la tecla `Esc` es la que se pulsa sin
     querer con la mano de medio, y es la tecla con la que se cancela
     algo en cualquier programa del mundo. Un modal que se cierra
     tocando el fondo y que no se cierra con `Esc` obliga a apuntar al
     fondo de la pantalla.

     El `autofocus` del `Campo` no lo arregla: enfoca el primer campo
     pero no devuelve el foco a la lista al cerrar, así que el
     tabulador sigue dentro de algo que ya no existe. Por eso al
     cerrar se devuelve el foco a lo que estaba enfocado antes de
     abrir.

     Y por eso `titulo`: un diálogo de verdad se anuncia con un nombre,
     y sin él un lector de pantalla dice «diálogo» a secas. */
  
  const ref = useRef<HTMLDivElement>(null);
  const antes = useRef<Element | null>(null);
  const claveRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    antes.current = document.activeElement;
    return () => {
      /* Si el elemento sigue en la página. Sin esta comprobación, cerrar
         un modal que ya no existe deja el foco en el cuerpo y el
         siguiente tabulador empieza por arriba del documento. */
      const a = antes.current as HTMLElement | null;
      if (a && document.contains(a)) a.focus();
    };
  }, []);

  useEffect(() => {
    function alPulsar(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCerrar();
        claveRef.current?.focus();
      }
    }
    document.addEventListener("keydown", alPulsar);
    return () => document.removeEventListener("keydown", alPulsar);
  }, [onCerrar]);

  return (
    <div
      onClick={onCerrar}
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.65)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "1rem",
        overflowY: "auto",
        zIndex: 200,
      }}
    >
      {/* El `stopPropagation` evita que tocar DENTRO del formulario lo
          cierre. Sin esto, cada toque para escribir un precio cierra el
          formulario y pierde lo escrito. */}
      <div
        ref={ref}
        style={{ width: "min(44rem, 100%)", margin: "1.5rem 0", cursor: "default" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          ref={claveRef}
          tabIndex={-1}
          style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px" }}
        />
        {children}
      </div>
    </div>
  );
}