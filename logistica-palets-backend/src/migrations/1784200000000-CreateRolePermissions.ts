import { MigrationInterface, QueryRunner } from 'typeorm';
import { ROLE_PERMISSIONS_SEED } from '../modules/permissions/role-permissions.seed';

/**
 * `role_permissions` — la plantilla de cada rol, ahora dato editable en vez
 * de código en `frontend/src/auth/rbac.ts` + los `@Roles()` de cada
 * controller.
 *
 * El seed (`ROLE_PERMISSIONS_SEED`, compartido con los tests de integración
 * para que no puedan divergir) es una transcripción fiel de esa matriz actual
 * — el objetivo es que ningún usuario existente pierda ni gane una capacidad
 * el día que se activa el motor de permisos. `adjustments` es la única
 * entrada nueva: hoy no tiene fila en `rbac.ts` pese a que el backend
 * (`adjustments.controller.ts`) ya la trata como un dominio propio con su
 * propio flujo de aprobación.
 */
export class CreateRolePermissions1784200000000 implements MigrationInterface {
  name = 'CreateRolePermissions1784200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "role_permissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "role" varchar NOT NULL,
        "module" varchar NOT NULL,
        "action" varchar NOT NULL,
        "allowed" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_role_permissions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_role_permission"
      ON "role_permissions" ("role", "module", "action")
    `);

    // Solo se insertan combinaciones permitidas: la ausencia de fila ya
    // significa "no permitido".
    for (const row of ROLE_PERMISSIONS_SEED) {
      for (const role of row.roles) {
        await queryRunner.query(
          `INSERT INTO "role_permissions" ("role", "module", "action", "allowed")
           VALUES ($1, $2, $3, true)
           ON CONFLICT DO NOTHING`,
          [role, row.module, row.action],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "role_permissions"`);
  }
}
