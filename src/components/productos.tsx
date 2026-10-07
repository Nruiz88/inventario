"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/ui/datos";
import { dinero, aNumero, aCentavos, margen } from "@/lib/dinero";
import {
  Panel, Boton, Campo, Area, Pastilla, Vacio, color, tipografia, Fila, BotonFila, Contenedor,
} from "@/lib/ui/controles";

/* =========================================================
   /productos — alta, modificación y baja
   ---------------------------------------------------------
   Lo que tiene que resolver esta pantalla, y por qué es más difícil de
   lo que parece:

   · UN producto con VARIANTES. "Gaseosa" tiene 500ml, 1,25 y 2,25, y los
     tres tienen precio y stock distintos. Meter una sola fila por
     producto obligaría a duplicar el producto tres veces.

   · DOS números distintos que se parecen. El precio de venta y el de
     coste. Confundirlos es el error más caro de un inventario: pones el
     costo por el de venta, y resulta que se está vendiendo a pérdida y
     el margen que ves no existe.

   · BAJA ≠ BORRAR. Un producto con movimientos se desactiva, y la razón
     la explica la API. Ver el comentario de `/api/productos/modificar.ts`.

   ⚠️  EL STOCK NO SE EDITA AQUÍ
   -----------------------------
   En la lista no hay un campo para escribir el stock. A propósito.

   El stock se mueve con `/api/movimientos`, que escribe el movimiento y
   recalcula. Si aquí hubiera un campo, el dueño corregiría un error de
   conteo escribiendo el número, y el movimiento no existiría: el sistema
   diría 42 y no habría forma de saber de dónde salió.

   En su lugar, la acción es «mover stock», que pregunta qué pasó.
   ========================================================= */

