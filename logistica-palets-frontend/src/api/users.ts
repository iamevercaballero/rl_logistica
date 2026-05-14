import { api } from "./client";

export type AppUser = {
  id: string;
  username: string;
  fullName?: string | null;
  role: string;
  active?: boolean;
};

export async function listUsers(): Promise<AppUser[]> {
  const { data } = await api.get<AppUser[]>("/users");
  return data;
}

export async function listActiveUsers(): Promise<AppUser[]> {
  const { data } = await api.get<AppUser[]>("/users/active");
  return data;
}

export async function createUser(payload: {
  username: string;
  password: string;
  role?: string;
  fullName?: string;
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

export async function deleteUser(id: string): Promise<void> {
  await api.delete(`/users/${id}`);
}
