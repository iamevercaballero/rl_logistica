import { MigrationInterface, QueryRunner } from 'typeorm';

const NIL = `'00000000-0000-0000-0000-000000000000'::uuid`;

/**
 * Cierra a nivel de base de datos la carrera de "doble fila de stock" para la
 * misma celda (producto+depósito+ubicación).
 *
 * Las columnas warehouseId/locationId son nullable y un UNIQUE estándar trata
 * los NULL como distintos → no protegería la celda a nivel de depósito
 * (locationId NULL). Por eso el índice único usa COALESCE con un UUID centinela,
 * que hace que dos filas (producto, NULL, NULL) colisionen.
 *
 * Antes de crear el índice deduplica filas existentes: por cada celda repetida,
 * conserva la fila más antigua, le suma las cantidades del resto y borra las
 * sobrantes. Idempotente (IF NOT EXISTS); seguro de re-aplicar.
 *
 * No es un índice declarado en la entidad → synchronize no lo toca ni lo pelea.
 * findOrCreateStock atrapa el 23505 que dispara este índice y re-lee la fila
 * ganadora en vez de duplicar.
 */
export class AddStockUniqueConstraint1700000000700 implements MigrationInterface {
  name = 'AddStockUniqueConstraint1700000000700';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const partition = `"productId", COALESCE("warehouseId", ${NIL}), COALESCE("locationId", ${NIL})`;

    // 1) Consolidar cantidades en la fila canónica (la más antigua) de cada celda.
    await queryRunner.query(`
      WITH grp AS (
        SELECT id,
          ROW_NUMBER() OVER (PARTITION BY ${partition} ORDER BY "updatedAt" ASC, id ASC) AS rn,
          SUM("currentQuantity") OVER (PARTITION BY ${partition}) AS group_total
        FROM stocks
      )
      UPDATE stocks s
      SET "currentQuantity" = grp.group_total, "updatedAt" = now()
      FROM grp
      WHERE s.id = grp.id AND grp.rn = 1
    `);

    // 2) Eliminar las filas duplicadas (no canónicas) de cada celda.
    await queryRunner.query(`
      WITH grp AS (
        SELECT id,
          ROW_NUMBER() OVER (PARTITION BY ${partition} ORDER BY "updatedAt" ASC, id ASC) AS rn
        FROM stocks
      )
      DELETE FROM stocks s USING grp WHERE s.id = grp.id AND grp.rn > 1
    `);

    // 3) Índice único de expresión (NULL colapsado por COALESCE).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_stock_cell"
      ON stocks ("productId", COALESCE("warehouseId", ${NIL}), COALESCE("locationId", ${NIL}))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_stock_cell"`);
  }
}
