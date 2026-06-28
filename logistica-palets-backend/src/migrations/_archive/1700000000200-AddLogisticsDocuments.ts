import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 1 — Documento logístico (remito) multi-producto/multi-lote.
 * Crea logistics_documents y document_sequences, y vincula movements.documentId.
 *
 * Idempotente (IF NOT EXISTS): seguro de aplicar sobre la DB de dev creada por
 * synchronize y sobre DB fresca. Aditivo: no toca datos existentes.
 */
export class AddLogisticsDocuments1700000000200 implements MigrationInterface {
  name = 'AddLogisticsDocuments1700000000200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Cabecera del remito
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "logistics_documents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" character varying(24) NOT NULL,
        "type" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'APROBADO',
        "date" TIMESTAMP NOT NULL DEFAULT now(),
        "documentNumber" character varying(80),
        "supplier" character varying(120),
        "destination" character varying(120),
        "warehouseId" uuid,
        "carrier" character varying(120),
        "driver" character varying(120),
        "vehiclePlate" character varying(30),
        "encargadoId" uuid,
        "notes" text,
        "totalLines" integer NOT NULL DEFAULT 0,
        "totalQuantity" integer NOT NULL DEFAULT 0,
        "createdById" uuid NOT NULL,
        "approvedById" uuid,
        "approvedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_logistics_documents" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_document_code" ON "logistics_documents" ("code")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_document_created_at" ON "logistics_documents" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_document_type_status" ON "logistics_documents" ("type", "status")`,
    );

    // Secuencias de códigos internos (RLNE / RLNS por año)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "document_sequences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "prefix" character varying(8) NOT NULL,
        "year" integer NOT NULL,
        "lastNumber" integer NOT NULL DEFAULT 0,
        CONSTRAINT "pk_document_sequences" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_document_sequence_key" ON "document_sequences" ("prefix", "year")`,
    );

    // Vínculo movimiento → documento
    await queryRunner.query(
      `ALTER TABLE "movements" ADD COLUMN IF NOT EXISTS "documentId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_movement_document" ON "movements" ("documentId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_movement_document"`);
    await queryRunner.query(`ALTER TABLE "movements" DROP COLUMN IF EXISTS "documentId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_document_sequence_key"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "document_sequences"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_document_type_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_document_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_document_code"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "logistics_documents"`);
  }
}
