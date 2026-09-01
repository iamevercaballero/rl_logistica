/**
 * Identidad de red de una petición: IP real del cliente, user-agent y el id de
 * correlación. Lo usan la bitácora de autenticación y el limitador de tasa.
 *
 * El problema que resuelve: en producción la app no recibe conexiones directas.
 * El cliente entra por el borde de Cloudflare, que habla con el contenedor
 * `cloudflared`, y ese contenedor es quien abre la conexión al backend por la
 * red interna de Docker. Sin nada de esto, `req.ip` es **siempre la misma IP**
 * —la del túnel— para todos los usuarios. Eso no sólo vacía de sentido el
 * registro de accesos: convierte el límite de 5 intentos de login por minuto
 * "por IP" en 5 intentos por minuto **para toda la empresa**, y el límite
 * general en un presupuesto compartido.
 */

export type ProxyRequest = {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  id?: unknown;
};

/**
 * Cómo interpretar `TRUST_PROXY`, la variable que declara que la app corre
 * detrás de un proxy de confianza.
 *
 * Es explícita a propósito, sin default activo: si estuviera prendida por
 * descuido en un despliegue donde el backend sí recibe conexiones directas,
 * cualquiera podría falsificar su IP con una cabecera y saltearse el limitador
 * de tasa. Vale más un límite mal repartido que un límite evitable.
 *
 * Valores: un número de saltos (`1`), `true`, o una lista de IPs/CIDR que
 * Express acepta tal cual.
 */
export function parseTrustProxy(raw = process.env.TRUST_PROXY): number | boolean | string | null {
  const valor = raw?.trim();
  if (!valor) return null;
  if (valor === 'true') return true;
  if (valor === 'false') return false;
  if (/^\d+$/.test(valor)) return Number(valor);
  return valor;
}

/** `true` si el despliegue declaró estar detrás de un proxy de confianza. */
export function behindTrustedProxy(raw = process.env.TRUST_PROXY): boolean {
  const parsed = parseTrustProxy(raw);
  return parsed !== null && parsed !== false && parsed !== 0;
}

function primerValor(valor: string | string[] | undefined): string | undefined {
  if (Array.isArray(valor)) return valor[0];
  return valor;
}

/**
 * IP real del cliente, o `null` si no se puede determinar.
 *
 * Se prefiere `CF-Connecting-IP` porque el borde de Cloudflare la **reescribe**
 * en cada petición: un cliente no puede falsificarla, a diferencia de
 * `X-Forwarded-For`, donde sólo agrega una entrada al final de lo que haya
 * mandado. Pero se lee únicamente cuando el despliegue declaró estar detrás de
 * un proxy: si el backend quedara expuesto de forma directa, esa cabecera la
 * pone quien quiera.
 *
 * Sin proxy declarado se usa `req.ip`, que es lo correcto en desarrollo y en
 * cualquier despliegue sin intermediarios.
 */
export function clientIp(req: ProxyRequest | undefined, trustProxyRaw = process.env.TRUST_PROXY): string | null {
  if (!req) return null;

  if (behindTrustedProxy(trustProxyRaw)) {
    const cloudflare = primerValor(req.headers?.['cf-connecting-ip'])?.trim();
    if (cloudflare) return normalizar(cloudflare);
  }

  // `req.ip` ya resuelve X-Forwarded-For cuando Express tiene `trust proxy`
  // configurado; si no, es la dirección del socket, que es lo correcto sin
  // intermediarios.
  const directa = req.ip ?? req.socket?.remoteAddress;
  return directa ? normalizar(directa) : null;
}

/**
 * `::ffff:190.x.x.x` → `190.x.x.x`. Node representa así las conexiones IPv4
 * sobre sockets IPv6, y sin normalizar la misma IP genera dos claves distintas
 * en el limitador de tasa y dos filas distintas en la bitácora.
 */
function normalizar(ip: string): string {
  const limpia = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  return limpia.slice(0, 45); // largo máximo de una IPv6 textual
}

/** User-agent recortado a lo que entra en la columna. */
export function userAgent(req: ProxyRequest | undefined, max = 255): string | null {
  const ua = primerValor(req?.headers?.['user-agent'])?.trim();
  return ua ? ua.slice(0, max) : null;
}

/**
 * Id de correlación de la petición. Lo genera `genReqId` de pino y viaja además
 * en la cabecera `X-Request-Id` de la respuesta, así que el operador que ve un
 * error puede dictarlo y se llega directo a sus líneas de log.
 */
export function requestId(req: ProxyRequest | undefined): string | null {
  const id = req?.id;
  if (typeof id === 'string' && id.trim()) return id.trim().slice(0, 64);
  if (typeof id === 'number') return String(id);
  return null;
}
