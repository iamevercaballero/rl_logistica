import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `user_permissions` — overrides puntuales por usuario, por encima de lo que
 * da `role_permissions`. Nace vacía: ningún usuario existente tiene overrides
 * hasta que un ADMIN/MANAGER los cargue explícitamente desde la ficha.
 */
export class CreateUserPermissions1784300000000 implements MigrationInterface {
  name = 'CreateUserPermissions1784300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_permissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "module" varchar NOT NULL,
        "action" varchar NOT NULL,
        "effect" varchar NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_permissions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_permission"
      ON "user_permissions" ("userId", "module", "action")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_permission_user"
      ON "user_permissions" ("userId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_permissions"`);
  }
}