type Variante = {
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

type Producto = { id: string; nombre: string; categoria: string | null; variantes: Variante[] };

export function Productos() {
  const { pedir } = useApi();
  const [lista, setLista] = useState<Producto[]>([]);
  const [busqueda, setBusqueda] = useState("");
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

  const filtrados = lista.filter((p) => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return (
      p.nombre.toLowerCase().includes(q) ||
      (p.categoria || "").toLowerCase().includes(q) ||
      p.variantes.some((v) => (v.sku || "").toLowerCase().includes(q))
    );
  });

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <Panel
        titulo={`Productos · ${lista.length}`}
        accion={<Boton tipo="primario" onClick={() => setCreando(true)}>Nuevo producto</Boton>}
      >
        <div style={{ padding: "1rem", borderBottom: `1px solid ${color.borde}` }}>
          <Campo valor={busqueda} onChange={setBusqueda} placeholder="Buscar por nombre, categoría o SKU" />
        </div>

        {filtrados.length === 0 ? (
          <Vacio>
            {lista.length === 0
              ? "No hay productos. Empezá por el que más vendés."
              : `Nada coincide con «${busqueda}».`}
          </Vacio>
        ) : (
          filtrados.map((p) => (
            <div key={p.id} style={{ borderBottom: `1px solid ${color.borde}`, padding: ".85rem 1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: ".75rem", alignItems: "baseline" }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{p.nombre}</span>
                  {p.categoria && (
                    <span style={{ ...tipografia.chico, color: color.apagado, marginLeft: ".5rem" }}>
                      {p.categoria}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: ".35rem" }}>
                  <Boton tamano="chico" onClick={() => setEditando(p)}>
                    Editar
                  </Boton>
                  <Boton
                    tamano="chico"
                    tipo="peligro"
                    onClick={() => setBorrando({ producto: p, variante: null })}
                  >
                    Desactivar
                  </Boton>
                </div>
              </div>

              {p.variantes.map((v) => (
                <div
                  key={v.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 5.5rem 6rem 5.5rem auto",
                    gap: ".6rem",
                    alignItems: "center",
                    padding: ".45rem 0 .45rem 1rem",
                    borderTop: `1px solid ${color.borde}22`,
                    fontSize: ".875rem",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 500 }}>{v.nombre || "—"}</span>
                    {v.sku && (
                      <span style={{ ...tipografia.chico, color: color.apagado, marginLeft: ".5rem" }}>
                        {v.sku}
                      </span>
                    )}
                    {!v.activo && (
                      <span style={{ marginLeft: ".5rem" }}>
                        <Pastilla>Inactivo</Pastilla>
                      </span>
                    )}
                  </div>

                  {/* El precio de venta y el de coste van en columnas
                      separadas y con su nombre debajo. Es lo que evita
                      el error caro: poner el costo donde va el de venta. */}
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                      {dinero(v.precio)}
                    </div>
                    <div style={{ ...tipografia.chico, color: color.apagado }}>venta</div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontVariantNumeric: "tabular-nums", color: color.claro }}>
                      {dinero(v.costo)}
                    </div>
                    <div style={{ ...tipografia.chico, color: color.apagado }}>costo</div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontVariantNumeric: "tabular-nums", color: v.bajo ? color.aviso : color.texto }}>
                      {v.stock}
                    </div>
                    <div style={{ ...tipografia.chico, color: color.apagado }}>mín. {v.minimo}</div>
                  </div>

                  <div style={{ display: "flex", gap: ".3rem" }}>
                    <Boton
                      tamano="chico"
                      tipo="fantasma"
                      onClick={() => setMoviendo(v)}
                      title="Merma, devolución o corrección de conteo"
                    >
                      Mover
                    </Boton>
                    <Boton tamano="chico" tipo="fantasma" onClick={() => setBorrando({ producto: p, variante: v })}>
                      ×
                    </Boton>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </Panel>

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

   En una versión siguiente, el precio se cambia en línea desde la
   lista. Es un botón por fila, no un formulario.
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

function Formulario({
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
    <Capa onCerrar={onCerrar}>
      <Panel titulo={editando ? `Editar ${producto!.nombre}` : "Nuevo producto"}>
        <div style={{ padding: "1rem", display: "grid", gap: ".85rem" }}>
          <Campo etiqueta="Nombre" valor={nombre} onChange={setNombre} placeholder="Gaseosa" autoFocus />

          <Fila cols={2}>
            <Campo etiqueta="Categoría" valor={categoria} onChange={setCategoria} placeholder="Bebidas" />
            <Campo
              etiqueta="Stock inicial por presentación"
              valor=""
              onChange={() => {}}
              tipo="number"
            />
          </Fila>

          {!editando && (
            <>
              <div style={{ height: 1, background: color.borde, margin: ".25rem 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: ".9rem" }}>Presentaciones</span>
                <Boton tamano="chico" onClick={nuevaVariante}>
                  Agregar
                </Boton>
              </div>

              {variantes.map((v, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr auto",
                    gap: ".4rem",
                    alignItems: "end",
                  }}
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

              <div style={{ ...tipografia.chico, color: color.apagado, lineHeight: 1.6 }}>
                El stock inicial entra como movimiento, para que el historial cuadre
                desde el primer día. Si lo pones en cero, contá después con «Mover».
              </div>
            </>
          )}

          {editando && producto!.variantes.length > 0 && (
            <div
              style={{
                padding: ".75rem",
                borderRadius: ".5rem",
                background: color.panel2,
                fontSize: ".85rem",
                color: color.apagado,
                lineHeight: 1.6,
              }}
            >
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
function MoverStock({
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
    <Capa onCerrar={onCerrar}>
      <Panel titulo={variante.nombre || "Producto"}>
        <div style={{ padding: "1rem", display: "grid", gap: ".85rem" }}>
          <div style={{ ...tipografia.chico, color: color.apagado }}>
            Ahora hay <strong style={{ color: color.texto }}>{variante.stock}</strong>.
          </div>

          <Fila cols={2}>
            <label style={{ display: "block" }}>
              <span style={{ ...tipografia.chico, color: color.apagado, display: "block", marginBottom: ".25rem", textTransform: "uppercase" }}>
                Qué pasó
              </span>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                style={{
                  width: "100%",
                  padding: ".6rem",
                  borderRadius: ".6rem",
                  border: `1px solid ${color.borde}`,
                  background: "#0d141c",
                  color: color.texto,
                  minHeight: "2.6rem",
                }}
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
            style={{
              padding: ".65rem .8rem",
              borderRadius: ".5rem",
              background: despues < 0 ? "#2a1a1d" : color.panel2,
              color: despues < 0 ? color.mal : color.apagado,
              fontSize: ".85rem",
            }}
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
function Baja({
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
    <Capa onCerrar={onCerrar}>
      <Panel titulo={datos.variante ? "Desactivar presentación" : "Desactivar producto"}>
        <div style={{ padding: "1rem", display: "grid", gap: ".85rem", fontSize: ".9rem", lineHeight: 1.65 }}>
          <p style={{ margin: 0 }}>
            Vas a desactivar <strong>{nombre}</strong>.
          </p>
          <p style={{ margin: 0, color: color.apagado }}>
            Deja de aparecer en la caja, pero sigue en el histórico y en los informes.
            Podés volver a activarlo.
          </p>
          <p style={{ margin: 0, color: color.apagado, fontSize: ".85rem" }}>
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
   Un overlay, en un solo sitio, para que los tres formularios sean
   iguales. Y `align-items: start` con un margen arriba: centrado
   exacto se sale de la pantalla en un móvil cuando el formulario es
   alto, y el botón de abajo queda inalcanzable.
   ========================================================= */
export function Capa({
  children,
  onCerrar,
}: {
  children: React.ReactNode;
  onCerrar: () => void;
}) {
  return (
    <div
      onClick={onCerrar}
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
      <div style={{ width: "min(44rem, 100%)", margin: "1.5rem 0", cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}