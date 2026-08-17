import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega el alcance operativo estable de RLNE/RLNS y snapshots de impresión.
 *
 * Los depósitos existentes quedan con documentCode NULL deliberadamente: el
 * código debe ser asignado explícitamente por operación y nunca inferido por
 * posición, UUID ni fecha de creación. Los documentos históricos tampoco se
 * renombran ni se reescriben.
 */
export class WarehouseDocumentCodesAndPrintSnapshots1783300000000 implements MigrationInterface {
  name = 'WarehouseDocumentCodesAndPrintSnapshots1783300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "documentCode" character varying(2)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_warehouse_document_code" ON "warehouses" ("documentCode")`,
    );
    await queryRunner.query(
      `ALTER TABLE "warehouses" ADD CONSTRAINT "chk_warehouse_document_code" ` +
      `CHECK ("documentCode" IS NULL OR "documentCode" ~ '^[0-9]{2}$')`,
    );

    await queryRunner.query(
      `ALTER TABLE "document_sequences" ADD COLUMN IF NOT EXISTS "warehouseId" uuid ` +
      `NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_document_sequence_key"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_document_sequence_key" ON "document_sequences" ("prefix", "year", "warehouseId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "logistics_documents" ADD COLUMN IF NOT EXISTS "warehouseNameSnapshot" character varying(120)`,
    );
    await queryRunner.query(
      `ALTER TABLE "logistics_documents" ADD COLUMN IF NOT EXISTS "warehouseDocumentCodeSnapshot" character varying(2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "logistics_documents" ADD COLUMN IF NOT EXISTS "createdByUsernameSnapshot" character varying(120)`,
    );
    await queryRunner.query(
      `ALTER TABLE "logistics_documents" ADD COLUMN IF NOT EXISTS "createdByFullNameSnapshot" character varying(160)`,
    );
    await queryRunner.query(
      `ALTER TABLE "logistics_documents" ADD COLUMN IF NOT EXISTS "encargadoUsernameSnapshot" character varying(120)`,
    );
    await queryRunner.query(
      `ALTER TABLE "logistics_documents" ADD COLUMN IF NOT EXISTS "encargadoFullNameSnapshot" character varying(160)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "logistics_documents" DROP COLUMN IF EXISTS "encargadoFullNameSnapshot"`);
    await queryRunner.query(`ALTER TABLE "logistics_documents" DROP COLUMN IF EXISTS "encargadoUsernameSnapshot"`);
    await queryRunner.query(`ALTER TABLE "logistics_documents" DROP COLUMN IF EXISTS "createdByFullNameSnapshot"`);
    await queryRunner.query(`ALTER TABLE "logistics_documents" DROP COLUMN IF EXISTS "createdByUsernameSnapshot"`);
    await queryRunner.query(`ALTER TABLE "logistics_documents" DROP COLUMN IF EXISTS "warehouseDocumentCodeSnapshot"`);
    await queryRunner.query(`ALTER TABLE "logistics_documents" DROP COLUMN IF EXISTS "warehouseNameSnapshot"`);

    // Las filas year=0 son contadores nuevos por depósito; los documentos que
    // ya emitieron no se tocan. Se eliminan solo para poder restaurar la clave vieja.
    await queryRunner.query(`DELETE FROM "document_sequences" WHERE "year" = 0`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_document_sequence_key"`);
    await queryRunner.query(`ALTER TABLE "document_sequences" DROP COLUMN IF EXISTS "warehouseId"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_document_sequence_key" ON "document_sequences" ("prefix", "year")`,
    );

    await queryRunner.query(`ALTER TABLE "warehouses" DROP CONSTRAINT IF EXISTS "chk_warehouse_document_code"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_warehouse_document_code"`);
    await queryRunner.query(`ALTER TABLE "warehouses" DROP COLUMN IF EXISTS "documentCode"`);
  }
}
