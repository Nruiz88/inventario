"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/ui/datos";
import { dinero, aCentavos } from "@/lib/dinero";
import { cn } from "@/lib/utils";
import { Panel, Boton, Campo, Pastilla, Vacio, Cifra, BotonFila } from "@/lib/ui/controles";
import { Capa } from "@/components/productos-form";

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
    <div className="grid gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
        <Panel>
          <div className="p-4">
            <Cifra valor={dinero(total)} etiqueta="Total que me deben" tono={total > 0 ? "aviso" : undefined} />
          </div>
        </Panel>
        <Panel>
          <div className="p-4">
            <Cifra valor={deben} etiqueta="Clientes que deben" />
          </div>
        </Panel>
        <Panel>
          <div className="p-4">
            <Cifra valor={clientes.length} etiqueta="Clientes" />
          </div>
        </Panel>
      </div>

      <Panel
        titulo="Clientes"
        accion={<Boton tipo="primario" onClick={() => setNuevo(true)}>Nuevo cliente</Boton>}
      >
        <div className="border-b border-borde p-4">
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
            <div key={c.id} className="border-b border-borde last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold">{c.nombre}</span>
                  {c.telefono && <span className="text-xs text-apagado">{c.telefono}</span>}
                  {c.saldo === 0 && <Pastilla tono="ok">Al día</Pastilla>}
                </div>

                <div className="flex items-center gap-3">
                  <span
                    data-cifra
                    className={cn(
                      "font-bold",
                      c.saldo > 0 ? "text-aviso" : c.saldo < 0 ? "text-claro" : "text-apagado"
                    )}
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
                <div className="border-t border-borde bg-hundido px-4 py-3">
                  {c.movimientos.length === 0 ? (
                    <span className="text-xs text-apagado">
                      Sin movimientos: nunca compró a cuenta.
                    </span>
                  ) : (
                    c.movimientos.map((m) => (
                      <div
                        key={m.id}
                        className="grid grid-cols-[5rem_1fr_6rem] items-baseline gap-x-2.5 py-1 text-[0.85rem]"
                      >
                        <span className="text-xs text-apagado">
                          {new Date(m.fecha).toLocaleDateString("es-AR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "2-digit",
                          })}
                        </span>

                        <span className="min-w-0 truncate">
                          {m.tipo === "debe" && <Pastilla tono="mal">Debe</Pastilla>}
                          {m.tipo === "haber" && <Pastilla tono="ok">Paga</Pastilla>}
                          {m.tipo === "nota" && <Pastilla>Ajuste</Pastilla>}
                          <span className="ml-1.5">{m.concepto}</span>
                        </span>

                        <span
                          data-cifra
                          className={cn(
                            "text-right",
                            m.tipo === "debe" ? "text-mal" : m.tipo === "haber" ? "text-ok" : "text-apagado"
                          )}
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
    <Capa onCerrar={onCerrar} titulo="Nuevo cliente">
      <Panel titulo="Nuevo cliente">
        <div className="grid gap-3 p-4">
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

          <div className="text-xs leading-relaxed text-apagado">
            Estos son los clientes de tu comercio, no usuarios de Nexo Studio. No
            entran nunca a este servicio ni tienen contraseña.
          </div>
        </div>

        <BotonFila>
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton tipo="primario" cargando={guardando} disabled={!nombre.trim()} onClick={guardar}>
            Crear
          </Boton>
        </BotonFila>
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
    <Capa onCerrar={onCerrar} titulo={`Cobro de ${cliente.nombre}`}>
      <Panel titulo={`Cobro de ${cliente.nombre}`}>
        <div className="grid gap-3 p-4">
          <div className="flex items-baseline justify-between gap-3 rounded-md bg-panel-2 px-3 py-2.5">
            <span className="text-xs text-apagado">Debe</span>
            <span data-cifra className="font-bold">{dinero(cliente.saldo)}</span>
          </div>

          <Campo etiqueta="Cuánto paga" valor={monto} onChange={setMonto} tipo="number" step={0.01} autoFocus />

          <Campo etiqueta="Concepto" valor={concepto} onChange={setConcepto} />

          <div className="text-xs leading-relaxed text-apagado">
            Esto baja la deuda. El dinero que entra al cajón se anota en
            <strong> Caja</strong>, que es donde se cuenta: si se anotara en los
            dos sitios, el arqueo sumaría el cobro dos veces.
          </div>
        </div>

        <BotonFila>
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton tipo="primario" cargando={guardando} disabled={aCentavos(monto) <= 0} onClick={guardar}>
            Anotar el cobro
          </Boton>
        </BotonFila>
      </Panel>
    </Capa>
  );
}