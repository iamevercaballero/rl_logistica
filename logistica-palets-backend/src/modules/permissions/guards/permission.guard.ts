import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from '../permissions.service';
import { PERMISSION_KEY, RequiredPermission } from '../decorators/require-permission.decorator';
import type { UserRole } from '../../users/entities/user.entity';

/**
 * Aplica `@RequirePermission(module, action)`. Sin ese decorador, deja pasar
 * — así conviven endpoints ya migrados con el resto que sigue confiando
 * solo en `@Roles()`.
 *
 * Debe ir DESPUÉS de `JwtAuthGuard` en `@UseGuards(...)`: lee `req.user`, que
 * `JwtAuthGuard` es quien lo pone.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<RequiredPermission | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as { userId: string; role: UserRole } | undefined;
    // No debería pasar con JwtAuthGuard antes en la cadena; si pasa, más vale
    // cortar acá que asumir un usuario que no se autenticó.
    if (!user) throw new UnauthorizedException();

    await this.permissions.assertPermission(user.userId, user.role, required.module, required.action);
    return true;
  }
}
