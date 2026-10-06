"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/ui/datos";
import { Resumen } from "@/components/resumen";

/* =========================================================
   / — el resumen
   ---------------------------------------------------------
   La página no hace nada: el marco ya está en el layout raíz y el
   contenido viene de `Resumen`.

   El `dynamic` es de la página, no del componente, porque la decisión
   de no cachear la tiene que tomar Next, no el código que se ejecuta
   dentro del navegador.
   ========================================================= */

export const dynamic = "force-dynamic";

export default function Pagina() {
  return <Resumen />;
}