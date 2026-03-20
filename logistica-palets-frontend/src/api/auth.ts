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
