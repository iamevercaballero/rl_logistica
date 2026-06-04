import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 5 — Plan de Producción.
 * Crea la tabla `production_plans` con índices.
 * Idempotente (IF NOT EXISTS).
 */
export class AddProductionPlans1700000000700 implements MigrationInterface {
  name = 'AddProductionPlans1700000000700';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "production_plans" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "plannedDate" date NOT NULL,
        "type" character varying NOT NULL,
        "productId" uuid NOT NULL,
        "warehouseId" uuid,
        "locationId" uuid,
        "plannedQuantity" integer NOT NULL,
        "plannedPallets" integer,
        "status" character varying NOT NULL DEFAULT 'PLANNED',
        "supplier" character varying,
        "destination" character varying,
        "carrier" character varying,
        "notes" text,
        "createdById" uuid NOT NULL,
        "confirmedById" uuid,
        "confirmedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_production_plans" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_prod_plan_date" ON "production_plans" ("plannedDate")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_prod_plan_product" ON "production_plans" ("productId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_prod_plan_status" ON "production_plans" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_prod_plan_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_prod_plan_product"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_prod_plan_date"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "production_plans"`);
  }
}
