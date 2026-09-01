-- =============================================================================
-- RL Logística — ¿la base soporta las claves foráneas y los CHECK de RL-C-03?
--
--   docker exec -e PGPASSWORD=... rl_logistica_db_prod \
--     psql -U <user> -d <db> -f - < scripts/check-referential-integrity.sql
--
-- Es SOLO LECTURA: no modifica nada, se puede correr sobre producción en marcha.
--
-- Correrlo ANTES de la migración es lo que la vuelve segura. Hoy el inventario
-- vive sin integridad referencial (6 claves foráneas en 29 tablas), así que
-- puede haber filas apuntando a registros que ya no existen sin que nadie lo
-- sepa. Crear la restricción sobre datos así falla a mitad de camino; peor
-- todavía sería "arreglarlo" borrando filas. Este informe dice exactamente
-- cuántas hay y dónde, para decidir con datos antes de tocar el esquema.
--
-- Salida: una fila por comprobación. `huerfanas = 0` en todas = migración segura.
-- =============================================================================

\pset border 2
\pset title 'Integridad referencial — huérfanos por relación'

WITH comprobaciones AS (

  -- ── Stock ──────────────────────────────────────────────────────────────────
  SELECT 'stocks.productId'                AS relacion, COUNT(*) AS huerfanas FROM stocks s
    WHERE s."productId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM products t WHERE t.id = s."productId")
  UNION ALL SELECT 'stocks.warehouseId', COUNT(*) FROM stocks s
    WHERE s."warehouseId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM warehouses t WHERE t.id = s."warehouseId")
  UNION ALL SELECT 'stocks.locationId', COUNT(*) FROM stocks s
    WHERE s."locationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM locations t WHERE t.id = s."locationId")

  -- ── Movimientos ────────────────────────────────────────────────────────────
  UNION ALL SELECT 'movements.productId', COUNT(*) FROM movements m
    WHERE m."productId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM products t WHERE t.id = m."productId")
  UNION ALL SELECT 'movements.documentId', COUNT(*) FROM movements m
    WHERE m."documentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM logistics_documents t WHERE t.id = m."documentId")
  UNION ALL SELECT 'movements.warehouseId', COUNT(*) FROM movements m
    WHERE m."warehouseId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM warehouses t WHERE t.id = m."warehouseId")
  UNION ALL SELECT 'movements.locationId', COUNT(*) FROM movements m
    WHERE m."locationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM locations t WHERE t.id = m."locationId")
  UNION ALL SELECT 'movements.fromWarehouseId', COUNT(*) FROM movements m
    WHERE m."fromWarehouseId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM warehouses t WHERE t.id = m."fromWarehouseId")
  UNION ALL SELECT 'movements.fromLocationId', COUNT(*) FROM movements m
    WHERE m."fromLocationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM locations t WHERE t.id = m."fromLocationId")
  UNION ALL SELECT 'movements.toWarehouseId', COUNT(*) FROM movements m
    WHERE m."toWarehouseId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM warehouses t WHERE t.id = m."toWarehouseId")
  UNION ALL SELECT 'movements.toLocationId', COUNT(*) FROM movements m
    WHERE m."toLocationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM locations t WHERE t.id = m."toLocationId")
  UNION ALL SELECT 'movements.palletId', COUNT(*) FROM movements m
    WHERE m."palletId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pallets t WHERE t.id = m."palletId")
  UNION ALL SELECT 'movements.lotId', COUNT(*) FROM movements m
    WHERE m."lotId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lots t WHERE t.id = m."lotId")

  -- ── Detalle por pallet ─────────────────────────────────────────────────────
  UNION ALL SELECT 'movement_details.movementId', COUNT(*) FROM movement_details d
    WHERE d."movementId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM movements t WHERE t.id = d."movementId")
  UNION ALL SELECT 'movement_details.palletId', COUNT(*) FROM movement_details d
    WHERE d."palletId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pallets t WHERE t.id = d."palletId")
  UNION ALL SELECT 'movement_details.lotId', COUNT(*) FROM movement_details d
    WHERE d."lotId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lots t WHERE t.id = d."lotId")
  UNION ALL SELECT 'movement_details.locationId', COUNT(*) FROM movement_details d
    WHERE d."locationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM locations t WHERE t.id = d."locationId")
  UNION ALL SELECT 'movement_details.pilaId', COUNT(*) FROM movement_details d
    WHERE d."pilaId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pilas t WHERE t.id = d."pilaId")

  -- ── Pallets y pilas ────────────────────────────────────────────────────────
  UNION ALL SELECT 'pallets.lotId', COUNT(*) FROM pallets p
    WHERE p."lotId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lots t WHERE t.id = p."lotId")
  UNION ALL SELECT 'pallets.currentLocationId', COUNT(*) FROM pallets p
    WHERE p."currentLocationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM locations t WHERE t.id = p."currentLocationId")
  UNION ALL SELECT 'pallets.pilaId', COUNT(*) FROM pallets p
    WHERE p."pilaId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pilas t WHERE t.id = p."pilaId")
  UNION ALL SELECT 'pilas.locationId', COUNT(*) FROM pilas x
    WHERE x."locationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM locations t WHERE t.id = x."locationId")
  UNION ALL SELECT 'pilas.productId', COUNT(*) FROM pilas x
    WHERE x."productId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM products t WHERE t.id = x."productId")
  UNION ALL SELECT 'pilas.lotId', COUNT(*) FROM pilas x
    WHERE x."lotId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lots t WHERE t.id = x."lotId")

  -- ── Ajustes ────────────────────────────────────────────────────────────────
  UNION ALL SELECT 'adjustment_requests.warehouseId', COUNT(*) FROM adjustment_requests a
    WHERE a."warehouseId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM warehouses t WHERE t.id = a."warehouseId")
  UNION ALL SELECT 'adjustment_requests.locationId', COUNT(*) FROM adjustment_requests a
    WHERE a."locationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM locations t WHERE t.id = a."locationId")
  UNION ALL SELECT 'adjustment_requests.originalMovementId', COUNT(*) FROM adjustment_requests a
    WHERE a."originalMovementId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM movements t WHERE t.id = a."originalMovementId")
  UNION ALL SELECT 'adjustment_request_lines.requestId', COUNT(*) FROM adjustment_request_lines l
    WHERE l."requestId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM adjustment_requests t WHERE t.id = l."requestId")
  UNION ALL SELECT 'adjustment_request_lines.productId', COUNT(*) FROM adjustment_request_lines l
    WHERE l."productId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM products t WHERE t.id = l."productId")
  UNION ALL SELECT 'adjustment_request_lines.locationId', COUNT(*) FROM adjustment_request_lines l
    WHERE l."locationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM locations t WHERE t.id = l."locationId")

  -- ── Documentos y varios ────────────────────────────────────────────────────
  UNION ALL SELECT 'logistics_documents.warehouseId', COUNT(*) FROM logistics_documents g
    WHERE g."warehouseId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM warehouses t WHERE t.id = g."warehouseId")
  UNION ALL SELECT 'regularization_logs.movementId', COUNT(*) FROM regularization_logs r
    WHERE r."movementId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM movements t WHERE t.id = r."movementId")
  UNION ALL SELECT 'document_sequences.warehouseId', COUNT(*) FROM document_sequences q
    WHERE q."warehouseId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM warehouses t WHERE t.id = q."warehouseId")
  UNION ALL SELECT 'sap_stock_snapshots.productId', COUNT(*) FROM sap_stock_snapshots n
    WHERE n."productId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM products t WHERE t.id = n."productId")
  UNION ALL SELECT 'sap_stock_snapshots.warehouseId', COUNT(*) FROM sap_stock_snapshots n
    WHERE n."warehouseId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM warehouses t WHERE t.id = n."warehouseId")
  UNION ALL SELECT 'sap_stock_snapshots.locationId', COUNT(*) FROM sap_stock_snapshots n
    WHERE n."locationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM locations t WHERE t.id = n."locationId")
  UNION ALL SELECT 'alert_rules.productId', COUNT(*) FROM alert_rules e
    WHERE e."productId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM products t WHERE t.id = e."productId")
  UNION ALL SELECT 'alert_rules.warehouseId', COUNT(*) FROM alert_rules e
    WHERE e."warehouseId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM warehouses t WHERE t.id = e."warehouseId")
  UNION ALL SELECT 'user_permissions.userId', COUNT(*) FROM user_permissions u
    WHERE u."userId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users t WHERE t.id = u."userId")
)
SELECT relacion, huerfanas,
       CASE WHEN huerfanas = 0 THEN 'ok' ELSE 'BLOQUEA LA MIGRACIÓN' END AS estado
