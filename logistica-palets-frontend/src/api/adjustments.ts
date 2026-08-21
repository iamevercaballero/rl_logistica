import { api } from "./client";
import type { PalletItem } from "./movements";

export type AdjustmentType = "ADJUSTMENT_IN" | "ADJUSTMENT_OUT";
export type AdjustmentStatus = "BORRADOR" | "PENDIENTE_APROBACION" | "APROBADO" | "RECHAZADO";

export const ADJUSTMENT_REASON_OPTIONS = [
  { value: "DIFERENCIA_INVENTARIO", label: "Diferencia de inventario" },
  { value: "CONTEO_FISICO",         label: "Conteo físico" },
  { value: "MERMA",                 label: "Merma" },
  { value: "PERDIDA",               label: "Pérdida" },
  { value: "ROTURA",                label: "Rotura" },
  { value: "SOBRANTE",              label: "Sobrante" },
  { value: "OBSOLETO",              label: "Obsoleto" },
  { value: "OTRO",                  label: "Otro" },
] as const;

export type AdjustmentRequest = {
  id: string;
  code: string;
  type: AdjustmentType;
  status: AdjustmentStatus;
  reason: string;
  adjustmentCategory?: string | null;
  warehouseId?: string | null;
  locationId?: string | null;
  notes?: string | null;
  rejectReason?: string | null;
  totalLines: number;
  totalQuantity: number;
  createdById: string;
  approvedById?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdjustmentLine = {
  id: string;
  requestId: string;
  productId: string;
  palletItems: PalletItem[];
  totalQuantity: number;
  locationId?: string | null;
};

export type AdjustmentRequestDetail = {
  request: AdjustmentRequest;
  lines: AdjustmentLine[];
};

export type CreateAdjustmentLinePayload = {
  productId: string;
  palletItems: PalletItem[];
  locationId?: string;
};

export type CreateAdjustmentPayload = {
  type: AdjustmentType;
  reason: string;
  adjustmentCategory?: string;
  warehouseId?: string;
  locationId?: string;
  notes?: string;
  lines: CreateAdjustmentLinePayload[];
};

export type UpdateAdjustmentPayload = Partial<Omit<CreateAdjustmentPayload, "type" | "lines">> & {
  lines?: CreateAdjustmentLinePayload[];
};

export async function createAdjustmentDraft(
  payload: CreateAdjustmentPayload,
): Promise<{ requestId: string; code: string }> {
  const { data } = await api.post("/adjustments", payload);
  return data;
}

export async function updateAdjustmentDraft(
  id: string,
  payload: UpdateAdjustmentPayload,
): Promise<{ requestId: string; code: string }> {
  const { data } = await api.patch(`/adjustments/${id}`, payload);
  return data;
}

export async function submitAdjustmentForApproval(
  id: string,
): Promise<{ requestId: string; code: string; status: AdjustmentStatus }> {
  const { data } = await api.patch(`/adjustments/${id}/submit`, {});
  return data;
}

export async function approveAdjustment(
  id: string,
): Promise<{ requestId: string; code: string; movementIds: string[] }> {
  const { data } = await api.patch(`/adjustments/${id}/approve`, {});
  return data;
}

export async function rejectAdjustment(
  id: string,
  rejectReason: string,
): Promise<{ requestId: string; code: string; status: AdjustmentStatus }> {
  const { data } = await api.patch(`/adjustments/${id}/reject`, { rejectReason });
  return data;
}

export async function cancelAdjustment(
  id: string,
): Promise<{ requestId: string; code: string }> {
  const { data } = await api.patch(`/adjustments/${id}/cancel`, {});
  return data;
}

export async function getAdjustments(params: {
  type?: AdjustmentType;
  status?: AdjustmentStatus;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  /** El backend ya lo soporta (ver `AdjustmentQueryDto`); faltaba exponerlo acá. */
  warehouseId?: string;
}): Promise<{ data: AdjustmentRequest[]; meta: { page: number; limit: number; total: number; totalPages: number } }> {
  const { data } = await api.get("/adjustments", { params });
  return data;
}

export async function getAdjustment(id: string): Promise<AdjustmentRequestDetail> {
  const { data } = await api.get(`/adjustments/${id}`);
  return data;
}
