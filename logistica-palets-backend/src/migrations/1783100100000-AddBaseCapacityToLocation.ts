import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Capacidad en bases (lugares de piso) en vez de pallets: una base aloja una
 * pila entera, no un pallet. `capacityPallets` queda de baja (no se borra,
 * puede seguir usándose en reportes viejos) — el operario ya no la ve.
 */
export class AddBaseCapacityToLocation1783100100000 implements MigrationInterface {
  name = 'AddBaseCapacityToLocation1783100100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "capacityBases" integer`);
    await queryRunner.query(`ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "defaultMaxStackLevel" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "locations" DROP COLUMN IF EXISTS "defaultMaxStackLevel"`);
    await queryRunner.query(`ALTER TABLE "locations" DROP COLUMN IF EXISTS "capacityBases"`);
  }
}
