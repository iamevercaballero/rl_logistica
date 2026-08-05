import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Pila" — agrupación física de pallets apilados que comparten un mismo lugar
 * de piso (una "base") dentro de un Sector-Subsector (`locations`). Es la
 * unidad que el motor de colocación arma automáticamente; el operario nunca
 * la elige a mano, solo ve el Sector-Subsector.
 *
 * `locationId` es uuid sin FK, igual criterio que `pallets.currentLocationId`
 * y `stocks.locationId` en este esquema — mitigado a nivel aplicación (los
 * mismos chequeos de "¿tiene contenido?" antes de borrar una ubicación se
 * extienden a pilas colgadas).
 */
export class CreatePilaTable1783100000000 implements MigrationInterface {
  name = 'CreatePilaTable1783100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pilas" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "locationId" uuid NOT NULL,
        "sequence" integer NOT NULL,
        "status" character varying NOT NULL DEFAULT 'OPEN',
        "maxLevels" integer,
        "productId" uuid,
        "lotId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "closedAt" TIMESTAMP,
        CONSTRAINT "PK_pilas_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_pila_location_sequence" ON "pilas" ("locationId", "sequence")`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_pila_location" ON "pilas" ("locationId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_pila_product" ON "pilas" ("productId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_pila_status" ON "pilas" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "pilas"`);
  }
}
