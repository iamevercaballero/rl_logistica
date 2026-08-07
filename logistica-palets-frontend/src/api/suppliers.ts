import { api } from "./client";

export type Supplier = {
  id: string;
  name: string;
  ruc?: string | null;
  notes?: string | null;
  active: boolean;
};

/** Catálogo de proveedores. Por defecto solo los activos. */
export async function listSuppliers(search?: string, includeInactive = false) {
  const { data } = await api.get<Supplier[]>("/suppliers", {
    params: { search: search || undefined, includeInactive: includeInactive ? "true" : undefined },
  });
  return data;
}

/** Alta rápida desde el formulario de entrada. */
export async function createSupplier(payload: { name: string; ruc?: string; notes?: string }) {
  const { data } = await api.post<Supplier>("/suppliers", payload);
  return data;
}

export async function updateSupplier(
  id: string,
  payload: Partial<{ name: string; ruc: string; notes: string; active: boolean }>,
) {
  const { data } = await api.patch<Supplier>(`/suppliers/${id}`, payload);
  return data;
}

export async function deactivateSupplier(id: string) {
  const { data } = await api.patch<Supplier>(`/suppliers/${id}/deactivate`);
  return data;
}
