import { api } from "./client";

export type Lot = {
  id: string;
  lotCode: string;
  product?: { id: string; code: string };
};

export async function listLots() {
  const { data } = await api.get<Lot[]>("/lots");
  return data;
}

export async function createLot(payload: { lotCode: string; productId: string }) {
  const { data } = await api.post<Lot>("/lots", payload);
  return data;
}

export async function deleteLot(id: string) {
  await api.delete(`/lots/${id}`);
}
