import type { MovementType } from "../api/movements";
import { parseQtyInput, quantitiesEqual, quantityMismatch, sumQuantities } from "../utils/quantity";

export function showsExternalDocumentNumber(type: MovementType) {
  return type === "ENTRY";
}

/**
 * Valida que las cantidades repartidas por pallet sumen exactamente el total
 * declarado del lote/producto. Devuelve `null` si coinciden dentro de la
 * precisión del negocio (3 decimales), o el texto del error con el desglose
 * recibida / distribuido / diferencia.
 *
 * La suma se hace con `sumQuantities` (enteros escalados): un residuo de coma
 * flotante como `4537.000000000001` NO cuenta como diferencia; una diferencia
 * real de 0,1 kg sí.
 */
export function palletDistributionError(
  palletQtys: string[],
  declaredTotal: string,
  opts: { label?: string; noun?: string } = {},
): string | null {
  const distributed = sumQuantities(palletQtys.map((q) => parseQtyInput(q) ?? 0));
  const declared = parseQtyInput(declaredTotal) ?? 0;
  if (quantitiesEqual(distributed, declared)) return null;

  const noun = opts.noun ?? "los pallets";
  const detail = quantityMismatch(declared, distributed);
  const prefix = opts.label ? `${opts.label}: ` : "";
  return `${prefix}la suma de ${noun} no coincide con la cantidad recibida — ${detail.message}. Ajustá las cantidades.`;
}

export function responsibleFieldLabel(type: MovementType) {
  return type === "EXIT" ? "Encargado de envío" : "Encargado de recepción";
}

/**
 * Cantidad efectiva de un lote de Entrada.
 *
 * Con desglose de pallets, la cantidad del lote se **deriva** de la suma exacta
 * de esos pallets (la suma manda, como en Salida) — editar un pallet actualiza
 * el total solo, sin bloquear ni pelear con un total tipeado de antemano. Sin
 * desglose, es el valor que tipeó el operador (un solo ítem implícito).
 */
export function entryLotQuantity(palletQtys: string[], declaredQty: string): number {
  return palletQtys.length > 0
    ? sumQuantities(palletQtys.map((q) => parseQtyInput(q) ?? 0))
    : parseQtyInput(declaredQty) ?? 0;
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
