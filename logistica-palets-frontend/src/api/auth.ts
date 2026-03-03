import { api, tokenStore } from "./client";

export type LoginResponse = {
  access_token: string;
  user: { id: string; username: string; role: string };
};

export async function login(username: string, password: string) {
  const { data } = await api.post<LoginResponse>("/auth/login", { username, password });
  tokenStore.set(data.access_token);
  localStorage.setItem("user", JSON.stringify(data.user));
  return data;
}

export function logout() {
  tokenStore.clear();
  localStorage.removeItem("user");
}
