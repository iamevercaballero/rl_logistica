import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Segunda pasada del rescate de stock "en el limbo", ahora por los ajustes.
 *
 * `PlaceUnlocatedStockInReception1784500000000` limpió lo que había hasta ese
 * momento y el backend empezó a ubicar en RECEPCIÓN los pallets de una Entrada
 * sin sector. Pero la condición estaba atada a `type === 'ENTRY'`, y un
 * sobrante de inventario aprobado entra como `ADJUSTMENT_IN`: desde entonces,
 * cada sobrante que registraba un pallet nuevo volvía a dejarlo sin ubicación.
 *
 * El síntoma en el depósito: el stock del lote sube y los reportes lo muestran,
 * pero el pallet no aparece ni en la Salida ni en el módulo de diferencias
 * —las dos filtran por depósito con un JOIN a `locations`—, así que esas
 * unidades quedan contadas y sin poder despacharse.
 *
 * `movements.service.ts` ya aplica el fallback a todo lo que entra mercadería
 * (`isEntry`, que incluye ADJUSTMENT_IN). Esta migración hace lo mismo con los
 * pallets que quedaron en el medio. Es idempotente: sólo toca los que siguen
 * con `currentLocationId` nulo.
 */
export class PlaceAdjustmentStockInReception1785500000000 implements MigrationInterface {
  name = 'PlaceAdjustmentStockInReception1785500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. RECEPCION de cada depósito que tenga pallets vivos sin ubicar ─────
    await queryRunner.query(`
      INSERT INTO locations (code, type, zone, "warehouseId", "capacityBases")
      -- El NULL va tipado: sin el cast, Postgres lo toma como text y choca
      -- contra la columna integer.
      SELECT DISTINCT 'RECEPCION', 'TEMPORAL', 'RECEPCION', m."warehouseId", NULL::integer
      FROM pallets p
      JOIN movement_details md ON md."palletId" = p.id
      JOIN movements m ON m.id = md."movementId"
      WHERE p."currentLocationId" IS NULL
        AND p.status NOT IN ('EXITED', 'EMPTY')
        AND m."warehouseId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM locations l WHERE l.code = 'RECEPCION' AND l."warehouseId" = m."warehouseId"
        )
    `);

    // ── 2. Mover los pallets vivos sin ubicación a la RECEPCION de su depósito,
    //       derivado de sus movimientos y sólo si es inequívoco ───────────────
    await queryRunner.query(`
      UPDATE pallets p
      SET "currentLocationId" = rl.id
      FROM (
        SELECT md."palletId" AS pid, MIN(m."warehouseId"::text)::uuid AS whid
        FROM movement_details md
        JOIN movements m ON m.id = md."movementId"
        WHERE m."warehouseId" IS NOT NULL
        GROUP BY md."palletId"
        HAVING COUNT(DISTINCT m."warehouseId") = 1
      ) pm
      JOIN locations rl ON rl.code = 'RECEPCION' AND rl."warehouseId" = pm.whid
      WHERE p.id = pm.pid
        AND p."currentLocationId" IS NULL
        AND p.status NOT IN ('EXITED', 'EMPTY')
    `);

    // ── 3. Las filas de stock sin ubicación, a esa misma RECEPCION ───────────
    // Si ya existe la fila (producto, depósito, RECEPCION) se suma y se borra
    // la huérfana; si no, se reubica directamente.
    await queryRunner.query(`
      UPDATE stocks dst
      SET "currentQuantity" = dst."currentQuantity" + src.qty, "updatedAt" = now()
      FROM (
        SELECT s."productId", s."warehouseId", s."currentQuantity" AS qty, rl.id AS rlid
        FROM stocks s
        JOIN locations rl ON rl.code = 'RECEPCION' AND rl."warehouseId" = s."warehouseId"
        WHERE s."locationId" IS NULL AND s."warehouseId" IS NOT NULL
      ) src
      WHERE dst."productId" = src."productId"
        AND dst."warehouseId" = src."warehouseId"
        AND dst."locationId" = src.rlid
    `);
    await queryRunner.query(`
      DELETE FROM stocks s
      USING locations rl
      WHERE s."locationId" IS NULL AND s."warehouseId" IS NOT NULL
        AND rl.code = 'RECEPCION' AND rl."warehouseId" = s."warehouseId"
        AND EXISTS (
          SELECT 1 FROM stocks d
          WHERE d."productId" = s."productId" AND d."warehouseId" = s."warehouseId" AND d."locationId" = rl.id
        )
    `);
    await queryRunner.query(`
      UPDATE stocks s
      SET "locationId" = rl.id, "updatedAt" = now()
      FROM locations rl
      WHERE s."locationId" IS NULL AND s."warehouseId" IS NOT NULL
        AND rl.code = 'RECEPCION' AND rl."warehouseId" = s."warehouseId"
    `);

    // ── 4. Lo que siga sin resolverse queda anotado, no bloquea el deploy ────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "unlocated_stock_review" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "entity" character varying(40) NOT NULL,
        "entityId" uuid NOT NULL,
        "reason" character varying(200) NOT NULL,
        "detectedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_unlocated_stock_review" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "unlocated_stock_review" ("entity", "entityId", "reason")
      SELECT 'PALLET', p.id, 'Pallet vivo sin ubicacion tras ajuste aprobado'
      FROM pallets p
      WHERE p."currentLocationId" IS NULL AND p.status NOT IN ('EXITED', 'EMPTY')
        AND NOT EXISTS (
          SELECT 1 FROM "unlocated_stock_review" r WHERE r."entity" = 'PALLET' AND r."entityId" = p.id
        )
    `);
  }

  public async down(): Promise<void> {
    // Migración de datos: revertir devolvería los pallets al limbo, que es
    // peor que dejarlos ubicados. No hay nada que reconstruir.
  }
}
