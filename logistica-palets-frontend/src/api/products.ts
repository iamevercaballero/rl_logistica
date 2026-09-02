import { api } from "./client";

export type Product = {
  id: string;
  code: string;
  description: string;
  unitOfMeasure?: string;
  active: boolean;
  stockMinimo?: number | null;
  /**
   * El material se maneja con Lote SAP ("Lote Ypané"). En `false` la Entrada
   * no manda `sapLot` y el backend tampoco lo escribe. Default `true`.
   */
  usesSapLot: boolean;
  stackable: boolean;
  maxStackLevel?: number | null;
  canReceiveWeightOnTop: boolean;
  stackingNotes?: string | null;
};

export type StockAlert = {
  id: string;
  code: string;
  description: string;
  stockMinimo: number;
  stockActual: number;
};

export type BulkImportRowError = {
  row: number;
  code?: string;
  description?: string;
  reason: string;
};

/** Una fila que la importación crearía, tal como quedaría guardada. */
export type BulkImportPreviewRow = {
  code: string;
  description: string;
  unitOfMeasure: string;
  stackable: boolean;
};

export type BulkImportResult = {
  totalRows: number;
  /** Filas válidas: las que se crearían (ensayo) o se crearon (confirmación). */
  valid: number;
  /** Filas realmente creadas. Siempre 0 en el ensayo. */
  imported: number;
  skipped: number;
  /** `false` en el ensayo, `true` cuando se aplicó. */
  committed: boolean;
  errors: BulkImportRowError[];
  preview: BulkImportPreviewRow[];
  previewTruncated: boolean;
};

export async function listProducts(search?: string): Promise<Product[]> {
  const { data } = await api.get<Product[]>("/products", { params: search ? { search } : undefined });
  return data;
}

export async function searchProducts(q: string): Promise<Product[]> {
  if (!q.trim()) return [];
  const { data } = await api.get<Product[]>("/products", { params: { search: q } });
  return data;
}

export async function createProduct(payload: {
  code: string;
  description: string;
  unitOfMeasure?: string;
  active?: boolean;
  stockMinimo?: number;
  usesSapLot?: boolean;
  stackable?: boolean;
  maxStackLevel?: number | null;
  canReceiveWeightOnTop?: boolean;
  stackingNotes?: string | null;
}): Promise<Product> {
  const { data } = await api.post<Product>("/products", payload);
  return data;
}

export async function updateProduct(id: string, payload: Partial<{
  code: string;
  description: string;
  unitOfMeasure: string;
  active: boolean;
  stockMinimo: number | null;
  usesSapLot: boolean;
  stackable: boolean;
  maxStackLevel: number | null;
  canReceiveWeightOnTop: boolean;
  stackingNotes: string | null;
}>): Promise<Product> {
  const { data } = await api.patch<Product>(`/products/${id}`, payload);
  return data;
}

/**
 * Baja de material. Si tiene lotes o movimientos, el backend lo desactiva en vez
 * de borrarlo (para no dejar el histórico sin material) y devuelve `deactivated`.
 */
export type DeleteProductResult = {
  deleted: boolean;
  deactivated: boolean;
  id: string;
  reason?: string;
};

export async function deleteProduct(id: string): Promise<DeleteProductResult> {
  const { data } = await api.delete<DeleteProductResult>(`/products/${id}`);
  return data;
}

/**
 * Carga masiva de materiales.
 *
 * `commit=false` —el default— hace un ensayo: valida el archivo, devuelve qué
 * crearía y no escribe nada. La escritura hay que pedirla a propósito.
 */
export async function bulkImportProducts(file: File, commit = false): Promise<BulkImportResult> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<BulkImportResult>("/products/bulk-import", form, {
    params: { commit: String(commit) },
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function getStockAlerts(): Promise<StockAlert[]> {
  const { data } = await api.get<StockAlert[]>("/products/alerts/stock-minimo");
  return data;
}
