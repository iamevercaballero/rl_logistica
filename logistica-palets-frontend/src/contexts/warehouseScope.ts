/**
 * Reglas puras del Depósito Activo, separadas del contexto de React para poder
 * probarlas sin montar componentes.
 *
 * Son las dos decisiones que no pueden fallar al cambiar de depósito:
 *  1. qué depósito queda activo (nunca uno no permitido, aunque lo diga el
 *     `localStorage`);
 *  2. qué queda cacheado (nunca datos operativos del depósito anterior).
 */

/** Raíces de query key cuyo contenido depende del depósito. */
export const WAREHOUSE_SCOPED_ROOTS = new Set([
  "dashboard", "kpis", "stock", "lots", "pallets", "movements", "documents",
  "reports", "locations", "alerts", "adjustments", "freshness", "bitacora",
]);

/**
 * ¿Esta query key depende del depósito?
 *
 * Los catálogos maestros (productos, usuarios, transportes, proveedores,
 * destinos) no cambian con el depósito y se conservan al cambiarlo: volver a
 * pedirlos sería trabajo al pedo.
 */
export function isWarehouseScopedKey(key: readonly unknown[]): boolean {
  return typeof key[0] === "string" && WAREHOUSE_SCOPED_ROOTS.has(key[0]);
}

/**
 * Depósito activo efectivo.
 *
 * El valor guardado es una preferencia, no una autorización: si dejó de estar
 * permitido (le revocaron el acceso, o el depósito se dio de baja) se descarta
 * y se cae al primero autorizado. Sin depósitos permitidos no hay activo.
 */
export function resolveActiveWarehouseId(
  storedId: string | null,
  allowedIds: readonly string[],
): string | null {
  if (allowedIds.length === 0) return null;
  if (storedId && allowedIds.includes(storedId)) return storedId;
  return allowedIds[0];
}
