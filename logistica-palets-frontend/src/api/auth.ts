import { api } from "./client";

type LoginResponse = {
  access_token?: string;
  token?: string;
  user?: {
    userId: string;
    username: string;
    role: "ADMIN" | "MANAGER" | "OPERATOR" | "AUDITOR";
  };
};

export async function login(username: string, password: string) {
  const { data } = await api.post<LoginResponse>("/auth/login", { username, password });

  const token = data.access_token || data.token;
  if (!token) throw new Error("No se recibió access_token");

  // Asegurar user para que AuthContext pueda hidratarse inmediatamente.
  if (data.user) {
    return { access_token: token, user: data.user };
  }

  const me = await api.get("/auth/me"); // si esto falla, tiene que fallar el login
  return { access_token: token, user: me.data };
}

export function logout() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("user");
}

export function getUser() {
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
