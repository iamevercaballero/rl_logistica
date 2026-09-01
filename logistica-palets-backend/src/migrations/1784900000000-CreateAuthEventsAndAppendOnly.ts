import { MigrationInterface, QueryRunner } from 'typeorm';
import { applyAppendOnlyTriggers, dropAppendOnlyTriggers } from '../common/append-only';

/**
 * Bitácora de autenticación y cumplimiento real del append-only (RL-M-09).
 *
 * Dos cosas que iban juntas: no había registro de intentos de login fallidos, y
 * las tablas de auditoría que sí existían eran append-only sólo por convención
 * —nada impedía un UPDATE o un DELETE sobre ellas—. Una bitácora que se puede
 * editar desde la misma conexión que la escribe no sirve como evidencia.
 *
 * Los triggers se aplican también a `document_events` y `user_audit_log`, que
 * ya existían. Es un cambio de comportamiento en la base: cualquier código que
 * intentara modificarlas empieza a fallar. Se verificó que nada en `src/` lo
 * hace, y `TRUNCATE` —lo que usan las pruebas para limpiar— no dispara triggers
 * de fila, así que sigue funcionando.
 */
export class CreateAuthEventsAndAppendOnly1784900000000 implements MigrationInterface {
  name = 'CreateAuthEventsAndAppendOnly1784900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auth_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "eventType" varchar(20) NOT NULL,
        "username" varchar(120) NOT NULL,
        "userId" uuid,
        "reason" varchar(20),
        "ip" varchar(45),
        "userAgent" varchar(255),
        "requestId" varchar(64),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_auth_events" PRIMARY KEY ("id")
      )
    `);

    // Las tres consultas que esta tabla existe para responder: "qué pasó en las
    // últimas horas", "quién viene fallando contra esta cuenta" y "qué está
    // haciendo esta IP".
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_auth_event_created_at" ON "auth_events" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_auth_event_username" ON "auth_events" ("username", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_auth_event_ip" ON "auth_events" ("ip", "createdAt")`,
    );

    await applyAppendOnlyTriggers(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Primero los triggers: si no, el DROP TABLE es lo de menos pero las otras
    // dos tablas quedarían con un trigger apuntando a una función borrada.
    await dropAppendOnlyTriggers(queryRunner);
    await queryRunner.query(`DROP TABLE IF EXISTS "auth_events"`);
  }
}
