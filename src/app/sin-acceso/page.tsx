import { MIS_SERVICIOS } from "@/lib/panel";

/* =========================================================
   Sin acceso
   ---------------------------------------------------------
   La pantalla de "no tienes el servicio" o "se te caducó".

   El texto no culpa a nadie. Dice lo que pasó y qué hacer, que es lo
   único que sirve aquí.

   Y el enlace va al PORTAL del cliente, no a otra página de este
   servicio: si no puede entrar aquí, tampoco va a poder hacer nada en
   ninguna otra parte, y mandarle a un sitio donde tampoco entra es
   peor que mandarle al que sí.
   ========================================================= */

export default function SinAcceso() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        fontFamily: "system-ui, sans-serif",
        background: "#0b0f14",
        color: "#e6edf3",
      }}
    >
      <div style={{ maxWidth: "30rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.25rem", marginBottom: ".75rem" }}>
          Tu inventario no está activo
        </h1>
        <p style={{ opacity: 0.75, lineHeight: 1.6 }}>
          Puede que la suscripción haya caducado o que se haya cancelado.
          Si crees que es un error, revísalo en tu panel de Nexo Studio.
        </p>
        <a
          href={MIS_SERVICIOS}
          style={{ display: "inline-block", marginTop: "1.5rem", color: "#4da3ff" }}
        >
          Ir a mi panel
        </a>
      </div>
    </main>
  );
}