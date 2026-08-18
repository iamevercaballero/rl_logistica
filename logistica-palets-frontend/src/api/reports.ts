import { api } from "./client";
import type { MovementType, VoidStatus } from "./movements";

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
  /** Día operativo usado por los filtros del reporte. */
  date: string;
  /** Instante exacto en que el movimiento quedó registrado. */
  createdAt: string;
  quantity: number;
  pallets?: number | null;
  lotCode?: string | null;       // single code, OR comma-separated when multi-lot palletItems
  sapLot?: string | null;        // same
  lotCount?: number;             // 0, 1, or N (N>1 = multi-lot)
  lotsDetail?: Array<{ lotCode: string; sapLot?: string | null; pallets: number; quantity: number }> | null;
  status?: 'NORMAL' | 'PENDING_REGULARIZATION';
  voidStatus?: VoidStatus;
  adjustmentReason?: string | null;
  documentNumber?: string | null;
  supplier?: string | null;
  carrier?: string | null;
  driver?: string | null;
  destination?: string | null;
  documentoMaterial?: string | null;
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
  documentoMaterial?: string | null;
  notes?: string | null;
  voidStatus?: VoidStatus;
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

export async function getTraceReport(materialId: string, warehouseId?: string) {
  const { data } = await api.get<TraceReportResponse>("/reports/trace", { params: { materialId, warehouseId } });
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

export async function getKpis(range: ReportRange = "today", warehouseId?: string) {
  const { data } = await api.get<KpisResponse>("/reports/kpis", { params: { range, warehouseId } });
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

export async function getFreshnessReport(productId?: string, warehouseId?: string) {
  const { data } = await api.get<FreshnessRow[]>("/reports/freshness", { params: { productId, warehouseId } });
  return data;
}

/* ── Salud del inventario (invariante Stock = Lote = Pallet) ──────────────── */
export type InventoryHealthRow = {
  productId: string;
  productCode: string;
  productDescription: string;
  stockSum: number;
  lotSum: number;
  palletSum: number;
  stockVsLot: number;
  lotVsPallet: number;
};

/**
 * Descuadre a nivel celda: el total del material puede cerrar y aun así estar mal
 * repartido entre ubicaciones (stock en una celda sin pallets que lo respalden).
 */
export type InventoryHealthCell = {
  productId: string;
  productCode: string;
  productDescription: string;
  locationId: string | null;
  locationCode: string | null;
  stockQuantity: number;
  palletQuantity: number;
  stockVsPallet: number;
  /** El stock apunta a una ubicación que ya no existe. */
  orphanLocation: boolean;
};

export type InventoryHealth = {
  ok: boolean;
  divergentCount: number;
  divergentCellCount: number;
  checkedAt: string;
  divergent: InventoryHealthRow[];
  divergentCells: InventoryHealthCell[];
};

export async function getInventoryHealth(warehouseId?: string): Promise<InventoryHealth> {
  const { data } = await api.get<InventoryHealth>("/reports/inventory-health", { params: { warehouseId } });
  return data;
}

/* ── KPIs de almacén: ocupación / rotación / dwell-time ───────────────────── */
export type WarehouseOccupancy = {
  warehouseId: string;
  warehouseName: string;
  totalLocations: number;
  capacityPallets: number;
  occupiedLocations: number;
  palletsStored: number;
  freeLocations: number;
  locationOccupancyPct: number;
  capacityOccupancyPct: number | null;
};

export type OccupancyReport = {
  warehouses: WarehouseOccupancy[];
  totals: {
    totalLocations: number;
    occupiedLocations: number;
    freeLocations: number;
    palletsStored: number;
    capacityPallets: number;
    locationOccupancyPct: number;
    capacityOccupancyPct: number | null;
  };
};

export async function getOccupancy(warehouseId?: string): Promise<OccupancyReport> {
  const { data } = await api.get<OccupancyReport>("/reports/occupancy", { params: { warehouseId } });
  return data;
}

export type RotationRow = {
  productId: string;
  productCode: string;
  productDescription: string;
  exitUnits: number;
  currentStock: number;
  turnover: number | null;
  deadStock: boolean;
};

export type RotationReport = {
  from: string;
  to: string;
  topMovers: RotationRow[];
  deadStock: RotationRow[];
  totals: { products: number; exitUnits: number; currentStock: number };
};

export async function getRotation(params: { from?: string; to?: string; warehouseId?: string } = {}): Promise<RotationReport> {
  const { data } = await api.get<RotationReport>("/reports/rotation", { params });
  return data;
}

export type DwellPallet = {
  id: string;
  code: string;
  quantity: number;
  createdAt: string;
  ageDays: number;
  productCode: string;
  productDescription: string;
  lotCode: string;
  locationCode: string | null;
  warehouseName: string | null;
};

export type DwellTimeReport = {
  summary: {
    totalPallets: number;
    avgAgeDays: number;
    totalPalletDays: number;
    buckets: { d0_7: number; d8_30: number; d31_90: number; d90plus: number };
  };
  oldest: DwellPallet[];
};

export async function getDwellTime(warehouseId?: string): Promise<DwellTimeReport> {
  const { data } = await api.get<DwellTimeReport>("/reports/dwell-time", { params: { warehouseId } });
  return data;
}
