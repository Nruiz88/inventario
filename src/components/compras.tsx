"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/ui/datos";
import { dinero, aCentavos } from "@/lib/dinero";
import { cn } from "@/lib/utils";
import { Panel, Boton, Campo, Area, Pastilla, Vacio, Fila, BotonFila } from "@/lib/ui/controles";
import { Capa } from "@/components/productos-form";

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
    <div className="grid gap-4">
      {pendientes.length > 0 && (
        <div className="rounded-md border border-aviso/40 bg-aviso/10 px-4 py-3 text-sm text-aviso">
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
              className={cn(
                "border-b border-borde px-4 py-3.5 transicion last:border-0",
                c.estado === "anulada" && "opacity-55"
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-semibold">{c.proveedor || "Sin proveedor"}</span>
                  <span className="text-xs text-apagado">{c.facturaNro || "sin factura"}</span>
                  {c.estado === "borrador" && <Pastilla tono="aviso">Sin recibir</Pastilla>}
                  {c.estado === "recibida" && <Pastilla tono="ok">Recibida</Pastilla>}
                  {c.estado === "anulada" && <Pastilla tono="mal">Anulada</Pastilla>}
                </div>
                <span data-cifra className="font-bold">{dinero(c.total)}</span>
              </div>

              <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-apagado">
                {c.lineas.map((l, i) => (
                  <span key={i}>
                    {l.cantidad}× {l.nombre}
                  </span>
                ))}
              </div>

              {c.notas && <div className="mt-1 text-xs text-apagado">{c.notas}</div>}

              {c.estado !== "anulada" && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
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
    <Capa onCerrar={onCerrar} titulo="Anotar pedido">
      <Panel titulo="Anotar pedido">
        <div className="grid gap-3 p-4">
          <Campo
            etiqueta="Buscar producto"
            valor={busqueda}
            onChange={setBusqueda}
            placeholder="Escribe para agregar al pedido"
          />

          {encontrados.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
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
                  className="grid grid-cols-[1fr_5rem_6rem_6rem_auto] items-end gap-1.5 py-1"
                >
                  <span className="self-center text-sm">{l.nombre}</span>
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
                  <span data-cifra className="self-center text-right text-sm">
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
            <div className="flex items-end justify-end">
              <div className="text-right">
                <div className="text-xs text-apagado">Total</div>
                <div data-cifra className="text-[1.9rem] leading-tight font-bold text-acento">
                  {dinero(total)}
                </div>
              </div>
            </div>
          </Fila>

          <Area etiqueta="Notas" valor={notas} onChange={setNotas} filas={2} />

          <div className="text-xs leading-relaxed text-apagado">
            Anotar el pedido <strong>no</strong> mueve el stock. Entra cuando lo
            marques como recibido, así una compra anotada y olvidada no descuenta
            mercadería que nunca llegó.
          </div>
        </div>

        <BotonFila>
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton
            tipo="primario"
            cargando={guardando}
            disabled={!lineas.some((l) => Number(l.cantidad) > 0)}
            onClick={guardar}
          >
            Anotar pedido
          </Boton>
        </BotonFila>
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
    <Capa onCerrar={onCerrar} titulo={`Anular compra de ${dinero(compra.total)}`}>
      <Panel titulo={`Anular compra de ${dinero(compra.total)}`}>
        <div className="grid gap-3 p-4 text-sm leading-relaxed">
          {compra.estado === "recibida" && (
            <div className="rounded-md bg-mal/12 px-3 py-2.5 text-sm text-mal">
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

        <BotonFila>
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton tipo="peligro" cargando={guardando} disabled={!motivo.trim()} onClick={confirmar}>
            Anular
          </Boton>
        </BotonFila>
      </Panel>
    </Capa>
  );
}