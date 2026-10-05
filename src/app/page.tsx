import { MIS_SERVICIOS } from "@/lib/panel";

/* Placeholder: la pantalla principal todavía no está. Este fichero es
   un `page.tsx`, y en App Router eso significa que solo puede exportar
   `default` y un puñado de claves concretas (`dynamic`, `metadata`…).
   Un `export const X = ...` cualquiera hace fallar la compilación con
   un error de tipos que no dice qué sobra. */
export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.25rem", marginBottom: ".75rem" }}>Inventario</h1>
      <p style={{ opacity: 0.75 }}>
        La API ya funciona: <code>/api/resumen</code>.
      </p>
      <a href={MIS_SERVICIOS} style={{ display: "inline-block", marginTop: "1.5rem" }}>
        Volver al panel
      </a>
    </main>
  );
}