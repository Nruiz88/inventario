"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useApi } from "@/lib/ui/datos";
import { dinero } from "@/lib/dinero";
import { Panel, Cifra, Pastilla, Vacio, color, tipografia } from "@/lib/ui/controles";

/* =========================================================
   El resumen
   ---------------------------------------------------------
   Las cuatro preguntas de un mostrador, en este orden:

     1. ¿qué se está acabando?
     2. ¿cuánto vendí hoy?
     3. ¿qué falta facturar?
     4. ¿cuánto deben los clientes?

   ⚠️  POR QUÉ SE PIDE DESDE EL NAVEGADOR Y NO DESDE EL SERVIDOR
   -------------------------------------------------------------
   El `/api/resumen` hace cinco consultas con RLS. Podría correr en el
   servidor y mandar el HTML hecho, y sería más rápido.

   Se pide desde el navegador para que el resumen funcione IGUAL que el
   resto del dashboard: todas las pantallas leen por `fetch` y todas
   manejan el 401 y el 402 en el mismo sitio. Con datos de servidor,
   esta pantalla tendría su propio camino para tratar la sesión
   caducada, y ese camino no lo ejecuta ninguna prueba porque es el
   único que no pasa por el proveedor.

   El precio es un viaje de ida y vuelta al entrar. A cambio, el 401 lo
   ve el proveedor, que manda al login en el sitio correcto, y no una
   función que alguien tendrá que recordar.
   ========================================================= */

type Datos = {
  hoy: string;
  stock: {
    total: number;
    bajo: number;
    enCero: number;
    lista: { id: string; nombre: string; variante: string; stock: number; minimo: number }[];
  };
  hoy_: { facturado: number; ventas: number; caja: number; saldoCaja: number | null };
  treintaDias: { total: number; promedio: number };
  facturacion: { pendientes: number; monto: number };
  deuda: number;
  ultimasVentas: {
    id: string;
    total: number;
    metodo: string;
    facturada: boolean;
    cliente: string | null;
  }[];
};

