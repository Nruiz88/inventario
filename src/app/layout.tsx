import type { ReactNode } from "react";
import { Marco } from "@/components/marco";

/* =========================================================
   Layout raíz
   ---------------------------------------------------------
   Next.js exige uno. Sin él no arranca: es el primer error que da al
   compilar un proyecto nuevo.

   Aquí solo va el marco. Todas las pantallas cuelgan de él, incluidas
   las de entrada, que son las que se quedan sin barra de navegación: lo
   decide `Marco` según la ruta, en un solo sitio.

   ⚠️  EL LAYOUT RAÍZ NO LLEVA <body>
   ------------------------------------
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
          /* Un comercio chico se usa en un móvil, muchas veces con una
             mano ocupada: sin esto, tocar un `<input>` en iOS hace zoom
             y la pantalla se descentra justo cuando estás apurado. */
          WebkitTextSizeAdjust: "100%",
          overscrollBehaviorY: "none",
        }}
      >
        <Marco>{children}</Marco>
      </body>
    </html>
  );
}