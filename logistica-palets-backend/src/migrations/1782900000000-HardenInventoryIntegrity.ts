import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Refuerzos de integridad detectados en la auditoría funcional pre-producción:
 *
 *  1. `uq_lot_product_code` — unicidad real de (productId, lotCode). Hasta acá la
 *     regla vivía sólo en `findOrCreateLot` (SELECT + INSERT), así que dos cargas
 *     simultáneas o una importación masiva podían partir un lote en dos filas y
 *     romper el orden FEFO.
 *
 *  2. `uq_location_warehouse_code` — unicidad del código de ubicación dentro del
 *     depósito. Dos ubicaciones homónimas parten el stock en celdas indistinguibles.
 *
 *  3. `uq_transport_plate` — la patente identifica al vehículo y los remitos se
 *     vinculan por ella; duplicarla mezcla el historial de viajes.
 *
 * Los índices se crean sólo si los datos existentes lo permiten: si hay duplicados
 * previos, la migración aborta con un mensaje que indica qué limpiar. Es deliberado
 * — crear el índice descartando filas en silencio sería peor.
 */
export class HardenInventoryIntegrity1782900000000 implements MigrationInterface {
  name = 'HardenInventoryIntegrity1782900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const duplicateLots = await queryRunner.query(`
      SELECT "productId", "lotCode", COUNT(*)::int AS n
      FROM lots GROUP BY "productId", "lotCode" HAVING COUNT(*) > 1
    `);
    if (duplicateLots.length > 0) {
      throw new Error(
        `No se puede crear uq_lot_product_code: hay ${duplicateLots.length} combinación(es) ` +
        `(productId, lotCode) duplicadas en la tabla lots. Consolidá esos lotes antes de migrar.`,
      );
    }

    const duplicateLocations = await queryRunner.query(`
      SELECT "warehouseId", code, COUNT(*)::int AS n
      FROM locations GROUP BY "warehouseId", code HAVING COUNT(*) > 1
    `);
    if (duplicateLocations.length > 0) {
      throw new Error(
        `No se puede crear uq_location_warehouse_code: hay ${duplicateLocations.length} código(s) ` +
        `de ubicación duplicados dentro de un mismo depósito. Renombralos antes de migrar.`,
      );
    }

    const duplicatePlates = await queryRunner.query(`
      SELECT plate, COUNT(*)::int AS n
      FROM transports GROUP BY plate HAVING COUNT(*) > 1
    `);
    if (duplicatePlates.length > 0) {
      throw new Error(
        `No se puede crear uq_transport_plate: hay ${duplicatePlates.length} patente(s) duplicada(s) ` +
        `en la tabla transports. Consolidá esos vehículos antes de migrar.`,
      );
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_lot_product_code" ON lots ("productId", "lotCode")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_location_warehouse_code" ON locations ("warehouseId", code)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_transport_plate" ON transports (plate)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_transport_plate"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_location_warehouse_code"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_lot_product_code"`);
  }
}
