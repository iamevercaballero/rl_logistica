import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RL-A-01 — tabla de claves de idempotencia.
 *
 * El índice único `(userId, key)` es el mecanismo, no un detalle: es lo que hace
 * que dos peticiones concurrentes con la misma clave choquen en la base en vez
 * de ejecutar la operación dos veces. La clave la genera el cliente, así que se
 * acota por usuario para que dos personas no puedan pisarse sin saberlo.
 */
export class CreateIdempotencyKeys1784700000000 implements MigrationInterface {
  name = 'CreateIdempotencyKeys1784700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "idempotency_keys" (
        "id"             uuid NOT NULL DEFAULT uuid_generate_v4(),
        "key"            character varying(200) NOT NULL,
        "userId"         uuid NOT NULL,
        "endpoint"       character varying(120) NOT NULL,
        "requestHash"    character varying(64) NOT NULL,
        "status"         character varying(20) NOT NULL DEFAULT 'IN_PROGRESS',
        "responseBody"   text,
        "responseStatus" integer,
        "createdAt"      TIMESTAMP NOT NULL DEFAULT now(),
        "completedAt"    TIMESTAMP,
        CONSTRAINT "PK_idempotency_keys_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_idempotency_key" ON "idempotency_keys" ("userId", "key")`,
    );
    // La purga por TTL borra por rango de fecha; sin este índice recorrería la
    // tabla entera cada hora.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_idempotency_created_at" ON "idempotency_keys" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "idempotency_keys"`);
  }
}
