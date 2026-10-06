"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/ui/datos";
import { dinero, aCentavos } from "@/lib/dinero";
import { Panel, Boton, Campo, Pastilla, Vacio, color, tipografia, Cifra } from "@/lib/ui/controles";
import { Capa } from "@/components/productos";

/* =========================================================
   /cuentas — las cuentas corrientes
   ---------------------------------------------------------
   Quién le compra al comercio y cuánto le debe.

   ⚠️  NO HAY UN SALDO EDITABLE
   ---------------------------
   El saldo de cada cliente es la SUMA de sus movimientos. No hay campo
   para escribirlo, y esa es la diferencia entre esto y una lista de
   contactos con un número al lado.

   Con un saldo guardado, "desde cuándo me debe esto" no tiene
   respuesta. Y esa es exactamente la pregunta que hace un dueño de
   kiosco: "yo te dejé fiado el mes pasado".

   Por eso cada cliente muestra su libro: los debe, los haberes, con
   fecha y concepto. El saldo sale de ahí y se puede seguir.
   ========================================================= */

type Movimiento = {
  id: string;
  tipo: "debe" | "haber" | "nota";
  monto_cents: number;
  concepto: string | null;
  fecha: string;
};

type Cliente = {
  id: string;
  nombre: string;
  telefono: string | null;
  documento: string | null;
  notas: string | null;
  activo: boolean;
  saldo: number;
  movimientos: Movimiento[];
};

