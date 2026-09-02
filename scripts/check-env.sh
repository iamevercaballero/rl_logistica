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

# El proxy determina qué variables hacen falta. Con Cloudflare Tunnel alcanza
# TUNNEL_TOKEN; con Caddy hacen falta los dominios y el mail de ACME. Se detecta
# por lo que el archivo ya trae, en vez de pedir un flag que alguien va a olvidar.
if tr -d '\r' < "$ENV_FILE" | grep -qE '^TUNNEL_TOKEN='; then
  PROXY="cloudflare-tunnel"; REQ_PROXY=(TUNNEL_TOKEN TRUST_PROXY)
else
  PROXY="caddy"; REQ_PROXY=(APP_DOMAIN API_DOMAIN ACME_EMAIL TRUST_PROXY)
fi
echo "Proxy detectado: $PROXY"
echo

# ── 1. Variables obligatorias ────────────────────────────────────────────────
echo "Variables requeridas"
REQUERIDAS=(
  POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
  DB_USERNAME DB_PASSWORD DB_DATABASE
  JWT_SECRET JWT_REFRESH_SECRET
  CORS_ORIGIN
  VITE_API_URL VITE_WS_URL
  BOOTSTRAP_ADMIN_USER BOOTSTRAP_ADMIN_PASSWORD
  "${REQ_PROXY[@]}"
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
# `<...>` sólo cuenta como marcador si adentro hay una palabra suelta (<dominio>),
# no una dirección de correo con nombre para mostrar ("RL Logística <no-reply@...>").
PLANTILLA='tudominio\.com|changeme|admin123|test_password_change_me|CAMBIAR|CHANGE_ME|<[a-zA-Z_-]+>'
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
if [ "$PROXY" = "caddy" ]; then
  app="$(val APP_DOMAIN)"; api="$(val API_DOMAIN)"
  [ -n "$app" ] && case "$(val CORS_ORIGIN)" in
    *"$app"*) verde "CORS_ORIGIN incluye APP_DOMAIN" ;;
    *) rojo "CORS_ORIGIN no incluye APP_DOMAIN ($app)" ;;
  esac
  [ -n "$api" ] && case "$(val VITE_API_URL)" in
    *"$api"*) verde "VITE_API_URL apunta a API_DOMAIN" ;;
    *) rojo "VITE_API_URL no apunta a API_DOMAIN ($api)" ;;
  esac
  case "$app$api" in
    *http*) rojo "APP_DOMAIN y API_DOMAIN van sin esquema (app.ejemplo.com, no https://...)" ;;
  esac
fi

# TRUST_PROXY: las dos arquitecturas ponen un proxy delante del backend, asi que
# sin esto `req.ip` es siempre la misma direccion -la del proxy- para todos los
# usuarios. El registro de accesos queda inservible y, peor, el limite de 5
# intentos de login por minuto "por IP" pasa a ser de 5 por minuto para toda la
# empresa: al tercer error de un operador, el resto se queda afuera.
case "$(val TRUST_PROXY)" in
  ""|0|false) rojo "TRUST_PROXY debe estar activo (1) detras de $PROXY: si no, el limite de intentos de login lo comparten todos los usuarios" ;;
  true) verde "TRUST_PROXY activo (true)" ;;
  *[!0-9]*) ambar "TRUST_PROXY no es un numero de saltos ni true: revisa que Express lo entienda" ;;
  *) verde "TRUST_PROXY activo ($(val TRUST_PROXY) salto/s)" ;;
esac
echo

# Vale para las dos arquitecturas: el frontend se compila contra VITE_API_URL y
# el backend sólo acepta los orígenes de CORS_ORIGIN. Si no coinciden con los
# hostnames publicados, el navegador bloquea cada request y no se ve hasta prod.
for k in CORS_ORIGIN VITE_API_URL VITE_WS_URL; do
  case "$(val "$k")" in
    https://*) verde "$k usa https" ;;
    "") ;;
    *) rojo "$k debe usar https en producción" ;;
  esac
done
ws="$(val VITE_WS_URL)"; apiurl="$(val VITE_API_URL)"
case "$apiurl" in
  "$ws"*) verde "VITE_WS_URL y VITE_API_URL comparten host" ;;
  *) [ -n "$ws" ] && [ -n "$apiurl" ] && rojo "VITE_WS_URL y VITE_API_URL apuntan a hosts distintos: el WebSocket no conectaría" ;;
esac
case "$(val CORS_ORIGIN)" in
  *"$(val VITE_WS_URL)"*) ambar "CORS_ORIGIN y VITE_WS_URL comparten host: revisá que el frontend y la API estén en hostnames distintos" ;;
esac
echo

# ── 6. Valores que romperían al cargar el archivo en una shell ───────────────
# docker compose y dotenv leen este archivo con su propio parser y toleran
# cualquier cosa. Pero DEPLOY.md pide correr comandos con "$DB_USERNAME" y
# "$POSTGRES_PASSWORD" ya en el entorno, y la forma natural de ponerlos ahí es
# `set -a; . .env.prod`. Un valor con espacios y sin comillas hace que la shell
# intente ejecutar la segunda palabra; uno con `<` o `>` abre una redirección y
# llega a crear un archivo. En los dos casos la carga aborta a la mitad y las
# variables quedan cargadas a medias, que es peor que no cargarlas.
#
# Esto le costó el puesto al backup: backup-db.sh sourceaba el archivo y salía
# con 127 sin escribir un byte, mientras este preflight daba verde.
#
# La comprobación es textual a propósito. Sourcear el archivo para ver si
# sourcea ejecutaría exactamente lo que se quiere detectar.
echo "Formato del archivo"
sospechosas=""
while IFS= read -r linea; do
  case "$linea" in
    [A-Za-z_]*=*) ;;
    *) continue ;;
  esac
  k="${linea%%=*}"
  v="${linea#*=}"
  v="${v%"${v##*[![:space:]]}"}"          # sin espacios al final
  [ -n "$v" ] || continue
  case "$v" in
    '"'*|"'"*) continue ;;                 # ya viene entre comillas
    *'#'*) continue ;;                     # la shell corta en el comentario
  esac
  case "$v" in
    *[[:space:]]*|*'<'*|*'>'*|*'|'*|*'&'*|*';'*|*'`'*|*'$('*)
      sospechosas="${sospechosas}${k}
" ;;
  esac
done < <(tr -d '\r' < "$ENV_FILE")

if [ -n "$sospechosas" ]; then
  ambar "estos valores no están entre comillas y romperían \`set -a; . $ENV_FILE\`:"
  printf '%s' "$sospechosas" | sed 's/^/      /'
  echo "      Encerralos entre comillas dobles."
else
  verde "todos los valores se pueden cargar en una shell"
fi
echo

# ── Resultado ────────────────────────────────────────────────────────────────
if [ "$errores" -gt 0 ]; then
  printf '\033[31mNO DESPLEGAR\033[0m — %d problema(s), %d aviso(s).\n' "$errores" "$avisos"
  exit 1
fi
printf '\033[32mListo para desplegar\033[0m — 0 problemas, %d aviso(s).\n' "$avisos"
