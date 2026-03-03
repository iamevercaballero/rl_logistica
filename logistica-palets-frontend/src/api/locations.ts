import { api } from "./client";

export type Location = {
  id: string;
  code: string;
  warehouseId?: string;
  active?: boolean;
};

export async function listLocations() {
  const { data } = await api.get<Location[]>("/locations");
  return data;
}

export async function createLocation(payload: {
  code: string;
  warehouseId: string;
}) {
  const { data } = await api.post<Location>("/locations", payload);
  return data;
}
