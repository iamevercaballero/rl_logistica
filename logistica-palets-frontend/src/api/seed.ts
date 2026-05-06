import { api } from './client';

export interface SeedStats {
  productosCreados: number;
  productosOmitidos: number;
  lotesCreados: number;
  stockCargado: number;
  entradasCreadas: number;
  salidasCreadas: number;
}

export interface SeedResult {
  mensaje: string;
  stats: SeedStats;
}

export async function seedFromExcel(opts: { maxMovimientos?: number; soloProductos?: boolean } = {}): Promise<SeedResult> {
  const r = await api.post<SeedResult>('/seed/from-excel', opts, { timeout: 300000 });
  return r.data;
}

export async function resetData(): Promise<{ mensaje: string }> {
  const r = await api.post<{ mensaje: string }>('/seed/reset');
  return r.data;
}
