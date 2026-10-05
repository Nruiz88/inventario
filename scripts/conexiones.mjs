#!/usr/bin/env node
/* =========================================================
   Comprobar la configuración del servicio
   ---------------------------------------------------------
   Esto existe por un fallo concreto: en Coolify, las variables de
   entorno creadas por la API vienen marcadas `is_preview: true`, que
   significa SOLO para despliegues de preview. En un despliegue normal no
   llegan al contenedor.

   El síntoma era el servicio arrancando con
   `[db] falta SUPABASE_URL o SUPABASE_SECRET_KEY`, con todas las
   variables PUESTAS en el panel de Coolify. Se estuvo un rato
   comprobando el código cuando el problema era que las variables no
   llegaban.

   Este script se ejecuta ANTES de desplegar y avisa de todo lo que se
   puede comprobar sin arrancar nada.

   USO
     npm run conexiones
   ========================================================= */

import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");

/* ---------------------------------------------------------------------
   Las variables, y POR QUÉ cada una está aquí
   ---------------------------------------------------------------------
   No es una lista: es el contrato de la conexión. Si falta una, el
   servicio arranca y falla al primer uso, que es cuando nadie mira. */
const VARIABLES = [
  {
    clave: "SUPABASE_URL",
    obligatorio: true,
    para: "conectar con la base",
    comoSeComprueba: (v) => /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(v),
    errorSiFalla: "no parece una URL de Supabase (https://xxx.supabase.co)",
  },
  {
    clave: "SUPABASE_SECRET_KEY",
    obligatorio: true,
    para: "el servidor: sesiones, webhooks, mantenimiento",
    comoSeComprueba: (v) => v.startsWith("sb_secret_"),
    errorSiFalla:
      "no empieza por sb_secret_. Si empieza por sb_publishable_, es la clave del cliente: la app funciona en local y en producción se rompe de formas distintas",
  },
  {
    clave: "SUPABASE_PUBLISHABLE_KEY",
    obligatorio: true,
    para: "el cliente con el token del usuario: es lo que aplica RLS",
    comoSeComprueba: (v) => v.startsWith("sb_publishable_"),
    errorSiFalla:
      "no empieza por sb_publishable_. Si empieza por sb_secret_, tienes las dos cambiadas y las consultas de datos NO van por RLS",
  },
  {
    clave: "SERVICE_SECRET",
    obligatorio: true,
    para: "verificar el ticket que firma el panel",
    comoSeComprueba: (v) => v.length >= 32,
    errorSiFalla: "demasiado corta (mínimo 32 caracteres)",
    /* Esto es lo que más cuesta diagnosticar: si los dos servicios no
       comparten el secreto, el canje da 401 sin decir por qué. */
    avisoSiFalla: "si el canje da 401, compara esto con el del panel: tienen que ser IGUALES",
  },
  {
    clave: "BUSINESS_TIMEZONE",
    obligatorio: false,
    para: "hoy, mañana y los recordatorios",
  },
  {
    clave: "APP_URL",
    obligatorio: false,
    para: "los enlaces que genera el propio servicio",
  },
  {
    clave: "DATABASE_URL",
    obligatorio: false,
    para: "migraciones. La aplicación NO la usa",
    avisoSiFalla: "contiene una contraseña: no la pongas en Coolify si no hace falta",
    /* El ejemplo lleva un placeholder y, por la longitud, parece una
       clave real. Se marca para que esta comprobación no se queje de
       algo que es correcto. */
    esEjemplo: true,
  },
];

/* ---------------------------------------------------------------------
   Leer el .env
   --------------------------------------------------------------------- */

function leerEnv(ruta) {
  if (!fs.existsSync(ruta)) return null;

  const salida = {};
  for (const linea of fs.readFileSync(ruta, "utf8").split("\n")) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;

    const eq = limpia.indexOf("=");
    if (eq < 1) continue;

    const clave = limpia.slice(0, eq).trim();
    const valor = limpia.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    salida[clave] = valor;
  }
  return salida;
}

