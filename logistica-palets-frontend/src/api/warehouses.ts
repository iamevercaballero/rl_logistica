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

/** Ubicación con estructura y ocupación, tal como la devuelve GET /warehouses/:id/layout */
export type LayoutLocation = {
  id: string;
  code: string;
  type: string;
  active: boolean;
  zone: string | null;
  aisle: string | null;
  rack: string | null;
  capacityBases: number | null;
  basesUsed: number;
  pallets: number;
  units: number;
};

export type WarehouseLayout = {
  warehouse: Warehouse;
  locations: LayoutLocation[];
  summary: {
    totalLocations: number;
    activeLocations: number;
    occupied: number;
    totalPallets: number;
    totalUnits: number;
    byZone: { zone: string; locations: number; occupied: number; pallets: number; units: number }[];
  };
};

export async function getWarehouseLayout(id: string): Promise<WarehouseLayout> {
  const { data } = await api.get<WarehouseLayout>(`/warehouses/${id}/layout`);
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

export async function deleteWarehouse(id: string) {
  await api.delete(`/warehouses/${id}`);
}
