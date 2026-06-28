import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 2 — Solicitudes de ajuste de inventario con circuito de aprobación.
 * Crea adjustment_requests y adjustment_request_lines.
 * Las secuencias RLAI/RLAO reutilizan la tabla document_sequences (ya creada en Fase 1).
 * Idempotente (IF NOT EXISTS): seguro sobre DB de dev (synchronize) y DB fresca.
 */
export class AddAdjustmentRequests1700000000300 implements MigrationInterface {
  name = 'AddAdjustmentRequests1700000000300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "adjustment_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" character varying(24) NOT NULL,
        "type" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'BORRADOR',
        "reason" character varying(60) NOT NULL,
        "adjustmentCategory" character varying(120),
        "warehouseId" uuid,
        "locationId" uuid,
        "notes" text,
        "rejectReason" text,
        "totalLines" integer NOT NULL DEFAULT 0,
        "totalQuantity" integer NOT NULL DEFAULT 0,
        "createdById" uuid NOT NULL,
        "approvedById" uuid,
        "approvedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_adjustment_requests" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_adj_request_code" ON "adjustment_requests" ("code")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_adj_request_created_at" ON "adjustment_requests" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_adj_request_type_status" ON "adjustment_requests" ("type", "status")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "adjustment_request_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "requestId" uuid NOT NULL,
        "productId" uuid NOT NULL,
        "palletItemsJson" text NOT NULL,
        "totalQuantity" integer NOT NULL DEFAULT 0,
        "locationId" uuid,
        CONSTRAINT "pk_adjustment_request_lines" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_adj_line_request" ON "adjustment_request_lines" ("requestId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_adj_line_request"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "adjustment_request_lines"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_adj_request_type_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_adj_request_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_adj_request_code"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "adjustment_requests"`);
  }
}
