import { describe, it, expect } from "vitest";
import { ticketDelHash } from "./hash-ticket";
import { verificar, diagnosticoDeTicket } from "./tickets";

/* =========================================================
   Estas pruebas existen porque el bug del prefijo 'ticket=' no lo
   detecto NINGUNA otra prueba.

   Todas las de la API hacían el POST ellas mismas con el ticket ya
   limpio, así que pasaban mientras la página mandaba el prefijo pegado
   y la entrada fallaba siempre.

   La diferencia entre un test que pasa y uno que sirve está en si
   ejecuta el código que se rompe. Este ejecuta el parseo del fragmento,
   que es donde estuvo el fallo.
   ========================================================= */

/* Un hash con la forma REAL que pone el panel. */
const HASH_REAL =
  "#ticket=eyJ1aWQiOiIyOGQ1YWUyMS1lYjZmLTQzNzYtYWMwZS0yOTY3MWJhOWY4NjYiLCJjaWQiOiJhYmExNWM1OSIsInJvbCI6ImNsaWVudCIsInNpZCI6bnVsbCwiYXQiOiJ4IiwiaXQiOiIwIiwiZXhwIjoxNzkyMTI3NDgzLCJqdGkiOiJhYmMxIn0.Z2Kg6QgWr8tEUgeds8ft9cMbn0g8";

describe("leer el ticket del hash", () => {
  it("quita el prefijo 'ticket=' y no solo la almohadilla", () => {
    /* EL CASO. Con el bug, esto devolvía "ticket=eyJ1aWQi..." y el
       servidor lo rechazaba siempre. */
    expect(ticketDelHash(HASH_REAL)).toBe(HASH_REAL.slice("#ticket=".length));
  });

  it("lo que devuelve es lo que firmó el panel", () => {
    const ticket = ticketDelHash(HASH_REAL);
    expect(ticket.startsWith("eyJ1aWQi")).toBe(true);
    expect(ticket).not.toContain("ticket=");
  });

  it("el resultado es base64url con un punto, que es lo que espera el verificador", () => {
    expect(ticketDelHash(HASH_REAL)).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("corta en el '&' si el fragmento trae más cosas", () => {
    /* Con más cosas, mandarlas pegadas haría que el servidor lo
       rechazara por algo que no es el ticket. */
    const conMas = "#ticket=eyJ1aWQiOiJ4In0.Z2Kg6Qg&otro=valor";
    expect(ticketDelHash(conMas)).toBe("eyJ1aWQiOiJ4In0.Z2Kg6Qg");
  });

  it("sin hash no devuelve nada", () => {
    expect(ticketDelHash("")).toBe("");
    expect(ticketDelHash("#")).toBe("");
  });

  it("un enlace roto se devuelve tal cual, para que el servidor lo rechace", () => {
    /* Silenciarlo y devolver "" haría que la página creyera que no hay
       enlace y mandara al panel: un fallo distinto y más difícil de ver. */
    expect(ticketDelHash("#basura")).toBe("basura");
  });
});

/* El mismo formato que firma el panel, con el secreto de ejemplo. */
const SECRETO = "secreto-de-prueba-para-estas-comprobaciones";
const CLIENTE = "aba15c59-f4c4-4f0a-9f50-d7988d9b3c9c";

function firmar(payload: Record<string, unknown>): string {
  /* Import diferido para que el módulo se cargue con la variable ya
     puesta, igual que en producción. */
  const crypto = require("crypto");
  const cuerpo = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const firma = crypto
    .createHmac("sha256", SECRETO)
    .update(cuerpo)
    .digest("base64url");
  return cuerpo + "." + firma;
}

const PAYLOAD_VALIDO = {
  uid: "28d5ae21-eb6f-4377-ac0e-29671ba9f862",
  cid: CLIENTE,
  rol: "client",
  sid: null,
  at: "x.y.z",
  exp: Math.floor(Date.now() / 1000) + 300,
  jti: "abc123",
};

describe("verificar el ticket que firma el panel", () => {
  it("acepta uno bien firmado", () => {
    const p = verificar(firmar(PAYLOAD_VALIDO), SECRETO);
    expect(p).not.toBeNull();
    expect(p?.cid).toBe(CLIENTE);
    expect(p?.rol).toBe("client");
  });

  it("rechaza uno firmado con OTRO secreto", () => {
    /* Es el fallo que costó una hora: los dos servicios con secretos
       distintos dan 401 sin decir por qué. */
    expect(verificar(firmar(PAYLOAD_VALIDO), "otro-secreto-distinto")).toBeNull();
  });

  it("rechaza uno manipiado: cambiar un carácter rompe la firma", () => {
    const bueno = firmar(PAYLOAD_VALIDO);
    const roto = bueno.slice(0, -3) + (bueno.slice(-3) === "AAA" ? "BBB" : "AAA");
    expect(verificar(roto, SECRETO)).toBeNull();
  });

  it("rechaza uno caducado", () => {
    const caducado = { ...PAYLOAD_VALIDO, exp: Math.floor(Date.now() / 1000) - 60 };
    expect(verificar(firmar(caducado), SECRETO)).toBeNull();
  });

  it("un cliente sin `cid` no vale", () => {
    const sinCliente = { ...PAYLOAD_VALIDO, cid: null };
    expect(verificar(firmar(sinCliente), SECRETO)).toBeNull();
  });

  it("NO lanza con basura: devuelve null", () => {
    /* Un ticket manipulado es un evento NORMAL: un escáner, alguien que
       cambia un carácter por curiosidad. Quien llama decide. */
    for (const basura of ["", "abc", "abc.def", "a".repeat(500), "....."]) {
      expect(() => verificar(basura, SECRETO)).not.toThrow();
      expect(verificar(basura, SECRETO)).toBeNull();
    }
  });
});

describe("diagnosticar un ticket rechazado", () => {
  it("distingue los cuatro motivos", () => {
    expect(diagnosticoDeTicket("")).toBe("vacio");
    expect(diagnosticoDeTicket("abc")).toBe("malformado");
    expect(
      diagnosticoDeTicket(firmar({ ...PAYLOAD_VALIDO, exp: Math.floor(Date.now() / 1000) - 60 }))
    ).toBe("caducado");
    /* Bien formado y vivo, pero con otra firma: el caso de los secretos
       distintos entre servicios. */
    expect(diagnosticoDeTicket(firmar(PAYLOAD_VALIDO))).toBe("no-verifica");
  });

  it("el diagnóstico nunca dice si la FIRMA era válida, solo si caducó", () => {
    /* Si dijera "no-verifica" al navegador, con un enlace manipulado
       alguien sabría que su firma era buena. El log va al servidor; la
       respuesta al navegador solo dice si caducó. */
    const motivo = diagnosticoDeTicket(firmar(PAYLOAD_VALIDO));
    expect(["vacio", "malformado", "caducado"]).not.toContain(motivo);
    expect(motivo).toBe("no-verifica");
  });
});