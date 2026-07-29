import { api } from "./client";

export type Product = {
  id: string;
  code: string;
  description: string;
  unitOfMeasure?: string;
  active: boolean;
  stockMinimo?: number | null;
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

export type BulkImportResult = {
  totalRows: number;
  imported: number;
  skipped: number;
  errors: BulkImportRowError[];
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
  stackable: boolean;
  maxStackLevel: number | null;
  canReceiveWeightOnTop: boolean;
  stackingNotes: string | null;
}>): Promise<Product> {
  const { data } = await api.patch<Product>(`/products/${id}`, payload);
  return data;
}

export async function deleteProduct(id: string): Promise<void> {
  await api.delete(`/products/${id}`);
}

export async function bulkImportProducts(file: File): Promise<BulkImportResult> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<BulkImportResult>("/products/bulk-import", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function getStockAlerts(): Promise<StockAlert[]> {
  const { data } = await api.get<StockAlert[]>("/products/alerts/stock-minimo");
  return data;
}
