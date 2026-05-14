import { api } from "./client";

export type LotPallet = {
  id: string;
  code: string;
  lotId: string;
  quantity: number;
  currentLocationId?: string | null;
  status: string;
};

/** Alias de compatibilidad para la página Palets */
export type Pallet = LotPallet;

export async function listPallets(): Promise<LotPallet[]> {
  const { data } = await api.get<LotPallet[]>("/pallets");
  return data;
}

export async function getPalletsByLot(lotId: string, status = "AVAILABLE"): Promise<LotPallet[]> {
  const { data } = await api.get<LotPallet[]>("/pallets", { params: { lotId, status } });
  return data;
}

export async function createPallet(payload: {
  code: string;
  lotId: string;
  quantity: number;
  currentLocationId?: string;
  status?: string;
}): Promise<LotPallet> {
  const { data } = await api.post<LotPallet>("/pallets", payload);
  return data;
}

export async function deletePallet(id: string): Promise<void> {
  await api.delete(`/pallets/${id}`);
}
