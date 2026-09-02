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

[ -f "$DUMP" ] || { echo "No existe el archivo: $DUMP" >&2; exit 1; }

# Los backups cifrados terminan en .gpg (ver backup-db.sh). Se detecta por el
# nombre y no por una variable, para que restaurar un archivo viejo sin cifrar
# siga funcionando sin tocar nada.
PASSPHRASE=""
case "$DUMP" in
  *.gpg)
    command -v gpg >/dev/null 2>&1 || {
      echo "El dump está cifrado y gpg no está instalado." >&2; exit 1; }
    PASSPHRASE="${BACKUP_PASSPHRASE:-$(val BACKUP_PASSPHRASE)}"
    [ -n "$PASSPHRASE" ] || {
      echo "El dump está cifrado y BACKUP_PASSPHRASE no está definida (revisá $ENV_FILE)." >&2
      exit 1; }
    ;;
esac

# Se comprueba ANTES de pedir confirmación. El dump trae `--clean --if-exists`,
# así que descubrir a mitad de camino que la frase no era la correcta dejaría la
# base con el esquema a medio borrar.
descifrar() {
  gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 \
      --decrypt "$DUMP" 3< <(printf '%s' "$PASSPHRASE")
}

if [ -n "$PASSPHRASE" ]; then
  descifrar 2>/dev/null | gzip -t 2>/dev/null || {
    echo "No se pudo descifrar, o el dump está corrupto: $DUMP" >&2; exit 1; }
else
  gzip -t "$DUMP" 2>/dev/null || { echo "Dump corrupto: $DUMP" >&2; exit 1; }
fi

echo "Vas a restaurar:  $DUMP"
if [ -n "$PASSPHRASE" ]; then echo "                  (cifrado, frase verificada)"; fi
echo "Sobre la DB:      '$PGDB' (contenedor $DB_CONTAINER)"
read -r -p "Esto SOBREESCRIBE la base. Escribí 'si' para continuar: " ans
[ "$ans" = "si" ] || { echo "Cancelado."; exit 1; }

echo ">> Restaurando ..."
if [ -n "$PASSPHRASE" ]; then
  descifrar | gunzip -c | docker exec -i "$DB_CONTAINER" psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1
else
  gunzip -c "$DUMP" | docker exec -i "$DB_CONTAINER" psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1
fi
echo ">> Restore completado."
