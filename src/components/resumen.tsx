"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Package, Wallet, Receipt, HandCoins } from "lucide-react";
import { useApi } from "@/lib/ui/datos";
import { dinero } from "@/lib/dinero";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardEyebrow, CardAction, CardBody } from "@/components/ui/card";
import { Pastilla, textoStock } from "@/components/ui/badge";
import { Boton } from "@/components/ui/button";
import { Vacio } from "@/components/ui/vacio";
import { Barra30 } from "@/components/barra30";

/* =========================================================
   El resumen
   ---------------------------------------------------------
   Las preguntas de un mostrador, en el orden en que se hacen:

     1. ¿cuánto vendí hoy?
     2. ¿cuánto dinero tengo parado en el depósito?
     3. ¿qué falta cobrar?
     4. ¿qué se está acabando?
     5. ¿qué está pasando este mes?

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

   ── LA CIFRA QUE FALTABA ──

   "Valor del stock" no estaba en ninguna pantalla. Es la primera
   pregunta de un almacén y la única que no tiene respuesta aquí: se
   veía el precio de venta y el coste de cada producto en el listado,
   pero no el total. Sin ese total no hay forma de saber si el negocio
   está sano: se puede estar vendiendo bien con el depósito lleno de
   mercadería que no se mueve, y el banco dice que no hay nada.

   Va con el margen que lleva ese depósito, que es lo mismo visto como
   rentabilidad: con un 36 %, $463 de coste son $722 de venta futura.
   ========================================================= */

