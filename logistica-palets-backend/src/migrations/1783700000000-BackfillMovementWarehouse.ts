import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill del depósito en movimientos históricos.
 *
 * Con el Depósito Activo, un movimiento sin `warehouseId` no se puede filtrar
 * ni autorizar: queda invisible en las vistas operativas y solo lo pueden tocar
 * los roles de alcance global. Esta migración recupera el dato **solo cuando es
 * inequívoco**, derivándolo de la ubicación o de los pallets del movimiento.
 *
 * Reglas:
 *  - Nunca se inventa un depósito. Si un movimiento no tiene forma de resolverlo
 *    (sin ubicación y sin pallets ubicados), se deja en NULL a propósito.
 *  - Si los pallets del movimiento están repartidos en más de un depósito, no se
 *    elige uno: es un caso a revisar a mano, no a adivinar.
 *  - No se toca ningún movimiento que ya tenga depósito.
 *  - No se borra ni se reescribe stock: es un backfill de metadato, el
 *    invariante Stock = Lotes = Pallets no se altera.
 *
 * Los casos que no se pudieron resolver quedan listados en la tabla
 * `warehouse_backfill_review` para revisarlos sin bloquear el despliegue.
 */
export class BackfillMovementWarehouse1783700000000 implements MigrationInterface {
  name = 'BackfillMovementWarehouse1783700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Desde la ubicación propia del movimiento (el caso más directo).
    await queryRunner.query(`
      UPDATE movements m
      SET "warehouseId" = loc."warehouseId"
      FROM locations loc
      WHERE m."warehouseId" IS NULL
        AND m."locationId" IS NOT NULL
        AND loc.id = m."locationId"
    `);

    // 2. Desde los pallets del movimiento (salidas, que nunca piden ubicación).
    //    El HAVING garantiza que solo se aplica si todos los pallets del
    //    movimiento viven en el mismo depósito: si hay más de uno, se omite.
    await queryRunner.query(`
      UPDATE movements m
      SET "warehouseId" = src."warehouseId"
      FROM (
        SELECT md."movementId", MIN(loc."warehouseId"::text)::uuid AS "warehouseId"
        FROM movement_details md
        JOIN pallets p   ON p.id = md."palletId"
        JOIN locations loc ON loc.id = p."currentLocationId"
        GROUP BY md."movementId"
        HAVING COUNT(DISTINCT loc."warehouseId") = 1
      ) src
      WHERE m."warehouseId" IS NULL
        AND src."movementId" = m.id
    `);

    // 3. Desde el documento al que pertenece la línea (RLNE/RLNS ya lo guardan).
    await queryRunner.query(`
      UPDATE movements m
      SET "warehouseId" = d."warehouseId"
      FROM logistics_documents d
      WHERE m."warehouseId" IS NULL
        AND m."documentId" IS NOT NULL
        AND d.id = m."documentId"
        AND d."warehouseId" IS NOT NULL
    `);

    // 4. Lo que quedó sin resolver se registra para revisión manual. No se
    //    bloquea el deploy: son datos históricos, no operaciones nuevas.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "warehouse_backfill_review" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "entity" character varying(40) NOT NULL,
        "entityId" uuid NOT NULL,
        "reason" character varying(200) NOT NULL,
        "detectedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_warehouse_backfill_review" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      INSERT INTO "warehouse_backfill_review" ("entity", "entityId", "reason")
      SELECT 'MOVEMENT', m.id,
             CASE
               WHEN EXISTS (
                 SELECT 1 FROM movement_details md
                 JOIN pallets p ON p.id = md."palletId"
                 JOIN locations loc ON loc.id = p."currentLocationId"
                 WHERE md."movementId" = m.id
               ) THEN 'Pallets en más de un depósito: requiere decisión manual'
               ELSE 'Sin ubicación ni pallets ubicados: depósito indeterminable'
             END
      FROM movements m
      WHERE m."warehouseId" IS NULL
    `);

    // 5. Mismo criterio para los documentos: se deriva del depósito de sus
    //    líneas cuando todas coinciden.
    await queryRunner.query(`
      UPDATE logistics_documents d
      SET "warehouseId" = src."warehouseId"
      FROM (
        SELECT m."documentId", MIN(m."warehouseId"::text)::uuid AS "warehouseId"
        FROM movements m
        WHERE m."documentId" IS NOT NULL AND m."warehouseId" IS NOT NULL
        GROUP BY m."documentId"
        HAVING COUNT(DISTINCT m."warehouseId") = 1
      ) src
      WHERE d."warehouseId" IS NULL
        AND src."documentId" = d.id
    `);

    await queryRunner.query(`
      INSERT INTO "warehouse_backfill_review" ("entity", "entityId", "reason")
      SELECT 'DOCUMENT', d.id, 'Documento sin depósito derivable de sus líneas'
      FROM logistics_documents d
      WHERE d."warehouseId" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // El backfill no es reversible sin perder información: no se sabe cuáles
    // filas tenían depósito antes de correrlo. Solo se elimina la tabla de
    // revisión, que es puramente informativa.
    await queryRunner.query(`DROP TABLE IF EXISTS "warehouse_backfill_review"`);
  }
}
