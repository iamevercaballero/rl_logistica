import { api } from "./client";

export type LocationZone =
  | "RECEPCION"
  | "ALMACENAMIENTO"
  | "PICKING"
  | "DESPACHO"
  | "CUARENTENA"
  | "DEVOLUCIONES";

export const LOCATION_ZONES: { value: LocationZone; label: string; icon: string }[] = [
  { value: "RECEPCION",      label: "Recepción",      icon: "📥" },
  { value: "ALMACENAMIENTO", label: "Almacenamiento", icon: "📦" },
  { value: "PICKING",        label: "Picking",        icon: "🛒" },
  { value: "DESPACHO",       label: "Despacho",       icon: "🚚" },
  { value: "CUARENTENA",     label: "Cuarentena",     icon: "⛔" },
  { value: "DEVOLUCIONES",   label: "Devoluciones",   icon: "↩️" },
];

export function zoneMeta(zone?: string | null) {
  return LOCATION_ZONES.find((z) => z.value === zone) ?? null;
}

export type Location = {
  id: string;
  code: string;
  type?: string;
  zone?: string | null;
  aisle?: string | null;
  rack?: string | null;
  level?: number | null;
  position?: number | null;
  capacityPallets?: number | null;
  warehouseId?: string;
  warehouse?: { id: string; name: string };
  active?: boolean;
};

export async function listLocations() {
  const { data } = await api.get<Location[]>("/locations");
  return data;
}

export type LocationAvailabilityStatus = "FREE" | "PARTIAL" | "FULL" | "BLOCKED";

export type LocationAvailability = {
  id: string;
  code: string;
  zone: string | null;
  aisle: string | null;
  rack: string | null;
  level: number | null;
  position: number | null;
  warehouseId: string | null;
  warehouseName: string | null;
  active: boolean;
  occupied: number;
  capacity: number | null;
  status: LocationAvailabilityStatus;
};

/** Disponibilidad por ubicación (ocupación vs capacidad) para el selector guiado. */
export async function getLocationAvailability() {
  const { data } = await api.get<LocationAvailability[]>("/locations/availability");
  return data;
}

/* ── Slotting: ubicación recomendada ──────────────────────────────────────── */

export type LocationRecommendation = {
  id: string;
  code: string;
  zone: string | null;
  warehouseName: string | null;
  occupied: number;
  capacity: number | null;
  score: number;
  reasons: string[];
};

export type SlottingResult = {
  productId: string;
  quantity: number;
  product: {
    code: string;
    description: string;
    temperatureZone: string;
    fragile: boolean;
    rotationPolicy: string;
  };
  recommendations: LocationRecommendation[];
  message: string | null;
};

/** Pide al backend las ubicaciones recomendadas para guardar un pallet del producto. */
export async function getLocationRecommendations(productId: string, quantity = 1) {
  const { data } = await api.get<SlottingResult>("/locations/recommendations", {
    params: { productId, quantity },
  });
  return data;
}

export async function createLocation(payload: {
  code: string;
  warehouseId: string;
  type?: string;
  zone?: LocationZone;
  aisle?: string;
  rack?: string;
  level?: number;
  position?: number;
  capacityPallets?: number;
}) {
  const { data } = await api.post<Location>("/locations", payload);
  return data;
}

export async function updateLocation(id: string, payload: Partial<{
  code: string;
  zone: LocationZone;
  capacityPallets: number;
  active: boolean;
}>) {
  const { data } = await api.patch<Location>(`/locations/${id}`, payload);
  return data;
}

/** Genera la estructura de una zona en lote (pasillos × racks × niveles × posiciones). */
export async function generateLocations(payload: {
  warehouseId: string;
  zone: LocationZone;
  codePrefix?: string;
  aisles?: string[];
  racks?: number;
  levels?: number;
  positions: number;
  capacityPallets?: number;
}): Promise<{ requested: number; created: number; skipped: number }> {
  const { data } = await api.post("/locations/generate", payload);
  return data;
}

export async function deleteLocation(id: string) {
  await api.delete(`/locations/${id}`);
}
