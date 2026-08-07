import { api } from "./client";

export type LocationZone =
  | "RECEPCION"
  | "ALMACENAMIENTO"
  | "PICKING"
  | "DESPACHO"
  | "CUARENTENA"
  | "DEVOLUCIONES";

export const LOCATION_ZONES: { value: LocationZone; label: string }[] = [
  { value: "RECEPCION",      label: "Recepción" },
  { value: "ALMACENAMIENTO", label: "Almacenamiento" },
  { value: "PICKING",        label: "Picking" },
  { value: "DESPACHO",       label: "Despacho" },
  { value: "CUARENTENA",     label: "Cuarentena" },
  { value: "DEVOLUCIONES",   label: "Devoluciones" },
];

export function zoneMeta(zone?: string | null) {
  return LOCATION_ZONES.find((z) => z.value === zone) ?? null;
}

export type Location = {
  id: string;
  code: string;
  type?: string;
  zone?: string | null;
  /** Sector (ej: "B"). */
  aisle?: string | null;
  /** Subsector dentro del sector (ej: "B1"). */
  rack?: string | null;
  /** Capacidad en bases (pilas) — la que ve el operario. */
  capacityBases?: number | null;
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
  warehouseId: string | null;
  warehouseName: string | null;
  active: boolean;
  /** Bases (pilas) ocupadas. */
  occupied: number;
  /** Capacidad en bases. */
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

/* ── Localizador visual de stock ──────────────────────────────────────────── */

/** Estado visual de una celda del mapa. Lo decide el backend. */
export type LocationMapState =
  | "INACTIVE"
  | "INCIDENT"
  | "EXPIRING"
  | "FULL"
  | "PROVISIONAL"
  | "OCCUPIED"
  | "FREE";

export type LocationIssue =
  | "OVER_CAPACITY"
  | "BLOCKED_PALLETS"
  | "STOCK_MISMATCH"
  | "EXPIRED"
  | "EXPIRING"
  | "INACTIVE_WITH_STOCK";

export const MAP_STATE_META: Record<LocationMapState, { label: string; bg: string; border: string; text: string }> = {
  FREE:        { label: "Libre",              bg: "var(--bg)",              border: "1px solid var(--border)",       text: "var(--muted)" },
  OCCUPIED:    { label: "Ocupada",            bg: "var(--primary-light)",   border: "1.5px solid var(--primary)",    text: "var(--primary-text)" },
  FULL:        { label: "Llena",              bg: "var(--badge-adjout-bg)", border: "1.5px solid var(--warning)",    text: "var(--badge-adjout-text)" },
  EXPIRING:    { label: "Próxima a vencer",   bg: "var(--badge-exit-bg)",   border: "1.5px solid var(--danger)",     text: "var(--badge-exit-text)" },
  PROVISIONAL: { label: "Entrada provisoria", bg: "rgba(168,85,247,0.14)",  border: "1.5px solid #a855f7",           text: "#c084fc" },
  INCIDENT:    { label: "Con incidencia",     bg: "rgba(234,179,8,0.16)",   border: "1.5px solid #eab308",           text: "#eab308" },
  INACTIVE:    { label: "Inactiva",           bg: "var(--panel)",           border: "1px dashed var(--border)",      text: "var(--muted)" },
};

export const ISSUE_META: Record<LocationIssue, { label: string; hint: string }> = {
  OVER_CAPACITY:       { label: "Sobrecapacidad",   hint: "Tiene más pallets que su capacidad declarada." },
  BLOCKED_PALLETS:     { label: "Pallets bloqueados", hint: "Contiene pallets en estado BLOCKED o DAMAGED." },
  STOCK_MISMATCH:      { label: "Diferencia",       hint: "El stock registrado no coincide con los pallets ubicados." },
  EXPIRED:             { label: "Lote vencido",     hint: "Contiene lotes con vencimiento pasado." },
  EXPIRING:            { label: "Próximo a vencer", hint: "Contiene lotes que vencen dentro de 30 días." },
  INACTIVE_WITH_STOCK: { label: "Inactiva con stock", hint: "La ubicación está desactivada pero todavía tiene pallets." },
};

/** Celda del mapa: estructura + ocupación + diagnóstico. */
export type LocationCell = {
  id: string;
  code: string;
  type: string;
  active: boolean;
  zone: string | null;
  aisle: string | null;
  rack: string | null;
  /** Bases (pilas) ocupadas — la capacidad real es en bases, no en pallets. */
  basesUsed: number;
  capacityBases: number | null;
  warehouseId: string | null;
  warehouseName: string | null;
  /** Pallets físicos acá — informativo. */
  pallets: number;
  units: number;
  stockUnits: number;
  blockedPallets: number;
  expiredPallets: number;
  expiringPallets: number;
  nearestExpiry: string | null;
  issues: LocationIssue[];
  state: LocationMapState;
};

export type LocationMap = {
  locations: LocationCell[];
  summary: {
    totalLocations: number;
    activeLocations: number;
    freeLocations: number;
    occupiedLocations: number;
    fullLocations: number;
    incidentLocations: number;
    totalPallets: number;
    totalUnits: number;
    byZone: { zone: string; locations: number; occupied: number; free: number; pallets: number; units: number }[];
  };
};

export async function getLocationMap(warehouseId?: string): Promise<LocationMap> {
  const { data } = await api.get<LocationMap>("/locations/map", {
    params: warehouseId ? { warehouseId } : undefined,
  });
  return data;
}

export type StockSearchRow = {
  palletId: string;
  palletCode: string;
  palletStatus: string;
  quantity: number;
  lotId: string;
  lotCode: string;
  supplierLot: string | null;
  sapLot: string | null;
  fechaVencimiento: string | null;
  lotStatus: string;
  productId: string;
  productCode: string;
  productDescription: string;
  unitOfMeasure: string | null;
  locationId: string | null;
  locationCode: string | null;
  zone: string | null;
  aisle: string | null;
  rack: string | null;
  level: number | null;
  position: number | null;
  locationActive: boolean | null;
  warehouseId: string | null;
  warehouseName: string | null;
  entryDocumentId: string | null;
};

export type StockSearchProduct = {
  productId: string;
  productCode: string;
  productDescription: string;
  unitOfMeasure: string | null;
  quantity: number;
  pallets: number;
  lots: number;
  locations: number;
  unlocatedPallets: number;
};

export type StockSearchResult = {
  query: string;
  truncated: boolean;
  summary: {
    quantity: number;
    pallets: number;
    lots: number;
    locations: number;
    unlocatedPallets: number;
    products: number;
  };
  products: StockSearchProduct[];
  locationIds: string[];
  rows: StockSearchRow[];
  emptyProducts: { id: string; code: string; description: string; unitOfMeasure: string | null }[];
};

/** Busca por material, descripción, lote interno, lote proveedor, pallet o ubicación. */
export async function searchStock(q: string, warehouseId?: string): Promise<StockSearchResult> {
  const { data } = await api.get<StockSearchResult>("/locations/stock-search", {
    params: warehouseId ? { q, warehouseId } : { q },
  });
  return data;
}

export type LocationContentPallet = {
  palletId: string;
  palletCode: string;
  palletStatus: string;
  quantity: number;
  createdAt: string | null;
  pilaId: string | null;
  stackPosition: number | null;
  lotId: string;
  lotCode: string;
  supplierLot: string | null;
  sapLot: string | null;
  fechaVencimiento: string | null;
  lotStatus: string;
  productId: string;
  productCode: string;
  productDescription: string;
  unitOfMeasure: string | null;
  entryDocumentId: string | null;
};

export type LocationContentPile = {
  pilaId: string | null;
  sequence: number | null;
  pallets: LocationContentPallet[];
};

export type LocationContent = {
  location: {
    id: string;
    code: string;
    type: string;
    active: boolean;
    zone: string | null;
    aisle: string | null;
    rack: string | null;
    capacityBases: number | null;
    temperatureZone: string;
    warehouseId: string | null;
    warehouseName: string | null;
  };
  occupancy: {
    pallets: number;
    basesUsed: number;
    basesCapacity: number | null;
    units: number;
    stockUnits: number;
    mismatch: number;
  };
  piles: LocationContentPile[];
  pallets: LocationContentPallet[];
};

export async function getLocationContent(id: string): Promise<LocationContent> {
  const { data } = await api.get<LocationContent>(`/locations/${id}/content`);
  return data;
}

export type LocationIncidents = {
  locations: LocationCell[];
  palletsWithoutLocation: {
    palletId: string;
    palletCode: string;
    palletStatus: string;
    quantity: number;
    lotCode: string;
    supplierLot: string | null;
    fechaVencimiento: string | null;
    productCode: string;
    productDescription: string;
    unitOfMeasure: string | null;
  }[];
  stockWithoutLocation: {
    productId: string;
    productCode: string;
    productDescription: string;
    unitOfMeasure: string | null;
    warehouseName: string | null;
    quantity: number;
  }[];
  summary: {
    locations: number;
    overCapacity: number;
    blockedPallets: number;
    stockMismatch: number;
    expired: number;
    expiring: number;
    inactiveWithStock: number;
    palletsWithoutLocation: number;
    stockWithoutLocation: number;
    expiryWarningDays: number;
  };
};

export async function getLocationIncidents(warehouseId?: string): Promise<LocationIncidents> {
  const { data } = await api.get<LocationIncidents>("/locations/incidents", {
    params: warehouseId ? { warehouseId } : undefined,
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
  capacityBases?: number;
  defaultMaxStackLevel?: number;
}) {
  const { data } = await api.post<Location>("/locations", payload);
  return data;
}

export async function updateLocation(id: string, payload: Partial<{
  code: string;
  zone: LocationZone;
  type: string;
  aisle: string;
  rack: string;
  /** `null` vuelve la capacidad a "sin límite" (omitirla significa "no tocar"). */
  capacityBases: number | null;
  defaultMaxStackLevel: number | null;
  active: boolean;
}>) {
  const { data } = await api.patch<Location>(`/locations/${id}`, payload);
  return data;
}

/** Genera la estructura de una zona en lote: sectores × subsectores (ej: "B-B1"). */
export async function generateLocations(payload: {
  warehouseId: string;
  zone: LocationZone;
  codePrefix?: string;
  /** Sectores a crear (ej: ["A","B"]). Omitido = subsectores planos sin letra de sector. */
  sectors?: string[];
  /** Número del primer subsector (ej: 4 → arranca en B4). Default 1 — permite correr el generador varias veces con capacidades distintas por tramo. */
  subsectorStart?: number;
  /** Cantidad de subsectores a crear a partir de subsectorStart. */
  subsectorsPerSector: number;
  capacityBases?: number;
  defaultMaxStackLevel?: number;
}): Promise<{ requested: number; created: number; skipped: number }> {
  const { data } = await api.post("/locations/generate", payload);
  return data;
}

export async function deleteLocation(id: string) {
  await api.delete(`/locations/${id}`);
}

/**
 * Elimina un pasillo completo. Todo-o-nada: si alguna ubicación tiene
 * contenido, el backend rechaza sin borrar nada e indica cuáles.
 */
export async function deleteAisle(warehouseId: string, aisle: string): Promise<{ aisle: string; deleted: number }> {
  const { data } = await api.delete<{ aisle: string; deleted: number }>("/locations/aisle", {
    params: { warehouseId, aisle },
  });
  return data;
}
