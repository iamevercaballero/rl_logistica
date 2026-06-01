import { api } from "./client";

export type LotPallet = {
  id: string;
  code: string;
  lotId: string;
  quantity: number;
  currentLocationId?: string | null;
  status: string;
  createdAt?: string | null;
  exitedAt?: string | null;
  // Enriched fields (present when returned from GET /pallets)
  lotCode?: string;
  fechaVencimiento?: string | null;
  productId?: string;
  productCode?: string;
  productDescription?: string;
  stackable?: boolean;
  maxStackLevel?: number | null;
  canReceiveWeightOnTop?: boolean;
  locationCode?: string | null;
  warehouseId?: string | null;
  warehouseName?: string | null;
};

export type Pallet = LotPallet;

export type PalletKpis = {
  total: number;
  available: number;
  partial: number;
  blocked: number;
  damaged: number;
  inTransit: number;
  exited: number;
  empty: number;
  noLocation: number;
};

export async function listPallets(filters?: {
  lotId?: string;
  status?: string;
  productId?: string;
  locationId?: string;
  search?: string;
}): Promise<LotPallet[]> {
  const params: Record<string, string> = {};
  if (filters?.lotId)      params.lotId      = filters.lotId;
  if (filters?.status)     params.status     = filters.status;
  if (filters?.productId)  params.productId  = filters.productId;
  if (filters?.locationId) params.locationId = filters.locationId;
  if (filters?.search)     params.search     = filters.search;
  const { data } = await api.get<LotPallet[]>("/pallets", { params });
  return data;
}

export async function getPalletsByLot(lotId: string, status = "AVAILABLE"): Promise<LotPallet[]> {
  const { data } = await api.get<LotPallet[]>("/pallets", { params: { lotId, status } });
  return data;
}

export async function getAllPalletsByLot(lotId: string): Promise<LotPallet[]> {
  const { data } = await api.get<LotPallet[]>("/pallets", { params: { lotId } });
  return data;
}

export async function getPalletKpis(): Promise<PalletKpis> {
  const { data } = await api.get<PalletKpis>("/pallets/kpis");
  return data;
}

export async function reconcilePalletStatuses(): Promise<{ exited: number; partial: number }> {
  const { data } = await api.post<{ exited: number; partial: number }>("/pallets/reconcile-status");
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

export async function updatePallet(id: string, payload: Partial<{
  quantity: number;
  currentLocationId: string | null;
  status: string;
}>): Promise<LotPallet> {
  const { data } = await api.patch<LotPallet>(`/pallets/${id}`, payload);
  return data;
}

export async function quickTransferPallet(palletId: string, toLocationId: string): Promise<LotPallet> {
  const { data } = await api.post<LotPallet>(`/pallets/${palletId}/transfer`, { toLocationId });
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
  remainingAfter?: number;
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
