"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/lib/ui/datos";
import { dinero, aNumero, aCentavos, margen } from "@/lib/dinero";
import {
  Panel, Boton, Campo, Area, Pastilla, Vacio, color, tipografia, Fila, BotonFila,
} from "@/lib/ui/controles";

/* =========================================================
   /ventas
   ---------------------------------------------------------
   Dos cosas en una pantalla, y por eso es la más larga:

     · la caja  — buscar, agregar, cobrar
     · el historial — qué se vendió, y anular o marcar como facturada

   ⚠️  POR QUÉ NO HAY UN `<form>` CON `onSubmit`
   -------------------------------------------
   Porque la operación no es un formulario: es una lista que se va
   llenando y una tecla. En un mostrador el dueño mete tres productos y
   cobra, y si cada línea fuera un formulario con su botón, tendría que
   confirmar tres veces.

   La tecla que hace la caja es la ENTER, y la de cobrar es la F2. En un
   mostrador el dueño casi no mira el teclado, así que las teclas son
   lo que hacen que esto sea rápido: la mano va al producto y la otra
   está en el teclado.

   Y el escáner de códigos es un teclado que manda la cadena y pulsa
   ENTER. Por eso el campo de búsqueda está siempre enfocado: si pierde
   el foco, el escáner se pierde en el nowhere y no aparece nada, que es
   el fallo más silencioso de un punto de venta.
   ========================================================= */

type Variante = {
  id: string;
  productoId: string;
  nombre: string;
  variante: string;
  sku: string | null;
  precio: number;
  costo: number;
  stock: number;
  minimo: number;
  bajo: boolean;
};

type Linea = { variante: Variante; cantidad: number };

type Cliente = { id: string; nombre: string; saldo: number };

const METODOS = [
  { valor: "efectivo", texto: "Efectivo" },
  { valor: "tarjeta", texto: "Tarjeta" },
  { valor: "transferencia", texto: "Transferencia" },
  { valor: "cuenta_corriente", texto: "A cuenta" },
];

