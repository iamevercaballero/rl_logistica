import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import { clientIp, type ProxyRequest } from './client-ip';

/**
 * ThrottlerGuard con mensajes para el operador, no para el desarrollador.
 *
 * Por defecto el guard responde `"ThrottlerException: Too Many Requests"`, que es
 * lo que terminaba viendo el usuario en la pantalla de login. El mensaje se define
 * acá (en el backend) para que valga igual desde el frontend, la app móvil o
 * cualquier integración.
 */
@Injectable()
export class FriendlyThrottlerGuard extends ThrottlerGuard {
  /**
   * Clave de conteo: la IP **real** del cliente.
   *
   * El `getTracker` de la librería devuelve `req.ip`, que detrás del túnel de
   * Cloudflare es la IP del contenedor `cloudflared` — la misma para todo el
   * mundo. Con eso, el límite de 5 intentos de login por minuto "por IP" pasa a
   * ser de 5 por minuto para toda la empresa: al tercer error de un operador,
   * el resto se queda afuera. Y al revés, los intentos de un atacante se
   * mezclan con el tráfico legítimo en el mismo presupuesto.
   */
  protected async getTracker(req: ProxyRequest): Promise<string> {
    return clientIp(req) ?? 'desconocida';
  }

  protected async getErrorMessage(
    context: ExecutionContext,
    _detail: ThrottlerLimitDetail,
  ): Promise<string> {
    const request = context.switchToHttp().getRequest<{ url?: string }>();

    if (request?.url?.includes('/auth/login')) {
      return 'Demasiados intentos de inicio de sesión. Esperá un minuto e intentá nuevamente.';
    }

    return 'Estás enviando demasiadas solicitudes seguidas. Esperá un momento e intentá nuevamente.';
  }
}
