import type { ReactNode } from "react";
import { MIS_SERVICIOS } from "@/lib/panel";

/* =========================================================
   Layout raíz
   ---------------------------------------------------------
   Next.js exige uno. Sin él no arranca: es el primer error que da al
   compilar un proyecto nuevo, y la plantilla no lo traía.

   ⚠️  EL LAYOUT RAÍZ NO LLEVA <body>
   -------------------------------------
   En App Router el `<body>` lo pone Next, no el layout. Si se pone
   también, sale un error de hidratación en cada página, que en el
   servidor parece funcionar y en el navegador rompe.
   ========================================================= */

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          background: "#0b0f14",
          color: "#e6edf3",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {children}
      </body>
    </html>
  );
}