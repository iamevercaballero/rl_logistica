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
  /** Peso físico de este pallet (kg) — se imprime en su etiqueta. */
  weightKg?: number;
  /** Sector-Subsector de este pallet. Si se omite, hereda el de la línea. */
  locationId?: string;
};

export type VoidStatus = 'NONE' | 'VOID_PENDING' | 'VOIDED';

export type Movement = {
  id: string;
  type: MovementType;
  status: MovementStatus;
  voidStatus?: VoidStatus;
  voidAdjRequestId?: string | null;
  /** Día operativo elegido por el usuario. */
  date: string;
  /** Instante exacto en que el movimiento quedó registrado. */
  createdAt: string;
  quantity: number;
  pallets?: number | null;
  documentNumber?: string | null;
  supplier?: string | null;
  carrier?: string | null;
  driver?: string | null;
  destination?: string | null;
  documentoMaterial?: string | null;
  notes?: string | null;
  lotId?: string | null;
  lotCode?: string | null;     // si lotCount > 1 viene concatenado con ", "
  sapLot?: string | null;
  lotCount?: number;           // 0 / 1 / N
  lotsDetail?: Array<{ lotCode: string; sapLot?: string | null; pallets: number; quantity: number }> | null;
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
  productId?: string; type?: MovementType | MovementType[]; dateFrom?: string; dateTo?: string;
  search?: string; status?: MovementStatus;
  documentoMaterialStatus?: "PENDING" | "COMPLETED";
}): Promise<{ data: Movement[]; meta: MovementsMeta }> {
  const { type, ...rest } = params;
  const { data } = await api.get<{ data: Movement[]; meta: MovementsMeta }>("/movements", {
    params: { ...rest, type: Array.isArray(type) ? type.join(",") : type },
  });
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
  documentoMaterial?: string;
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

/* ── Vista previa de colocación (pilas) ──────────────────────────────────── */

export type PlacementPile = {
  pilaId: string;
  isNew: boolean;
  sequence: number;
  productId: string;
  lotId: string | null;
  /** Máximo de niveles que admite esta pila (null = sin límite declarado). */
  maxLevel: number | null;
  items: { key: string; stackPosition: number }[];
};

export type PlacementPlan = {
  locationId: string;
  locationCode: string;
  piles: PlacementPile[];
  basesUsed: number;
  basesTotal: number | null;
  basesFree: number | null;
};

/** Cómo van a quedar armadas las pilas antes de confirmar una entrada — no reserva nada. */
export async function previewPlacement(payload: {
  locationId: string;
  productId: string;
  palletCount: number;
}): Promise<PlacementPlan> {
  const { data } = await api.post<PlacementPlan>("/movements/preview-placement", payload);
  return data;
}

/** Edita metadatos de cualquier movimiento (cualquier tipo/estado). Propaga a lotes. */
// ─── Documentos logísticos (remitos) — multi-producto / multi-lote ───

export type DocumentType = "ENTRY" | "EXIT";
export type DocumentStatus = "BORRADOR" | "PENDIENTE_APROBACION" | "APROBADO" | "RECHAZADO" | "ANULADO";

export type DocumentLine = {
  productId: string;
  quantity?: number;
  pallets?: number;
  locationId?: string;
  lotId?: string;
  palletItems?: PalletItem[];
};

export type CreateDocumentPayload = {
  type: DocumentType;
  date?: string;
  documentNumber?: string;
  supplier?: string;
  destination?: string;
  documentoMaterial?: string;
  warehouseId?: string;
  carrier?: string;
  driver?: string;
  /** CI del conductor — se copia desde la ficha del vehículo en Transportes. */
  driverDocument?: string;
  vehiclePlate?: string;
  encargadoId?: string;
  notes?: string;
  isProvisional?: boolean;
  lines: DocumentLine[];
};

export type LogisticsDocument = {
  id: string;
  code: string;
  type: DocumentType;
  status: DocumentStatus;
  date: string;
  documentNumber?: string | null;
  supplier?: string | null;
  destination?: string | null;
  documentoMaterial?: string | null;
  warehouseId?: string | null;
  carrier?: string | null;
  driver?: string | null;
  /** CI del conductor — copiada desde Transportes, sale impresa en la nota. */
  driverDocument?: string | null;
  vehiclePlate?: string | null;
  notes?: string | null;
  totalLines: number;
  totalQuantity: number;
  /** Líneas (movimientos) de este documento anuladas después de aprobado. El status del documento no cambia por esto. */
  voidedLines?: number;
  createdAt: string;
};

export async function createDocument(
  payload: CreateDocumentPayload,
): Promise<{ documentId: string; code: string; movementIds: string[]; stockImpact: string }> {
  const { data } = await api.post("/movements/documents", payload);
  return data;
}

export async function getDocuments(params: {
  type?: DocumentType; from?: string; to?: string; search?: string;
} = {}): Promise<LogisticsDocument[]> {
  const { data } = await api.get<LogisticsDocument[]>("/movements/documents", { params });
  return data;
}

export async function getDocument(id: string): Promise<{
  document: LogisticsDocument;
  movements: Movement[];
  details: { id: string; movementId: string; palletId?: string | null; lotId?: string | null; locationId?: string | null; quantity: number }[];
}> {
  const { data } = await api.get(`/movements/documents/${id}`);
  return data;
}

export type PrintProduct = { id: string; code: string; description: string; unitOfMeasure?: string | null };
export type PrintLot = { id: string; lotCode: string; productId: string; fechaVencimiento?: string | null; fechaFabricacion?: string | null; sapLot?: string | null };
export type PrintWarehouse = { id: string; name: string; documentCode?: string | null };
export type PrintDocumentWarehouse = { id: string | null; name: string; documentCode: string | null };
export type PrintUserSnapshot = { id: string; username: string; fullName: string | null };
export type PrintLogisticsSnapshot = {
  carrier: string | null;
  driver: string | null;
  driverDocument: string | null;
  vehiclePlate: string | null;
};
export type PrintLocation = { id: string; code: string; warehouse?: { id: string; name: string } | null };
export type PrintPallet = { id: string; code: string; quantity: number; lotId: string; weightKg?: number | null };
export type PrintDetail = { id: string; movementId: string; palletId?: string | null; lotId?: string | null; locationId?: string | null; quantity: number };

/** Movimiento tal como lo devuelve la entidad (sin enriquecer). Usado en respuestas de impresión. */
export type RawMovement = {
  id: string;
  type: MovementType;
  date: string;
  createdAt?: string;
  productId: string;
  quantity: number;
  pallets?: number | null;
  lotId?: string | null;
  warehouseId?: string | null;
  supplier?: string | null;
  destination?: string | null;
  documentoMaterial?: string | null;
  carrier?: string | null;
  driver?: string | null;
  notes?: string | null;
  documentId?: string | null;
};

export type DocumentPrintData = {
  document: LogisticsDocument;
  /** Snapshots explícitos: el frontend no reconstruye la cabecera consultando catálogos vivos. */
  warehouse: PrintDocumentWarehouse | null;
  createdBy: PrintUserSnapshot;
  encargado: PrintUserSnapshot | null;
  logistics: PrintLogisticsSnapshot;
  movements: RawMovement[];
  details: PrintDetail[];
  products: PrintProduct[];
  lots: PrintLot[];
  warehouses: PrintWarehouse[];
  pallets: PrintPallet[];
  locations: PrintLocation[];
};

export async function getDocumentForPrint(id: string): Promise<DocumentPrintData> {
  const { data } = await api.get(`/movements/documents/${id}/print`);
  return data;
}

export async function editMovementMetadata(
  id: string,
  payload: {
    reason: string;
    documentNumber?: string;
    supplier?: string;
    carrier?: string;
    driver?: string;
    destination?: string;
    documentoMaterial?: string;
    notes?: string;
    sapLot?: string;
    fechaVencimiento?: string;
    fechaFabricacion?: string;
    proveedor?: string;
  },
): Promise<{ edited: boolean; changes: number }> {
  const { data } = await api.patch(`/movements/${id}/edit`, payload);
  return data;
}

/**
 * Transferencia multi-producto: mueve los pallets seleccionados de una ubicación
 * a otra en una sola transacción (un movimiento TRANSFER por producto).
 */
export async function transferBatch(payload: {
  date?: string;
  fromLocationId: string;
  toLocationId: string;
  notes?: string;
  lines: { productId: string; palletItems: { palletId: string; quantity: number }[] }[];
}): Promise<{ movementIds: string[]; totalQty: number; totalPallets: number }> {
  const { data } = await api.post("/movements/transfer-batch", payload);
  return data;
}

/** Desglose por lote de un movimiento: datos del lote y pallets actuales (para el editor). */
export type MovementLotBreakdown = {
  lotId: string;
  lotCode: string;
  sapLot?: string | null;
  fechaVencimiento?: string | null;
  fechaFabricacion?: string | null;
  proveedor?: string | null;
  quantity: number;
  availableQty: number;
  pallets: {
    id: string;
    code: string;
    status: string;
    quantityInMovement: number;
    currentQuantity: number;
    /** Peso físico del pallet (kg) — editable en la corrección. */
    weightKg?: number | null;
    locationId?: string | null;
  }[];
};

export async function getMovementLots(id: string): Promise<{
  movementId: string;
  type: MovementType;
  quantity: number;
  lots: MovementLotBreakdown[];
}> {
  const { data } = await api.get(`/movements/${id}/lots`);
  return data;
}

/**
 * Corrección de lotes/pallets de una entrada posteada.
 * Renombres y datos del lote se aplican directo (auditados); las reducciones
 * por pallet y los agregados generan solicitudes RLAI/RLAO pendientes de
 * aprobación (el stock no cambia hasta aprobar).
 */
export type QuantityEditLotPayload = {
  lotId: string;
  newLotCode?: string;
  sapLot?: string;
  fechaVencimiento?: string;
  fechaFabricacion?: string;
  proveedor?: string;
  /** `weightKg` es descriptivo: se aplica directo y auditado, no genera solicitud. */
  palletEdits?: { palletId: string; newQuantity: number; weightKg?: number }[];
  addQuantity?: number;
  addPalletCount?: number;
};

export async function requestQuantityEdit(
  id: string,
  payload: { reason: string; lots: QuantityEditLotPayload[] },
): Promise<{
  renamed: number;
  lotFieldChanges: number;
  requests: { requestId: string; code: string; type: string; totalQuantity: number }[];
  warnings: string[];
}> {
  const { data } = await api.post(`/movements/${id}/request-quantity-edit`, payload);
  return data;
}

/**
 * Solicita la anulación automática de un movimiento.
 * Genera un AdjustmentRequest compensatorio en PENDIENTE_APROBACION.
 * Devuelve warnings si hay pallets ya consumidos.
 */
export async function voidMovement(id: string): Promise<{
  requestId: string;
  code: string;
  warnings: string[];
}> {
  const { data } = await api.post(`/movements/${id}/void`, {});
  return data;
}

export async function regularizeMovement(id: string, payload: {
  reason: string;
  documentNumber?: string;
  supplier?: string;
  carrier?: string;
  driver?: string;
  destination?: string;
  documentoMaterial?: string;
  notes?: string;
  sapLot?: string;
  fechaVencimiento?: string;
  fechaFabricacion?: string;
  proveedor?: string;
}): Promise<{ regularized: boolean; changes: number }> {
  const { data } = await api.patch(`/movements/${id}/regularize`, payload);
  return data;
}

export type StockSnapshotRowIssue = {
  file: "ENTRADA" | "SALIDA" | "STOCK";
  /** ERROR = la fila no se importa; WARNING = se importa pero requiere revisión. */
  severity: "ERROR" | "WARNING";
  row: number;
  code?: string;
  reason: string;
};

export type StockSnapshotProductStatus =
  | "ADJUSTED"
  | "WOULD_ADJUST"
  | "SKIPPED_NOT_FOUND"
  | "SKIPPED_INACTIVE"
  | "SKIPPED_ALREADY_HAS_STOCK"
  | "SKIPPED_NON_POSITIVE"
  | "ERROR";


export type StockLotItem = {
  /** Lote del proveedor — junto con el material forma la clave única del lote. */
  lotCode: string;
  /** Lote SAP del origen — informativo. */
  sapLot?: string;
  quantity: number;
  fechaVencimiento?: string | null;
  /** Fila del Excel de origen. */
  row: number;
};

export type StockConsistencyReport = {
  stockTotal: number;
  lotsTotal: number;
  palletsTotal: number;
  consistent: boolean;
  mismatches: { productId: string; stock: number; lots: number; pallets: number }[];
};

export type StockLotSnapshotProductResult = {
  code: string;
  description: string;
  unitOfMeasure?: string;
  isNewProduct: boolean;
  lots: StockLotItem[];
  net: number;
  status: StockSnapshotProductStatus;
  movementId?: string;
  productCreated?: boolean;
  error?: string;
};

export type StockLotSnapshotResult = {
  committed: boolean;
  sourceRows: number;
  totals: {
    materials: number;
    lots: number;
    records: number;
    warnings: number;
    errors: number;
  };
  rowIssues: StockSnapshotRowIssue[];
  products: StockLotSnapshotProductResult[];
  /** Verificación Stock = Lotes = Palets. Sólo tras confirmar la carga. */
  integrity?: StockConsistencyReport;
  summary: {
    adjusted: number;
    newProducts: number;
    skippedInactive: number;
    skippedAlreadyHasStock: number;
    skippedNonPositive: number;
    errors: number;
  };
};

export async function stockSnapshotFromLots(
  stock: File,
  commit: boolean,
): Promise<StockLotSnapshotResult> {
  const form = new FormData();
  form.append("stock", stock);
  const { data } = await api.post<StockLotSnapshotResult>(
    `/movements/stock-snapshot/from-lots?commit=${commit ? "true" : "false"}`,
    form,
    { headers: { "Content-Type": "multipart/form-data" }, timeout: 300000 },
  );
  return data;
}

export type StockSnapshotRevertItem = {
  movementId: string;
  code: string;
  description: string;
  quantity: number;
  reverted: boolean;
  error?: string;
};

export type StockSnapshotRevertResult = {
  committed: boolean;
  totalFound: number;
  totalReverted: number;
  items: StockSnapshotRevertItem[];
};

export async function revertStockSnapshot(commit: boolean): Promise<StockSnapshotRevertResult> {
  const { data } = await api.post<StockSnapshotRevertResult>(
    `/movements/stock-snapshot/revert?commit=${commit ? "true" : "false"}`,
  );
  return data;
}
