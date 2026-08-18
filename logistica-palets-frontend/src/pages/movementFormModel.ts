import type { MovementType } from "../api/movements";

export function showsExternalDocumentNumber(type: MovementType) {
  return type === "ENTRY";
}

export function responsibleFieldLabel(type: MovementType) {
  return type === "EXIT" ? "Encargado de envío" : "Encargado de recepción";
}

/**
 * Lote SAP a enviar en los `palletItems` de un material.
 *
 * El lote SAP es un valor de cabecera del remito, pero la configuración es por
 * material (`usesSapLot`): en una entrada multi-producto conviven materiales que
 * lo usan y materiales que no, y cada línea se arma con el suyo.
 *
 * Solo evita mandarlo de más — quien garantiza que no se escriba es el backend.
 * Un material sin el dato cargado (respuestas viejas, productos sintetizados a
 * partir de un palet) se trata como que sí lo usa: es el default de la columna.
 */
export function sapLotForProduct(
  product: { usesSapLot?: boolean } | null | undefined,
  entrySapLot: string,
): string | undefined {
  if (product?.usesSapLot === false) return undefined;
  return entrySapLot.trim() || undefined;
}
