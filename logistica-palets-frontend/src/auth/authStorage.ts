import type { AuthUser, EffectivePermissions } from "./AuthContext";

const USER_KEY = "user";

/**
 * Token de acceso: en memoria, nunca en localStorage (RL-M-01).
 *
 * En localStorage lo lee cualquier script que llegue a ejecutarse en el origen
 * —una dependencia comprometida, un XSS— y, peor, sobrevive al cierre de la
 * pestaña: se puede robar hoy y usar mañana desde otra máquina. En memoria
 * muere con la pestaña, así que deja de ser un secreto persistente.
 *
 * No hace que un XSS sea inofensivo: mientras la página corre, el script puede
 * usar la sesión igual. Lo que quita es la exfiltración de una credencial que
 * dura horas.
 *
 * La sesión se sigue recuperando al recargar porque el refresh token vive en
 * una cookie HttpOnly —esa sí inalcanzable para el script— y el arranque pide
 * un token nuevo con ella.
 */
let accessToken = "";

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
  return accessToken;
}

export function setToken(token: string) {
  accessToken = token;
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
  accessToken = "";
  localStorage.removeItem(USER_KEY);
  // Restos de la versión que guardaba el token acá: se limpian una vez para que
  // no quede una credencial vieja en el navegador de nadie.
  localStorage.removeItem("access_token");
}
