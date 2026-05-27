import { api } from "./client";

export type MovementType = "ENTRY" | "EXIT" | "TRANSFER" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT";
export type MovementStatus = "NORMAL" | "PENDING_REGULARIZATION";

export const ADJUSTMENT_REASONS = [
  { value: "DIFERENCIA_INVENTARIO", label: "Diferencia de inventario" },
  { value: "CONTEO_FISICO",         label: "Conteo físico" },
  { value: "MERMA",                 label: "Merma" },
  { value: "PERDIDA",               label: "Pérdida" },
  { value: "ROTURA",                label: "Rotura" },
  { value: "SOBRANTE",              label: "Sobrante" },
  { value: "OTRO",                  label: "Otro" },
] as const;

export type PalletItem = {
  palletId?: string;
  lotCode?: string;
  quantity: number;
  fechaVencimiento?: string;
  fechaFabricacion?: string;
  sapLot?: string;
  proveedor?: string;
};

export type Movement = {
  id: string;
  type: MovementType;
  status: MovementStatus;
  date: string;
  quantity: number;
  pallets?: number | null;
  documentNumber?: string | null;
  supplier?: string | null;
  carrier?: string | null;
  driver?: string | null;
  destination?: string | null;
  notes?: string | null;
  lotId?: string | null;
  lotCode?: string | null;
  sapLot?: string | null;
  adjustmentReason?: string | null;
  adjustmentCategory?: string | null;
  encargado?: { id: string; username: string; fullName?: string | null } | null;
  material: { id: string; code: string; description: string; unitOfMeasure?: string | null };
  warehouse?: { id: string; name: string } | null;
  location?: { id: string; code: string } | null;
  from?: { warehouseId?: string | null; warehouseName?: string | null; locationId?: string | null; locationCode?: string | null } | null;
  to?: { warehouseId?: string | null; warehouseName?: string | null; locationId?: string | null; locationCode?: string | null } | null;
};

export type MovementsMeta = { page: number; limit: number; total: number; totalPages: number };

export async function getMovements(params: {
  page?: number; limit?: number; warehouseId?: string; locationId?: string;
  productId?: string; type?: MovementType; dateFrom?: string; dateTo?: string;
  search?: string; status?: MovementStatus;
}): Promise<{ data: Movement[]; meta: MovementsMeta }> {
  const { data } = await api.get<{ data: Movement[]; meta: MovementsMeta }>("/movements", { params });
  return data;
}

export async function createMovement(payload: {
  type: MovementType;
  date?: string;
  productId: string;
  quantity?: number;
  pallets?: number;
  warehouseId?: string;
  locationId?: string;
  fromLocationId?: string;
  toLocationId?: string;
  documentNumber?: string;
  supplier?: string;
  carrier?: string;
  driver?: string;
  destination?: string;
  notes?: string;
  lotId?: string;
  encargadoRecepcionId?: string;
  isProvisional?: boolean;
  adjustmentReason?: string;
  adjustmentCategory?: string;
  palletItems?: PalletItem[];
}): Promise<{ movementId: string; stockImpact: string }> {
  const { data } = await api.post("/movements", payload);
  return data;
}

export async function regularizeMovement(id: string, payload: {
  reason: string;
  documentNumber?: string;
  supplier?: string;
  carrier?: string;
  driver?: string;
  destination?: string;
  notes?: string;
  sapLot?: string;
  fechaVencimiento?: string;
  fechaFabricacion?: string;
  proveedor?: string;
}): Promise<{ regularized: boolean; changes: number }> {
  const { data } = await api.patch(`/movements/${id}/regularize`, payload);
  return data;
}
