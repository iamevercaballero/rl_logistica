import { api } from "./client";
import { normalizeAuthUser } from "../auth/authStorage";

type LoginResponse = {
  access_token?: string;
  token?: string;
  user?: {
    id?: string;
    userId?: string;
    username?: string;
    role?: "ADMIN" | "MANAGER" | "OPERATOR" | "AUDITOR";
  };
};

export async function login(username: string, password: string) {
  const { data } = await api.post<LoginResponse>("/auth/login", { username, password });

  const token = data.access_token || data.token;
  if (!token) {
    throw new Error("No se recibió access_token");
  }

  const normalizedUser = normalizeAuthUser(data.user);
  if (normalizedUser) {
    return { access_token: token, user: normalizedUser };
  }

  const me = await api.get("/auth/me");
  const hydratedUser = normalizeAuthUser(me.data);
  if (!hydratedUser) {
    throw new Error("No se pudo obtener el usuario autenticado");
  }

  return { access_token: token, user: hydratedUser };
}

/**
 * Cambio de contraseña propia.
 *
 * OJO: el backend actualiza `passwordChangedAt`, y `jwt.strategy` rechaza todo
 * token emitido antes de esa marca. O sea que **esta llamada invalida la sesión
 * en curso**: quien la use tiene que cerrar sesión y volver a entrar, o el
 * siguiente request choca con un 401 y el interceptor lo saca de la app sin
 * explicar por qué.
 */
export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.post("/auth/change-password", { currentPassword, newPassword });
}
