import type { AuthUser, EffectivePermissions } from "./AuthContext";

const TOKEN_KEY = "access_token";
const USER_KEY = "user";

type RawAuthUser = Partial<AuthUser> & {
  id?: string;
  userId?: string;
  username?: string;
  role?: AuthUser["role"];
  fullName?: string | null;
  active?: boolean;
  mustChangePassword?: boolean;
  permissions?: EffectivePermissions;
};

/**
 * `permissions` viaja tal cual llega — `undefined` si la respuesta no lo trae
 * (ej. un `user` viejo en localStorage, de antes de esta migración), un
 * objeto (aunque esté vacío) si `/auth/me` respondió. `can()` distingue "no
 * hay permisos reales todavía" de "el usuario tiene cero permisos en algo" a
 * partir de esta diferencia — no default a `{}` acá.
 */
export function normalizeAuthUser(user: RawAuthUser | null | undefined): AuthUser | null {
  if (!user) {
    return null;
  }

  const userId = user.userId ?? user.id;
  if (!userId || !user.username || !user.role) {
    return null;
  }

  return {
    userId,
    username: user.username,
    fullName: user.fullName ?? null,
    role: user.role,
    active: user.active ?? true,
    mustChangePassword: user.mustChangePassword ?? false,
    permissions: user.permissions && typeof user.permissions === "object" ? user.permissions : undefined,
  };
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function setStoredUser(user: AuthUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) {
    return null;
  }

  try {
    return normalizeAuthUser(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearAuthStorage() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
