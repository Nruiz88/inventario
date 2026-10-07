import { cn } from "@/lib/utils";

/* =========================================================
   Los controles
   ---------------------------------------------------------
   La piel de caja, cuentas, compras y ventas. La API no cambia:
   mismos nombres, mismas props, mismos valores — solo cambia cómo se
   pintan, para que las cuatro pantallas hablen el mismo idioma visual
   que resumen y productos (Tailwind + los tokens de `globals.css`).

   ── POR QUÉ ESTÁN AQUÍ Y NO EN `components/ui` ──

   Estos controles reciben `valor`/`onChange` de React (un string y un
   setter), mientras que los de `components/ui` son los estándares de
   shadcn (`value`/`onChange` del evento). Cambiar la firma sería
   cambiar la lógica de cuatro pantallas a la vez, y este rediseño es
   de piel: el objetivo es que se vean iguales sin tocar una sola
   llamada a la API.

   Los valores salen de los tokens de la hoja, no de números escritos
   en cada pantalla: el mismo rojo de error en cuatro sitios son cuatro
   sitios que se desincronizan cuando alguien decide que el error es
   naranja. Para eso está `cn`: junta las clases y deja que el token
   mande.
   ========================================================= */

export const color = {
  fondo: "#0b0f14",
  panel: "#111820",
  panel2: "#161f2a",
  borde: "#243040",
  texto: "#e6edf3",
  apagado: "#8b9bb0",
  claro: "#c9d5e2",
  acento: "#4da3ff",
  ok: "#3fb950",
  mal: "#f0616d",
  aviso: "#d29922",
};

export const radio = { sm: ".4rem", md: ".6rem", lg: ".9rem" };

/* Una pantalla pensada para un mostrador
 * ------------------------------------
 * Se usa mucho en un kiosco, con una mano ocupada y con luz de fluorescente
 * a media tarde. De ahí tres cosas que no son estéticas:
 *
 *   · los números de stock van en `tabular-nums`: con cifras de ancho
 *     variable, el 1 se ve más pequeño que el 8 y contar "11" contra
 *     "8" a ojo es un error esperando.
 *
 *   · los targets son grandes. Un botón de 28px de alto falla con el
 *     dedo, y falla cuando estás apurado, que es cuando más se usa.
 *
 *   · el contraste está por encima de 4.5:1 en el texto pequeño. Con la
 *     pantalla sucia y a contraluz, el gris apagado no se lee.
 */
export const tipografia = {
  chico: { fontSize: ".78rem", lineHeight: 1.4 },
  normal: { fontSize: ".9rem", lineHeight: 1.5 },
  grande: { fontSize: "1.05rem", lineHeight: 1.4 },
  cifra: {
    fontSize: "1.9rem",
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums" as const,
    lineHeight: 1.1,
  },
  cifraChica: { fontSize: "1.25rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" as const },
};

