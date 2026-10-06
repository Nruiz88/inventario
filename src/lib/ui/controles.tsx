/* =========================================================
   Los controles
   ---------------------------------------------------------
   Estilos en línea y sin librería.

   No es falta de criterio: es que el layout raíz y la pantalla de
   entrada ya usan estilos en línea, y en un proyecto sin Tailwind lo
   consistente es seguir en esa línea. Meter CSS Modules o styled-jsx en
   la mitad de las pantallas deja dos sistemas conviviendo, y el que
   llega tarde es siempre el que hay que cambiar.

   Los valores salen de aquí, no de números escritos en cada pantalla:
   el mismo rojo de error en cuatro sitios es cuatro sitios que se
   desincronizan cuando alguien decide que el error es naranja.
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
  cifra: { fontSize: "1.9rem", lineWeight: 700, fontVariantNumeric: "tabular-nums" as const, lineHeight: 1.1 },
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
    <section
      style={{
        background: color.panel,
        border: `1px solid ${color.borde}`,
        borderRadius: radio.lg,
        overflow: "hidden",
      }}
    >
      {(titulo || accion) && (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: ".75rem",
            padding: ".85rem 1rem",
            borderBottom: `1px solid ${color.borde}`,
            background: color.panel2,
          }}
        >
          {titulo && (
            <h2 style={{ margin: 0, fontSize: ".95rem", fontWeight: 600, color: color.texto }}>
              {titulo}
            </h2>
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
  const base: React.CSSProperties = {
    padding: tamano === "chico" ? ".45rem .7rem" : ".65rem 1rem",
    borderRadius: radio.md,
    border: `1px solid ${color.borde}`,
    fontSize: tamano === "chico" ? ".8rem" : ".9rem",
    fontWeight: 600,
    cursor: disabled || cargando ? "wait" : "pointer",
    opacity: disabled || cargando ? 0.55 : 1,
    width: ancho ? "100%" : undefined,
    minHeight: tamano === "chico" ? "2rem" : "2.6rem",
    fontFamily: "inherit",
    transition: "filter .12s ease",
  };

  const tonos: Record<string, React.CSSProperties> = {
    normal: { background: color.panel2, color: color.texto },
    primario: { background: color.acento, color: "#06121f", borderColor: color.acento },
    peligro: { background: "#3a1a1e", color: color.mal, borderColor: "#6b2b32" },
    fantasma: { background: "transparent", color: color.apagado, borderColor: "transparent" },
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || cargando}
      title={title}
      style={{ ...base, ...tonos[tipo] }}
      onMouseEnter={(e) => {
        if (!disabled && !cargando) e.currentTarget.style.filter = "brightness(1.15)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = "none";
      }}
    >
      {cargando ? "…" : children}
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
  return (
    <label style={{ display: "block", width: ancho ? "100%" : undefined }}>
      {etiqueta && (
        <span
          style={{
            display: "block",
            fontSize: ".75rem",
            color: color.apagado,
            marginBottom: ".25rem",
            textTransform: "uppercase",
            letterSpacing: ".04em",
          }}
        >
          {etiqueta}
        </span>
      )}
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
        style={{
          width: "100%",
          padding: ".6rem .7rem",
          borderRadius: radio.md,
          border: `1px solid ${color.borde}`,
          background: "#0d141c",
          color: color.texto,
          fontSize: ".95rem",
          fontFamily: "inherit",
          minHeight: "2.6rem",
        }}
      />
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
    <label style={{ display: "block", width: "100%" }}>
      {etiqueta && (
        <span
          style={{
            display: "block",
            fontSize: ".75rem",
            color: color.apagado,
            marginBottom: ".25rem",
            textTransform: "uppercase",
            letterSpacing: ".04em",
          }}
        >
          {etiqueta}
        </span>
      )}
      <textarea
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={filas}
        style={{
          width: "100%",
          padding: ".6rem .7rem",
          borderRadius: radio.md,
          border: `1px solid ${color.borde}`,
          background: "#0d141c",
          color: color.texto,
          fontSize: ".95rem",
          fontFamily: "inherit",
          resize: "vertical",
        }}
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
    <div style={{ display: "flex", gap: ".5rem", justifyContent: "flex-end", padding: ".85rem 1rem", borderTop: `1px solid ${color.borde}`, flexWrap: "wrap" }}>
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
  const t: Record<string, string> = {
    neutro: color.apagado,
    ok: color.ok,
    mal: color.mal,
    aviso: color.aviso,
  };
  return (
    <span
      style={{
        display: "inline-block",
        padding: ".12rem .45rem",
        borderRadius: radio.sm,
        fontSize: ".7rem",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: ".03em",
        color: t[tono],
        border: `1px solid ${t[tono]}44`,
        background: t[tono] + "14",
        whiteSpace: "nowrap",
      }}
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
  const t = tono === "ok" ? color.ok : tono === "mal" ? color.mal : tono === "aviso" ? color.aviso : color.texto;
  return (
    <div>
      {etiqueta && (
        <div style={{ ...tipografia.chico, color: color.apagado, marginBottom: ".15rem" }}>
          {etiqueta}
        </div>
      )}
      <div style={{ ...tipografia.cifra, color: t }}>{valor}</div>
    </div>
  );
}

export function Vacio({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "2rem 1rem",
        textAlign: "center",
        color: color.apagado,
        fontSize: ".9rem",
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  );
}

export function Fila({ children, cols = 1 }: { children: React.ReactNode; cols?: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: ".7rem",
      }}
    >
      {children}
    </div>
  );
}

/** El relleno de la pantalla, compartido por todas. */
export function Contenedor({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: "76rem", margin: "0 auto", padding: "1.25rem 1rem 5rem" }}>{children}</div>
  );
}

export function Separador() {
  return <div style={{ height: 1, background: color.borde, margin: "1rem 0" }} />;
}