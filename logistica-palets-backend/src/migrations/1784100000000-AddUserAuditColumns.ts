import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Columnas de trazabilidad y seguridad de `users`, necesarias para la ficha
 * de usuario (pestaña Seguridad) y para invalidar JWT ya emitidos sin llevar
 * una lista de revocación aparte.
 *
 * `passwordChangedAt` nace en `now()`: todo usuario existente queda con un
 * timestamp válido menor a cualquier token futuro, así que ningún JWT ya
 * emitido se invalida por esta migración — el chequeo en `JwtStrategy` solo
 * empieza a importar desde el primer reset de contraseña o "cerrar sesiones"
 * que se haga después de aplicarla.
 */
export class AddUserAuditColumns1784100000000 implements MigrationInterface {
  name = 'AddUserAuditColumns1784100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "createdAt" timestamp NOT NULL DEFAULT now()`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp NOT NULL DEFAULT now()`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastLoginAt" timestamp`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordChangedAt" timestamp NOT NULL DEFAULT now()`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mustChangePassword" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "mustChangePassword"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "passwordChangedAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "lastLoginAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "updatedAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "createdAt"`);
  }
}
