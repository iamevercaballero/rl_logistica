import { api } from "./client";
import type { LotPallet } from "./pallets";

export type Lot = {
  id: string;
  lotCode: string;
  productId: string;
  fechaVencimiento?: string | null;
  fechaFabricacion?: string | null;
  proveedor?: string | null;
  sapLot?: string | null;
  stockActual: number;
  status?: string;
  product?: { id: string; code: string; description: string };
  /** Pallets disponibles — sólo presente en respuesta FEFO */
  pallets?: LotPallet[];
};

/** Genera el lote SAP del día: letra-año + mes + día + 08201 (A=2001, ..., Z=2026) */
export function generateSapLot(date = new Date()): string {
  const letter = String.fromCharCode(65 + (date.getFullYear() - 2001));
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${letter}${mm}${dd}08201`;
}

export async function listLots(productId?: string, sapLot?: string): Promise<Lot[]> {
  const { data } = await api.get<Lot[]>("/lots", {
    params: { ...(productId ? { productId } : {}), ...(sapLot ? { sapLot } : {}) },
  });
  return data;
}

/** Lotes disponibles ordenados por FEFO. Filtra por productId, sapLot, locationId o combinaciones. */
export async function fefoLots(productId?: string, sapLot?: string, locationId?: string): Promise<Lot[]> {
  const { data } = await api.get<Lot[]>("/lots/fefo", {
    params: {
      ...(productId ? { productId } : {}),
      ...(sapLot ? { sapLot } : {}),
      ...(locationId ? { locationId } : {}),
    },
  });
  return data;
}

export async function createLot(payload: {
  lotCode: string;
  productId: string;
  fechaVencimiento?: string;
  fechaFabricacion?: string;
  proveedor?: string;
  sapLot?: string;
}): Promise<Lot> {
  const { data } = await api.post<Lot>("/lots", payload);
  return data;
}

export async function updateLot(
  id: string,
  payload: Partial<{
    lotCode: string;
    fechaVencimiento: string;
    fechaFabricacion: string;
    proveedor: string;
    sapLot: string;
  }>,
): Promise<Lot> {
  const { data } = await api.patch<Lot>(`/lots/${id}`, payload);
  return data;
}

export async function deleteLot(id: string): Promise<void> {
  await api.delete(`/lots/${id}`);
}
