-- =============================================================================
-- Fake-apply de InitialSchema en una DB EXISTENTE (prod/staging).
--
-- Una DB que ya tiene el schema (creado por synchronize) NO debe re-ejecutar
-- InitialSchema. Esto la marca como "ya aplicada" e (opcional) limpia los
-- registros de las migraciones incrementales que vas a archivar.
--
-- 1) Reemplazá <TS> y <NAME> por el timestamp y el nombre de clase de la
--    migración generada (ej: archivo 1718999999999-InitialSchema.ts →
--    class InitialSchema1718999999999 → TS=1718999999999, NAME=InitialSchema1718999999999).
-- 2) Corré esto UNA vez en cada DB existente, ANTES de deployar con migraciones.
--
--   psql "$DATABASE_URL" -f scripts/fake-apply-baseline.sql
-- =============================================================================

BEGIN;

-- Marca InitialSchema como aplicada sin ejecutarla (la DB ya tiene el schema).
INSERT INTO typeorm_migrations ("timestamp", "name")
SELECT <TS>, '<NAME>'
WHERE NOT EXISTS (
  SELECT 1 FROM typeorm_migrations WHERE "name" = '<NAME>'
);

-- Opcional: limpia los registros de las incrementales que vas a archivar
-- (sus archivos ya no existirán; los registros quedarían huérfanos e inocuos,
--  pero esto deja la tabla prolija). Dejá comentado si preferís conservarlos.
-- DELETE FROM typeorm_migrations
-- WHERE "name" IN (
--   'AddCriticalIndexes1700000000100',
--   'AddLogisticsDocuments1700000000200',
--   'AddAdjustmentRequests1700000000300',
--   'AddVoidStatus1700000000400',
--   'AddUploadsAndEvents1700000000500',
--   'AddEntityCodeToEvents1700000000600',
--   'AddStockUniqueConstraint1700000000700'
-- );

COMMIT;
