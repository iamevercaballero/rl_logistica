import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Permisos de depósito por usuario (`user_warehouses`).
 *
 * Es una tabla de relación explícita, no un array de ids dentro del usuario:
 * un usuario puede tener acceso a N depósitos y un depósito a N usuarios, y
 * la asignación se puede auditar/consultar con SQL normal.
 *
 * Fase actual (política resuelta en WarehouseAccessService, no acá):
 *   ADMIN / MANAGER → acceso global, no necesitan filas en esta tabla.
 *   OPERATOR        → solo los depósitos asignados explícitamente.
 *   AUDITOR         → sin ampliar permisos por defecto.
 *
 * El backfill asigna a cada OPERATOR el depósito operativo `RL LOGÍSTICA`
 * (documentCode '01'), que es el único con el que trabajan hoy. Si ese
 * depósito no existe (base nueva/vacía) no se inventa ninguna asignación:
 * la migración no falla, simplemente no hay filas que crear.
 */
export class CreateUserWarehouses1783600000000 implements MigrationInterface {
  name = 'CreateUserWarehouses1783600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_warehouses" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "warehouseId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_warehouses_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_warehouses_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_warehouses_warehouse" FOREIGN KEY ("warehouseId")
          REFERENCES "warehouses"("id") ON DELETE CASCADE
      )
    `);

    // Una asignación por par usuario+depósito: evita duplicados que harían
    // ambiguo revocar el acceso.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_warehouse" ON "user_warehouses" ("userId", "warehouseId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_user_warehouses_user" ON "user_warehouses" ("userId")`,
    );

    // Backfill: OPERATOR → RL LOGÍSTICA (código documental '01').
    // Se identifica por documentCode, no por nombre ni por posición: el nombre
    // es editable y el orden de inserción no es un identificador estable.
    await queryRunner.query(`
      INSERT INTO "user_warehouses" ("userId", "warehouseId")
      SELECT u."id", w."id"
      FROM "users" u
      CROSS JOIN "warehouses" w
      WHERE u."role" = 'OPERATOR'
        AND w."documentCode" = '01'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_user_warehouses_user"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_user_warehouse"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_warehouses"`);
  }
}
