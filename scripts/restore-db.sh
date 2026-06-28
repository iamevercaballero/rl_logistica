#!/usr/bin/env bash
# =============================================================================
# Restore de un backup (.sql.gz) a la DB de producción — RL Logística.
#
#   bash scripts/restore-db.sh backups/rl_logistica_palets_20260628_030000.sql.gz
#
# CUIDADO: sobreescribe el contenido de la DB (el dump usa --clean --if-exists).
# Probá restores periódicamente contra una DB descartable (ver DEPLOY.md).
# =============================================================================
set -euo pipefail

DUMP="${1:?Pasá la ruta del dump .sql.gz}"
DB_CONTAINER="${DB_CONTAINER:-rl_logistica_db_prod}"
ENV_FILE="${ENV_FILE:-.env.prod}"

if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
PGUSER="${POSTGRES_USER:?POSTGRES_USER no definido}"
PGDB="${POSTGRES_DB:?POSTGRES_DB no definido}"

[ -f "$DUMP" ] || { echo "No existe el archivo: $DUMP" >&2; exit 1; }
gzip -t "$DUMP" 2>/dev/null || { echo "Dump corrupto: $DUMP" >&2; exit 1; }

echo "Vas a restaurar:  $DUMP"
echo "Sobre la DB:      '$PGDB' (contenedor $DB_CONTAINER)"
read -r -p "Esto SOBREESCRIBE la base. Escribí 'si' para continuar: " ans
[ "$ans" = "si" ] || { echo "Cancelado."; exit 1; }

echo ">> Restaurando ..."
gunzip -c "$DUMP" | docker exec -i "$DB_CONTAINER" psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1
echo ">> Restore completado."
