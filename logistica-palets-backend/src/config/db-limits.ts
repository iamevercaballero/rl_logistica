/**
 * Límites de la conexión a PostgreSQL: cuánto puede durar una consulta, cuánto
 * puede quedar abierta una transacción sin actividad, y cuántas conexiones abre
 * el backend.
 *
 * El problema que atacan: no había ninguno. Una consulta de reporte con un plan
 * malo se quedaba con su conexión sin límite, y una transacción abandonada
 * —un `await` que nunca resuelve, un proceso que se cuelga— retenía además sus
 * bloqueos pesimistas, que en este código protegen justo los caminos que tocan
 * stock. Con el pool agotado, la aplicación deja de responder entera aunque la
 * base esté sana.
 *
 * Los tres valores son configurables porque el correcto depende del despliegue,
 * y los defaults están elegidos para no cambiar el comportamiento actual salvo
 * en el caso patológico.
 */

/** Un valor de tiempo que PostgreSQL acepta en estos parámetros: `30s`, `500ms`, `0`. */
const TIEMPO_VALIDO = /^\d+(ms|s|min)?$/;

/**
 * Valida un valor de tiempo antes de meterlo en la línea de opciones.
 *
 * No es paranoia sobre el operador: la cadena se concatena en los argumentos de
 * arranque de la sesión, así que un valor con espacios inyectaría parámetros
 * arbitrarios. Ante algo que no reconoce, usa el default en vez de fallar — un
 * backend que no arranca por un timeout mal escrito es peor que uno que arranca
 * con el valor previsto.
 */
export function tiempoValido(valor: string | undefined, porDefecto: string): string {
  if (!valor) return porDefecto;
  const limpio = valor.trim();
  return TIEMPO_VALIDO.test(limpio) ? limpio : porDefecto;
}

export type LimitesDeConexion = {
  /** Cadena para `extra.options` — parámetros de arranque de la sesión. */
  options: string;
  /** Máximo de conexiones del pool. */
  poolSize: number;
  /** Cuánto espera una petición por una conexión libre antes de fallar. */
  connectionTimeoutMillis: number;
};

/**
 * Arma los límites a partir del entorno.
 *
 * `statement_timeout` (30 s por defecto) corta la consulta que se desbocó. Es
 * holgado a propósito: la consulta más lenta medida en el banco de un millón de
 * movimientos era de 2,1 segundos *antes* del índice de RL-A-07, así que 30
 * segundos no alcanza a ninguna consulta legítima y sí a una que se fue de
 * cauce.
 *
 * `idle_in_transaction_session_timeout` (60 s) es el que más importa acá: mata
 * la transacción abandonada, que es la que retiene bloqueos y bloquea a todos
 * los demás. Se lo deja al doble que el otro porque una transacción legítima
 * puede tener varias consultas encadenadas.
 *
 * **No se pone `lock_timeout` a propósito.** Convertiría una espera normal por
 * contención —dos salidas simultáneas sobre el mismo lote, que el motor ya
 * resuelve con bloqueo pesimista y reintento— en un error para el operador. El
 * problema no es esperar por un lock, es no soltarlo nunca, y de eso se ocupa
 * el timeout de transacción ociosa.
 *
 * El pool queda en 10, que es el default de node-postgres: se declara para
 * poder subirlo o bajarlo sin tocar código, no para cambiar el comportamiento
 * de hoy. Node es de un solo hilo y la concurrencia acá es de E/S, así que
 * subirlo sin medir sólo consume conexiones del servidor.
 *
 * `connectionTimeoutMillis` sí cambia algo: hoy es 0, es decir, una petición
 * espera para siempre por una conexión libre. Con 10 segundos, si el pool está
 * agotado o la base no responde, la petición falla y libera al cliente en vez
 * de acumular peticiones colgadas.
 */
export function limitesDeConexion(env: NodeJS.ProcessEnv = process.env): LimitesDeConexion {
  const statement = tiempoValido(env.DB_STATEMENT_TIMEOUT, '30s');
  const idleTx = tiempoValido(env.DB_IDLE_TX_TIMEOUT, '60s');

  const poolCrudo = Number(env.DB_POOL_SIZE);
  const poolSize = Number.isInteger(poolCrudo) && poolCrudo > 0 ? poolCrudo : 10;

  const conexionCruda = Number(env.DB_CONNECTION_TIMEOUT_MS);
  const connectionTimeoutMillis =
    Number.isInteger(conexionCruda) && conexionCruda >= 0 ? conexionCruda : 10_000;

  return {
    // La zona horaria estaba primero y sigue primero: ver el comentario en
    // src/data-source.ts sobre por qué no se confía en el default del servidor.
    options: [
      '-c timezone=Etc/GMT+3',
      `-c statement_timeout=${statement}`,
      `-c idle_in_transaction_session_timeout=${idleTx}`,
    ].join(' '),
    poolSize,
    connectionTimeoutMillis,
  };
}
