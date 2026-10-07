"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/ui/datos";
import { dinero, aCentavos } from "@/lib/dinero";
import { cn } from "@/lib/utils";
import { Panel, Boton, Campo, Area, Pastilla, Vacio, color, tipografia, Fila, Cifra, BotonFila } from "@/lib/ui/controles";
import { Capa } from "@/components/productos-form";

/* =========================================================
   /caja
   ---------------------------------------------------------
   Los movimientos del cajón y el arqueo del día.

   ⚠️  SON DOS COSAS QUE PARECEN UNA
   ---------------------------------
   La lista de movimientos es lo que pasó HOY. El arqueo es lo que hay
   en el cajón AHORA, y para eso necesita el saldo con el que se abrió
   el día.

   Por eso el arqueo va arriba, con su número, y los movimientos debajo.

   Confundirlos es el error más fácil de esta pantalla: el dueño mira
   los movimientos, ve que entrou 20.000 y salió 15.000, concluye que
   tiene 5.000, y en el cajón hay 15.000 porque el día empezó con 10.000.
   Lo que está mal no es el sistema: está comparando un número de hoy
   con el dinero del cajón, que incluye ayer.

   Por eso la tarjeta del arqueo dice explícitamente «con lo que se
   abrió hoy» y el total de los movimientos dice «hoy».
   ========================================================= */

type Mov = {
  id: string;
  fecha: string;
  tipo: "ingreso" | "egreso";
  categoria: string;
  monto: number;
  concepto: string;
  deVenta: boolean;
};

const CATEGORIAS: Record<string, string> = {
  venta: "Venta",
  compra: "Pago a proveedor",
  gasto: "Gasto",
  retiro: "Retiro del dueño",
  pago_deuda: "Cobro de una deuda",
  otro: "Otro",
};