/* ---------------------------------------------------------------------
   Comprobar
   --------------------------------------------------------------------- */

const env = leerEnv(path.join(RAIZ, ".env.local"));
const ejemplos = leerEnv(path.join(RAIZ, ".env.example"));

let problemas = 0;
let avisos = 0;

console.log("\n═══ La configuración ═══\n");

if (!env) {
  console.log("  ✗ no hay .env.local");
  console.log("");
  console.log("    Cópialo del ejemplo y rellénalo:");
  console.log("      cp .env.example .env.local");
  console.log("");
  console.log("    Con .env.example no hay nada que comprobar: está lleno de");
  console.log("    valores de mentira a propósito.");
  process.exit(1);
}

console.log("  .env.local: " + Object.keys(env).length + " variables\n");

for (const v of VARIABLES) {
  const valor = env[v.clave];
  const falta = valor === undefined || valor === "";

  if (falta) {
    if (v.obligatorio) {
      problemas++;
      console.log(`  ✗ ${v.clave}`);
      console.log(`      falta. Es para ${v.para}`);
    } else {
      console.log(`  · ${v.clave}`);
      console.log(`      no está. Es para ${v.para}`);
    }
    continue;
  }

  const bien = v.comoSeComprueba ? v.comoSeComprueba(valor) : true;
  if (!bien) {
    problemas++;
    console.log(`  ✗ ${v.clave}`);
    console.log(`      ${v.errorSiFalla}`);
    continue;
  }

  console.log(`  ✓ ${v.clave}  (${valor.length} caracteres)`);

  if (v.avisoSiFalla) console.log(`      nota: ${v.avisoSiFalla}`);
}

/* ---------------------------------------------------------------------
   Lo que se comprueba en el .env y no en el despliegue
   --------------------------------------------------------------------- */

console.log("\n── Lo que esta plantilla puede comprobar por ti ──\n");

/* 1. Que el id del módulo esté puesto. */
const sesion = fs.readFileSync(path.join(RAIZ, "src/lib/acceso/sesion.ts"), "utf8");
const modulo = (sesion.match(/MODULO_ID\s*=\s*"([^"]*)"/) || [])[1];

if (!modulo || modulo.startsWith("PON_AQUI")) {
  problemas++;
  console.log("  ✗ MODULO_ID sin poner");
  console.log("      en src/lib/acceso/sesion.ts. Es el id del módulo en la tabla");
  console.log("      `modules` del panel, y tiene que ser el MISMO que usa el panel");
  console.log("      para firmar el ticket.");
} else {
  console.log(`  ✓ MODULO_ID = "${modulo}"`);
}

/* 2. Que la tabla de sesiones exista en las migraciones. */
const sql = fs.readFileSync(path.join(RAIZ, "db/001_sesiones.sql"), "utf8");
if (!/enable row level security/i.test(sql)) {
  problemas++;
  console.log("  ✗ la tabla de sesiones NO tiene RLS");
  console.log("      sin esa línea, `authenticated` puede leer TODAS las sesiones del");
  console.log("      sistema, y con eso los tokens.");
} else if (!/revocado_en/.test(sql)) {
  problemas++;
  console.log("  ✗ la tabla de sesiones no tiene revocado_en");
  console.log("      sin eso no se pueden cerrar sesiones, y para revocar");
  console.log("      habría que tocar expira_en, que el CHECK impide escribir en pasado.");
} else {
  console.log("  ✓ la tabla de sesiones tiene RLS y revocado_en");
}

/* 3. Que la cookie siga siendo host-only. */
if (!/opcionesCookie|sin `domain`|Domain/i.test(sesion)) {
  avisos++;
  console.log("  · no veo la nota de la cookie host-only en sesion.ts");
  console.log("      Si le pones `domain`, la cookie viaja a todos los subdominios y un");
  console.log("      XSS en cualquiera se lleva la sesión de todos.");
} else {
  console.log("  ✓ la cookie se deja host-only (sin `domain`)");
}

