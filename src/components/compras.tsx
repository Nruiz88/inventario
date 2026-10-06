"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/ui/datos";
import { dinero, aCentavos } from "@/lib/dinero";
import { Panel, Boton, Campo, Area, Pastilla, Vacio, color, tipografia, Fila } from "@/lib/ui/controles";
import { Capa } from "@/components/productos";

/* =========================================================
   /compras
   ---------------------------------------------------------
   Anotar pedidos y recibirlos.

   ⚠️  LA DIFERENCIA ENTRE ANOTAR Y RECIBIR
   ----------------------------------------
   Anotar un pedido NO mueve el stock. El stock entra cuando se marca
   como recibido.

   Es lo que hace que esto sirva: el dueño abre el pedido por la mañana
   y a veces se distrae. Si el stock se moviera al anotar, el inventario
   mostraría mercadería que no ha llegado y «qué tengo» sería mentira.

   Y el botón de recibir está donde está por una razón: es la única
   acción que cambia el stock, y por eso se pinta distinto. Si se
   mezclara con «anular» o «editar» en una lista de botones iguales,
   tarde o temprano alguien pulsa el equivocado y entra mercadería que
   no llegó.
   ========================================================= */

type Compra = {
  id: string;
  fecha: string;
  estado: "borrador" | "recibida" | "anulada";
  facturaNro: string | null;
  total: number;
  notas: string | null;
  proveedor: string | null;
  lineas: { nombre: string; cantidad: number; costo: number; total: number }[];
};

export function Compras() {
  const { pedir } = useApi();
  const [lista, setLista] = useState<Compra[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [anulando, setAnulando] = useState<Compra | null>(null);

  function cargar() {
    pedir<Compra[]>("/api/compras").then((r) => {
      if (r.ok) setLista(r.datos);
    });
  }

  useEffect(cargar, []);

  async function recibir(c: Compra) {
    /* Se confirma porque el stock cambia y no tiene vuelta atrás
       fingertips: una compra recibida no vuelve a borrador. */
    if (
      !window.confirm(
        `¿Marcar recibida la compra de ${dinero(c.total)}?\n\nEl stock va a entrar. ` +
          `Después se puede anular, pero no volver a borrador.`
      )
    )
      return;

    const r = await pedir("/api/compras", {
      method: "PATCH",
      body: JSON.stringify({ id: c.id, accion: "recibir" }),
    });
    if (r.ok) cargar();
  }

  async function anular(c: Compra) {
    const motivo = window.prompt("Motivo de la anulación:");
    if (!motivo) return;
    const r = await pedir("/api/compras", {
      method: "PATCH",
      body: JSON.stringify({ id: c.id, accion: "anular", motivo }),
    });
    if (r.ok) {
      setAnulando(null);
      cargar();
    }
  }

  const pendientes = lista.filter((c) => c.estado === "borrador");

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {pendientes.length > 0 && (
        <div
          style={{
            padding: ".75rem 1rem",
            borderRadius: ".6rem",
            background: "#2a2417",
            border: `1px solid ${color.aviso}55`,
            color: color.aviso,
            fontSize: ".875rem",
          }}
        >
          {pendientes.length === 1
            ? "Hay 1 pedido sin recibir. El stock todavía no entró."
            : `Hay ${pendientes.length} pedidos sin recibir. El stock todavía no entró.`}
        </div>
      )}

      <Panel
        titulo="Compras a proveedor"
        accion={<Boton tipo="primario" onClick={() => setNuevo(true)}>Anotar pedido</Boton>}
      >
        {lista.length === 0 ? (
          <Vacio>No hay compras anotadas.</Vacio>
        ) : (
          lista.map((c) => (
            <div
              key={c.id}
              style={{
                padding: ".85rem 1rem",
                borderBottom: `1px solid ${color.borde}`,
                opacity: c.estado === "anulada" ? 0.55 : 1,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: ".75rem", alignItems: "baseline", flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: ".5rem", alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600 }}>{c.proveedor || "Sin proveedor"}</span>
                  <span style={{ ...tipografia.chico, color: color.apagado }}>{c.facturaNro || "sin factura"}</span>
                  {c.estado === "borrador" && <Pastilla tono="aviso">Sin recibir</Pastilla>}
                  {c.estado === "recibida" && <Pastilla tono="ok">Recibida</Pastilla>}
                  {c.estado === "anulada" && <Pastilla tono="mal">Anulada</Pastilla>}
                </div>
                <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{dinero(c.total)}</span>
              </div>

              <div style={{ ...tipografia.chico, color: color.apagado, marginTop: ".3rem" }}>
                {c.lineas.map((l, i) => (
                  <span key={i} style={{ marginRight: ".75rem" }}>
                    {l.cantidad}× {l.nombre}
                  </span>
                ))}
              </div>

              {c.notas && (
                <div style={{ ...tipografia.chico, color: color.apagado, marginTop: ".3rem" }}>
                  {c.notas}
                </div>
              )}

              {c.estado !== "anulada" && (
                <div style={{ display: "flex", gap: ".4rem", marginTop: ".6rem", flexWrap: "wrap" }}>
                  {c.estado === "borrador" && (
                    <Boton tipo="primario" tamano="chico" onClick={() => recibir(c)}>
                      Marcar recibida
                    </Boton>
                  )}
                  <Boton tamano="chico" tipo="peligro" onClick={() => setAnulando(c)}>
                    Anular
                  </Boton>
                </div>
              )}
            </div>
          ))
        )}
      </Panel>

      {nuevo && (
        <FormularioCompra
          onCerrar={() => setNuevo(false)}
          onGuardado={() => {
            setNuevo(false);
            cargar();
          }}
        />
      )}

      {anulando && (
        <AnularCompra
          compra={anulando}
          onCerrar={() => setAnulando(null)}
          onGuardado={() => {
            setAnulando(null);
            cargar();
          }}
        />
      )}
    </div>
  );
}

