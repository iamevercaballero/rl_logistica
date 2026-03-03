import { api } from "./client";

export type WarehouseStockRow = {
  id: string;
  name: string;
  total_units: number;
  total_pallets: number;
};

export type KpisResponse = {
  totalPallets: number;
  totalUnits: number;
  movementsToday: number;
  stockByWarehouse: WarehouseStockRow[];
};

export async function getKpis(): Promise<KpisResponse> {
  const { data } = await api.get<KpisResponse>("/reports/kpis");
  return data;
}