/* 4. Que el proxy no se tome en serio a sí mismo.

   ⚠️  POR QUÉ BUSCA EN DOS SITIOS
   ------------------------------
   La plantilla miraba solo `src/lib/acceso/proxy.ts`. Ese fichero
   NUNCA lo leyó nadie: Next.js carga el middleware desde `src/proxy.ts`
   (o `proxy.ts` en la raíz), y lo que estaba en `acceso/` era código
   muerto.

   Peor que estar muerto era el síntoma: si el fichero faltaba, este
   script reventaba con un ENOENT y no llegaba a decir nada. El
   validador que debía avisar de un problema se caía él mismo por el
   problema.

   Se buscan los dos sitios porque cualquiera de los dos vale: lo que
   importa es que el fichero que Next carga tenga el recordatorio, y no
   que esté en un directorio concreto. */
const rutasProxy = ["src/proxy.ts", "proxy.ts", "src/lib/acceso/proxy.ts"];
const proxyRuta = rutasProxy.find((r) => fs.existsSync(path.join(RAIZ, r)));

if (!proxyRuta) {
  avisos++;
  console.log("  · no hay ningún proxy (src/proxy.ts)");
  console.log("      Sin él, Next.js deja pintar cualquier página sin sesión.");
  console.log("      Ojo: el proxy NO es la barrera de seguridad. Eso es RLS.");
} else {
  if (proxyRuta !== "src/proxy.ts" && proxyRuta !== "proxy.ts") {
    avisos++;
    console.log("  · el proxy está en " + proxyRuta + ", y Next no lee de ahí");
    console.log("      El sitio que Next carga es src/proxy.ts.");
  }

  const proxy = fs.readFileSync(path.join(RAIZ, proxyRuta), "utf8");

  if (!/no es la barrera de seguridad|RLS/i.test(proxy)) {
    avisos++;
    console.log("  · " + proxyRuta + " no dice que no es la barrera de seguridad");
    console.log("      Sin ese recordatorio, es fácil apoyarse solo en el middleware.");
  } else {
    console.log("  ✓ " + proxyRuta + " avisa de que la seguridad está en RLS");
  }

  /* 5. Que el matcher del proxy excluya los ficheros estáticos. */
  if (!/matcher/i.test(proxy) || !/\.\*\\\\\.\.\*|\.\*\\\.\.\*/.test(proxy)) {
    avisos++;
    console.log("  · el matcher del proxy no excluye los ficheros con punto");
    console.log("      Sin eso, cada .js y cada imagen hace una consulta a la tabla de");
    console.log("      sesiones. En un móvil se nota mucho.");
  } else {
    console.log("  ✓ el matcher del proxy excluye los estáticos");
  }
}

/* 6. Que el .example no tenga claves de verdad. */
const Sospechoso = [];
for (const v of VARIABLES) {
  if (v.esEjemplo) continue;
  const enEjemplo = ejemplos && ejemplos[v.clave];
  if (!enEjemplo) continue;
  if (enEjemplo.length > 40 && !enEjemplo.includes("TU-") && !enEjemplo.includes("xxx")) {
    Sospechoso.push(v.clave);
  }
}

if (Sospechoso.length) {
  problemas++;
  console.log(`  ✗ .env.example parece tener claves de verdad en: ${Sospechoso.join(", ")}`);
  console.log("      Un .example va al repositorio. Si la clave real está ahí escrita,");
  console.log("      el día que alguien lo sube está en git para siempre.");
} else {
  console.log("  ✓ .env.example no tiene claves de verdad");
}

/* --------------------------------------------------------------------- */

console.log("\n" + "═".repeat(54));

if (problemas) {
  console.log(`✗ ${problemas} cosa(s) que arreglar antes de desplegar.\n`);
  process.exit(1);
}
if (avisos) {
  console.log(`✓ Listo, con ${avisos} aviso(s) por mirar.\n`);
  process.exit(0);
}
console.log("✓ La configuración está completa.\n");
console.log("  Aun así: despliega y comprueba con un navegador de verdad.");
console.log("  Las pruebas no ejecutan el fragmento, y ahí estuvo el fallo más caro.\n");