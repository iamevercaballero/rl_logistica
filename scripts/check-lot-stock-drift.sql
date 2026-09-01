-- =============================================================================
-- RL Logística — ¿el contador de cada lote coincide con sus pallets? (RL-A-09)
--
--   docker exec -i -e PGPASSWORD=... rl_logistica_backend_prod-db \
--     psql -U <user> -d <db> -f - < scripts/check-lot-stock-drift.sql
--
-- Es SOLO LECTURA: no corrige nada, se puede correr sobre producción en marcha.
--
-- Por qué correrlo ANTES de desplegar: hasta ahora, una resta que dejaba el
-- contador del lote en negativo se recortaba a cero en silencio
-- (`Math.max(0, ...)`), así que la divergencia entre `lots.stockActual` y la
-- suma real de sus pallets podía venir arrastrándose hace tiempo sin que nadie
-- lo supiera. Desde este cambio esa resta CORTA la operación con un mensaje que
-- pide reconciliar. Es el comportamiento correcto — pero si hay lotes ya
-- desfasados, conviene saberlo y reconciliarlos antes, no descubrirlo cuando un
-- operador no pueda despachar.
--
-- Si la consulta no devuelve filas, no hay nada que reconciliar.
-- =============================================================================

\pset border 2
\pset title 'Lotes cuyo contador no coincide con la suma de sus pallets'

WITH real AS (
  SELECT l.id,
         l."lotCode",
         l."stockActual"                                   AS contador,
         -- Misma definición que usa `LotsService.reconcileStock`: todo lo que
         -- no salió del depósito. Los EMPTY suman 0, así que no cambian nada.
         COALESCE(SUM(p.quantity) FILTER (WHERE p.status <> 'EXITED'), 0) AS en_pallets
    FROM lots l
    LEFT JOIN pallets p ON p."lotId" = l.id
   GROUP BY l.id, l."lotCode", l."stockActual"
)
SELECT "lotCode"                              AS lote,
       contador,
       en_pallets,
       ROUND(en_pallets - contador, 3)        AS diferencia,
       CASE
         WHEN contador > en_pallets THEN 'el contador infla: una salida va a fallar'
         ELSE 'el contador falta: hay mercadería que no cuenta'
       END                                    AS efecto,
       id                                     AS lote_id
  FROM real
 -- Comparación a la escala de la base (3 decimales), para no listar residuos
 -- de coma flotante como si fueran diferencias reales.
 WHERE ROUND(contador, 3) <> ROUND(en_pallets, 3)
 ORDER BY ABS(en_pallets - contador) DESC;

\pset title 'Resumen'

WITH real AS (
  SELECT l.id, l."stockActual" AS contador,
         COALESCE(SUM(p.quantity) FILTER (WHERE p.status <> 'EXITED'), 0) AS en_pallets
    FROM lots l LEFT JOIN pallets p ON p."lotId" = l.id
   GROUP BY l.id, l."stockActual"
)
SELECT COUNT(*)                                                        AS lotes_totales,
       COUNT(*) FILTER (WHERE ROUND(contador,3) <> ROUND(en_pallets,3)) AS desfasados,
       CASE
         WHEN COUNT(*) FILTER (WHERE ROUND(contador,3) <> ROUND(en_pallets,3)) = 0
           THEN 'sin desvíos: se puede desplegar'
         ELSE 'reconciliar antes de desplegar (POST /api/lots/reconcile-all)'
       END                                                             AS veredicto
  FROM real;
