import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Junta clases de Tailwind resolviendo las que chocan.
 *
 * Sin esto, añadir `p-4` a un componente que ya trae `p-2` depende de
 * cuál de los dos gana en el orden del HTML, y en un proyecto con
 * componentes compuestos eso significa que el espacio sale distinto
 * según dónde se use. `twMerge` resuelve por la última que llega, que
 * es lo que se espera cuando se está sobrescribiendo.
 *
 * ── POR QUÉ ESTÁ EN SU PROPIO FICHERO Y NO EN UN IMPORT DE UNA LÍNEA ──
 *
 * Porque se usa en todos lados y porque cuando falla el fallo tiene que
 * ser legible. Un `cn` roto no da error: da clases que no se aplican, y
 * eso se manifesta como un espaciado raro en una pantalla concreta, tres
 * Commit más tarde.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}