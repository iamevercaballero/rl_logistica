/**
 * Definición única de las restricciones de integridad del inventario (RL-C-03).
 *
 * Vive fuera de la migración para que las pruebas de integración puedan aplicar
 * exactamente el mismo esquema. El `synchronize` de TypeORM sólo crea claves
 * foráneas para relaciones declaradas con `@ManyToOne`, y acá casi todas son
 * columnas `uuid` planas, así que sin esto la suite correría contra un esquema
 * más permisivo que el de producción — que es la peor clase de test verde.
 *
 * El criterio de cada acción y qué queda deliberadamente afuera está explicado
 * en la migración `1784600000000-AddInventoryForeignKeys`.
 */

export type OnDelete = 'RESTRICT' | 'CASCADE';

/** [tabla, columna, tablaDestino, acción] */
export const INVENTORY_FKS: ReadonlyArray<readonly [string, string, string, OnDelete]> = [
  ['stocks', 'productId', 'products', 'RESTRICT'],
  ['stocks', 'warehouseId', 'warehouses', 'RESTRICT'],
  ['stocks', 'locationId', 'locations', 'RESTRICT'],

  ['movements', 'productId', 'products', 'RESTRICT'],
  ['movements', 'documentId', 'logistics_documents', 'RESTRICT'],
  ['movements', 'warehouseId', 'warehouses', 'RESTRICT'],
  ['movements', 'locationId', 'locations', 'RESTRICT'],
  ['movements', 'fromWarehouseId', 'warehouses', 'RESTRICT'],
  ['movements', 'fromLocationId', 'locations', 'RESTRICT'],
  ['movements', 'toWarehouseId', 'warehouses', 'RESTRICT'],
  ['movements', 'toLocationId', 'locations', 'RESTRICT'],
  ['movements', 'palletId', 'pallets', 'RESTRICT'],
  ['movements', 'lotId', 'lots', 'RESTRICT'],

  ['movement_details', 'movementId', 'movements', 'CASCADE'],
  ['movement_details', 'palletId', 'pallets', 'RESTRICT'],
  ['movement_details', 'lotId', 'lots', 'RESTRICT'],
  ['movement_details', 'locationId', 'locations', 'RESTRICT'],
  ['movement_details', 'pilaId', 'pilas', 'RESTRICT'],

  ['pallets', 'lotId', 'lots', 'RESTRICT'],
  ['pallets', 'currentLocationId', 'locations', 'RESTRICT'],
  ['pallets', 'pilaId', 'pilas', 'RESTRICT'],

  ['pilas', 'locationId', 'locations', 'RESTRICT'],
  ['pilas', 'productId', 'products', 'RESTRICT'],
  ['pilas', 'lotId', 'lots', 'RESTRICT'],

  ['adjustment_requests', 'warehouseId', 'warehouses', 'RESTRICT'],
  ['adjustment_requests', 'locationId', 'locations', 'RESTRICT'],
  ['adjustment_requests', 'originalMovementId', 'movements', 'RESTRICT'],
  ['adjustment_request_lines', 'requestId', 'adjustment_requests', 'CASCADE'],
  ['adjustment_request_lines', 'productId', 'products', 'RESTRICT'],
  ['adjustment_request_lines', 'locationId', 'locations', 'RESTRICT'],

  ['logistics_documents', 'warehouseId', 'warehouses', 'RESTRICT'],
  ['regularization_logs', 'movementId', 'movements', 'CASCADE'],
  // `document_sequences.warehouseId` queda SIN clave foránea a propósito: usa el
  // UUID cero (`GLOBAL_SEQUENCE_SCOPE`) como centinela de "secuencia global", el
  // alcance de los correlativos RLAI/RLAO, que no son por depósito. Es una
  // columna discriminada, no una referencia pura — misma categoría que los
  // `entityId` polimórficos. Lo detectó la suite de integración al correr contra
  // este esquema: la restricción rechazaba cada emisión de código de ajuste.

  ['sap_stock_snapshots', 'productId', 'products', 'RESTRICT'],
  ['sap_stock_snapshots', 'warehouseId', 'warehouses', 'RESTRICT'],
  ['sap_stock_snapshots', 'locationId', 'locations', 'RESTRICT'],

  ['alert_rules', 'productId', 'products', 'CASCADE'],
  ['alert_rules', 'warehouseId', 'warehouses', 'CASCADE'],

  ['user_permissions', 'userId', 'users', 'CASCADE'],
] as const;

/** [tabla, nombre, expresión] */
export const INVENTORY_CHECKS: ReadonlyArray<readonly [string, string, string]> = [
  ['movements', 'chk_movement_quantity_positive', '"quantity" > 0'],
  ['movement_details', 'chk_movement_detail_quantity_positive', '"quantity" > 0'],
  ['stocks', 'chk_stock_quantity_non_negative', '"currentQuantity" >= 0'],
  ['pallets', 'chk_pallet_quantity_non_negative', '"quantity" >= 0'],
  ['lots', 'chk_lot_stock_non_negative', '"stockActual" >= 0'],
] as const;

/** Nombre de la clave foránea de una columna. Determinista: lo usan migración y tests. */
export function inventoryFkName(tabla: string, columna: string): string {
  return `fk_${tabla}_${columna.toLowerCase()}`;
}

/** SQL que agrega una restricción sólo si todavía no existe. */
export function addConstraintIfMissing(tabla: string, nombre: string, definicion: string): string {
  return `
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${nombre}') THEN
        ALTER TABLE "${tabla}" ADD CONSTRAINT "${nombre}" ${definicion};
      END IF;
    END $$;
  `;
}
