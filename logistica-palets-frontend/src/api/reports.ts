import { api } from "./client";

export type ReportRange = "today" | "week" | "month";

export type StockByWarehouseRow = {
  warehouseId: string;
  warehouseName: string;
  pallets: number;
  units: number;
};

export type StockItemRow = {
  palletId: string;
  palletCode: string;
  quantity: number;
  status: string;
  locationId: string;
  locationCode: string;
  warehouseId: string;
  warehouseName: string;
};

export type StockReportResponse = {
  totalPallets: number;
  totalUnits: number;
  byWarehouse: StockByWarehouseRow[];
  items: StockItemRow[];
};

export type ReportMovementRow = {
  id: string;
  type: "ENTRY" | "EXIT" | "TRANSFER";
  createdAt: string;
  reference?: string | null;
  notes?: string | null;
  warehouseId?: string | null;
  warehouseName?: string | null;
  palletId?: string | null;
  palletCode?: string | null;
  quantity?: number;
};

export type ReportMovementsResponse = {
  data: ReportMovementRow[];
  meta: { page: number; limit: number; total: number; totalPages: number };
};

export type ReportTraceEvent = {
  at: string;
  type: "ENTRY" | "EXIT" | "TRANSFER";
  fromWarehouse?: string;
  toWarehouse?: string;
  ref?: string;
  userId?: string | null;
  username?: string | null;
  quantity?: number;
};

export type TraceReportResponse = {
  palletId: string;
  history: ReportTraceEvent[];
};

export type KpisResponse = {
  range: ReportRange;
  totalPallets: number;
  totalUnits: number;
  movementsCount: number;
  movementsInRange: number;
  stockByWarehouse: StockByWarehouseRow[];
};

export async function getStockReport(warehouseId?: string) {
  const { data } = await api.get<StockReportResponse>("/reports/stock", { params: { warehouseId } });
  return data;
}

export async function getMovementsReport(params?: {
  warehouseId?: string;
  type?: "ENTRY" | "EXIT" | "TRANSFER";
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const { data } = await api.get<ReportMovementsResponse>("/reports/movements", { params });
  return data;
}

export async function getTraceReport(palletId: string) {
  const { data } = await api.get<TraceReportResponse>("/reports/trace", { params: { palletId } });
  return data;
}

export async function getKpis(range: ReportRange = "today") {
  const { data } = await api.get<KpisResponse>("/reports/kpis", { params: { range } });
  return data;
}