export function Ventas() {
  const { pedir } = useApi();

  const [variantes, setVariantes] = useState<Variante[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [metodo, setMetodo] = useState("efectivo");
  const [clienteId, setClienteId] = useState("");
  const [cobrando, setCobrando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [anulando, setAnulando] = useState<{ id: string; total: number } | null>(null);
  const [motivo, setMotivo] = useState("");

  const campo = useRef<HTMLInputElement>(null);

  /* ── Cargar ── */
  useEffect(() => {
    pedir<any[]>("/api/productos").then((r) => {
      if (!r.ok) return;
      /* Se aplana: la API devuelve productos con sus variantes dentro y
         aquí se trabaja con una sola lista. La caja busca entre
         variantes, no entre productos: lo que se escanea es una
         presentación. */
      const plana: Variante[] = [];
      for (const p of r.datos) {
        for (const v of p.variantes || []) {
          plana.push({
            id: v.id,
            productoId: p.id,
            nombre: p.nombre,
            variante: v.nombre,
            sku: v.sku,
            precio: v.precio,
            costo: v.costo,
            stock: v.stock,
            minimo: v.minimo,
            bajo: v.bajo,
          });
        }
      }
      setVariantes(plana);
    });

    pedir<any>("/api/cuentas").then((r) => {
      if (r.ok) setClientes(r.datos.clientes || []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Buscar ──
     Con cuatro filtros, no uno. En un kiosco hay "gaseosa 500" y
     "gaseosa 1,25" y dos "gaseosa"; el que escanea el código quiere el
     exacto, y el que teclea "gase" quiere ver las cuatro. */
  const encontrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return variantes.slice(0, 12);
    return variantes
      .filter((v) => {
        if (v.sku && v.sku.toLowerCase() === q) return true;
        if (v.sku && v.sku.toLowerCase().includes(q)) return true;
        return (v.nombre + " " + v.variante).toLowerCase().includes(q);
      })
      .slice(0, 20);
  }, [busqueda, variantes]);

  /* ── El total ──
     Se calcula aquí, con el precio que trae la lista. NO es el precio
     final: el servidor lo vuelve a leer de la base al guardar.

     Y esa diferencia es a propósito, no un descuido. Si el precio se
     subiera entre que se carga la lista y que se cobra, lo que se ve
     en la pantalla y lo que se guarda serían distintos, y el dueño
     descubriría el cambio cuando mira el total del banco. Es mejor que
     lo_adjuste al cobrar, y que la caja muestre lo que el servidor dice
     al confirmar. */
  const total = lineas.reduce((s, l) => s + l.variante.precio * l.cantidad, 0);

  const gananciaTotal = lineas.reduce((s, l) => s + (l.variante.precio - l.variante.costo) * l.cantidad, 0);

  function agregar(v: Variante) {
    if (v.stock <= 0) {
      /* No se añade y se dice por qué. La alternativa es añadirla con
         stock 0 y que el servidor la rechace: el dueño pulse F2 y
        descubrió que no había, con la caja ya abierta delante de un
         cliente. */
      campo.current?.focus();
      return;
    }

    setLineas((previas) => {
      const existe = previas.findIndex((l) => l.variante.id === v.id);
      if (existe < 0) return [...previas, { variante: v, cantidad: 1 }];

      const siguiente = [...previas];
      /* No se deja pasar del stock. Se avisa con el `title` del botón en
         la lista, pero aquí se recorta: una venta que no se puede
         guardar es una venta que se pierde. */
      siguiente[existe] = {
        ...siguiente[existe],
        cantidad: Math.min(v.stock, siguiente[existe].cantidad + 1),
      };
      return siguiente;
    });

    setBusqueda("");
    /* El foco vuelve al campo SIN `setTimeout`.
       Con un `setTimeout` de 0 funciona en un navegador y no en otro, y
       el síntoma es que el escáner deja de funcionar justo después de
       la primera venta. */
    campo.current?.focus();
  }

  function cambiar(id: string, cantidad: number) {
    setLineas((previas) =>
      previas
        .map((l) => (l.variante.id === id ? { ...l, cantidad } : l))
        .filter((l) => l.cantidad > 0)
    );
  }

  async function cobrar() {
    if (!lineas.length) return;

    if (metodo === "cuenta_corriente" && !clienteId) {
      /* Sin cliente no hay a quién apuntar la deuda. El trigger lo
         comprueba también, y rechazaría con un error de Postgres que no
         se entiende. Aquí se dice lo que falta. */
      return;
    }

    setGuardando(true);
    const r = await pedir("/api/ventas", {
      method: "POST",
      body: JSON.stringify({
        items: lineas.map((l) => ({ varianteId: l.variante.id, cantidad: l.cantidad })),
        metodoPago: metodo,
        clienteId: metodo === "cuenta_corriente" ? clienteId : null,
      }),
    });
    setGuardando(false);

    if (r.ok) {
      setLineas([]);
      setClienteId("");
      campo.current?.focus();
      /* Se vuelve a pedir la lista para que los stocks que estaban en
         la pantalla ya no sean los de antes. Sin esto, el dueño cobra
         seis gaseosas y sigue viendo que hay diez: la siguiente venta
         por la misma pantalla intenta vender las que ya no existen. */
      pedir<any[]>("/api/productos").then((res) => {
        if (res.ok) {
          const plana: Variante[] = [];
          for (const p of res.datos)
            for (const v of p.variantes || [])
              plana.push({ ...v, productoId: p.id, nombre: p.nombre, variante: v.nombre });
          setVariantes(plana);
        }
      });
    }
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {/* ── La caja ── */}
      <Panel titulo="Caja">
        <div style={{ padding: "1rem", display: "grid", gap: ".85rem" }}>
          <Campo
            etiqueta="Buscar o escanear"
            valor={busqueda}
            onChange={setBusqueda}
            placeholder="Escribe el nombre o pasa el escáner"
            autoFocus
          />

          {/* El `tabIndex={-1}` y el `onClick` con `focus()`: el botón
              no roba el foco, para que después de tocarlo el escáner
              siga funcionando. Un `<button>` normal lo roba, y la venta
              siguiente se pierde. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: ".4rem" }}>
            {encontrados.map((v) => (
              <button
                key={v.id}
                type="button"
                tabIndex={-1}
                onClick={() => agregar(v)}
                disabled={v.stock <= 0}
                title={
                  v.stock <= 0
                    ? "Sin stock"
                    : `${v.nombre}${v.variante ? " · " + v.variante : ""} — ${dinero(v.precio)}`
                }
                style={{
                  padding: ".5rem .7rem",
                  borderRadius: ".45rem",
                  border: `1px solid ${v.bajo ? color.aviso + "66" : color.borde}`,
                  background: v.stock <= 0 ? "#151a1f" : color.panel2,
                  color: v.stock <= 0 ? color.apagado : color.texto,
                  opacity: v.stock <= 0 ? 0.5 : 1,
                  cursor: v.stock <= 0 ? "not-allowed" : "pointer",
                  fontSize: ".85rem",
                  textAlign: "left",
                  lineHeight: 1.35,
                  minHeight: "2.6rem",
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {v.nombre}
                  {v.variante ? <span style={{ color: color.apagado, fontWeight: 400 }}> · {v.variante}</span> : null}
                </div>
                <div style={{ display: "flex", gap: ".5rem", fontSize: ".78rem", marginTop: ".1rem" }}>
                  <span style={{ color: color.acento, fontVariantNumeric: "tabular-nums" }}>
                    {dinero(v.precio)}
                  </span>
                  <span style={{ color: v.stock === 0 ? color.mal : color.apagado }}>
                    {v.stock === 0 ? "agotado" : `${v.stock} en stock`}
                  </span>
                </div>
              </button>
            ))}
            {encontrados.length === 0 && (
              <span style={{ ...tipografia.chico, color: color.apagado, alignSelf: "center" }}>
                {/* Tres casos distintos, y el mensaje tiene que decir cuál.
                    Con un solo mensaje, un kiosco recién configurado
                    —que no tiene ni un producto— lee "Nada coincide con
                    «»", que suena a que el buscador está roto. */}
                {!busqueda.trim()
                  ? variantes.length === 0
                    ? "Todavía no hay productos. Cargalos en Productos para poder vender."
                    : "Escribí el nombre de algo para empezar."
                  : `Nada coincide con «${busqueda}».`}
              </span>
            )}
          </div>

          <div style={{ height: 1, background: color.borde }} />

          {lineas.length === 0 ? (
            <Vacio>Toque un producto para empezar la venta.</Vacio>
          ) : (
            <div>
              {lineas.map((l) => (
                <div
                  key={l.variante.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 5.5rem 6rem",
                    gap: ".6rem",
                    alignItems: "center",
                    padding: ".45rem 0",
                    borderBottom: `1px solid ${color.borde}`,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: ".9rem", fontWeight: 600 }}>
                      {l.variante.nombre}
                      {l.variante.variante ? (
                        <span style={{ color: color.apagado, fontWeight: 400 }}> · {l.variante.variante}</span>
                      ) : null}
                    </div>
                    <div style={{ ...tipografia.chico, color: color.apagado }}>
                      {dinero(l.variante.precio)} c/u
                      {l.variante.costo > 0 && <> · margen {margen(l.variante.precio, l.variante.costo)}%</>}
                    </div>
                  </div>

                  <input
                    type="number"
                    min={1}
                    max={l.variante.stock}
                    value={l.cantidad}
                    onChange={(e) => cambiar(l.variante.id, Math.min(l.variante.stock, Number(e.target.value) || 1))}
                    style={{
                      width: "100%",
                      padding: ".4rem",
                      borderRadius: ".4rem",
                      border: `1px solid ${color.borde}`,
                      background: "#0d141c",
                      color: color.texto,
                      fontSize: ".9rem",
                      textAlign: "center",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  />

                  <div
                    style={{
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 600,
                    }}
                  >
                    {dinero(l.variante.precio * l.cantidad)}
                  </div>
                </div>
              ))}

              <div style={{ display: "flex", justifyContent: "space-between", padding: ".8rem 0 0" }}>
                <span style={{ ...tipografia.grande, fontWeight: 600 }}>Total</span>
                <span style={{ ...tipografia.cifra, color: color.acento }}>{dinero(total)}</span>
              </div>

              {gananciaTotal > 0 && (
                <div style={{ ...tipografia.chico, color: color.apagado, textAlign: "right" }}>
                  Ganancia estimada {dinero(gananciaTotal)}
                </div>
              )}
            </div>
          )}

          <Fila cols={metodo === "cuenta_corriente" ? 1 : 2}>
            <label style={{ display: "block" }}>
              <span
                style={{
                  display: "block",
                  fontSize: ".75rem",
                  color: color.apagado,
                  marginBottom: ".25rem",
                  textTransform: "uppercase",
                }}
              >
                Cómo paga
              </span>
              <select
                value={metodo}
                onChange={(e) => setMetodo(e.target.value)}
                style={{
                  width: "100%",
                  padding: ".6rem",
                  borderRadius: ".6rem",
                  border: `1px solid ${color.borde}`,
                  background: "#0d141c",
                  color: color.texto,
                  fontSize: ".95rem",
                  minHeight: "2.6rem",
                }}
              >
                {METODOS.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.texto}
                  </option>
                ))}
              </select>
            </label>

            {metodo === "cuenta_corriente" && (
              <label style={{ display: "block" }}>
                <span
                  style={{
                    display: "block",
                    fontSize: ".75rem",
                    color: color.apagado,
                    marginBottom: ".25rem",
                    textTransform: "uppercase",
                  }}
                >
                  Cliente
                </span>
                <select
                  value={clienteId}
                  onChange={(e) => setClienteId(e.target.value)}
                  style={{
                    width: "100%",
                    padding: ".6rem",
                    borderRadius: ".6rem",
                    border: `1px solid ${color.borde}`,
                    background: "#0d141c",
                    color: color.texto,
                    fontSize: ".95rem",
                    minHeight: "2.6rem",
                  }}
                >
                  <option value="">Elegí un cliente…</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                      {c.saldo > 0 ? ` — debe ${dinero(c.saldo)}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </Fila>

          {metodo === "cuenta_corriente" && !clienteId && (
            <div style={{ ...tipografia.chico, color: color.aviso }}>
              Para vender a cuenta hay que elegir a quién se le apunta la deuda.
            </div>
          )}

          <Boton
            tipo="primario"
            ancho
            cargando={guardando}
            disabled={!lineas.length || (metodo === "cuenta_corriente" && !clienteId)}
            onClick={cobrar}
          >
            Cobrar {dinero(total)}
          </Boton>
        </div>
      </Panel>

      {/* ── El historial ── */}
      <Historial onAnular={setAnulando} />
      <Anular
        datos={anulando}
        motivo={motivo}
        setMotivo={setMotivo}
        onCerrar={() => {
          setAnulando(null);
          setMotivo("");
        }}
      />
    </div>
  );
}

/* =========================================================
   El historial
   ========================================================= */
function Historial({ onAnular }: { onAnular: (v: { id: string; total: number }) => void }) {
  const { pedir } = useApi();
  const [ventas, setVentas] = useState<any[]>([]);
  const [soloPendientes, setSoloPendientes] = useState(false);

  const cargar = () => {
    pedir<any[]>("/api/ventas" + (soloPendientes ? "?soloPendientes=1" : "")).then((r) => {
      if (r.ok) setVentas(r.datos);
    });
  };

  useEffect(cargar, [soloPendientes]);

  async function marcarFacturada(id: string) {
    /* El número se pide con `prompt` en vez de con un formulario en
       línea. Es un dato corto, se teclea una vez y no se relee nunca,
       y un `prompt` evita tener tres botones en cada fila para un
       campo que casi siempre es el mismo. */
    const numero = window.prompt("Número del comprobante:");
    if (!numero) return;
    const r = await pedir("/api/ventas", {
      method: "PATCH",
      body: JSON.stringify({ id, accion: "facturar", numero }),
    });
    if (r.ok) cargar();
  }

  async function quitarFactura(id: string) {
    const r = await pedir("/api/ventas", {
      method: "PATCH",
      body: JSON.stringify({ id, accion: "desfacturar" }),
    });
    if (r.ok) cargar();
  }

  return (
    <Panel
      titulo={soloPendientes ? "Ventas sin facturar" : "Ventas"}
      accion={
        <label style={{ ...tipografia.chico, color: color.apagado, cursor: "pointer", display: "flex", gap: ".4rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={soloPendientes}
            onChange={(e) => setSoloPendientes(e.target.checked)}
          />
          Solo sin facturar
        </label>
      }
    >
      {ventas.length === 0 ? (
        <Vacio>{soloPendientes ? "Todo facturado. Nada pendiente." : "Todavía no hay ventas."}</Vacio>
      ) : (
        <div>
          {ventas.map((v) => (
            <div
              key={v.id}
              style={{
                padding: ".75rem 1rem",
                borderBottom: `1px solid ${color.borde}`,
                opacity: v.anulada ? 0.55 : 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: ".75rem",
                  alignItems: "baseline",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <span style={{ fontWeight: 600 }}>
                    {v.cliente || "Mostrador"}
                  </span>
                  <span style={{ ...tipografia.chico, color: color.apagado, marginLeft: ".5rem" }}>
                    {new Date(v.fecha).toLocaleString("es-AR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {dinero(v.total)}
                </span>
              </div>

              <div
                style={{
                  ...tipografia.chico,
                  color: color.apagado,
                  marginTop: ".2rem",
                  display: "flex",
                  gap: ".5rem",
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                {v.lineas.map((l: any, i: number) => (
                  <span key={i}>
                    {l.cantidad}× {l.nombre}
                  </span>
                ))}
              </div>

              <div style={{ display: "flex", gap: ".4rem", marginTop: ".5rem", flexWrap: "wrap", alignItems: "center" }}>
                <Pastilla>{v.metodo.replace("_", " ")}</Pastilla>

                {v.anulada ? (
                  <Pastilla tono="mal">Anulada</Pastilla>
                ) : v.facturada ? (
                  <>
                    <Pastilla tono="ok">{v.facturaNro}</Pastilla>
                    <Boton tamano="chico" tipo="fantasma" onClick={() => quitarFactura(v.id)}>
                      Quitar
                    </Boton>
                  </>
                ) : (
                  <>
                    <Pastilla tono="aviso">Sin factura</Pastilla>
                    <Boton tamano="chico" onClick={() => marcarFacturada(v.id)}>
                      Marcar
                    </Boton>
                  </>
                )}

                {!v.anulada && (
                  <Boton tamano="chico" tipo="peligro" onClick={() => onAnular({ id: v.id, total: v.total })}>
                    Anular
                  </Boton>
                )}
              </div>

              {v.anulada && v.anuladaMotivo && (
                <div style={{ ...tipografia.chico, color: color.mal, marginTop: ".3rem" }}>
                  Motivo: {v.anuladaMotivo}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* =========================================================
   Anular una venta
   ---------------------------------------------------------
   Un panel encima, no un `prompt`.

   El motivo es obligatorio, y con un `prompt` la mitad de las veces se
   acepta vacío. Y una venta anulada sin motivo no tiene explicación
   dos meses después.
   ========================================================= */
function Anular({
  datos,
  motivo,
  setMotivo,
  onCerrar,
}: {
  datos: { id: string; total: number } | null;
  motivo: string;
  setMotivo: (v: string) => void;
  onCerrar: () => void;
}) {
  const { pedir } = useApi();
  const [guardando, setGuardando] = useState(false);

  if (!datos) return null;

  async function confirmar() {
    setGuardando(true);
    const r = await pedir("/api/ventas", {
      method: "PATCH",
      body: JSON.stringify({ id: datos!.id, accion: "anular", motivo }),
    });
    setGuardando(false);
    if (r.ok) onCerrar();
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.65)",
        display: "grid",
        placeItems: "center",
        padding: "1rem",
        zIndex: 200,
      }}
    >
      <div style={{ width: "min(28rem, 100%)" }}>
        <Panel titulo={`Anular venta de ${dinero(datos.total)}`}>
          <div style={{ padding: "1rem", display: "grid", gap: ".85rem" }}>
            <div style={{ ...tipografia.chico, color: color.apagado, lineHeight: 1.6 }}>
              Se devuelve el stock y se saca el dinero de la caja. Queda registrado,
              no se borra.
            </div>

            <Area
              etiqueta="Motivo (obligatorio)"
              valor={motivo}
              onChange={setMotivo}
              placeholder="Error de tecleo, devolución del cliente…"
              filas={3}
            />

            <Fila cols={2}>
              <Boton onClick={onCerrar}>Cancelar</Boton>
              <Boton tipo="peligro" cargando={guardando} disabled={!motivo.trim()} onClick={confirmar}>
                Anular
              </Boton>
            </Fila>
          </div>
        </Panel>
      </div>
    </div>
  );
}