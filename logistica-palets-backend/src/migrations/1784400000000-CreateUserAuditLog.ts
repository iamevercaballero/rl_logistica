import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `user_audit_log` — quién cambió qué a quién en la administración de
 * usuarios. Sin FK a `users` (mismo criterio que el resto de la app para
 * columnas de autoría, ej. `movements.createdById`): un actor o un target
 * dado de baja más adelante no debe romper ni vaciar este historial.
 */
export class CreateUserAuditLog1784400000000 implements MigrationInterface {
  name = 'CreateUserAuditLog1784400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_audit_log" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "actorUserId" uuid NOT NULL,
        "targetUserId" uuid NOT NULL,
        "action" varchar NOT NULL,
        "field" varchar,
        "oldValue" text,
        "newValue" text,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_audit_log" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_audit_target"
      ON "user_audit_log" ("targetUserId", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_audit_log"`);
  }
}
