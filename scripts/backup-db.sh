#!/usr/bin/env bash
# =============================================================================
# Backup diario de PostgreSQL — RL Logística (producción).
#
# Corre en el VPS, en el directorio donde está docker-compose.prod.yml.
#   bash scripts/backup-db.sh
#
# Cron sugerido (03:00 cada día):
#   0 3 * * * cd /opt/rl_logistica && bash scripts/backup-db.sh >> /var/log/rl_backup.log 2>&1
#
# Off-site opcional (Cloudflare R2 / Backblaze B2 vía rclone): exportá
#   RCLONE_REMOTE=r2:rl-logistica-backups   (tras configurar un remote con `rclone config`)
# =============================================================================
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-rl_logistica_db_prod}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
ENV_FILE="${ENV_FILE:-.env.prod}"

# Credenciales desde .env.prod (no se hardcodean).
# El archivo se lee clave por clave, no con `. "$ENV_FILE"`. Sourcear rompe: los
# valores con espacios y sin comillas —EMISOR_RAZON_SOCIAL, MAIL_FROM— hacen que
# el shell intente ejecutarlos, y con `set -e` el script aborta con exit 127 sin
# escribir un solo byte. Corriendo por cron eso se pierde en un log que nadie
# mira, y el problema recien aparece el dia que hace falta restaurar.
# Una variable ya exportada gana sobre el archivo (util para probar el ciclo
# contra una base descartable).
val() {
  [ -f "$ENV_FILE" ] || return 0
  tr -d '\r' < "$ENV_FILE" | grep -m1 "^$1=" | cut -d= -f2- |
    sed -E "s/^\"(.*)\"$/\1/; s/^'(.*)'$/\1/"
}

PGUSER="${POSTGRES_USER:-$(val POSTGRES_USER)}"
PGDB="${POSTGRES_DB:-$(val POSTGRES_DB)}"
: "${PGUSER:?POSTGRES_USER no definido (ponelo en $ENV_FILE o exportalo)}"
: "${PGDB:?POSTGRES_DB no definido (ponelo en $ENV_FILE o exportalo)}"

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/rl_${PGDB}_${TS}.sql.gz"

echo ">> Dump de '$PGDB' desde contenedor '$DB_CONTAINER' ..."
# Sin -t: un TTY corrompería el stream que va a gzip.
docker exec "$DB_CONTAINER" pg_dump -U "$PGUSER" -d "$PGDB" \
  --no-owner --clean --if-exists | gzip -9 > "$OUT"

# Verificación de integridad: no vacío y gzip válido.
if [ ! -s "$OUT" ] || ! gzip -t "$OUT" 2>/dev/null; then
  echo "ERROR: backup vacío o corrupto, se elimina: $OUT" >&2
  rm -f "$OUT"
  exit 1
fi
echo ">> OK: $OUT ($(du -h "$OUT" | cut -f1))"

# Off-site opcional.
if [ -n "${RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null 2>&1; then
  echo ">> Subiendo off-site a $RCLONE_REMOTE ..."
  rclone copy "$OUT" "$RCLONE_REMOTE" && echo ">> Subido off-site."
fi

echo ">> Retención: borrando backups locales > ${RETENTION_DAYS} días ..."
find "$BACKUP_DIR" -name 'rl_*.sql.gz' -type f -mtime "+${RETENTION_DAYS}" -print -delete
echo ">> Backup finalizado."
