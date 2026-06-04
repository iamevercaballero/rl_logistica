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

export type VoidStatus = 'NONE' | 'VOID_PENDING' | 'VOIDED';

export type Movement = {
  id: string;
  type: MovementType;
  status: MovementStatus;
  voidStatus?: VoidStatus;
  voidAdjRequestId?: string | null;
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
  lotCode?: string | null;     // si lotCount > 1 viene concatenado con ", "
  sapLot?: string | null;
  lotCount?: number;           // 0 / 1 / N
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
  warehouseId?: string;
  carrier?: string;
  driver?: string;
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
  warehouseId?: string | null;
  carrier?: string | null;
  driver?: string | null;
  vehiclePlate?: string | null;
  notes?: string | null;
  totalLines: number;
  totalQuantity: number;
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
export type PrintWarehouse = { id: string; name: string };
export type PrintPallet = { id: string; code: string; quantity: number; lotId: string };
export type PrintDetail = { id: string; movementId: string; palletId?: string | null; lotId?: string | null; locationId?: string | null; quantity: number };

/** Movimiento tal como lo devuelve la entidad (sin enriquecer). Usado en respuestas de impresión. */
export type RawMovement = {
  id: string;
  type: MovementType;
  date: string;
  productId: string;
  quantity: number;
  pallets?: number | null;
  lotId?: string | null;
  warehouseId?: string | null;
  supplier?: string | null;
  destination?: string | null;
  carrier?: string | null;
  driver?: string | null;
  notes?: string | null;
  documentId?: string | null;
};

export type DocumentPrintData = {
  document: LogisticsDocument;
  movements: RawMovement[];
  details: PrintDetail[];
  products: PrintProduct[];
  lots: PrintLot[];
  warehouses: PrintWarehouse[];
  pallets: PrintPallet[];
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
  notes?: string;
  sapLot?: string;
  fechaVencimiento?: string;
  fechaFabricacion?: string;
  proveedor?: string;
}): Promise<{ regularized: boolean; changes: number }> {
  const { data } = await api.patch(`/movements/${id}/regularize`, payload);
  return data;
}