/* =========================================================
   Anotar un pedido
   ---------------------------------------------------------
   El costo va EN PESOS y se convierte a centavos antes de mandar. Y el
   costo es el dato que más se teclea mal en esta pantalla, así que el
   total se ve mientras se escribe y no después.

   ⚠️  EL PRECIO DE VENTA NO SE TOCA
   -------------------------------
   Al recibir la compra, un trigger actualiza el costo de la variante.
   No el de venta: ese lo pone el dueño cuando quiere cambiar la
  >ganga. Si esta pantalla cambiara el de venta, un pedido a proveedor
   repondría precios y el dueño no lo habría decidido.
   ========================================================= */
function FormularioCompra({
  onCerrar,
  onGuardado,
}: {
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const { pedir } = useApi();
  const [variantes, setVariantes] = useState<any[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [lineas, setLineas] = useState<{ varianteId: string; nombre: string; cantidad: string; costo: string }[]>([]);
  const [facturaNro, setFacturaNro] = useState("");
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    pedir<any[]>("/api/productos").then((r) => {
      if (!r.ok) return;
      const plana: any[] = [];
      for (const p of r.datos)
        for (const v of p.variantes || [])
          plana.push({ id: v.id, nombre: p.nombre + " · " + v.nombre, costo: v.costo, stock: v.stock });
      setVariantes(plana);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const encontrados = variantes
    .filter((v) => busqueda.trim() && v.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()))
    .slice(0, 10);

  const total = lineas.reduce((s, l) => s + Number(l.cantidad || 0) * aCentavos(l.costo || 0), 0);

  function agregar(v: any) {
    setLineas((ls) =>
      ls.some((l) => l.varianteId === v.id)
        ? ls
        : [...ls, { varianteId: v.id, nombre: v.nombre, cantidad: "1", costo: String((v.costo || 0) / 100) }]
    );
    setBusqueda("");
  }

  async function guardar() {
    setGuardando(true);
    const r = await pedir("/api/compras", {
      method: "POST",
      body: JSON.stringify({
        facturaNro,
        notas,
        lineas: lineas
          .filter((l) => Number(l.cantidad) > 0)
          .map((l) => ({
            varianteId: l.varianteId,
            cantidad: Number(l.cantidad),
            costo: aCentavos(l.costo || 0),
          })),
      }),
    });
    setGuardando(false);
    if (r.ok) onGuardado();
  }

  return (
    <Capa onCerrar={onCerrar}>
      <Panel titulo="Anotar pedido">
        <div style={{ padding: "1rem", display: "grid", gap: ".85rem" }}>
          <Campo
            etiqueta="Buscar producto"
            valor={busqueda}
            onChange={setBusqueda}
            placeholder="Escribe para agregar al pedido"
          />

          {encontrados.length > 0 && (
            <div style={{ display: "flex", gap: ".35rem", flexWrap: "wrap" }}>
              {encontrados.map((v) => (
                <Boton tamano="chico" key={v.id} onClick={() => agregar(v)}>
                  {v.nombre}
                </Boton>
              ))}
            </div>
          )}

          {lineas.length === 0 ? (
            <Vacio>Agregá productos al pedido.</Vacio>
          ) : (
            <div>
              {lineas.map((l, i) => (
                <div
                  key={l.varianteId}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 5rem 6rem 6rem auto",
                    gap: ".4rem",
                    alignItems: "end",
                    padding: ".3rem 0",
                  }}
                >
                  <span style={{ fontSize: ".875rem", alignSelf: "center" }}>{l.nombre}</span>
                  <Campo
                    etiqueta={i === 0 ? "Cant." : undefined}
                    valor={l.cantidad}
                    onChange={(x) =>
                      setLineas((ls) => ls.map((m, j) => (j === i ? { ...m, cantidad: x } : m)))
                    }
                    tipo="number"
                  />
                  <Campo
                    etiqueta={i === 0 ? "Costo $" : undefined}
                    valor={l.costo}
                    onChange={(x) =>
                      setLineas((ls) => ls.map((m, j) => (j === i ? { ...m, costo: x } : m)))
                    }
                    tipo="number"
                    step={0.01}
                  />
                  <span
                    style={{
                      alignSelf: "center",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      fontSize: ".875rem",
                    }}
                  >
                    {dinero(Number(l.cantidad || 0) * aCentavos(l.costo || 0))}
                  </span>
                  <Boton
                    tamano="chico"
                    tipo="fantasma"
                    onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}
                  >
                    ×
                  </Boton>
                </div>
              ))}
            </div>
          )}

          <Fila cols={2}>
            <Campo etiqueta="Nº de factura" valor={facturaNro} onChange={setFacturaNro} />
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ ...tipografia.chico, color: color.apagado }}>Total</div>
                <div style={{ ...tipografia.cifra, color: color.acento }}>{dinero(total)}</div>
              </div>
            </div>
          </Fila>

          <Area etiqueta="Notas" valor={notas} onChange={setNotas} filas={2} />

          <div style={{ ...tipografia.chico, color: color.apagado, lineHeight: 1.6 }}>
            Anotar el pedido <strong>no</strong> mueve el stock. Entra cuando lo
            marques como recibido, así una compra anotada y olvidada no descuenta
            mercadería que nunca llegó.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: ".5rem",
            padding: ".85rem 1rem",
            borderTop: `1px solid ${color.borde}`,
          }}
        >
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton
            tipo="primario"
            cargando={guardando}
            disabled={!lineas.some((l) => Number(l.cantidad) > 0)}
            onClick={guardar}
          >
            Anotar pedido
          </Boton>
        </div>
      </Panel>
    </Capa>
  );
}

