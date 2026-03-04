import { api } from "./client";

export async function login(username: string, password: string) {
  const { data } = await api.post("/auth/login", { username, password });

  const token = data.access_token || data.token;
  if (!token) throw new Error("No se recibió access_token");

  localStorage.setItem("access_token", token);

  // Forzar user (sin esto el RBAC no puede decidir)
  if (data.user) {
    localStorage.setItem("user", JSON.stringify(data.user));
  } else {
    const me = await api.get("/auth/me"); // <- si esto falla, tiene que fallar el login
    localStorage.setItem("user", JSON.stringify(me.data));
  }

  return data;
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