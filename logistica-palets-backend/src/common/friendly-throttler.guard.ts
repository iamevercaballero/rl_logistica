import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

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
