import { api } from "./client";

export async function movementEntry(payload: {
  reference?: string;
  notes?: string;
  items: Array<{ palletCode: string; lotId: string; locationId: string; quantity: number }>;
}) {
  const { data } = await api.post("/movements/entry", payload);
  return data;
}

export async function movementExit(payload: {
  reference?: string;
  notes?: string;
  items: Array<{ palletId: string; quantity: number }>;
}) {
  const { data } = await api.post("/movements/exit", payload);
  return data;
}

export async function movementTransfer(payload: {
  palletId: string;
  destinationLocationId: string;
  quantity: number;
  reference?: string;
  notes?: string;
}) {
  const { data } = await api.post("/movements/transfer", payload);
  return data;
}
