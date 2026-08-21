import { api } from "./client";

export type Warehouse = {
  id: string;
  name: string;
  documentCode?: string | null;
  address?: string;
  active: boolean;
  /**
   * El depósito opera con Lote SAP ("Lote Ypané"). Se combina con
   * `Product.usesSapLot` con un AND: apagarlo acá saca el concepto de todo el
   * depósito — el campo de la Entrada y la fila de la etiqueta de pallet.
   * Ausente en respuestas viejas → se asume `true`, el default de la columna.
   */
  usesSapLot?: boolean;
};

/** El depósito maneja Lote SAP. Sin el dato (respuesta vieja) se asume que sí. */
export function warehouseUsesSapLot(
  warehouse: Pick<Warehouse, "usesSapLot"> | null | undefined,
): boolean {
  return warehouse?.usesSapLot !== false;
}

export async function listWarehouses() {
  const { data } = await api.get<Warehouse[]>("/warehouses");
  return data;
}

/**
 * Depósitos que el usuario autenticado puede seleccionar.
 *
 * Es la única fuente del selector global: el alcance lo decide el backend a
 * partir del rol y de `user_warehouses`, nunca el cliente. Un `localStorage`
 * manipulado no puede agregar un depósito que no esté en esta lista.
 */
export async function listAllowedWarehouses() {
  const { data } = await api.get<Warehouse[]>("/warehouses/allowed");
  return data;
}

/** "01 · RL LOGÍSTICA" — etiqueta estándar del depósito en toda la UI. */
export function warehouseLabel(warehouse: Pick<Warehouse, "name" | "documentCode"> | null | undefined): string {
  if (!warehouse) return "—";
  return warehouse.documentCode ? `${warehouse.documentCode} · ${warehouse.name}` : warehouse.name;
}

/** Ubicación con estructura y ocupación, tal como la devuelve GET /warehouses/:id/layout */
export type LayoutLocation = {
  id: string;
  code: string;
  type: string;
  active: boolean;
  zone: string | null;
  aisle: string | null;
  rack: string | null;
  capacityBases: number | null;
  basesUsed: number;
  pallets: number;
  units: number;
};

export type WarehouseLayout = {
  warehouse: Warehouse;
  locations: LayoutLocation[];
  summary: {
    totalLocations: number;
    activeLocations: number;
    occupied: number;
    totalPallets: number;
    totalUnits: number;
    byZone: { zone: string; locations: number; occupied: number; pallets: number; units: number }[];
  };
};

export async function getWarehouseLayout(id: string): Promise<WarehouseLayout> {
  const { data } = await api.get<WarehouseLayout>(`/warehouses/${id}/layout`);
  return data;
}

export async function createWarehouse(payload: {
  name: string;
  documentCode: string;
  address?: string;
  active?: boolean;
  usesSapLot?: boolean;
}) {
  const { data } = await api.post<Warehouse>("/warehouses", payload);
  return data;
}

export async function updateWarehouse(id: string, payload: {
  name?: string;
  documentCode?: string;
  address?: string;
  active?: boolean;
  usesSapLot?: boolean;
}) {
  const { data } = await api.patch<Warehouse>(`/warehouses/${id}`, payload);
  return data;
}

export async function deleteWarehouse(id: string) {
  await api.delete(`/warehouses/${id}`);
}