type Datos = {
  hoy: string;
  stock: {
    total: number;
    bajo: number;
    enCero: number;
    valorCosto: number;
    valorVenta: number;
    margenStock: number;
    sinCoste: number;
    lista: {
      id: string;
      nombre: string;
      variante: string;
      stock: number;
      minimo: number;
      faltan: number;
    }[];
  };
  hoy_: { facturado: number; ventas: number; caja: number; saldoCaja: number | null };
  treintaDias: { total: number; promedio: number; porDia: { fecha: string; total: number }[] };
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

  const totalFaltan = d.stock.lista.reduce((s, v) => s + v.faltan, 0);

  return (
    <div className="grid gap-4">
      {/* ── Los cuatro números ──
          Igual de grandes y en el mismo orden todos los días. Si uno
          creciera "porque hoy es importante", el ojo deja de compararlos
          y deja de servirlos para comparar. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra
          icono={<Wallet className="size-4" aria-hidden />}
          etiqueta="Vendido hoy"
          valor={dinero(d.hoy_.facturado)}
          pie={`${d.hoy_.ventas} ${d.hoy_.ventas === 1 ? "venta" : "ventas"}`}
        />

        <Cifra
          icono={<Package className="size-4" aria-hidden />}
          etiqueta="Valor del stock"
          valor={dinero(d.stock.valorCosto)}
          pie={
            d.stock.valorCosto > 0
              ? `al coste · margen ${Math.round(d.stock.margenStock * 100)} %`
              : "sin stock cargado"
          }
        />

        <Cifra
          icono={<Receipt className="size-4" aria-hidden />}
          etiqueta="Sin facturar"
          valor={String(d.facturacion.pendientes)}
          pie={d.facturacion.pendientes > 0 ? dinero(d.facturacion.monto) : "todo cobrado"}
          tono={d.facturacion.pendientes > 0 ? "aviso" : undefined}
        />

        <Cifra
          icono={<HandCoins className="size-4" aria-hidden />}
          etiqueta="Me deben"
          valor={dinero(d.deuda)}
          tono={d.deuda > 0 ? "aviso" : undefined}
        />
      </div>

      {/* ── El cajón ──
          Va solo, y no como uno más de la fila, porque a veces no hay
          número: si no se abrió el arqueo, el dinero que hay en el cajón
          es una cuenta pendiente. Poner un hueco donde debería haber una
          cifra es peor que poner un texto que dice qué hacer. */}
      {d.hoy_.saldoCaja === null ? (
        <Card className="border-aviso/40">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-sm text-apagado">
              No se abrió el arqueo de hoy, así que no se sabe cuánto hay en el cajón.
            </p>
            <Boton como={Link} href="/caja" variante="secundario" tamano="chico">
              Abrir arqueo
              <ArrowRight className="size-3.5" aria-hidden />
            </Boton>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
            <span className="text-[0.7rem] font-bold tracking-[0.08em] uppercase text-apagado">
              En el cajón
            </span>
            <span
              data-cifra
              className={cn(
                "text-xl font-bold",
                d.hoy_.saldoCaja < 0 ? "text-mal" : "text-texto"
              )}
            >
              {dinero(d.hoy_.saldoCaja)}
            </span>
          </div>
        </Card>
      )}

      {/* ── Lo que se está acabando ──
          Va PRIMERO porque es lo que el dueño viene a mirar. Y dentro,
          los que están en cero van antes que los que están en dos: uno
          se repone en dos días y el otro se acaba hoy. */}
      <Card>
        <CardHeader>
          <div>
            <CardEyebrow>Reponer</CardEyebrow>
            <CardTitle>Stock bajo</CardTitle>
          </div>
          <CardAction>
            <span className="text-sm text-apagado">
              {d.stock.bajo} de {d.stock.total}
              {totalFaltan > 0 && ` · faltan ${totalFaltan} unidades`}
            </span>
            <Boton como={Link} href="/productos" variante="fantasma" tamano="chico">
              Ver productos
              <ArrowRight className="size-3.5" aria-hidden />
            </Boton>
          </CardAction>
        </CardHeader>

        {d.stock.lista.length === 0 ? (
          <Vacio>Nada por debajo del mínimo.</Vacio>
        ) : (
          <ul>
            {d.stock.lista.map((v) => {
              const estado = textoStock(v.stock, v.minimo);
              return (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-borde px-4 py-2.5 last:border-0"
                >
                  <span className="min-w-0 truncate">
                    {v.nombre}
                    {v.variante && <span className="text-apagado"> · {v.variante}</span>}
                  </span>

                  <span className="flex items-center gap-3">
                    {/* El mínimo, pequeño y apagado. Está para saber por
                        qué salta el aviso, no para leerse. */}
                    <span className="hidden text-xs text-apagado sm:inline">
                      mín. {v.minimo}
                    </span>

                    <span data-cifra className="w-10 text-right text-sm text-claro">
                      {v.stock}
                    </span>

                    <Pastilla tono={estado.tono}>{estado.texto}</Pastilla>

                    {/* "Faltan" es lo que va escrito en el pedido. Es la
                        cifra que el dueño usa, y la que no estaba: antes
                        había que restar el stock del mínimo a ojo. */}
                    {v.faltan > 0 && (
                      <span
                        data-cifra
                        className="w-24 text-right text-sm font-bold text-texto"
                      >
                        pedir {v.faltan}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ── El mes y las últimas ventas ──
          Siete y cinco. La de las ventas es la más larga porque es una
          lista, y la del mes es un gráfico cuadrado: ponerlos a media
          medida deja a los dos con espacio de sobra y con las filas
          apretadas. */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <div>
              <CardEyebrow>Hoy</CardEyebrow>
              <CardTitle>Últimas ventas</CardTitle>
            </div>
            <CardAction>
              <Boton como={Link} href="/ventas" variante="fantasma" tamano="chico">
                Ver todas
                <ArrowRight className="size-3.5" aria-hidden />
              </Boton>
            </CardAction>
          </CardHeader>

          {d.ultimasVentas.length === 0 ? (
            <Vacio>Todavía no hay ventas.</Vacio>
          ) : (
            <ul>
              {d.ultimasVentas.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-borde px-4 py-2.5 last:border-0"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{v.cliente || "Mostrador"}</span>
                    {!v.facturada && <Pastilla tono="aviso">Sin factura</Pastilla>}
                  </span>

                  <span className="flex items-baseline gap-3">
                    <span data-cifra className="font-semibold">
                      {dinero(v.total)}
                    </span>
                    <span className="text-xs text-apagado">
                      {v.metodo.replace("_", " ")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardEyebrow>30 días</CardEyebrow>
              <CardTitle>Cómo va el mes</CardTitle>
            </div>
          </CardHeader>

          <CardBody>
            <div className="flex items-baseline justify-between gap-3">
              <span data-cifra className="text-2xl font-bold">
                {dinero(d.treintaDias.total)}
              </span>
              <span className="text-xs text-apagado">
                {dinero(d.treintaDias.promedio)} por día
              </span>
            </div>

            <Barra30 datos={d.treintaDias.porDia} />

            <p className="mt-3 text-xs text-apagado">
              Los treinta días, con los que no hubo venta a cero. Un hueco
              parecería que se vendió más.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/* =========================================================
   La cifra con su icono
   ---------------------------------------------------------
   El icono va arriba y a la izquierda, al lado de la etiqueta, y no
   detrás de la cifra. Con la cifra a 1.9rem, un icono al lado empuja
   la caja y descuadra la fila de cuatro: las cuatro cajas tienen que
   medir igual para que el ojo las lea como una fila.
   ========================================================= */
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
  const color =
    tono === "mal" ? "text-mal" : tono === "aviso" ? "text-aviso" : "text-texto";

  return (
    <Card>
      <CardBody className="p-4">
        <div className="mb-1.5 flex items-center gap-1.5 text-apagado">
          <span aria-hidden>{icono}</span>
          <span className="truncate text-[0.7rem] font-bold tracking-[0.08em] uppercase">
            {etiqueta}
          </span>
        </div>

        {/* `data-cifra` y no una clase: la regla que pone las cifras
            fijas está en la hoja, aplicada a lo que se cuenta, y un
            `<span>` sin ese atributo no la recibe. */}
        <div data-cifra className={cn("text-[1.6rem] leading-tight font-bold", color)}>
          {valor}
        </div>

        {pie && <div className="mt-1 text-xs text-apagado">{pie}</div>}
      </CardBody>
    </Card>
  );
}