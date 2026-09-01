import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sesiones de refresco (RL-M-02).
 *
 * Hasta acá `logout` sólo borraba la cookie del navegador: el refresh token
 * seguía siendo válido siete días, así que cerrar sesión no cerraba nada para
 * quien tuviera una copia. Cada fila de esta tabla es un refresh token vigente,
 * y su `id` viaja como `jti` dentro del token: sin fila viva, el token no vale.
 *
 * **Efecto al desplegar: todas las sesiones abiertas se cortan.** Los refresh
 * tokens emitidos antes no llevan `jti` y se rechazan a propósito —admitirlos
 * dejaría abierta una vía que evita la revocación—, así que la gente vuelve a
 * iniciar sesión una vez. Conviene desplegar fuera del horario de operación.
 */
export class CreateRefreshSessions1785100000000 implements MigrationInterface {
  name = 'CreateRefreshSessions1785100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "refresh_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "familyId" uuid NOT NULL,
        "expiresAt" TIMESTAMP NOT NULL,
        "revokedAt" TIMESTAMP,
        "revokedReason" varchar(20),
        "replacedById" uuid,
        "ip" varchar(45),
        "userAgent" varchar(255),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_sessions" PRIMARY KEY ("id")
      )
    `);

    // Las dos consultas de la tabla: las sesiones vivas de un usuario —para
    // cerrarlas todas— y las vencidas, para purgarlas.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_refresh_session_user" ON "refresh_sessions" ("userId", "revokedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_refresh_session_expires" ON "refresh_sessions" ("expiresAt")`,
    );
    // Cortar una familia entera al detectar un reuso.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_refresh_session_family" ON "refresh_sessions" ("familyId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_sessions"`);
  }
}
