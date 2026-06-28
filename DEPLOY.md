# Deploy a producción — RL Logística WMS

Guía para levantar el stack en un VPS (OVHcloud VPS-2 o similar) con Docker
Compose + Caddy (HTTPS) + Cloudflare DNS + backups diarios.

```
Cloudflare DNS/Proxy
        ↓
VPS (OVHcloud)  ── firewall: 22, 80, 443
        ↓
Caddy (HTTPS automático)
        ↓
Docker Compose: frontend · backend · postgres · redis
        ↓
Backups: pg_dump diario → R2/B2 (off-site) + snapshot del VPS
```

## 1. Prerrequisitos en el VPS
- Ubuntu LTS, usuario no-root con sudo, SSH por clave (password deshabilitado).
- Firewall (ufw): permitir 22, 80, 443; denegar el resto.
- Docker + Docker Compose plugin instalados.
- Repo clonado en `/opt/rl_logistica` (por ejemplo).

## 2. DNS (Cloudflare)
Crear registros A → IP del VPS:
- `app.tudominio.com`  (frontend)
- `api.tudominio.com`  (backend)

Ponerlos en **"DNS only" (nube gris)** la primera vez para que Caddy emita los
certificados Let's Encrypt. Después podés activar el proxy de Cloudflare en
**"Full (strict)"**.

## 3. Secretos — crear `.env.prod`
```bash
cp .env.prod.example .env.prod
# Generar secretos fuertes:
openssl rand -base64 32   # → DB_PASSWORD (y POSTGRES_PASSWORD, mismo valor)
openssl rand -base64 64   # → JWT_SECRET
openssl rand -base64 64   # → JWT_REFRESH_SECRET (distinto al anterior)
```
Completar también: `APP_DOMAIN`, `API_DOMAIN`, `ACME_EMAIL`, `VITE_API_URL`,
`VITE_WS_URL`, `CORS_ORIGIN`, y **`BOOTSTRAP_ADMIN_USER` + `BOOTSTRAP_ADMIN_PASSWORD`**
(≥12 caracteres — el backend aborta el arranque en prod si faltan o son débiles).

> El backend valida los secretos al arrancar (`validateEnv`). Si algo falta o es
> débil, el contenedor falla rápido con un mensaje claro en los logs.

## 4. Levantar
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
En el **primer** arranque, con una DB vacía, el backend aplica `InitialSchema`
(`DB_SYNCHRONIZE=false`, `DB_MIGRATIONS_RUN=true`) y crea el usuario admin inicial.

> Si la DB **ya existía** (creada por synchronize en un deploy viejo), antes de
> arrancar corré una sola vez: `psql ... -f logistica-palets-backend/scripts/fake-apply-baseline.sql`
> (ver `logistica-palets-backend/MIGRATIONS.md`).

## 5. Verificar
```bash
curl -fsS https://api.tudominio.com/api/health        # 200 OK
docker compose -f docker-compose.prod.yml ps           # todo "healthy"
```
- Login en `https://app.tudominio.com` con el admin del `.env.prod`.
- Confirmá que el dashboard recibe updates en tiempo real (WebSocket autenticado).
- Ningún puerto de db/redis expuesto al host (`docker ps` no debe mostrarlos).

## 6. Backups (diarios + off-site)
```bash
# Prueba manual:
bash scripts/backup-db.sh
# Cron (03:00 cada día):
0 3 * * * cd /opt/rl_logistica && bash scripts/backup-db.sh >> /var/log/rl_backup.log 2>&1
```
Off-site opcional a Cloudflare R2 / Backblaze B2: configurar `rclone` y exportar
`RCLONE_REMOTE=r2:rl-logistica-backups`. Sumar snapshot automático del VPS (OVH).

**Probar el restore** periódicamente contra una DB descartable:
```bash
bash scripts/restore-db.sh backups/<ultimo>.sql.gz   # pide confirmación
```

## 7. Actualizar (nuevo deploy)
```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
Las migraciones nuevas se aplican solas al arrancar. Hacé backup antes de cada
deploy con cambios de schema.
