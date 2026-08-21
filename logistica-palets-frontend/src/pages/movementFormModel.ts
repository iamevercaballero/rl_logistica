import type { MovementType } from "../api/movements";

export function showsExternalDocumentNumber(type: MovementType) {
  return type === "ENTRY";
}

export function responsibleFieldLabel(type: MovementType) {
  return type === "EXIT" ? "Encargado de envío" : "Encargado de recepción";
}

/**
 * El Lote SAP corresponde en esta operación.
 *
 * Se decide en dos niveles y se combina con un AND, igual que en el backend:
 * el depósito puede no manejar el concepto (y ahí no corresponde para ningún
 * material), y dentro de un depósito que sí lo maneja, cada material define si
 * lo usa. Un `undefined` en cualquiera de los dos (respuestas viejas, productos
 * sintetizados a partir de un palet) se trata como que sí: es el default de
 * ambas columnas.
 */
export function sapLotApplies(
  warehouse: { usesSapLot?: boolean } | null | undefined,
  product: { usesSapLot?: boolean } | null | undefined,
): boolean {
  return warehouse?.usesSapLot !== false && product?.usesSapLot !== false;
}

/**
 * Lote SAP a enviar en los `palletItems` de un material.
 *
 * El lote SAP es un valor de cabecera del remito, pero la configuración es por
 * depósito y por material: en una entrada multi-producto conviven materiales que
 * lo usan y materiales que no, y cada línea se arma con el suyo.
 *
 * Solo evita mandarlo de más — quien garantiza que no se escriba es el backend.
 */
export function sapLotForProduct(
  product: { usesSapLot?: boolean } | null | undefined,
  entrySapLot: string,
  warehouse?: { usesSapLot?: boolean } | null,
): string | undefined {
  if (!sapLotApplies(warehouse, product)) return undefined;
  return entrySapLot.trim() || undefined;
}
