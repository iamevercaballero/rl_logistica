import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 3 — Adjuntos/fotos y bitácora de eventos.
 * Crea las tablas `attachments` y `document_events`.
 * Idempotente (IF NOT EXISTS).
 */
export class AddUploadsAndEvents1700000000500 implements MigrationInterface {
  name = 'AddUploadsAndEvents1700000000500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "attachments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(200) NOT NULL,
        "originalName" character varying(255) NOT NULL,
        "category" character varying(20) NOT NULL,
        "mimeType" character varying(100) NOT NULL,
        "fileSize" integer NOT NULL,
        "filePath" character varying(500) NOT NULL,
        "entityType" character varying(20) NOT NULL,
        "entityId" uuid NOT NULL,
        "createdById" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_attachments" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_attachment_entity" ON "attachments" ("entityType", "entityId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "document_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "entityType" character varying(20) NOT NULL,
        "entityId" uuid NOT NULL,
        "eventType" character varying(40) NOT NULL,
        "description" text NOT NULL,
        "metadata" text,
        "userId" uuid,
        "username" character varying(100),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_document_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_doc_event_entity" ON "document_events" ("entityType", "entityId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_doc_event_created_at" ON "document_events" ("createdAt" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_doc_event_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_doc_event_entity"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "document_events"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_attachment_entity"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "attachments"`);
  }
}
