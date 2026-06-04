import { api } from "./client";

export type PlanStatus = "PLANNED" | "CONFIRMED" | "EXECUTED" | "CANCELLED";
export type PlanType = "ENTRY" | "EXIT";

export type ProductionPlanRow = {
  id: string;
  plannedDate: string;
  type: PlanType;
  status: PlanStatus;
  plannedQuantity: number;
  plannedPallets: number | null;
  supplier: string | null;
  destination: string | null;
  carrier: string | null;
  notes: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  product: {
    id: string;
    code: string;
    description: string;
    unitOfMeasure: string | null;
  };
  warehouseName: string | null;
  locationCode: string | null;
};

export type ProductionPlanListResponse = {
  data: ProductionPlanRow[];
  meta: { page: number; limit: number; total: number; totalPages: number };
};

export type CreateProductionPlanPayload = {
  plannedDate: string;
  type: PlanType;
  productId: string;
  warehouseId?: string;
  locationId?: string;
  plannedQuantity: number;
  plannedPallets?: number;
  supplier?: string;
  destination?: string;
  carrier?: string;
  notes?: string;
};

export async function listProductionPlans(params?: {
  status?: PlanStatus;
  type?: PlanType;
  productId?: string;
  warehouseId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}) {
  const { data } = await api.get<ProductionPlanListResponse>("/production-plans", { params });
  return data;
}

export async function getUpcomingPlans(days = 7) {
  const { data } = await api.get<ProductionPlanRow[]>("/production-plans/upcoming", {
    params: { days },
  });
  return data;
}

export async function createProductionPlan(payload: CreateProductionPlanPayload) {
  const { data } = await api.post<ProductionPlanRow>("/production-plans", payload);
  return data;
}

export async function updateProductionPlan(
  id: string,
  payload: Partial<CreateProductionPlanPayload & { status: PlanStatus }>,
) {
  const { data } = await api.patch<ProductionPlanRow>(`/production-plans/${id}`, payload);
  return data;
}

export async function deleteProductionPlan(id: string) {
  const { data } = await api.delete<ProductionPlanRow>(`/production-plans/${id}`);
  return data;
}
