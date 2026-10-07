import type { ReactNode } from "react";
import { Marco } from "@/components/marco";
import "./globals.css";

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

   ── POR QUÉ EL FONDO ESTÁ EN LA HOJA Y NO AQUÍ ──

   Antes llevaba aquí los colores del cuerpo como estilos en línea. Con
   la hoja, el fondo, el color del texto, el color de la barra de
   scroll y el `:focus-visible` salen de `globals.css`.

   La razón es una sola, y es que este layout es un componente de
   servidor: no puede leer el tema ni depender del navegador. Todo lo
   que dependa de eso va a la hoja, o el día que se añada un tema
   claro hay que recordar venir aquí.
   ========================================================= */

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          width: "100%",
        }}
      >
        <Marco>{children}</Marco>
      </body>
    </html >
  );
}