/* =========================================================
   Anular una compra
   ========================================================= */
function AnularCompra({
  compra,
  onCerrar,
  onGuardado,
}: {
  compra: Compra;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const { pedir } = useApi();
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function confirmar() {
    setGuardando(true);
    const r = await pedir("/api/compras", {
      method: "PATCH",
      body: JSON.stringify({ id: compra.id, accion: "anular", motivo }),
    });
    setGuardando(false);
    if (r.ok) onGuardado();
  }

  return (
    <Capa onCerrar={onCerrar}>
      <Panel titulo={`Anular compra de ${dinero(compra.total)}`}>
        <div style={{ padding: "1rem", display: "grid", gap: ".85rem" }}>
          {compra.estado === "recibida" && (
            <div
              style={{
                padding: ".65rem .8rem",
                borderRadius: ".5rem",
                background: "#2a1a1d",
                color: color.mal,
                fontSize: ".85rem",
              }}
            >
              Esta compra ya había entrado al stock. Al anularla, el stock
              <strong> sale</strong>: va a quedar como estaba antes de recibirla.
            </div>
          )}

          <Area
            etiqueta="Motivo (obligatorio)"
            valor={motivo}
            onChange={setMotivo}
            placeholder="Se equivocaron al mandar la mercadería"
            filas={3}
          />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: ".5rem",
            padding: ".85rem 1rem",
            borderTop: `1px solid ${color.borde}`,
          }}
        >
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton tipo="peligro" cargando={guardando} disabled={!motivo.trim()} onClick={confirmar}>
            Anular
          </Boton>
        </div>
      </Panel>
    </Capa>
  );
}