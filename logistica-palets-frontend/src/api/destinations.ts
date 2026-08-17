import { api } from "./client";

export type Destination = {
  id: string;
  name: string;
  notes?: string | null;
  active: boolean;
};

export async function listDestinations(search?: string, includeInactive = false) {
  const { data } = await api.get<Destination[]>("/destinations", {
    params: { search: search || undefined, includeInactive: includeInactive ? "true" : undefined },
  });
  return data;
}

export async function createDestination(payload: { name: string; notes?: string }) {
  const { data } = await api.post<Destination>("/destinations", payload);
  return data;
}
