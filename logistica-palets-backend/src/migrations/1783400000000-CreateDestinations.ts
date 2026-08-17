import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catálogo reutilizable de destinos. Las RLNS siguen guardando el nombre en
 * `logistics_documents.destination`, por lo que no se agrega una FK ni se
 * reescriben documentos ya emitidos.
 */
export class CreateDestinations1783400000000 implements MigrationInterface {
  name = 'CreateDestinations1783400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "destinations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(120) NOT NULL,
        "notes" text,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_destinations_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_destination_name"
      ON "destinations" (LOWER(TRIM("name")))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "destinations"`);
  }
}
