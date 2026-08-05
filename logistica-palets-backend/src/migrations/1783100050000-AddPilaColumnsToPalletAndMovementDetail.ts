import { MigrationInterface, QueryRunner } from 'typeorm';

/** A qué pila pertenece un pallet, y en qué nivel de esa pila (1 = base). */
export class AddPilaColumnsToPalletAndMovementDetail1783100050000 implements MigrationInterface {
  name = 'AddPilaColumnsToPalletAndMovementDetail1783100050000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "pallets" ADD COLUMN IF NOT EXISTS "pilaId" uuid`);
    await queryRunner.query(`ALTER TABLE "pallets" ADD COLUMN IF NOT EXISTS "stackPosition" integer`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_pallet_pila" ON "pallets" ("pilaId")`);

    await queryRunner.query(`ALTER TABLE "movement_details" ADD COLUMN IF NOT EXISTS "pilaId" uuid`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_movement_detail_pila" ON "movement_details" ("pilaId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_movement_detail_pila"`);
    await queryRunner.query(`ALTER TABLE "movement_details" DROP COLUMN IF EXISTS "pilaId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pallet_pila"`);
    await queryRunner.query(`ALTER TABLE "pallets" DROP COLUMN IF EXISTS "stackPosition"`);
    await queryRunner.query(`ALTER TABLE "pallets" DROP COLUMN IF EXISTS "pilaId"`);
  }
}
