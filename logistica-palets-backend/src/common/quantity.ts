/** Decimales admitidos por las columnas `numeric(14,3)` del inventario. */
export const QUANTITY_SCALE = 3;

const FACTOR = 10 ** QUANTITY_SCALE;

/**
 * Redondea una cantidad a la precisión que soporta la base.
 *
 * Las cantidades del inventario son decimales y en JavaScript se operan como
 * `number` (coma flotante binaria), donde `0.1 + 0.2 === 0.30000000000000004`.
 * Sin redondear, esos residuos se acumulan movimiento a movimiento y terminan
 * apareciendo como diferencias de inventario fantasma o como un "stock
 * insuficiente" al despachar exactamente lo que hay disponible.
 */
export function roundQuantity(value: number): number {
  return Math.round(value * FACTOR) / FACTOR;
}

/** `true` si las dos cantidades son iguales dentro de la precisión soportada. */
export function quantitiesEqual(a: number, b: number): boolean {
  return roundQuantity(a - b) === 0;
}
