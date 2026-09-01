# Deploy a producción — RL Logística WMS

Guía para levantar el stack en un VPS (OVHcloud VPS-2 o similar) con Docker
Compose + Cloudflare Tunnel + backups diarios.

```
Cloudflare (TLS + WAF)
        ↕  túnel saliente
VPS  ── firewall: solo 22. No hace falta abrir 80 ni 443.
        ↓
Docker Compose: cloudflared · frontend · backend · postgres · redis
        ↓
Backups: pg_dump diario → R2/B2 (off-site) + snapshot del VPS
```

`cloudflared` abre una conexión **saliente** hacia Cloudflare, que enruta los
hostnames públicos hasta `frontend:80` y `backend:3000` por la red interna del
compose. Nada entra al VPS desde internet, que es una superficie de ataque menos
que un reverse proxy escuchando en 443.

**Alternativa sin Cloudflare:** el repo conserva un `Caddyfile` con HTTPS
automático por Let's Encrypt. Para usarlo hay que volver a agregar el servicio
`caddy` al compose, abrir 80/443 en el firewall y definir `APP_DOMAIN`,
`API_DOMAIN` y `ACME_EMAIL` en lugar de `TUNNEL_TOKEN`.

## 0. Antes de cada despliegue

```bash
bash scripts/check-env.sh .env.prod
```

Valida que estén todas las variables, que los secretos tengan largo suficiente y
sean distintos entre sí, que no haya quedado ningún valor de la plantilla, y que
`CORS_ORIGIN` y `VITE_*` sean coherentes con los hostnames publicados. Sale con
código distinto de cero si algo falta: encadenalo antes del `up` y no vas a
desplegar a medias. Nunca imprime el valor de un secreto.

## 1. Prerrequisitos en el VPS
- Ubuntu LTS, usuario no-root con sudo, SSH por clave (password deshabilitado).
- Firewall (ufw): permitir 22, 80, 443; denegar el resto.
- Docker + Docker Compose plugin instalados.
- Repo clonado en `/opt/rl_logistica` (por ejemplo).

## 2. Túnel (Cloudflare Zero Trust)

En **Zero Trust → Networks → Tunnels**, crear un túnel para producción y anotar
su token (*Install connector* → la parte que sigue a `--token`). Ese valor va en
`TUNNEL_TOKEN` dentro de `.env.prod`.

En **Public Hostname** del mismo túnel, agregar dos rutas:

| Hostname | Service |
|---|---|
| `app.rl-logistica.com` | `http://frontend:80` |
| `api.rl-logistica.com` | `http://backend:3000` |

Los nombres de servicio son los del compose: `cloudflared` los alcanza por la red
interna, así que no hace falta publicar puertos ni crear registros DNS a mano —
Cloudflare crea los CNAME del túnel solo.

No abras 80 ni 443 en el firewall del VPS: el túnel es saliente. Con `ufw`
alcanza con permitir 22.

> **Si usás la alternativa con Caddy** en lugar del túnel: creá registros A hacia
> la IP del VPS, ponelos en *DNS only* (nube gris) la primera vez para que Caddy
> emita los certificados, y recién después activá el proxy en *Full (strict)*.

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
