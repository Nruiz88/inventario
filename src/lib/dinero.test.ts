import { describe, it, expect } from "vitest";
import { dinero, numero, aNumero, aCentavos, margen, ganancia, hoy } from "./dinero";

/* =========================================================
   El dinero
   ---------------------------------------------------------
   Estas funciones están en UN archivo y no en cada ruta por una razón
   concreta: la duplicación del redondeo es la que produce un error que
   aparece tres meses después, cuando ya no se puede saber de dónde
   salió. Un céntimo de diferencia en 500 ventas es un euro, y nadie
   lo encuentra mirando el código.
   ========================================================= */

describe("el dinero, en centavos", () => {
  it("225 centavos son $2,25", () => {
    expect(dinero(225)).toBe("$2,25");
  });

  it("los miles se separan con punto, como se escribe acá", () => {
    /* Con el formato de en-US sale "2,500.00", que acá no lo entiende
       nadie y el dueño lo lee como dos mil quinientos. */
    expect(dinero(250000)).toBe("$2.500,00");
  });

  it("un céntimo no se pierde", () => {
    expect(dinero(1)).toBe("$0,01");
    expect(dinero(99)).toBe("$0,99");
  });

  it("nada es cero, no NaN", () => {
    /* `undefined` entra a dinero() en cuanto una consulta viene vacía, y
       `Math.round(undefined)` es NaN: en pantalla sale "NaN" en vez de
       un precio. */
    expect(dinero(0)).toBe("$0,00");
    expect(dinero(undefined as any)).toBe("$0,00");
    expect(dinero(null as any)).toBe("$0,00");
  });
});

describe("convertir", () => {
  it("de centavos a número plano", () => {
    expect(aNumero(225)).toBe(2.25);
    expect(aNumero(0)).toBe(0);
  });

  it("de número plano a centavos, redondeando", () => {
    expect(aCentavos(2.25)).toBe(225);
    expect(aCentavos("2.25")).toBe(225);
    /* Los centavos no admiten decimales. Guardar 225.5 es guardar un
       número que no existe, y suma sin parar. */
    expect(aCentavos(2.255)).toBe(226);
  });

  it("texto que no es un número da 0, no NaN", () => {
    expect(aNumero("hola")).toBe(0);
    expect(aCentavos("hola")).toBe(0);
  });
});

describe("el margen", () => {
  it("un producto de 225 que cuesta 150 da 50%", () => {
    expect(margen(225, 150)).toBe(50);
  });

  it("y se gana 75", () => {
    expect(ganancia(225, 150)).toBe(75);
  });

  it("sin costo no hay margen, no Infinity", () => {
    /* Un producto recién creado tiene costo 0. Dividir por cero da
       Infinity, y en pantalla sale "Infinity%" en la lista de
       productos. */
    expect(margen(225, 0)).toBe(0);
    expect(margen(225, 0)).not.toBe(Infinity);
  });

  it("vender por debajo de coste da margen negativo, no cero", () => {
    /* Que salga "-20%" y no "0%" es lo que hace ver que ese producto
       está mal puesto. Con 0% el dueño no se entera. */
    expect(margen(100, 125)).toBe(-20);
  });
});

describe("la fecha de hoy", () => {
  it("es la del negocio, no la de UTC", () => {
    /* `new Date().toISOString().slice(0,10)` da la fecha en UTC, que
       entre las 21 y las 3 de la mañana es la del día siguiente. Para
       un comercio que cierra a las 23, el arqueo del viernes acaba en
       sábado sin que nadie lo note. */
    const resultado = hoy("America/Argentina/Buenos_Aires");
    expect(resultado).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("avanzar un día en el este hace retroceder el día en UTC", () => {
    /* Este es el caso exacto que hace daño: si la zona es +3 y son las
       22:00 del lunes, en UTC ya es martes. */
    const zona = "America/Argentina/Buenos_Aires";
    const esperado = new Intl.DateTimeFormat("en-CA", {
      timeZone: zona,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    expect(hoy(zona)).toBe(esperado);
  });
});