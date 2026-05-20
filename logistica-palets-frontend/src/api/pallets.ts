import { api } from "./client";

export type LotPallet = {
  id: string;
  code: string;
  lotId: string;
  quantity: number;
  currentLocationId?: string | null;
  status: string;
  createdAt?: string | null;
  exitedAt?:  string | null;
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

/** Todos los pallets de un lote, sin filtrar por estado (activos + despachados). */
export async function getAllPalletsByLot(lotId: string): Promise<LotPallet[]> {
  const { data } = await api.get<LotPallet[]>("/pallets", { params: { lotId } });
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

/* ── Pallet traceability ──────────────────────────────────────────────────── */

export type PalletHistoryEvent = {
  movementId: string;
  type: string;
  date: string;
  quantity: number;
  documentNumber?: string | null;
  supplier?: string | null;
  carrier?: string | null;
  driver?: string | null;
  destination?: string | null;
  notes?: string | null;
  status: string;
  from?: {
    locationId: string;
    locationCode: string;
    warehouseName?: string | null;
  } | null;
  to?: {
    locationId: string;
    locationCode: string;
    warehouseName?: string | null;
  } | null;
};

export type PalletHistoryResponse = {
  pallet: LotPallet;
  product: { code: string; description: string } | null;
  history: PalletHistoryEvent[];
};

export async function getPalletHistory(id: string): Promise<PalletHistoryResponse> {
  const { data } = await api.get<PalletHistoryResponse>(`/pallets/${id}/history`);
  return data;
}
