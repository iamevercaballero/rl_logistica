#!/usr/bin/env bash
# =============================================================================
# Genera la migracion InitialSchema con el schema COMPLETO actual, a partir de
# las entidades, contra una base vacia y efimera (docker). Un solo comando:
#
#   bash scripts/generate-baseline.sh
#
# Resultado: src/migrations/<timestamp>-InitialSchema.ts con todo el CREATE
# (tablas, columnas, indices declarados en entidades y FKs).
#
# OJO: el generador NO incluye el indice de expresion uq_stock_cell (no esta
# declarado en ninguna entidad). Tras generar, segui MIGRATIONS.md para plegarlo.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

# --- Asegurar npm en PATH -----------------------------------------------------
# En un subshell de bash, npm puede no estar disponible si node se instalo con
# un version manager (nvm/fnm) que solo se carga en shells interactivos.
ensure_npm() {
  command -v npm >/dev/null 2>&1 && return 0
  # nvm
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
  command -v npm >/dev/null 2>&1 && return 0
  # fnm
  if command -v fnm >/dev/null 2>&1; then eval "$(fnm env)" >/dev/null 2>&1 || true; fi
  command -v npm >/dev/null 2>&1 && return 0
  # ultimo recurso: agarrar el npm de instalaciones comunes
  local d
  for d in "$HOME"/.nvm/versions/node/*/bin /opt/homebrew/bin /usr/local/bin "$HOME"/.volta/bin; do
    if [ -x "$d/npm" ]; then PATH="$d:$PATH"; export PATH; break; fi
  done
  command -v npm >/dev/null 2>&1
}

if ! ensure_npm; then
  echo "ERROR: no encuentro 'npm' en este subshell." >&2
  echo "Corre la generacion directamente desde tu terminal (zsh), donde npm si funciona:" >&2
  echo >&2
  echo "  docker run -d --rm --name rl_baseline_tmp -e POSTGRES_USER=tmp -e POSTGRES_PASSWORD=tmp \\" >&2
  echo "    -e POSTGRES_DB=baseline -p 55432:5432 postgres:16-alpine" >&2
  echo "  DB_HOST=localhost DB_PORT=55432 DB_USERNAME=tmp DB_PASSWORD=tmp DB_DATABASE=baseline \\" >&2
  echo "    DB_SYNCHRONIZE=false npm run migration:baseline" >&2
  echo "  docker rm -f rl_baseline_tmp" >&2
  exit 1
fi

NAME="rl_baseline_tmp"
PORT="${BASELINE_PORT:-55432}"

cleanup() { docker rm -f "${NAME}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo ">> Levantando Postgres efimero (${NAME}) en :${PORT} ..."
docker run -d --rm --name "${NAME}" \
  -e POSTGRES_USER=tmp -e POSTGRES_PASSWORD=tmp -e POSTGRES_DB=baseline \
  -p "${PORT}:5432" postgres:16-alpine >/dev/null

echo ">> Esperando a que acepte conexiones ..."
until docker exec "${NAME}" pg_isready -U tmp >/dev/null 2>&1; do sleep 1; done
sleep 1

echo ">> Generando InitialSchema desde las entidades ..."
# Las env vars inline ganan: data-source.ts usa dotenv sin override.
DB_HOST=localhost DB_PORT="${PORT}" DB_USERNAME=tmp DB_PASSWORD=tmp DB_DATABASE=baseline \
  DB_SYNCHRONIZE=false DB_MIGRATIONS_RUN=false \
  npm run migration:generate -- src/migrations/InitialSchema

echo
echo "OK. Migracion generada en src/migrations/."
echo "Proximo paso: MIGRATIONS.md (plegar uq_stock_cell, archivar incrementales, fake-apply en prod)."
