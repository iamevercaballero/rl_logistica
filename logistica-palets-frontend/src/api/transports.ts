import { api } from "./client";

export type Transport = {
  id: string;
  plate: string;
  type: string;
  description?: string;
  active: boolean;
};

export async function listTransports() {
  const { data } = await api.get<Transport[]>("/transports");
  return data;
}

export async function createTransport(payload: {
  plate: string;
  type: string;
  description?: string;
}) {
  const { data } = await api.post<Transport>("/transports", payload);
  return data;
}
