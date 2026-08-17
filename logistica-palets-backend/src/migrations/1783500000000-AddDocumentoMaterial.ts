import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Documento de material SAP para Salidas. Se conserva tanto en la cabecera
 * RLNS como en cada movimiento, de modo que reportes y trazabilidad histórica
 * no dependan de reconstruir el dato desde otro sistema.
 */
export class AddDocumentoMaterial1783500000000 implements MigrationInterface {
  name = 'AddDocumentoMaterial1783500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "logistics_documents" ADD COLUMN IF NOT EXISTS "documentoMaterial" character varying(80)`,
    );
    await queryRunner.query(
      `ALTER TABLE "movements" ADD COLUMN IF NOT EXISTS "documentoMaterial" character varying(80)`,
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_exit_pending_documento_material"
      ON "movements" ("type")
      WHERE "type" = 'EXIT' AND NULLIF(BTRIM("documentoMaterial"), '') IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_exit_pending_documento_material"`);
    await queryRunner.query(`ALTER TABLE "movements" DROP COLUMN IF EXISTS "documentoMaterial"`);
    await queryRunner.query(`ALTER TABLE "logistics_documents" DROP COLUMN IF EXISTS "documentoMaterial"`);
  }
}
