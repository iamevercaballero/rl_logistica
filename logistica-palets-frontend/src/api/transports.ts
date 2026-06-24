import { api } from "./client";
import type { LogisticsDocument } from "./movements";

export type TransportStatus = "DISPONIBLE" | "EN_RUTA" | "MANTENIMIENTO" | "FUERA_DE_SERVICIO";

export const TRANSPORT_STATUSES: { value: TransportStatus; label: string; icon: string; color: string }[] = [
  { value: "DISPONIBLE",        label: "Disponible",        icon: "🟢", color: "var(--success)" },
  { value: "EN_RUTA",           label: "En ruta",           icon: "🚚", color: "var(--primary)" },
  { value: "MANTENIMIENTO",     label: "Mantenimiento",     icon: "🔧", color: "var(--warning)" },
  { value: "FUERA_DE_SERVICIO", label: "Fuera de servicio", icon: "⛔", color: "var(--danger)" },
];

export function transportStatusMeta(status?: string | null) {
  return TRANSPORT_STATUSES.find((s) => s.value === status) ?? TRANSPORT_STATUSES[0];
}

export type DriverStatus = "ACTIVO" | "INACTIVO";

export type TransportDriver = {
  name: string;
  document?: string | null;
  phone?: string | null;
  license?: string | null;
  licenseExpiry?: string | null;
  status?: DriverStatus | string | null;
};

export type Transport = {
  id: string;
  plate: string;
  type: string;
  description?: string;
  status: TransportStatus | string;
  capacityPallets?: number | null;
  capacityKg?: number | null;
  drivers: TransportDriver[];
  notes?: string | null;
  active: boolean;
};

export type TransportPayload = {
  plate?: string;
  type?: string;
  description?: string;
  status?: TransportStatus;
  capacityPallets?: number;
  capacityKg?: number;
  drivers?: TransportDriver[];
  notes?: string;
  active?: boolean;
};

export async function listTransports() {
  const { data } = await api.get<Transport[]>("/transports");
  return data;
}

export async function createTransport(payload: TransportPayload & { plate: string; type: string }) {
  const { data } = await api.post<Transport>("/transports", payload);
  return data;
}

export async function updateTransport(id: string, payload: TransportPayload) {
  const { data } = await api.patch<Transport>(`/transports/${id}`, payload);
  return data;
}

/** Historial de remitos (entradas/salidas) vinculados a la patente del vehículo. */
export async function getTransportHistory(id: string): Promise<{
  transport: Transport;
  documents: LogisticsDocument[];
  summary: { totalTrips: number; entries: number; exits: number; lastTrip: string | null };
}> {
  const { data } = await api.get(`/transports/${id}/history`);
  return data;
}

/** Registra una inspección en la bitácora del vehículo. */
export async function registerInspection(
  id: string,
  payload: { result: "APROBADA" | "CON_OBSERVACIONES" | "RECHAZADA"; notes?: string; setStatus?: TransportStatus },
): Promise<Transport> {
  const { data } = await api.post<Transport>(`/transports/${id}/inspection`, payload);
  return data;
}

export async function deleteTransport(id: string) {
  await api.delete(`/transports/${id}`);
}
