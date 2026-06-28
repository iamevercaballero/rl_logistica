-- =============================================================================
-- Fake-apply de InitialSchema en una DB EXISTENTE (prod/staging).
--
-- Una DB que ya tiene el schema (creado por synchronize) NO debe re-ejecutar
-- InitialSchema. Esto la marca como "ya aplicada" e (opcional) limpia los
-- registros de las migraciones incrementales que vas a archivar.
--
-- Valores reales de la baseline ya generada:
--   archivo: src/migrations/1782626569588-InitialSchema.ts
--   clase:   InitialSchema1782626569588
--   TS=1782626569588   NAME=InitialSchema1782626569588
--
-- Corré esto UNA vez en cada DB existente (creada por synchronize), ANTES de
-- deployar con migraciones. En un VPS NUEVO con DB vacía NO hace falta: ahí
-- InitialSchema corre limpio con migration:run.
--
--   psql "$DATABASE_URL" -f scripts/fake-apply-baseline.sql
-- =============================================================================

BEGIN;

-- typeorm_migrations puede no existir todavía en una DB creada por synchronize.
CREATE TABLE IF NOT EXISTS typeorm_migrations (
  "id"        SERIAL PRIMARY KEY,
  "timestamp" bigint NOT NULL,
  "name"      character varying NOT NULL
);

-- Marca InitialSchema como aplicada sin ejecutarla (la DB ya tiene el schema).
INSERT INTO typeorm_migrations ("timestamp", "name")
SELECT 1782626569588, 'InitialSchema1782626569588'
WHERE NOT EXISTS (
  SELECT 1 FROM typeorm_migrations WHERE "name" = 'InitialSchema1782626569588'
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
