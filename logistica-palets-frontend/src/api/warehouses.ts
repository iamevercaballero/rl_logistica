import { api } from "./client";

export type Warehouse = {
  id: string;
  name: string;
  address?: string;
  active: boolean;
};

export async function listWarehouses() {
  const { data } = await api.get<Warehouse[]>("/warehouses");
  return data;
}

export async function createWarehouse(payload: {
  name: string;
  address?: string;
  active?: boolean;
}) {
  const { data } = await api.post<Warehouse>("/warehouses", payload);
  return data;
}
