/**
 * Orígenes permitidos, en un solo lugar (RL-A-11).
 *
 * `CORS_ORIGIN` es una lista separada por comas. La API la interpretaba bien,
 * pero el gateway de WebSocket pasaba la variable **cruda** a socket.io: con dos
 * dominios, el origen del navegador se comparaba contra la cadena entera
 * `"https://app.x,https://otro.x"`, que no coincide con nada. No era sólo un
 * problema de seguridad — con más de un dominio, el WebSocket no conectaba para
 * nadie.
 *
 * Y cuando la variable faltaba, el gateway caía en `origin: '*'` junto con
 * `credentials: true`, una combinación que el propio estándar CORS prohíbe: el
 * navegador rechaza la respuesta. Acá el equivalente correcto es reflejar el
 * origen que pide, que es lo que ya hacía la API.
 *
 * Se expone como función y no como valor para que se evalúe en cada petición.
 * El decorador `@WebSocketGateway` se ejecuta al **importar** el módulo, antes
 * de que `ConfigModule` haya leído el `.env`: un valor calculado ahí queda
 * congelado con lo que hubiera en ese instante, que en desarrollo es nada.
 */

/**
 * Lista de orígenes configurada, o `null` si no hay ninguna.
 *
 * `null` significa "sin restricción declarada", no "todos permitidos": cada
 * caller decide qué hacer. En producción no puede pasar — `env.validation.ts`
 * exige la variable y aborta el arranque si falta.
 */
export function corsOrigins(raw = process.env.CORS_ORIGIN): string[] | null {
  const lista = (raw ?? '')
    .split(',')
    .map((origen) => origen.trim())
    .filter(Boolean);
  return lista.length > 0 ? lista : null;
}

/**
 * ¿Se acepta este origen?
 *
 * Sin lista configurada se acepta cualquiera —es el comportamiento de
 * desarrollo, y el arranque en producción ya falló si la variable no está—.
 * Una petición sin cabecera `Origin` (curl, healthchecks, apps móviles) también
 * se acepta: CORS es una protección del navegador y no hay nada que proteger
 * cuando no hay origen.
 */
export function isOriginAllowed(origin: string | undefined, raw = process.env.CORS_ORIGIN): boolean {
  if (!origin) return true;
  const permitidos = corsOrigins(raw);
  if (permitidos === null) return true;
  return permitidos.includes(origin);
}

/** Callback con la firma que esperan tanto Express como socket.io. */
export function corsOriginCallback(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  if (isOriginAllowed(origin)) {
    callback(null, true);
    return;
  }
  // Se responde "no permitido" en vez de lanzar: un error acá se convierte en un
  // 500 que sugiere una falla del servidor, cuando lo que pasó es que el origen
  // no está en la lista.
  callback(null, false);
}
