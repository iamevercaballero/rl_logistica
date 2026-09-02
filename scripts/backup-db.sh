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
# El `|| true` no es decorativo: con `set -e` y `pipefail`, si la clave no
# está el grep falla, la sustitución falla, y una asignación como
# `X=$(val LO_QUE_SEA)` mata el script en silencio, sin llegar siquiera al
# mensaje que explica qué falta. Una clave ausente tiene que devolver vacío.
val() {
  [ -f "$ENV_FILE" ] || return 0
  { tr -d '\r' < "$ENV_FILE" | grep -m1 "^$1=" | cut -d= -f2- |
      sed -E "s/^\"(.*)\"$/\1/; s/^'(.*)'$/\1/"; } || true
}

PGUSER="${POSTGRES_USER:-$(val POSTGRES_USER)}"
PGDB="${POSTGRES_DB:-$(val POSTGRES_DB)}"
: "${PGUSER:?POSTGRES_USER no definido (ponelo en $ENV_FILE o exportalo)}"
: "${PGDB:?POSTGRES_DB no definido (ponelo en $ENV_FILE o exportalo)}"

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/rl_${PGDB}_${TS}.sql.gz"

# ── Cifrado en reposo ────────────────────────────────────────────────────────
# Lo que más protege es la copia off-site: si algún día se filtran las
# credenciales de R2/B2, del otro lado hay una base entera con la operación del
# cliente. También cubre un disco del VPS que se dé de baja mal.
#
# Simétrico y no asimétrico, a propósito. Con clave pública el servidor no
# podría descifrar sus propios backups —mejor si lo comprometen—, pero obliga a
# custodiar una clave privada que, si se pierde, deja inservibles todos los
# backups. Para una operación de una sola persona eso agrega más riesgo del que
# saca. La frase va en el mismo archivo que ya guarda la contraseña de la base,
# así que no suma un secreto nuevo que administrar; guardala igual fuera del
# servidor, porque un backup que no se puede descifrar no es un backup.
#
# gpg y no `openssl enc`: openssl en CBC descifra basura sin avisar si el
# archivo se corrompió o alguien lo tocó. gpg comprueba integridad.
#
# La frase viaja por descriptor de archivo, nunca por la línea de comandos, que
# `ps` le muestra a cualquier usuario del sistema.
PASSPHRASE="${BACKUP_PASSPHRASE:-$(val BACKUP_PASSPHRASE)}"

if [ -n "$PASSPHRASE" ]; then
  command -v gpg >/dev/null 2>&1 || {
    echo "ERROR: BACKUP_PASSPHRASE está definida pero gpg no está instalado." >&2
    echo "       Se aborta en vez de escribir el backup sin cifrar." >&2
    exit 1
  }
  OUT="$OUT.gpg"
fi

echo ">> Dump de '$PGDB' desde contenedor '$DB_CONTAINER' ..."
# Sin -t: un TTY corrompería el stream que va a gzip.
if [ -n "$PASSPHRASE" ]; then
  docker exec "$DB_CONTAINER" pg_dump -U "$PGUSER" -d "$PGDB" \
    --no-owner --clean --if-exists | gzip -9 |
    gpg --batch --yes --quiet --pinentry-mode loopback \
        --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 \
        --passphrase-fd 3 --output "$OUT" 3< <(printf '%s' "$PASSPHRASE")
else
  docker exec "$DB_CONTAINER" pg_dump -U "$PGUSER" -d "$PGDB" \
    --no-owner --clean --if-exists | gzip -9 > "$OUT"
fi

# Verificación: que no esté vacío y que el contenido se pueda recuperar de
# verdad. Con cifrado esto descifra y valida el gzip de adentro, así que de una
# sola pasada comprueba la frase, la integridad del archivo y que el dump no
# haya salido truncado.
verificar() {
  [ -s "$OUT" ] || return 1
  if [ -n "$PASSPHRASE" ]; then
    gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 \
        --decrypt "$OUT" 3< <(printf '%s' "$PASSPHRASE") 2>/dev/null | gzip -t 2>/dev/null
  else
    gzip -t "$OUT" 2>/dev/null
  fi
}

if ! verificar; then
  echo "ERROR: backup vacío, corrupto o no descifrable, se elimina: $OUT" >&2
  rm -f "$OUT"
  exit 1
fi

if [ -n "$PASSPHRASE" ]; then
  echo ">> OK, cifrado con AES-256: $OUT ($(du -h "$OUT" | cut -f1))"
else
  echo ">> OK: $OUT ($(du -h "$OUT" | cut -f1))"
  echo "!! Backup SIN CIFRAR. Definí BACKUP_PASSPHRASE en $ENV_FILE." >&2
fi

# Off-site opcional.
if [ -n "${RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null 2>&1; then
  echo ">> Subiendo off-site a $RCLONE_REMOTE ..."
  rclone copy "$OUT" "$RCLONE_REMOTE" && echo ">> Subido off-site."
fi

echo ">> Retención: borrando backups locales > ${RETENTION_DAYS} días ..."
find "$BACKUP_DIR" -name 'rl_*.sql.gz*' -type f -mtime "+${RETENTION_DAYS}" -print -delete
echo ">> Backup finalizado."