FROM comprobaciones
ORDER BY huerfanas DESC, relacion;

\pset title 'Rangos de cantidad — violaciones de los CHECK propuestos'

SELECT 'movements.quantity > 0'        AS regla, COUNT(*) AS violaciones,
       CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'BLOQUEA LA MIGRACIÓN' END AS estado
  FROM movements WHERE quantity IS NULL OR quantity <= 0
UNION ALL
SELECT 'movement_details.quantity > 0', COUNT(*),
       CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'BLOQUEA LA MIGRACIÓN' END
  FROM movement_details WHERE quantity IS NULL OR quantity <= 0
UNION ALL
SELECT 'stocks.currentQuantity >= 0', COUNT(*),
       CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'BLOQUEA LA MIGRACIÓN' END
  FROM stocks WHERE "currentQuantity" < 0
UNION ALL
SELECT 'pallets.quantity >= 0', COUNT(*),
       CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'BLOQUEA LA MIGRACIÓN' END
  FROM pallets WHERE quantity < 0
UNION ALL
SELECT 'lots.stockActual >= 0', COUNT(*),
       CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'BLOQUEA LA MIGRACIÓN' END
  FROM lots WHERE "stockActual" < 0
ORDER BY 2 DESC, 1;

\pset title 'Volumen (para estimar cuánto tarda la migración)'

SELECT relname AS tabla, n_live_tup AS filas
  FROM pg_stat_user_tables
 WHERE relname IN ('movements','movement_details','stocks','pallets','pilas','lots','locations','products')
 ORDER BY n_live_tup DESC;
