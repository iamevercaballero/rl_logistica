import { api } from "./client";

export type Pallet = {
  id: string;
  code: string;
  lotId: string;
  quantity: number;
  currentLocationId: string;
  status: string;
};

export async function listPallets() {
  const { data } = await api.get<Pallet[]>("/pallets");
  return data;
}

export async function createPallet(payload: {
  code: string;
  lotId: string;
  quantity: number;
  currentLocationId: string;
  status?: string;
}) {
  const { data } = await api.post<Pallet>("/pallets", payload);
  return data;
}

export async function deletePallet(id: string) {
  await api.delete(`/pallets/${id}`);
}
