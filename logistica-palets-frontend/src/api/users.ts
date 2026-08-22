import { api } from "./client";

export type AppUser = {
  id: string;
  username: string;
  fullName?: string | null;
  role: string;
  active?: boolean;
  /** Depósitos asignados — solo viene en `listUsers()`, para el buscador/filtro. */
  warehouseIds?: string[];
};

export type UserDetail = AppUser & {
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
};

export async function listUsers(): Promise<AppUser[]> {
  const { data } = await api.get<AppUser[]>("/users");
  return data;
}

export async function listActiveUsers(): Promise<AppUser[]> {
  const { data } = await api.get<AppUser[]>("/users/active");
  return data;
}

export async function getUser(id: string): Promise<UserDetail> {
  const { data } = await api.get<UserDetail>(`/users/${id}`);
  return data;
}

export async function createUser(payload: {
  username: string;
  password: string;
  role?: string;
  fullName?: string;
  mustChangePassword?: boolean;
}): Promise<AppUser> {
  const { data } = await api.post<AppUser>("/users", payload);
  return data;
}

export async function updateUser(id: string, payload: Partial<{
  username: string;
  password: string;
  role: string;
  fullName: string;
  active: boolean;
}>): Promise<AppUser> {
  const { data } = await api.patch<AppUser>(`/users/${id}`, payload);
  return data;
}

/** Baja lógica — el usuario queda inactivo, nunca se borra. */
export async function deleteUser(id: string): Promise<void> {
  await api.delete(`/users/${id}`);
}

/* ── Depósitos ────────────────────────────────────────────────────────────── */

export async function getUserWarehouses(id: string): Promise<string[]> {
  const { data } = await api.get<string[]>(`/users/${id}/warehouses`);
  return data;
}

export async function setUserWarehouses(id: string, warehouseIds: string[]): Promise<string[]> {
  const { data } = await api.put<string[]>(`/users/${id}/warehouses`, { warehouseIds });
  return data;
}

/* ── Permisos ─────────────────────────────────────────────────────────────── */

export type PermissionEffect = "ALLOW" | "DENY";

/** módulo → acciones efectivas. Ausencia de módulo = sin permiso ahí. */
export type EffectivePermissions = Record<string, string[]>;

export type UserPermissionOverride = {
  id: string;
  userId: string;
  module: string;
  action: string;
  effect: PermissionEffect;
  createdAt: string;
  updatedAt: string;
};

export type UserPermissionsResponse = {
  role: string;
  roleDefaults: EffectivePermissions;
  overrides: UserPermissionOverride[];
  effective: EffectivePermissions;
};

export type PermissionOverrideInput = { module: string; action: string; effect: PermissionEffect };

export async function getUserPermissions(id: string): Promise<UserPermissionsResponse> {
  const { data } = await api.get<UserPermissionsResponse>(`/users/${id}/permissions`);
  return data;
}

/** Reemplaza el conjunto completo de overrides — no es incremental. */
export async function setUserPermissions(id: string, overrides: PermissionOverrideInput[]): Promise<EffectivePermissions> {
  const { data } = await api.put<EffectivePermissions>(`/users/${id}/permissions`, { overrides });
  return data;
}

export async function restoreUserPermissions(id: string): Promise<EffectivePermissions> {
  const { data } = await api.post<EffectivePermissions>(`/users/${id}/permissions/restore`);
  return data;
}

/* ── Historial ────────────────────────────────────────────────────────────── */

export type UserAuditAction =
  | "USER_CREATED"
  | "USER_UPDATED"
  | "ROLE_CHANGED"
  | "USER_ACTIVATED"
  | "USER_DEACTIVATED"
  | "PASSWORD_RESET"
  | "SESSIONS_CLOSED"
  | "WAREHOUSE_ASSIGNED"
  | "WAREHOUSE_REMOVED"
  | "PERMISSION_GRANTED"
  | "PERMISSION_REVOKED"
  | "PERMISSIONS_RESTORED";

export type UserAuditEntry = {
  id: string;
  actorUserId: string;
  targetUserId: string;
  action: UserAuditAction;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
};

export async function getUserAuditLog(id: string): Promise<UserAuditEntry[]> {
  const { data } = await api.get<UserAuditEntry[]>(`/users/${id}/audit-log`);
  return data;
}

/* ── Seguridad ────────────────────────────────────────────────────────────── */

export async function resetUserPassword(
  id: string,
  newPassword: string,
  mustChangePassword = true,
): Promise<{ reset: boolean }> {
  const { data } = await api.post<{ reset: boolean }>(`/users/${id}/reset-password`, { newPassword, mustChangePassword });
  return data;
}

export async function closeUserSessions(id: string): Promise<{ closed: boolean }> {
  const { data } = await api.post<{ closed: boolean }>(`/users/${id}/close-sessions`);
  return data;
}
