import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mueve a la zona de RECEPCIÓN el stock que quedó "en el limbo".
 *
 * Antes, una Entrada registrada sin asignar sector dejaba los pallets con
 * `currentLocationId = NULL`. Ese stock se cuenta en los totales (el catálogo lo
 * muestra) pero es **invisible en la Salida**: la pantalla filtra los pallets por
 * depósito con un JOIN a `locations`, y un pallet sin ubicación no está en
 * ninguna estantería de ningún depósito.
 *
 * A partir de ahora el backend ubica esos pallets en una `RECEPCION` por
 * depósito (ver `movements.service.ts`). Esta migración hace lo mismo con los
 * datos ya existentes:
 *  1. Crea la `RECEPCION` de cada depósito que la necesite.
 *  2. Mueve los pallets vivos sin ubicación a la `RECEPCION` de su depósito
 *     (derivado de sus movimientos; fallback: la fila de `stocks` sin ubicación
 *     del producto de su lote).
 *  3. Mueve las filas de `stocks` con `locationId NULL` a esa `RECEPCION`.
 *
 * No inventa depósitos: lo que no se puede resolver queda listado en
 * `unlocated_stock_review` y el deploy sigue.
 */
export class PlaceUnlocatedStockInReception1784500000000 implements MigrationInterface {
  name = 'PlaceUnlocatedStockInReception1784500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. RECEPCION por depósito que tenga stock o pallets sin ubicar ────────
    await queryRunner.query(`
      INSERT INTO locations (code, type, zone, "warehouseId", "capacityBases")
      SELECT 'RECEPCION', 'TEMPORAL', 'RECEPCION', wh.id, NULL
      FROM (
        SELECT DISTINCT s."warehouseId" AS id
        FROM stocks s
        WHERE s."locationId" IS NULL AND s."warehouseId" IS NOT NULL
        UNION
        SELECT DISTINCT m."warehouseId" AS id
        FROM pallets p
        JOIN movement_details md ON md."palletId" = p.id
        JOIN movements m ON m.id = md."movementId"
        WHERE p."currentLocationId" IS NULL
          AND p.status NOT IN ('EXITED', 'EMPTY')
          AND m."warehouseId" IS NOT NULL
      ) wh
      WHERE wh.id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM locations l WHERE l.code = 'RECEPCION' AND l."warehouseId" = wh.id
        )
    `);

    // ── 2. Mover los pallets vivos sin ubicación (antes que el stock, para que
    //       el fallback 2b pueda mirar las filas de stock todavía en NULL) ─────
    // 2a. Depósito por los movimientos del pallet (solo si es inequívoco).
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
    // 2b. Fallback: la fila de stock sin ubicación del producto de su lote.
    await queryRunner.query(`
      UPDATE pallets p
      SET "currentLocationId" = rl.id
      FROM lots lt
      JOIN (
        SELECT s."productId" AS pid, MIN(s."warehouseId"::text)::uuid AS whid
        FROM stocks s
        WHERE s."locationId" IS NULL AND s."warehouseId" IS NOT NULL
        GROUP BY s."productId"
        HAVING COUNT(DISTINCT s."warehouseId") = 1
      ) sw ON sw.pid = lt."productId"
      JOIN locations rl ON rl.code = 'RECEPCION' AND rl."warehouseId" = sw.whid
      WHERE lt.id = p."lotId"
        AND p."currentLocationId" IS NULL
        AND p.status NOT IN ('EXITED', 'EMPTY')
    `);

    // ── 3. Mover las filas de stock sin ubicación a la RECEPCION ──────────────
    // Merge por si ya existía una fila (product, wh, RECEPCION).
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
    // El resto (lo normal en el primer run): reubicar la fila directamente.
    await queryRunner.query(`
      UPDATE stocks s
      SET "locationId" = rl.id, "updatedAt" = now()
      FROM locations rl
      WHERE s."locationId" IS NULL AND s."warehouseId" IS NOT NULL
        AND rl.code = 'RECEPCION' AND rl."warehouseId" = s."warehouseId"
    `);

    // ── 4. Lo que no se pudo resolver: se registra, no se bloquea el deploy ──
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
      SELECT 'PALLET', p.id, 'Pallet vivo sin ubicacion y sin deposito derivable'
      FROM pallets p
      WHERE p."currentLocationId" IS NULL AND p.status NOT IN ('EXITED', 'EMPTY')
      UNION ALL
      SELECT 'STOCK', s.id, 'Fila de stock sin ubicacion y sin deposito'
      FROM stocks s
      WHERE s."locationId" IS NULL AND s."currentQuantity" <> 0
        AND (s."warehouseId" IS NULL
             OR NOT EXISTS (SELECT 1 FROM locations rl WHERE rl.code = 'RECEPCION' AND rl."warehouseId" = s."warehouseId"))
    `);
  }

  public async down(): Promise<void> {
    // Migración de datos: revertir movería el stock de vuelta a NULL (peor que
    // dejarlo). No se puede reconstruir qué pallet estaba sin ubicar antes.
    // La tabla de revisión es informativa; se deja.
  }
}
