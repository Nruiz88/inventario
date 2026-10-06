/* Genera el PHP que crea las variables de entorno en Coolify.
 *
 * POR QUE NO ES SQL, Y POR QUE NO SE PUEDE
 * -----------------------------------------
 * La columna `value` de environment_variables tiene el cast
 * 'encrypted' en el modelo EnvironmentVariable. O sea que lo que hay
 * en la base no es el valor: es el valor cifrado con la APP_KEY de
 * Coolify.
 *
 * Insertar el valor en claro por SQL produce una fila correcta en
 * todos los aspects que se pueden mirar desde fuera —la clave, el
 * orden, is_preview=false— y que Coolify no puede leer. El sintoma es
 * una DecryptException en cuanto algo toca esa fila, y un despliegue
 * que falla sin decir por que.
 *
 * Por eso esto va por Eloquent: el mismo modelo, los mismos casts y
 * el mismo cifrado que usa la pantalla de la interfaz. Lo unico que
 * cambia es que no hay que tener delante un boton.
 *
 * Hay una segunda razon, mas fina. El `resourceable_type` tiene que
 * ser exactamente 'App\Models\Application', con UNA barra. La primera
 * version de esto escapaba las barras y guardaba dos, y las filas
 * quedaron fuera de la relacion morphMany: escritas, correctas, e
 * invisibles. Dos fallos que desde la tabla de Postgres no se ven.
 */
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");

function leerEnv(ruta) {
  const s = {};
  for (const l of fs.readFileSync(ruta, "utf8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) s[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return s;
}

const env = leerEnv(path.join(RAIZ, ".env.local"));

const DOMINIO = "inventario.panel-niconqn.duckdns.org";

const VARIABLES = [
  ["SUPABASE_URL", env.SUPABASE_URL],
  ["SUPABASE_SECRET_KEY", env.SUPABASE_SECRET_KEY],
  ["SUPABASE_PUBLISHABLE_KEY", env.SUPABASE_PUBLISHABLE_KEY],
  ["SERVICE_SECRET", env.SERVICE_SECRET],
  ["BUSINESS_TIMEZONE", env.BUSINESS_TIMEZONE || "America/Argentina/Buenos_Aires"],
  ["APP_URL", "https://" + DOMINIO],
  ["NEXT_PUBLIC_PANEL_URL", "https://panel-niconqn.duckdns.org"],
];

/* PHP con comillas simples: los valores van en base64, que no tiene
   comillas ni barras ni nada que reinterpretar PHP. */
const phpLit = (v) => "'" + Buffer.from(String(v), "utf8").toString("base64") + "'";

let php = `<?php
/**
 * Crear las variables de entorno de inventario en Coolify, por Eloquent.
 *
 * GENERADO. No editar a mano: los valores vienen de .env.local y
 * ponerlos a mano es la forma facil de que un token acabe con una
 * comilla de mas.
 *
 * Uso:
 *   node db/generar-coolify.mjs
 *   docker cp coolify-vars.php coolify:/var/www/html/
 *   docker exec coolify php /var/www/html/artisan tinker /var/www/html/coolify-vars.php
 */

/** El valor va en base64 para no tener que escaping de PHP ni de SQL. */
$dec = function (?string $b64): string {
    return base64_decode($b64, true);
};

$app = \\App\\Models\\Application::where('uuid', 'vu36zj9mmqnczlirdkdoifpv')->first();

if (! $app) {
    fwrite(STDERR, "la app no existe\\n");
    exit(1);
}

echo "app: " . $app->name . "  (" . $app->build_pack . ")\\n";

/* Fuera todo lo que haya,Including lo que esta en claro y no se puede
   descifrar. Esta es la parte que hace falta de verdad: si se dejara,
   quedarian filas visibles pero inservibles. */
$previas = $app->environment_variables()->get();
echo "borrando " . $previas->count() . " previas\\n";
foreach ($previas as $v) {
    $v->forceDelete();
}

$filas = [
`;

let orden = 0;
for (const [clave, valor] of VARIABLES) {
  orden++;
  php += `    ['${clave}', ${phpLit(valor)}],\n`;
}

php += `];

foreach ($filas as $i => [$clave, $b64]) {
    $valor = $dec($b64);

    /* is_buildtime SOLO para la de Next.js.
     *
     * Es la unica que Next sustituye al compilar, y la unica que hace
     * falta durante el build. Las otras seis no se usan al compilar,
     * asi que marcarlas como buildtime hace que Coolify las pase como
     * ARG, y un ARG no desaparece: queda en el historial de la imagen
     * para siempre, visible con docker history.
     *
     * El aviso de BuildKit lo dice al vuelo:
     *
     *   SecretsUsedInArgOrEnv: Do not use ARG or ENV instructions
     *   for sensitive data (ARG "SERVICE_SECRET")
     *
     * buildtime = false + runtime = true es lo correcto para un
     * secreto: llega al contenedor, y no a la imagen. */
    $buildtime = $clave === 'NEXT_PUBLIC_PANEL_URL';

    /* create() en la relacion: es lo que hace la interfaz, y por
       eso el cifrado y el uuid salen bien. */
    $app->environment_variables()->create([
        'key' => $clave,
        'value' => $valor,
        'is_preview' => false,
        'is_shown_once' => false,
        'is_multiline' => false,
        'is_literal' => false,
        'order' => $i + 1,
        'is_required' => false,
        'is_shared' => false,
        'is_runtime' => true,
        'is_buildtime' => $buildtime,
    ]);

    printf(
        "  %-26s %d chars  md5 %s  buildtime=%s\\n",
        $clave,
        strlen($valor),
        substr(md5($valor), 0, 8),
        $buildtime ? 'SI' : 'no'
    );
}

echo "\\ncreadas " . $app->environment_variables()->count() . "\\n";
`;

const salida = path.join(process.env.TEMP || ".", "coolify-vars.php");
fs.writeFileSync(salida, php, "utf8");

console.log(`  ${salida}`);
console.log(`  ${VARIABLES.length} variables`);
for (const [k, v] of VARIABLES) console.log(`    ${k.padEnd(26)} ${String(v).length} chars`);