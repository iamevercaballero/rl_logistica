#!/usr/bin/env bash
# =============================================================================
# Preflight del archivo de entorno de producción — RL Logística.
#
#   bash scripts/check-env.sh .env.prod
#
# Corre ANTES de `docker compose -f docker-compose.prod.yml up`. Comprueba que
# estén todas las variables que el despliegue necesita, que no hayan quedado
# valores de la plantilla, y que las que tienen que ser coherentes entre sí lo
# sean. Nunca imprime el valor de un secreto: sólo el nombre y el diagnóstico.
#
# Por qué existe: `.env.prod` estaba sin APP_DOMAIN, API_DOMAIN ni ACME_EMAIL, y
# nada lo avisaba. Docker Compose sustituye una variable ausente por una cadena
# vacía con un simple WARN, así que Caddy arrancaba con un bloque de sitio vacío
# y fallaba a emitir el certificado con un error que no apuntaba a la causa.
# El backend, por su lado, aborta en una instalación nueva si faltan las
# credenciales del admin inicial — correcto, pero recién al arrancar.
# =============================================================================
set -uo pipefail

ENV_FILE="${1:-.env.prod}"
errores=0
avisos=0

rojo()  { printf '  \033[31m✗\033[0m %s\n' "$1"; errores=$((errores + 1)); }
ambar() { printf '  \033[33m!\033[0m %s\n' "$1"; avisos=$((avisos + 1)); }
verde() { printf '  \033[32m✓\033[0m %s\n' "$1"; }

[ -f "$ENV_FILE" ] || { echo "No existe el archivo: $ENV_FILE" >&2; exit 1; }

# Lee una variable sin exponerla: devuelve el valor por stdout, sólo para
# comprobaciones internas del script.
val() { tr -d '\r' < "$ENV_FILE" | grep -m1 "^$1=" | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/'; }

echo "Preflight de $ENV_FILE"
echo

# ── 1. Variables obligatorias ────────────────────────────────────────────────
echo "Variables requeridas"
REQUERIDAS=(
  POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
  DB_USERNAME DB_PASSWORD DB_DATABASE
  JWT_SECRET JWT_REFRESH_SECRET
  CORS_ORIGIN
  APP_DOMAIN API_DOMAIN ACME_EMAIL
  VITE_API_URL VITE_WS_URL
  BOOTSTRAP_ADMIN_USER BOOTSTRAP_ADMIN_PASSWORD
)
faltan=0
for k in "${REQUERIDAS[@]}"; do
  if [ -z "$(val "$k")" ]; then rojo "$k está ausente o vacía"; faltan=$((faltan + 1)); fi
done
[ "$faltan" -eq 0 ] && verde "las ${#REQUERIDAS[@]} variables requeridas están definidas"
echo

# ── 2. Secretos ──────────────────────────────────────────────────────────────
echo "Secretos"
for k in JWT_SECRET JWT_REFRESH_SECRET; do
  v="$(val "$k")"
  [ -z "$v" ] && continue
  if [ "${#v}" -lt 32 ]; then rojo "$k tiene ${#v} caracteres (mínimo 32)"
  else verde "$k tiene longitud suficiente (${#v})"; fi
done
if [ -n "$(val JWT_SECRET)" ] && [ "$(val JWT_SECRET)" = "$(val JWT_REFRESH_SECRET)" ]; then
  rojo "JWT_SECRET y JWT_REFRESH_SECRET son iguales: deben ser distintos"
fi
pw="$(val BOOTSTRAP_ADMIN_PASSWORD)"
if [ -n "$pw" ] && [ "${#pw}" -lt 12 ]; then
  rojo "BOOTSTRAP_ADMIN_PASSWORD tiene ${#pw} caracteres (el backend exige 12)"
fi
echo

# ── 3. Valores de plantilla que quedaron sin reemplazar ──────────────────────
echo "Valores de plantilla"
PLANTILLA='tudominio\.com|changeme|admin123|test_password_change_me|CAMBIAR|CHANGE_ME|<.*>'
sin_reemplazar="$(tr -d '\r' < "$ENV_FILE" | grep -vE '^\s*#' | grep -nEi "=.*($PLANTILLA)" | cut -d: -f2 | cut -d= -f1)"
if [ -n "$sin_reemplazar" ]; then
  while read -r k; do [ -n "$k" ] && rojo "$k conserva un valor de la plantilla"; done <<< "$sin_reemplazar"
else
  verde "ningún valor de plantilla quedó sin reemplazar"
fi
echo

# ── 4. Seguridad de la configuración ─────────────────────────────────────────
echo "Configuración de producción"
[ "$(val DB_SYNCHRONIZE)" = "true" ] && rojo "DB_SYNCHRONIZE=true destruiría el esquema; debe ser false" \
  || verde "DB_SYNCHRONIZE no está en true"
[ "$(val ALLOW_SEED)" = "true" ] && rojo "ALLOW_SEED=true habilita el borrado masivo de inventario" \
  || verde "ALLOW_SEED no está en true"
[ "$(val NODE_ENV)" = "production" ] || ambar "NODE_ENV no es 'production' (el compose lo fuerza igual)"
echo

# ── 5. Coherencia entre dominios ─────────────────────────────────────────────
# Un CORS_ORIGIN que no coincide con el dominio real del frontend es el clásico
# «anda todo pero el navegador bloquea cada request», y no se ve hasta produccion.
echo "Coherencia de dominios"
app="$(val APP_DOMAIN)"; api="$(val API_DOMAIN)"
if [ -n "$app" ]; then
  case "$(val CORS_ORIGIN)" in
    *"$app"*) verde "CORS_ORIGIN incluye APP_DOMAIN" ;;
    *) rojo "CORS_ORIGIN no incluye APP_DOMAIN ($app): el navegador bloquearía cada request" ;;
  esac
fi
if [ -n "$api" ]; then
  case "$(val VITE_API_URL)" in
    *"$api"*) verde "VITE_API_URL apunta a API_DOMAIN" ;;
    *) rojo "VITE_API_URL no apunta a API_DOMAIN ($api)" ;;
  esac
  case "$(val VITE_WS_URL)" in
    *"$api"*) verde "VITE_WS_URL apunta a API_DOMAIN" ;;
    *) rojo "VITE_WS_URL no apunta a API_DOMAIN ($api)" ;;
  esac
fi
case "$(val APP_DOMAIN)$(val API_DOMAIN)" in
  *http*) rojo "APP_DOMAIN y API_DOMAIN van sin esquema (app.ejemplo.com, no https://app.ejemplo.com)" ;;
esac
echo

# ── Resultado ────────────────────────────────────────────────────────────────
if [ "$errores" -gt 0 ]; then
  printf '\033[31mNO DESPLEGAR\033[0m — %d problema(s), %d aviso(s).\n' "$errores" "$avisos"
  exit 1
fi
printf '\033[32mListo para desplegar\033[0m — 0 problemas, %d aviso(s).\n' "$avisos"