export function Cuentas() {
  const { pedir } = useApi();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [total, setTotal] = useState(0);
  const [deben, setDeben] = useState(0);
  const [busqueda, setBusqueda] = useState("");
  const [nuevo, setNuevo] = useState(false);
  const [cobrando, setCobrando] = useState<Cliente | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);

  function cargar() {
    pedir<any>("/api/cuentas").then((r) => {
      if (!r.ok) return;
      setClientes(r.datos.clientes || []);
      setTotal(r.datos.total || 0);
      setDeben(r.datos.deben || 0);
    });
  }

  useEffect(cargar, []);

  const filtrados = clientes.filter((c) => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return c.nombre.toLowerCase().includes(q) || (c.telefono || "").toLowerCase().includes(q);
  });

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(11rem, 1fr))",
          gap: ".75rem",
        }}
      >
        <Panel>
          <div style={{ padding: "1rem" }}>
            <Cifra valor={dinero(total)} etiqueta="Total que me deben" tono={total > 0 ? "aviso" : undefined} />
          </div>
        </Panel>
        <Panel>
          <div style={{ padding: "1rem" }}>
            <Cifra valor={deben} etiqueta="Clientes que deben" />
          </div>
        </Panel>
        <Panel>
          <div style={{ padding: "1rem" }}>
            <Cifra valor={clientes.length} etiqueta="Clientes" />
          </div>
        </Panel>
      </div>

      <Panel
        titulo="Clientes"
        accion={<Boton tipo="primario" onClick={() => setNuevo(true)}>Nuevo cliente</Boton>}
      >
        <div style={{ padding: "1rem", borderBottom: `1px solid ${color.borde}` }}>
          <Campo valor={busqueda} onChange={setBusqueda} placeholder="Buscar por nombre o teléfono" />
        </div>

        {filtrados.length === 0 ? (
          <Vacio>
            {clientes.length === 0
              ? "Todavía no hay clientes. Son los que te compran a cuenta, no los usuarios de Nexo Studio."
              : `Nada coincide con «${busqueda}».`}
          </Vacio>
        ) : (
          filtrados.map((c) => (
            <div key={c.id} style={{ borderBottom: `1px solid ${color.borde}` }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: ".75rem",
                  alignItems: "center",
                  padding: ".75rem 1rem",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <span style={{ fontWeight: 600 }}>{c.nombre}</span>
                  {c.telefono && (
                    <span style={{ ...tipografia.chico, color: color.apagado, marginLeft: ".5rem" }}>
                      {c.telefono}
                    </span>
                  )}
                  {c.saldo === 0 && (
                    <span style={{ marginLeft: ".5rem" }}>
                      <Pastilla tono="ok">Al día</Pastilla>
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", gap: ".75rem", alignItems: "center" }}>
                  <span
                    style={{
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      color: c.saldo > 0 ? color.aviso : c.saldo < 0 ? color.claro : color.apagado,
                    }}
                  >
                    {dinero(c.saldo)}
                  </span>

                  <Boton tamano="chico" onClick={() => setCobrando(c)} disabled={c.saldo <= 0}>
                    Cobró
                  </Boton>

                  <Boton
                    tamano="chico"
                    tipo="fantasma"
                    onClick={() => setAbierto(abierto === c.id ? null : c.id)}
                  >
                    {abierto === c.id ? "Cerrar" : "Ver libro"}
                  </Boton>
                </div>
              </div>

              {/* El libro del cliente. Se muestra entero, y no una línea
                  de saldo, porque la pregunta que lo justifica es
                  «desde cuándo». */}
              {abierto === c.id && (
                <div
                  style={{
                    padding: ".75rem 1rem",
                    background: "#0d141c",
                    borderTop: `1px solid ${color.borde}`,
                  }}
                >
                  {c.movimientos.length === 0 ? (
                    <span style={{ ...tipografia.chico, color: color.apagado }}>
                      Sin movimientos: nunca compró a cuenta.
                    </span>
                  ) : (
                    c.movimientos.map((m) => (
                      <div
                        key={m.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "5rem 1fr 6rem",
                          gap: ".6rem",
                          alignItems: "baseline",
                          padding: ".35rem 0",
                          fontSize: ".85rem",
                        }}
                      >
                        <span style={{ color: color.apagado, fontSize: ".78rem" }}>
                          {new Date(m.fecha).toLocaleDateString("es-AR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "2-digit",
                          })}
                        </span>

                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {m.tipo === "debe" && <Pastilla tono="mal">Debe</Pastilla>}
                          {m.tipo === "haber" && <Pastilla tono="ok">Paga</Pastilla>}
                          {m.tipo === "nota" && <Pastilla>Ajuste</Pastilla>}
                          <span style={{ marginLeft: ".4rem" }}>{m.concepto}</span>
                        </span>

                        <span
                          style={{
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                            color: m.tipo === "debe" ? color.mal : m.tipo === "haber" ? color.ok : color.apagado,
                          }}
                        >
                          {m.tipo === "debe" ? "+" : "−"}
                          {dinero(m.monto_cents)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </Panel>

      {nuevo && (
        <FormularioCliente
          onCerrar={() => setNuevo(false)}
          onGuardado={() => {
            setNuevo(false);
            cargar();
          }}
        />
      )}

      {cobrando && (
        <FormularioCobro
          cliente={cobrando}
          onCerrar={() => setCobrando(null)}
          onGuardado={() => {
            setCobrando(null);
            cargar();
          }}
        />
      )}
    </div>
  );
}

/* =========================================================
   Alta de cliente
   ========================================================= */
function FormularioCliente({
  onCerrar,
  onGuardado,
}: {
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const { pedir } = useApi();
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [documento, setDocumento] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    const r = await pedir("/api/cuentas", {
      method: "POST",
      body: JSON.stringify({ accion: "cliente", nombre, telefono, documento }),
    });
    setGuardando(false);
    if (r.ok) onGuardado();
  }

  return (
    <Capa onCerrar={onCerrar}>
      <Panel titulo="Nuevo cliente">
        <div style={{ padding: "1rem", display: "grid", gap: ".85rem" }}>
          <Campo etiqueta="Nombre" valor={nombre} onChange={setNombre} autoFocus />

          <Campo
            etiqueta="Teléfono"
            valor={telefono}
            onChange={setTelefono}
            tipo="tel"
          />

          <Campo
            etiqueta="DNI o documento"
            valor={documento}
            onChange={setDocumento}
          />

          <div style={{ ...tipografia.chico, color: color.apagado, lineHeight: 1.6 }}>
            Estos son los clientes de tu comercio, no usuarios de Nexo Studio. No
            entran nunca a este servicio ni tienen contraseña.
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
          <Boton tipo="primario" cargando={guardando} disabled={!nombre.trim()} onClick={guardar}>
            Crear
          </Boton>
        </div>
      </Panel>
    </Capa>
  );
}

/* =========================================================
   Anotar un cobro
   ---------------------------------------------------------
   El monto va precargado con la deuda. Es lo que el dueño va a
   cobrar el 90% de las veces, y escribirlo a mano cada vez es la forma
   de que se apunte 4.500 cuando eran 4.000.

   Y avisa de una cosa que confunde: el cobro NO toca la caja. El
   dinero entra, pero por qué y de qué es lo decide el arqueo. Si esta
   ruta escribiera también en la caja, cada cobro se contaría dos
   veces.
   ========================================================= */
function FormularioCobro({
  cliente,
  onCerrar,
  onGuardado,
}: {
  cliente: Cliente;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const { pedir } = useApi();
  const [monto, setMonto] = useState(String(cliente.saldo / 100));
  const [concepto, setConcepto] = useState("pago a cuenta");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    const r = await pedir("/api/cuentas", {
      method: "POST",
      body: JSON.stringify({
        accion: "cobro",
        clienteId: cliente.id,
        /* El servidor lo pasa a centavos. Se manda en pesos desde el
           campo, que es pesos, para que no haya dos unidades en la
           misma pantalla. */
        monto: aCentavos(monto || 0),
        concepto,
      }),
    });
    setGuardando(false);
    if (r.ok) onGuardado();
  }

  return (
    <Capa onCerrar={onCerrar}>
      <Panel titulo={`Cobro de ${cliente.nombre}`}>
        <div style={{ padding: "1rem", display: "grid", gap: ".85rem" }}>
          <div
            style={{
              padding: ".8rem",
              borderRadius: ".5rem",
              background: color.panel2,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <span style={{ ...tipografia.chico, color: color.apagado }}>Debe</span>
            <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {dinero(cliente.saldo)}
            </span>
          </div>

          <Campo etiqueta="Cuánto paga" valor={monto} onChange={setMonto} tipo="number" step={0.01} autoFocus />

          <Campo etiqueta="Concepto" valor={concepto} onChange={setConcepto} />

          <div style={{ ...tipografia.chico, color: color.apagado, lineHeight: 1.6 }}>
            Esto baja la deuda. El dinero que entra al cajón se anota en
            <strong> Caja</strong>, que es donde se cuenta: si se anotara en los
            dos sitios, el arqueo sumaría el cobro dos veces.
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
          <Boton tipo="primario" cargando={guardando} disabled={aCentavos(monto) <= 0} onClick={guardar}>
            Anotar el cobro
          </Boton>
        </div>
      </Panel>
    </Capa>
  );
}