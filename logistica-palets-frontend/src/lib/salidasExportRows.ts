import type { Movement } from "../api/movements";
import { fmtDateTime } from "../utils/dateFormat";

export const DOCUMENTO_MATERIAL_PENDING = "Pendiente";

export type SalidaExportRow = {
  fecha: string;
  material: string;
  lote: string;
  sapLot: string;
  documentoMaterial: string;
  quantity: number;
  unit: string;
  pallets: number | string;
  desde: string;
  destino: string;
  carrier: string;
  driver: string;
  notes: string;
  estado: string;
};

/** Una fila por lote, igual que la tabla de Reporte de Salidas. */
export function buildSalidasExportRows(data: Movement[]): SalidaExportRow[] {
  return data.flatMap((movement) => {
    const lots = movement.lotsDetail?.length
      ? movement.lotsDetail
      : [{
          lotCode: movement.lotCode ?? null,
          sapLot: movement.sapLot ?? null,
          pallets: movement.pallets ?? null,
          quantity: movement.quantity,
        }];
    const documentoMaterial = movement.documentoMaterial?.trim() || DOCUMENTO_MATERIAL_PENDING;

    return lots.map((lot) => ({
      fecha: fmtDateTime(movement.createdAt ?? movement.date),
      material: `${movement.material.code} - ${movement.material.description}`,
      lote: lot.lotCode ?? "-",
      sapLot: lot.sapLot ?? "-",
      documentoMaterial,
      quantity: lot.quantity,
      unit: movement.material.unitOfMeasure ?? "",
      pallets: lot.pallets ?? "-",
      desde: `${movement.warehouse?.name ?? movement.from?.warehouseName ?? "-"}${
        (movement.location?.code ?? movement.from?.locationCode)
          ? ` / ${movement.location?.code ?? movement.from?.locationCode}`
          : ""
      }`,
      destino: movement.destination ?? "-",
      carrier: movement.carrier ?? "-",
      driver: movement.driver ?? "-",
      notes: movement.notes ?? "-",
      estado: movement.voidStatus === "VOIDED" ? "Anulado" : "Normal",
    }));
  });
}
