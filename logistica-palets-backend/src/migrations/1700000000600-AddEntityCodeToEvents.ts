import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega entityCode a document_events para mostrar el código del documento
 * (RLNE-2026-000001, RLAI-...) en la Bitácora global sin necesidad de JOINs.
 */
export class AddEntityCodeToEvents1700000000600 implements MigrationInterface {
  name = 'AddEntityCodeToEvents1700000000600';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "document_events"
        ADD COLUMN IF NOT EXISTS "entityCode" character varying(40)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "document_events"
        DROP COLUMN IF EXISTS "entityCode"
    `);
  }
}
