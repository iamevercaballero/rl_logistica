import { api } from "./client";
import type { MovementType } from "./movements";

export type ReportRange = "today" | "week" | "month";

export type StockByWarehouseRow = {
  warehouseId: string;
  warehouseName: string;
  quantity: number;
};

export type StockByMaterialRow = {
  productId: string;
  code: string;
  description: string;
  unitOfMeasure?: string | null;
  quantity: number;
};

export type StockItemRow = {
  id: string;
  currentQuantity: number;
  updatedAt: string;
  material: {
    id: string;
    code: string;
    description: string;
    unitOfMeasure?: string | null;
  };
  warehouse?: { id: string; name: string } | null;
  location?: { id: string; code: string } | null;
};

export type StockReportResponse = {
  totalMaterials: number;
  stockRows: number;
  totalQuantity: number;
  byWarehouse: StockByWarehouseRow[];
  byMaterial: StockByMaterialRow[];
  items: StockItemRow[];
};

export type ReportMovementRow = {
  id: string;
  type: MovementType;
  date: string;
  quantity: number;
  pallets?: number | null;
  lotCode?: string | null;       // single code, OR comma-separated when multi-lot palletItems
  sapLot?: string | null;        // same
  lotCount?: number;             // 0, 1, or N (N>1 = multi-lot)
  status?: 'NORMAL' | 'PENDING_REGULARIZATION';
  adjustmentReason?: string | null;
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
  from?: { warehouseName?: string | null; locationCode?: string | null } | null;
  to?: { warehouseName?: string | null; locationCode?: string | null } | null;
};

export type ReportMovementsResponse = {
  data: ReportMovementRow[];
  meta: { page: number; limit: number; total: number; totalPages: number };
};

export type ReportTraceEvent = {
  movementId: string;
  at: string;
  type: MovementType;
  quantity: number;
  documentNumber?: string | null;
  supplier?: string | null;
  destination?: string | null;
  notes?: string | null;
  warehouseName?: string | null;
  locationCode?: string | null;
  fromWarehouseName?: string | null;
  fromLocationCode?: string | null;
  toWarehouseName?: string | null;
  toLocationCode?: string | null;
};

export type TraceReportResponse = {
  material: { id: string; code: string; description: string };
  history: ReportTraceEvent[];
};

export type DailyStockRow = {
  date: string;
  material: { id: string; code: string; description: string; unitOfMeasure?: string | null };
  stockInicial: number;
  entradas: number;
  salidas: number;
  stockFinal: number;
  stockSAP: number;
  diferencia: number;
};

export type KpisResponse = {
  range: ReportRange;
  totalMaterials: number;
  totalQuantity: number;
  movementsCount: number;
  movementsInRange: number;
  movementsPrev: number;
  movementsDelta: number | null;   // % change vs previous equivalent period; null when no baseline
  pendingRegularizations: number;
  expiringLots: number;            // lots expiring within 60 days with stock > 0
  expiringCritical: number;        // subset expiring within 15 days
  stockByWarehouse: StockByWarehouseRow[];
};

export async function getStockReport(warehouseId?: string, locationId?: string) {
  const { data } = await api.get<StockReportResponse>("/reports/stock", { params: { warehouseId, locationId } });
  return data;
}

export async function getMovementsReport(params?: {
  warehouseId?: string;
  locationId?: string;
  productId?: string;
  type?: MovementType;
  status?: 'NORMAL' | 'PENDING_REGULARIZATION';
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const { data } = await api.get<ReportMovementsResponse>("/reports/movements", { params });
  return data;
}

export async function getTraceReport(materialId: string) {
  const { data } = await api.get<TraceReportResponse>("/reports/trace", { params: { materialId } });
  return data;
}

export async function getDailyStockReport(params?: { date?: string; dateFrom?: string; dateTo?: string; productId?: string; warehouseId?: string; locationId?: string }) {
  const { data } = await api.get<DailyStockRow[]>("/reports/daily-stock", { params });
  return data;
}

export async function getDifferencesSapReport(params?: { date?: string; productId?: string; warehouseId?: string; locationId?: string }) {
  const { data } = await api.get<DailyStockRow[]>("/reports/differences-sap", { params });
  return data;
}

export async function upsertSapStock(payload: { date: string; productId: string; warehouseId?: string; locationId?: string; sapQuantity: number }) {
  const { data } = await api.post("/reports/sap-stock", payload);
  return data;
}

export async function getKpis(range: ReportRange = "today") {
  const { data } = await api.get<KpisResponse>("/reports/kpis", { params: { range } });
  return data;
}

export type FreshnessRow = {
  lotId: string;
  lotCode: string;
  sapLot: string | null;
  fechaVencimiento: string;
  fechaFabricacion: string | null;
  stockActual: number;
  proveedor: string | null;
  diasRestantes: number;
  product: {
    id: string;
    code: string;
    description: string;
    unitOfMeasure: string | null;
  };
};

export async function getFreshnessReport(productId?: string) {
  const { data } = await api.get<FreshnessRow[]>("/reports/freshness", { params: { productId } });
  return data;
}
