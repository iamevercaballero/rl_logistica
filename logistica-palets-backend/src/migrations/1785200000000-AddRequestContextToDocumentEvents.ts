import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * IP, user-agent e id de correlación en la bitácora de negocio (cierra RL-M-09).
 *
 * RL-M-09 dejó esos tres datos en `auth_events` —la bitácora de accesos— pero no
 * en `document_events`, que es la de negocio. El resultado quedaba a mitad de
 * camino: de cada movimiento, ajuste o anulación se sabía **quién** lo hizo, no
 * **desde dónde**. Para un inventario con más de diez años de conservación
 * exigida, esa es justo la mitad que hace falta cuando algo se investiga.
 *
 * Las tres columnas son nulables, y no por comodidad: la bitácora también la
 * escriben el cron de alertas, el seed y el arranque, que no vienen de ninguna
 * petición. Ahí el valor correcto es NULL — una IP inventada sería peor que
 * ninguna. Las filas anteriores a esta migración quedan igual, en NULL, porque
 * ese dato no existe y no se puede reconstruir.
 *
 * No se hace backfill ni se toca una fila. `ADD COLUMN` con default nulo no
 * reescribe la tabla en PostgreSQL 11+, así que la migración es instantánea sin
 * importar el volumen.
 *
 * Sobre el trigger append-only: rechaza `UPDATE` y `DELETE` de filas, no DDL, de
 * modo que agregar columnas no lo activa ni hay que deshabilitarlo. Verificado.
 *
 * Los tipos replican exactamente los de `auth_events`, para que las dos bitácoras
 * se puedan cruzar por `requestId` sin conversiones: 45 caracteres alcanzan para
 * una IPv6 completa, 255 para el user-agent y 64 para el id de correlación.
 */
export class AddRequestContextToDocumentEvents1785200000000
  implements MigrationInterface
{
  name = 'AddRequestContextToDocumentEvents1785200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "document_events"
        ADD COLUMN IF NOT EXISTS "ip" character varying(45),
        ADD COLUMN IF NOT EXISTS "userAgent" character varying(255),
        ADD COLUMN IF NOT EXISTS "requestId" character varying(64)
    `);

    // Cruzar las dos bitácoras por el id de correlación es el caso de uso que
    // motiva la columna: «este login sospechoso, ¿qué movimientos generó?».
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_doc_event_request"
        ON "document_events" ("requestId") WHERE "requestId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_doc_event_request"`);
    await queryRunner.query(`
      ALTER TABLE "document_events"
        DROP COLUMN IF EXISTS "requestId",
        DROP COLUMN IF EXISTS "userAgent",
        DROP COLUMN IF EXISTS "ip"
    `);
  }
}