/** Un panel: la caja de todo lo que hay en pantalla. */
export function Panel({
  children,
  titulo,
  accion,
}: {
  children: React.ReactNode;
  titulo?: string;
  accion?: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-borde bg-panel text-texto">
      {(titulo || accion) && (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-borde px-5 py-3.5">
          {titulo && (
            <h2 className="text-base font-semibold leading-tight text-texto">{titulo}</h2>
          )}
          {accion}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * Botón.
 *
 * El `disabled` con `cargando` es un detalle que se olvida: sin él, el
 * dueño puede pulsar "Cobrar" cuatro veces antes de que llegue la
 * respuesta, y se anota cuatro veces. En un mostrador es fácil: la
 * pantalla tarda y la mano vuelve a pulsar.
 */
export function Boton({
  children,
  onClick,
  tipo = "normal",
  tamano = "normal",
  disabled,
  cargando,
  ancho,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tipo?: "normal" | "primario" | "peligro" | "fantasma";
  tamano?: "normal" | "chico";
  disabled?: boolean;
  cargando?: boolean;
  ancho?: boolean;
  title?: string;
}) {
  const tonos: Record<string, string> = {
    normal: "bg-panel-2 text-texto border-borde hover:border-borde-fuerte",
    primario: "bg-acento text-acento-oscuro border-transparent hover:brightness-110 active:brightness-95",
    peligro: "bg-[#3a1a1e] text-mal border-[#6b2b32] hover:bg-[#4a2028] hover:border-mal",
    fantasma: "bg-transparent text-apagado border-transparent hover:bg-panel-2 hover:text-texto",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || cargando}
      title={title}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md border font-semibold whitespace-nowrap transicion",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-55",
        tamano === "chico" ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm",
        ancho && "w-full",
        (disabled || cargando) && "cursor-wait",
        tonos[tipo]
      )}
    >
      {cargando && (
        <span
          aria-hidden
          className="size-3.5 shrink-0 rounded-full border-2 border-current border-t-transparent"
          style={{ animation: "giro 700ms linear infinite" }}
        />
      )}
      {cargando ? <span>{children}</span> : children}
    </button>
  );
}

/** Campo de texto. El `inputMode` va en el tipo, no en el `input`. */
export function Campo({
  etiqueta,
  valor,
  onChange,
  tipo = "text",
  placeholder,
  autoFocus,
  disabled,
  min,
  step,
  ancho,
}: {
  etiqueta?: string;
  valor: string;
  onChange: (v: string) => void;
  tipo?: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  min?: number;
  step?: number;
  ancho?: boolean;
}) {
  const entrada = (
    <input
      type={tipo}
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
      min={min}
      step={step}
      inputMode={tipo === "number" ? "decimal" : undefined}
      className={cn(
        "w-full rounded-md border border-borde bg-hundido px-3 py-2.5 text-texto transicion",
        "placeholder:text-apagado/60",
        "focus-visible:border-acento focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-acento",
        "disabled:opacity-50",
        ancho && "w-full"
      )}
    />
  );

  if (!etiqueta) return <div className={ancho ? "w-full" : undefined}>{entrada}</div>;

  return (
    <label className="block w-full">
      <span className="mb-1.5 block text-[0.7rem] font-bold tracking-[0.08em] text-apagado uppercase">
        {etiqueta}
      </span>
      {entrada}
    </label>
  );
}

/** Una casilla. */
export function Area({
  etiqueta,
  valor,
  onChange,
  placeholder,
  filas = 2,
}: {
  etiqueta?: string;
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
  filas?: number;
}) {
  return (
    <label className="block w-full">
      {etiqueta && (
        <span className="mb-1.5 block text-[0.7rem] font-bold tracking-[0.08em] text-apagado uppercase">
          {etiqueta}
        </span>
      )}
      <textarea
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={filas}
        className={cn(
          "w-full resize-y rounded-md border border-borde bg-hundido px-3 py-2.5 text-texto transicion",
          "placeholder:text-apagado/60",
          "focus-visible:border-acento focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-acento"
        )}
      />
    </label>
  );
}

export function BotonFila({
  children,
  onClick,
  tipo = "fantasma",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tipo?: "normal" | "primario" | "peligro" | "fantasma";
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t border-borde px-5 py-3.5">
      {children}
    </div>
  );
}

/** Una etiqueta que explica un estado: "no hay", "se está acabando". */
export function Pastilla({
  children,
  tono = "neutro",
}: {
  children: React.ReactNode;
  tono?: "neutro" | "ok" | "mal" | "aviso";
}) {
  const tonos: Record<string, string> = {
    neutro: "border-borde-fuerte bg-panel-2 text-apagado",
    ok: "border-ok/40 bg-ok/12 text-ok",
    mal: "border-mal/45 bg-mal/12 text-mal",
    aviso: "border-aviso/40 bg-aviso/12 text-aviso",
  };

  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.7rem] font-bold tracking-wide uppercase",
        tonos[tono]
      )}
    >
      {children}
    </span>
  );
}

/** Cifra grande. Con tabular-nums para que los dígitos no bailen. */
export function Cifra({
  valor,
  etiqueta,
  tono,
}: {
  valor: React.ReactNode;
  etiqueta?: string;
  tono?: "ok" | "mal" | "aviso";
}) {
  const colorClase =
    tono === "ok" ? "text-ok" : tono === "mal" ? "text-mal" : tono === "aviso" ? "text-aviso" : "text-texto";

  return (
    <div>
      {etiqueta && (
        <div className="mb-1 text-[0.7rem] font-bold tracking-[0.08em] text-apagado uppercase">
          {etiqueta}
        </div>
      )}
      <div data-cifra className={cn("text-[1.9rem] leading-tight font-bold", colorClase)}>
        {valor}
      </div>
    </div>
  );
}

export function Vacio({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-8 text-center text-sm leading-relaxed text-apagado">{children}</div>
  );
}

export function Fila({ children, cols = 1 }: { children: React.ReactNode; cols?: number }) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

/** El relleno de la pantalla, compartido por todas. */
export function Contenedor({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[76rem] px-4 pt-5 pb-20">{children}</div>;
}

export function Separador() {
  return <div className="my-4 h-px bg-borde" />;
}
