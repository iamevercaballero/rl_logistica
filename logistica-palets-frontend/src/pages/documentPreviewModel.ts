import type { MovementType } from "../api/movements";
import { sumQuantities } from "../utils/quantity";

/**
 * Vista previa de la nota — lo que se va a registrar, antes de registrarlo.
 *
 * Entrada y Salida se confirmaban de una: el botón mandaba el remito y recién
 * después se veía la nota impresa. Un destino mal elegido o un lote de menos se
 * descubrían con el movimiento ya aplicado al stock, y había que corregirlo por
 * el módulo de correcciones.
 *
 * Este modelo arma el resumen a partir de **las mismas líneas que se envían**
 * (no de una lectura aparte de los campos), así que lo que se muestra en la
 * previa es exactamente lo que se manda. Los datos se agrupan en el mismo orden
 * que la nota impresa (`PrintDocument`) para que la previa se lea como el papel
 * que va a salir.
 */

/** Un lote dentro de una línea de la nota. */
export type PreviewLot = {
  lotCode: string;
  sapLot?: string | null;
  fechaVencimiento?: string | null;
};

/** Una línea de mercadería: un material del remito. */
export type PreviewLine = {
  productLabel: string;
  unitOfMeasure?: string | null;
  quantity: number;
  pallets: number;
  lots: PreviewLot[];
};

export type DocumentPreview = {
  type: Extract<MovementType, "ENTRY" | "EXIT">;
  /** Día operativo elegido (YYYY-MM-DD). */
  date: string;
  warehouseName: string;
  supplier?: string;
  destination?: string;
  documentNumber?: string;
  documentoMaterial?: string;
  carrier?: string;
  vehiclePlate?: string;
  driver?: string;
  driverDocument?: string;
  /** Encargado de recepción/envío, tal como va a quedar en el remito. */
  responsibleName?: string;
  notes?: string;
  /** Nombres de los adjuntos que se van a subir al confirmar. */
  attachments: string[];
  lines: PreviewLine[];
};

/** Título del documento, igual que en la nota impresa. */
export function previewTitle(type: DocumentPreview["type"]): string {
  return type === "ENTRY" ? "NOTA DE ENTRADA" : "NOTA DE ENTREGA";
}

export type PreviewTotals = { lines: number; quantity: number; pallets: number; lots: number };

export function previewTotals(preview: DocumentPreview): PreviewTotals {
  const lotCodes = new Set<string>();
  for (const line of preview.lines) {
    for (const lot of line.lots) lotCodes.add(lot.lotCode);
  }
  return {
    lines: preview.lines.length,
    quantity: sumQuantities(preview.lines.map((line) => line.quantity)),
    pallets: preview.lines.reduce((sum, line) => sum + line.pallets, 0),
    lots: lotCodes.size,
  };
}

/**
 * Datos de cabecera que la nota va a imprimir en blanco.
 *
 * No bloquean nada — un remito sin transportadora es válido — pero conviene
 * verlos listados antes de confirmar, que es justo lo que no se podía hacer
 * cuando el botón registraba de una.
 */
export function previewMissingFields(preview: DocumentPreview): string[] {
  const missing: string[] = [];
  const isEntry = preview.type === "ENTRY";

  if (isEntry && !preview.supplier?.trim()) missing.push("Proveedor");
  if (isEntry && !preview.documentNumber?.trim()) missing.push("N° MIC/Factura/Remito");
  if (!isEntry && !preview.destination?.trim()) missing.push("Destino");
  if (!preview.vehiclePlate?.trim()) missing.push("Vehículo / chapa");
  if (!preview.carrier?.trim()) missing.push("Transportadora");
  // El conductor firma "Transportado por": sin él la nota sale con ese bloque
  // completado con la transportadora y el renglón de CI en blanco.
  if (!preview.driver?.trim()) missing.push("Conductor");
  else if (!preview.driverDocument?.trim()) missing.push("CI del conductor");

  return missing;
}
