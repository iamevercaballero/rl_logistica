import { api } from "./client";

export type MovementType = "ENTRY" | "EXIT" | "TRANSFER" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | "REPROCESS";

export type Movement = {
  id: string;
  type: MovementType;
  date: string;
  quantity: number;
  pallets?: number | null;
  documentNumber?: string | null;
  supplier?: string | null;
  carrier?: string | null;
  driver?: string | null;
  destination?: string | null;
  notes?: string | null;
  material: {
    id: string;
    code: string;
    description: string;
    unitOfMeasure?: string | null;
  };
  warehouse?: { id: string; name: string } | null;
  location?: { id: string; code: string } | null;
  from?: { warehouseId?: string | null; warehouseName?: string | null; locationId?: string | null; locationCode?: string | null } | null;
  to?: { warehouseId?: string | null; warehouseName?: string | null; locationId?: string | null; locationCode?: string | null } | null;
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
  locationId?: string;
  productId?: string;
  type?: MovementType;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}) {
  const { data } = await api.get<{ data: Movement[]; meta: MovementsMeta }>("/movements", { params });
  return data;
}

export async function createMovement(payload: {
  type: MovementType;
  date?: string;
  productId: string;
  quantity: number;
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
}) {
  const { data } = await api.post("/movements", payload);
  return data;
}
