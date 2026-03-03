import { api } from "./client";

export type MovementRow = {
  movement_id?: string;     
  movementId?: string;      
  type: string;
  date: string;
  reference?: string | null;
  notes?: string | null;

  pallet_id?: string;
  palletId?: string;
  lot_id?: string;
  lotId?: string;
  location_id?: string;
  locationId?: string;

  quantity?: number;
};

export async function getMovements() {
  const { data } = await api.get<MovementRow[]>("/reports/movements");
  return data;
}