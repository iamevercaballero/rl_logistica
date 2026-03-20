import { api } from "./client";

export type MovementType = "ENTRY" | "EXIT" | "TRANSFER";

export type Movement = {
  id: string;
  type: MovementType;
  date: string;
  reference?: string;
  notes?: string;
};

export type MovementsMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export async function getMovements(params: {
  page?: number;
  limit?: number;
  warehouseId?: string;
  type?: MovementType;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}) {
  const { data } = await api.get<{ data: Movement[]; meta: MovementsMeta }>("/movements", { params });
  return data;
}

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
