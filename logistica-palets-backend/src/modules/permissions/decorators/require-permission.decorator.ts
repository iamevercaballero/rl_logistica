import { SetMetadata } from '@nestjs/common';
import type { PermissionAction } from '../entities/role-permission.entity';

export const PERMISSION_KEY = 'requiredPermission';
export type RequiredPermission = { module: string; action: PermissionAction };

/**
 * Permiso fino requerido para este handler, evaluado sobre los permisos
 * *efectivos* del usuario (rol + overrides) — no reemplaza a `@Roles()`, se
 * suma. `@Roles()` sigue siendo el piso grueso (validado primero, en
 * `RolesGuard`); esto afina por persona sobre ese piso.
 *
 * Va SIEMPRE después de `JwtAuthGuard` en `@UseGuards(...)` del controller,
 * nunca como guard global: `PermissionGuard` necesita `req.user`, que recién
 * existe una vez que `JwtAuthGuard` corrió.
 */
export const RequirePermission = (module: string, action: PermissionAction) =>
  SetMetadata(PERMISSION_KEY, { module, action } satisfies RequiredPermission);