export function Resumen() {
  const { pedir } = useApi();
  const [d, setD] = useState<Datos | null>(null);

  useEffect(() => {
    pedir<Datos>("/api/resumen").then((r) => {
      if (r.ok) setD(r.datos);
    });
    /* Sin dependencias a propósito: se pide UNA vez al entrar.
       Con `[pedir]` en la lista, cada render vuelve a pedir, y como
       `setD` provoca un render, es un bucle que tumba la API en un
       mostrador abierto toda la tarde. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!d) return <Vacio>Cargando…</Vacio>;

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {/* ── Los números ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(11rem, 1fr))",
          gap: ".75rem",
        }}
      >
        <Panel>
          <div style={{ padding: "1rem" }}>
            <Cifra valor={dinero(d.hoy_.facturado)} etiqueta="Vendido hoy" />
            <div style={{ ...tipografia.chico, color: color.apagado, marginTop: ".3rem" }}>
              {d.hoy_.ventas} {d.hoy_.ventas === 1 ? "venta" : "ventas"}
            </div>
          </div>
        </Panel>

        <Panel>
          <div style={{ padding: "1rem" }}>
            {/* Con arqueo abierto se muestra lo que HAY. Sin él, no se
                inventa un número: se dice que hay que abrir el arqueo, que
                es lo que hay que hacer. */}
            {d.hoy_.saldoCaja === null ? (
              <div>
                <div style={{ ...tipografia.chico, color: color.apagado, marginBottom: ".2rem" }}>
                  En el cajón
                </div>
                <div style={{ ...tipografia.chico, color: color.aviso, lineHeight: 1.5 }}>
                  Abrí el arqueo del día para saber cuánto hay.
                </div>
              </div>
            ) : (
              <Cifra
                valor={dinero(d.hoy_.saldoCaja)}
                etiqueta="En el cajón"
                tono={d.hoy_.saldoCaja < 0 ? "mal" : undefined}
              />
            )}
          </div>
        </Panel>

        <Panel>
          <div style={{ padding: "1rem" }}>
            <Cifra
              valor={d.facturacion.pendientes}
              etiqueta="Sin facturar"
              tono={d.facturacion.pendientes > 0 ? "aviso" : "ok"}
            />
            {d.facturacion.pendientes > 0 && (
              <div style={{ ...tipografia.chico, color: color.apagado, marginTop: ".3rem" }}>
                {dinero(d.facturacion.monto)}
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <div style={{ padding: "1rem" }}>
            <Cifra valor={dinero(d.deuda)} etiqueta="Me deben" tono={d.deuda > 0 ? "aviso" : undefined} />
          </div>
        </Panel>
      </div>

      {/* ── Lo que se está acabando ──
          Va PRIMERO porque es lo que el dueño viene a mirar. Y dentro,
          los que están en cero van antes que los que están en dos: uno
          se repone en dos días y el otro se acaba hoy. */}
      <Panel
        titulo={`Stock bajo · ${d.stock.bajo} de ${d.stock.total}`}
        accion={
          <Link href="/productos" style={{ fontSize: ".85rem", color: color.acento, textDecoration: "none" }}>
            Ver productos
          </Link>
        }
      >
        {d.stock.lista.length === 0 ? (
          <Vacio>Nada por debajo del mínimo.</Vacio>
        ) : (
          <div>
            {d.stock.enCero > 0 && (
              <div
                style={{
                  padding: ".6rem 1rem",
                  background: "#2a1a1d",
                  borderBottom: `1px solid ${color.borde}`,
                  fontSize: ".85rem",
                  color: color.mal,
                }}
              >
                {d.stock.enCero} sin existencias: {d.stock.enCero === 1 ? "se acaba" : "se acaban"} hoy.
              </div>
            )}
            <Tabla
              filas={d.stock.lista.map((v) => ({
                id: v.id,
                a: v.nombre + (v.variante ? ` · ${v.variante}` : ""),
                b:
                  v.stock === 0 ? (
                    <Pastilla tono="mal">Agotado</Pastilla>
                  ) : (
                    <span style={{ color: color.claro }}>{v.stock}</span>
                  ),
                c: <span style={{ color: color.apagado }}>mín. {v.minimo}</span>,
              }))}
            />
          </div>
        )}
      </Panel>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(19rem, 1fr))",
          gap: "1rem",
        }}
      >
        <Panel
          titulo="Últimas ventas"
          accion={
            <Link href="/ventas" style={{ fontSize: ".85rem", color: color.acento, textDecoration: "none" }}>
              Ver todas
            </Link>
          }
        >
          {d.ultimasVentas.length === 0 ? (
            <Vacio>Todavía no hay ventas.</Vacio>
          ) : (
            <Tabla
              filas={d.ultimasVentas.map((v) => ({
                id: v.id,
                a: (
                  <span>
                    {v.cliente || "Mostrador"}
                    {!v.facturada && (
                      <span style={{ marginLeft: ".4rem" }}>
                        <Pastilla tono="aviso">Sin factura</Pastilla>
                      </span>
                    )}
                  </span>
                ),
                b: <span style={{ fontVariantNumeric: "tabular-nums" }}>{dinero(v.total)}</span>,
                c: (
                  <span style={{ color: color.apagado, fontSize: ".8rem" }}>
                    {v.metodo.replace("_", " ")}
                  </span>
                ),
              }))}
            />
          )}
        </Panel>

        {/* El promedio diario es lo que el dueño compara con "el mes
            pasado", que es su pregunta de verdad. El total del mes no
            sirve para eso hasta que se acaba. */}
        <Panel titulo="Últimos 30 días">
          <div style={{ padding: "1rem" }}>
            <Cifra valor={dinero(d.treintaDias.total)} etiqueta="Total" />
            <div style={{ height: "1rem" }} />
            <Cifra valor={dinero(d.treintaDias.promedio)} etiqueta="Por día" />
          </div>
        </Panel>
      </div>
    </div>
  );
}

/**
 * Tabla mínima, sin cabeceras.
 *
 * En un panel de cuatro filas se sabe qué es cada columna por el
 * contenido. Un `<thead>` ahí es ruido, y en un móvil ocupa un ancho
 * que hace falta para los números.
 */
function Tabla({
  filas,
}: {
  filas: { id: string; a: ReactNode; b: ReactNode; c: ReactNode }[];
}) {
  return (
    <div>
      {filas.map((f) => (
        <div
          key={f.id}
          style={{
            display: "grid",
            /* La tercera columna es la del método de pago, y con 5.5rem
               "cuenta corriente" se partía en dos líneas y empujaba el
               precio. Con "auto" y un mínimo, el ancho lo decide el
               contenido: "efectivo" ocupa poco y "cuenta corriente"
               ocupa lo que necesita. */
            gridTemplateColumns: "minmax(0, 1fr) auto minmax(4.5rem, auto)",
            gap: ".75rem",
            alignItems: "baseline",
            padding: ".6rem 1rem",
            borderBottom: `1px solid ${color.borde}`,
            fontSize: ".875rem",
          }}
        >
          <div
            style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {f.a}
          </div>
          <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{f.b}</div>
          <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>{f.c}</div>
        </div>
      ))}
    </div>
  );
}