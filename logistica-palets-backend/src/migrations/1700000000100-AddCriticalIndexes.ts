import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Índices críticos para queries de alta frecuencia.
 * Idempotente: usa IF NOT EXISTS, seguro de aplicar sobre la DB de dev
 * (creada por synchronize) y sobre DB fresca en producción.
 */
export class AddCriticalIndexes1700000000100 implements MigrationInterface {
  name = 'AddCriticalIndexes1700000000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // movement_details — joins frecuentes desde reports y trazabilidad de palets
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_movement_detail_movement" ON "movement_details" ("movementId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_movement_detail_pallet" ON "movement_details" ("palletId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_movement_detail_lot" ON "movement_details" ("lotId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_movement_detail_location" ON "movement_details" ("locationId")`,
    );

    // stocks — keyed por (product, warehouse, location) en findOne y agregaciones
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_stock_product_warehouse_location" ON "stocks" ("productId", "warehouseId", "locationId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_stock_product" ON "stocks" ("productId")`,
    );

    // lots — FEFO ordena por fechaVencimiento; status filtra PENDING_REGULARIZATION
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_lot_status" ON "lots" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_lot_product" ON "lots" ("productId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_lot_vencimiento" ON "lots" ("fechaVencimiento")`,
    );

    // movements — historial por createdAt DESC, búsquedas por tipo+status, joins por producto
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_movement_created_at" ON "movements" ("createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_movement_product" ON "movements" ("productId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_movement_type_status" ON "movements" ("type", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_movement_pallet" ON "movements" ("palletId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_movement_lot" ON "movements" ("lotId")`,
    );

    // pallets — currentLocationId para stock math, status para listados de operación
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_pallet_current_location" ON "pallets" ("currentLocationId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_pallet_lot" ON "pallets" ("lotId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_pallet_status" ON "pallets" ("status")`,
    );

    // regularization_logs — audit trail por movimiento
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_regularization_movement" ON "regularization_logs" ("movementId")`,
    );

    // sap_stock_snapshots — diff diario y traza por material
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_sap_snapshot_date_product" ON "sap_stock_snapshots" ("date", "productId")`,
    );

    // billing — listados de facturas por cliente, fecha y estado
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_facturas_cliente" ON "facturas" ("clienteId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_facturas_fecha" ON "facturas" ("fecha" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_facturas_estado" ON "facturas" ("estado")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_items_factura_factura" ON "items_factura" ("facturaId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_items_factura_factura"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_facturas_estado"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_facturas_fecha"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_facturas_cliente"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_sap_snapshot_date_product"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_regularization_movement"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pallet_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pallet_lot"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pallet_current_location"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_movement_lot"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_movement_pallet"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_movement_type_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_movement_product"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_movement_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_lot_vencimiento"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_lot_product"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_lot_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_stock_product"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_stock_product_warehouse_location"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_movement_detail_location"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_movement_detail_lot"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_movement_detail_pallet"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_movement_detail_movement"`);
  }
}