export function Caja() {
  const { pedir } = useApi();
  const [datos, setDatos] = useState<any>(null);
  const [movimientos, setMovs] = useState<Mov[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [cerrando, setCerrando] = useState(false);

  function cargar() {
    pedir<any>("/api/caja").then((r) => {
      if (r.ok) {
        setDatos(r.datos);
        setMovs(r.datos.movimientos);
      }
    });
    pedir<any>("/api/arqueo").then((r) => {
      if (r.ok) setDatos((prev: any) => ({ ...(prev || {}), arqueo: r.datos }));
    });
  }

  useEffect(cargar, []);

  const arqueo = datos?.arqueo;
  const [abriendo, setAbriendo] = useState(false);

  return (
    <div className="grid gap-4">
      {/* ── El arqueo ──
          La condición mira `arqueo.arqueo`, NO `arqueo`.

          Son dos cosas distintas y confundirlas rompe la pantalla:
          `arqueo` es la respuesta completa y puede no haber llegado
          todavía; `arqueo.arqueo` es la fila del día, que es `null`
          cuando no hay arqueo abierto.

          Con la condición al revés, una respuesta que llega con
          `cerrado: false` y `arqueo: null` —que es exactamente lo que
          devuelve `/api/arqueo` un día que no se ha abierto— caía en la
          rama de "abierto" y leía `arqueo.arqueo.inicial` sobre null.
          Pantalla en blanco con HTTP 200 y un error de React por encima.

          Un fallo que solo aparece el primer día que se usa, que es
          justo cuando el dueño no sabe qué hacer con la pantalla. */}
      <Panel titulo="Arqueo del día">
        {!arqueo || !arqueo.arqueo ? (
          <div className="grid gap-3 p-4">
            <div className="text-sm leading-relaxed text-apagado">
              Hoy no hay arqueo abierto.
            </div>
            {/* Abrir y cerrar el día van en momentos distintos, y por eso
                son dos pasos. Abrir con el saldo inicial es lo que hace
                que el total del día sirva: sin él, la caja de hoy no
                incluye lo que había de anoche y el número no cuadra con
                lo que se cuenta. */}
            <div>
              <Boton tipo="primario" onClick={() => setAbriendo(true)}>
                Abrir el arqueo de hoy
              </Boton>
            </div>
          </div>
        ) : arqueo.cerrado ? (
          <div className="grid gap-3 p-4">
            <div className="flex flex-wrap gap-6">
              <Cifra etiqueta="Contado" valor={dinero(arqueo.arqueo.real ?? 0)} />
              <Cifra etiqueta="Sistema" valor={dinero(arqueo.arqueo.calculado ?? 0)} />
              <Cifra
                etiqueta="Diferencia"
                valor={dinero(arqueo.arqueo.diferencia ?? 0)}
                tono={
                  (arqueo.arqueo.diferencia ?? 0) === 0
                    ? "ok"
                    : (arqueo.arqueo.diferencia ?? 0) > 0
                      ? "aviso"
                      : "mal"
                }
              />
            </div>

            {(arqueo.arqueo.diferencia ?? 0) === 0 ? (
              <div className="text-sm text-ok">Cuadró. El cajón está bien.</div>
            ) : (
              <div className="text-sm leading-relaxed text-aviso">
                {(arqueo.arqueo.diferencia ?? 0) > 0
                  ? `Sobraron ${dinero(arqueo.arqueo.diferencia!)}. Puede ser cambio que quedó en el cajón, o un cobro anotado de más.`
                  : `Faltaron ${dinero(Math.abs(arqueo.arqueo.diferencia!))}. Un gasto sin anotar es lo primero que hay que mirar.`}
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-3 p-4">
            <div className="flex flex-wrap gap-6">
              <Cifra etiqueta="Se abrió con" valor={dinero(arqueo.arqueo.inicial)} />
              <Cifra etiqueta="Entró" valor={dinero(arqueo.caja.ingresos)} tono="ok" />
              <Cifra etiqueta="Salió" valor={dinero(arqueo.caja.egresos)} tono="mal" />
              <Cifra etiqueta="Debería haber" valor={dinero(arqueo.esperado)} />
            </div>

            <div className="text-xs leading-relaxed text-apagado">
              «Debería haber» es lo que dice el sistema. Contá el cajón y anotá el
              número real: la diferencia la calcula el sistema, no se escribe.
            </div>

            <div>
              <Boton tipo="primario" onClick={() => setCerrando(true)}>
                Cerrar el arqueo
              </Boton>
            </div>
          </div>
        )}
      </Panel>

      {/* ── Los movimientos ── */}
      <Panel
        titulo={`Movimientos de hoy · ${dinero(datos?.saldo || 0)}`}
        accion={<Boton tipo="primario" onClick={() => setNuevo(true)}>Anotar</Boton>}
      >
        <div className="flex flex-wrap gap-6 border-b border-borde px-4 py-3">
          <Cifra etiqueta="Entró" valor={dinero(datos?.ingresos || 0)} tono="ok" />
          <Cifra etiqueta="Salió" valor={dinero(datos?.egresos || 0)} tono="mal" />
          <Cifra etiqueta="Hoy" valor={dinero(datos?.saldo || 0)} />
        </div>

        {movimientos.length === 0 ? (
          <Vacio>Hoy todavía no se movió nada de la caja.</Vacio>
        ) : (
          movimientos.map((m) => (
            <div
              key={m.id}
              className="grid grid-cols-[5.5rem_1fr_6rem] items-baseline gap-x-2.5 border-b border-borde px-4 py-2.5 text-sm transicion last:border-0 hover:bg-panel-2/60"
            >
              <Pastilla tono={m.tipo === "ingreso" ? "ok" : "mal"}>
                {m.tipo === "ingreso" ? "+" : "−"}
              </Pastilla>

              <div className="min-w-0">
                <div className="truncate">{m.concepto}</div>
                <div className="text-xs text-apagado">
                  {CATEGORIAS[m.categoria] || m.categoria}
                  {/* Las ventas en efectivo entran solas: poner un botón de
                      quitar ahí sería tentador, pero quitarlo rompe la
                      correspondencia con la venta. */}
                  {m.deVenta && " · de una venta"}
                </div>
              </div>

              <div
                data-cifra
                className={cn(
                  "text-right font-semibold",
                  m.tipo === "ingreso" ? "text-ok" : "text-mal"
                )}
              >
                {dinero(m.monto)}
              </div>
            </div>
          ))
        )}
      </Panel>

      {nuevo && (
        <FormularioMovimiento
          onCerrar={() => setNuevo(false)}
          onGuardado={() => {
            setNuevo(false);
            cargar();
          }}
        />
      )}

      {cerrando && arqueo?.arqueo && (
        <CerrarArqueo
          esperado={arqueo.esperado}
          onCerrar={() => setCerrando(false)}
          onGuardado={() => {
            setCerrando(false);
            cargar();
          }}
        />
      )}

      {abriendo && (
        <AbrirArqueo
          onCerrar={() => setAbriendo(false)}
          onGuardado={() => {
            setAbriendo(false);
            cargar();
          }}
        />
      )}
    </div>
  );
}

/* =========================================================
   Abrir el día
   ---------------------------------------------------------
   Un solo campo: cuánto hay en el cajón ahora.

   Y es el número que hace que todo lo demás tenga sentido. El total de
   "hoy" que muestra la lista de movimientos NO incluye este dinero: es
   lo que se movió hoy. El saldo real del cajón es este número más lo
   que entró menos lo que salió.

   Confundir los dos es el error más fácil de esta pantalla, y por eso
   el campo dice «con cuánto se abre el cajón» y no «saldo inicial».
   ========================================================= */
function AbrirArqueo({
  onCerrar,
  onGuardado,
}: {
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const { pedir } = useApi();
  const [saldo, setSaldo] = useState("");
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function abrir() {
    setGuardando(true);
    const r = await pedir("/api/arqueo", {
      method: "POST",
      body: JSON.stringify({ saldoInicial: saldo, notas }),
    });
    setGuardando(false);
    if (r.ok) onGuardado();
  }

  return (
    <Capa onCerrar={onCerrar} titulo="Abrir el arqueo de hoy">
      <Panel titulo="Abrir el arqueo de hoy">
        <div className="grid gap-3 p-4">
          <Campo
            etiqueta="¿Cuánto hay en el cajón ahora?"
            valor={saldo}
            onChange={setSaldo}
            tipo="number"
            step={0.01}
            autoFocus
          />

          <div className="text-xs leading-relaxed text-apagado">
            Contá el cajón y poné el número. Es el punto de partida del día: sin
            él, el total de los movimientos no se puede comparar con lo que hay
            adentro.
          </div>

          <Area etiqueta="Notas" valor={notas} onChange={setNotas} filas={2} />
        </div>

        <BotonFila>
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton tipo="primario" cargando={guardando} disabled={!saldo.trim()} onClick={abrir}>
            Abrir
          </Boton>
        </BotonFila>
      </Panel>
    </Capa>
  );
}

/* =========================================================
   Anotar un movimiento
   ---------------------------------------------------------
   Solo se anota lo que NO viene de una venta.

   El formulario no tiene categoría «venta», y no es un olvido: esa
   entrada la pone el trigger cuando se cobra en efectivo. Si se
   permitiera anotar una venta a mano, el cajón sumaría dos veces y el
   arqueo no cerraría nunca.
   ========================================================= */
function FormularioMovimiento({
  onCerrar,
  onGuardado,
}: {
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const { pedir } = useApi();
  const [tipo, setTipo] = useState<"egreso" | "ingreso">("egreso");
  const [categoria, setCategoria] = useState("gasto");
  const [monto, setMonto] = useState("");
  const [concepto, setConcepto] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    const r = await pedir("/api/caja", {
      method: "POST",
      body: JSON.stringify({
        tipo,
        categoria,
        /* Se manda en pesos y lo pasa a centavos el servidor. */
        monto: aCentavos(monto || 0),
        concepto,
      }),
    });
    setGuardando(false);
    if (r.ok) onGuardado();
  }

  return (
    <Capa onCerrar={onCerrar} titulo="Anotar movimiento de caja">
      <Panel titulo="Anotar movimiento de caja">
        <div className="grid gap-3 p-4">
          <Fila cols={2}>
            <label className="block">
              <span className="mb-1.5 block text-[0.7rem] font-bold tracking-[0.08em] text-apagado uppercase">
                Entra o sale
              </span>
              <select
                value={tipo}
                onChange={(e) => {
                  const t = e.target.value as "egreso" | "ingreso";
                  setTipo(t);
                  setCategoria(t === "egreso" ? "gasto" : "pago_deuda");
                }}
                className="w-full min-h-[2.6rem] rounded-md border border-borde bg-hundido px-3 text-texto transicion focus-visible:border-acento focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-acento"
              >
                <option value="egreso">Sale</option>
                <option value="ingreso">Entra</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[0.7rem] font-bold tracking-[0.08em] text-apagado uppercase">
                Motivo
              </span>
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className="w-full min-h-[2.6rem] rounded-md border border-borde bg-hundido px-3 text-texto transicion focus-visible:border-acento focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-acento"
              >
                {tipo === "egreso" ? (
                  <>
                    <option value="gasto">Gasto</option>
                    <option value="retiro">Retiro del dueño</option>
                    <option value="compra">Pago a proveedor</option>
                    <option value="otro">Otro</option>
                  </>
                ) : (
                  <>
                    <option value="pago_deuda">Cobro de una deuda</option>
                    <option value="otro">Otro</option>
                  </>
                )}
              </select>
            </label>
          </Fila>

          <Campo etiqueta="Monto $" valor={monto} onChange={setMonto} tipo="number" step={0.01} autoFocus />

          <Area
            etiqueta="De qué es (obligatorio)"
            valor={concepto}
            onChange={setConcepto}
            placeholder="Factura de luz de este mes"
            filas={2}
          />

          <div className="text-xs leading-relaxed text-apagado">
            Las ventas en efectivo entran solas. Acá van los gastos, los retiros
            y los pagos a proveedor.
          </div>
        </div>

        <BotonFila>
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton
            tipo="primario"
            cargando={guardando}
            disabled={!concepto.trim() || aCentavos(monto) <= 0}
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
   Cerrar el arqueo
   ---------------------------------------------------------
   Se pide el número contado y NADA más. No hay campo para la
   diferencia, ni para el saldo calculado, ni para "cerrado": todo eso
   lo pone la base.

   Y el número esperado se muestra justo encima, para que el dueño pueda
   contar y comparar sin tener que acordarse. La diferencia es
   información, no un dato que se escriba.
   ========================================================= */
function CerrarArqueo({
  esperado,
  onCerrar,
  onGuardado,
}: {
  esperado: number;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const { pedir } = useApi();
  const [real, setReal] = useState("");
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function cerrar() {
    setGuardando(true);
    const r = await pedir("/api/arqueo", {
      method: "PATCH",
      body: JSON.stringify({ real, notas }),
    });
    setGuardando(false);
    if (r.ok) onGuardado();
  }

  return (
    <Capa onCerrar={onCerrar} titulo="Cerrar el arqueo">
      <Panel titulo="Cerrar el arqueo">
        <div className="grid gap-3 p-4">
          <div className="flex items-baseline justify-between gap-3 rounded-md bg-panel-2 px-3 py-2.5">
            <span className="text-xs text-apagado">El sistema dice</span>
            <span data-cifra className="font-bold">{dinero(esperado)}</span>
          </div>

          <Campo
            etiqueta="Cuánto contaste"
            valor={real}
            onChange={setReal}
            tipo="number"
            step={0.01}
            autoFocus
          />

          <Area etiqueta="Notas (si no cuadra, escribí qué creés que pasó)" valor={notas} onChange={setNotas} filas={2} />

          <div className="text-xs leading-relaxed text-apagado">
            La diferencia la calcula el sistema. No se escribe a mano, porque un
            arqueo donde el dueño pone la diferencia no sirve para detectar que
            faltaba.
          </div>
        </div>

        <BotonFila>
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton tipo="primario" cargando={guardando} disabled={!real.trim()} onClick={cerrar}>
            Cerrar y ver la diferencia
          </Boton>
        </BotonFila>
      </Panel>
    </Capa>
  );
}