import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Anulación automática de movimientos.
 * - movements: agrega voidStatus ('NONE'|'VOID_PENDING'|'VOIDED') y voidAdjRequestId
 * - adjustment_requests: agrega originalMovementId (referencia al movimiento anulado)
 * Idempotente (IF NOT EXISTS / ALTER ... IF NOT EXISTS).
 */
export class AddVoidStatus1700000000400 implements MigrationInterface {
  name = 'AddVoidStatus1700000000400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // movements
    await queryRunner.query(`
      ALTER TABLE "movements"
        ADD COLUMN IF NOT EXISTS "voidStatus" character varying NOT NULL DEFAULT 'NONE',
        ADD COLUMN IF NOT EXISTS "voidAdjRequestId" uuid
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_movement_void_status" ON "movements" ("voidStatus") WHERE "voidStatus" != 'NONE'`,
    );

    // adjustment_requests
    await queryRunner.query(`
      ALTER TABLE "adjustment_requests"
        ADD COLUMN IF NOT EXISTS "originalMovementId" uuid
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_adj_request_original_movement" ON "adjustment_requests" ("originalMovementId") WHERE "originalMovementId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_adj_request_original_movement"`);
    await queryRunner.query(`ALTER TABLE "adjustment_requests" DROP COLUMN IF EXISTS "originalMovementId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_movement_void_status"`);
    await queryRunner.query(`ALTER TABLE "movements" DROP COLUMN IF EXISTS "voidAdjRequestId"`);
    await queryRunner.query(`ALTER TABLE "movements" DROP COLUMN IF EXISTS "voidStatus"`);
  }
}
