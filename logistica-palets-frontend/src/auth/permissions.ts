import type { AuthUser } from "./AuthContext";
import { PERMS, type ModuleKey, type Role } from "./rbac";

export type PermissionActionKey = "read" | "create" | "update" | "remove" | "approve";

/**
 * ¿Puede este usuario `action` en `module`?
 *
 * Fuente primaria: `permissions` efectivos de `/auth/me` — la plantilla del
 * rol (`role_permissions`) con los overrides puntuales del usuario
 * (`user_permissions`) ya aplicados por el backend. Ahí confiamos siempre que
 * haya respuesta real, incluso si para ESE módulo puntual da cero acciones
 * (`permissions` pruna los módulos vacíos — ausencia de la clave ahí ya es
 * "no", no "no sé").
 *
 * Solo cae a la matriz estática de `rbac.ts` (el comportamiento previo a esta
 * migración) cuando `permissions` es `undefined` — un `user` cacheado de
 * antes de que existiera este campo. Es una red para la transición, no una
 * fuente de verdad paralela: en cuanto se resuelve un `/auth/me` fresco, deja
 * de usarse.
 */
export function can(
  user: Pick<AuthUser, "role" | "permissions"> | null | undefined,
  module: ModuleKey,
  action: PermissionActionKey,
): boolean {
  if (!user) return false;
  if (user.permissions) {
    return !!user.permissions[module]?.includes(action);
  }
  return staticFallback(module, action, user.role);
}

function staticFallback(module: ModuleKey, action: PermissionActionKey, role: Role): boolean {
  const perms = PERMS[module];
  switch (action) {
    case "read": return perms.read.includes(role);
    case "create": return perms.create.includes(role);
    case "update": return perms.update.includes(role);
    case "remove": return perms.remove.includes(role);
    case "approve": return (perms.approve ?? []).includes(role);
  }
}
