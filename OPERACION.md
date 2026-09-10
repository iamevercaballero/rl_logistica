# RL Logística — Operación de producción

Runbook de la instancia **en vivo** de RL Logística WMS. Qué corre, dónde se
administra cada cosa, las tareas de rutina y qué hacer cuando algo se rompe.

Complementa a los otros documentos, no los repite:

| Documento | Para qué |
|---|---|
| `DEPLOY.md` | El procedimiento de puesta en marcha: túnel, secretos, migraciones con su orden |
| `DEPLOY_STAGING_LOCAL.md` | Ensayo del despliegue en una VM local |
| `GUIA-OPERATIVA.md` | Uso del sistema desde el depósito |
| **`OPERACION.md`** | **Operar esta instalación concreta: acceso, updates, backups, incidentes** |

Puesto en producción en **septiembre de 2026**.

---

## La infraestructura

| | |
|---|---|
| Proveedor | Hostinger — VPS KVM 2, datacenter **São Paulo** |
| Recursos | 2 vCPU · 8 GB RAM · 100 GB disco · 8 TB tráfico |
| SO | Ubuntu 26.04 LTS |
| Hostname | `rl-logistica-prod` |
| IP | `179.199.141.28` (+ IPv6) |
| Swap | **Sin swap**, a propósito — 8 GB da margen; ver *Incidentes → `Exited (137)`* |

### Acceso al servidor

Solo por **clave SSH**, usuario `deploy`. Root por SSH y login por contraseña
están **deshabilitados** (`/etc/ssh/sshd_config.d/00-hardening.conf`).

```bash
ssh deploy@179.199.141.28        # o el alias `rl-prod` si lo configuraste en ~/.ssh/config
```

- La clave privada (`id_ed25519_rl_logistica_prod`) vive en la máquina del
  administrador. No hay copia en el servidor.
- `deploy` está en los grupos `sudo` y `docker`.
- Si se pierde el acceso SSH: **hPanel → Browser terminal** entra por consola sin
  clave.
- Firewall (`ufw`): solo el puerto 22. `fail2ban` activo sobre SSH.
  `unattended-upgrades` aplica parches de seguridad solo.

### Dónde está todo

| Ruta | Qué |
|---|---|
| `/opt/rl_logistica` | El repo (clon de solo lectura vía deploy key de GitHub) |
| `/opt/rl_logistica/.env.prod` | Secretos de producción — **gitignored, sin copia en Git** |
| `/opt/rl_logistica/backups/` | Backups locales (diarios + `mensuales/`) |
| `/home/deploy/rl_backup.log` | Log del cron de backup |
| `~/.config/rclone/rclone.conf` | Credenciales de Cloudflare R2 (ofuscadas) |

---

## Qué corre en producción

`docker-compose.prod.yml` levanta cinco contenedores:

| Servicio | Contenedor | Expuesto |
|---|---|---|
| PostgreSQL 16 | `rl_logistica_db_prod` | Solo red interna |
| Redis 7 | `rl_logistica_redis_prod` | Solo red interna |
| Backend (NestJS) | `rl_logistica_backend_prod` | `127.0.0.1:3000` (solo para diagnóstico desde el propio server) |
| Frontend (nginx) | `rl_logistica_frontend_prod` | Solo red interna |
| Cloudflare Tunnel | `rl_logistica_cloudflared_prod` | Conexión **saliente** |

Nada entra al VPS desde internet salvo SSH. El túnel `cloudflared` abre una
conexión saliente hacia Cloudflare, que termina TLS en su borde y enruta:

| Hostname público | → servicio interno |
|---|---|
| `https://app.rl-logistica.com` | `http://frontend:8080` |
| `https://api.rl-logistica.com` | `http://backend:3000` |

> El túnel de producción se llama **`rl-logistica-prod`** en Cloudflare Zero Trust.
> Es **distinto** del `rl-logistica-staging`, que apunta a `staging.` /
> `staging-api.` y no se toca.

El host corre en `America/Asuncion`. Los contenedores fijan `Etc/GMT+3` a
propósito (el `tzdata` de las imágenes Alpine quedó viejo respecto de la Ley 7324)
— no cambiar eso.

---

## Dónde se administra cada cosa

Ninguna credencial va en este archivo. Solo dónde vive cada cosa.

| Servicio | Consola | Para qué |
|---|---|---|
| DNS + Túnel | Cloudflare → `rl-logistica.com` / Zero Trust → Tunnels | Rutas públicas, TLS |
| Backups off-site | Cloudflare → R2 → bucket `rl-logistica-backups` | Copia externa de los dumps |
| Latido del backup | healthchecks.io — check *"RL Logística — backup diario"* | Avisa si el backup **no** corre |
| Uptime de la app | UptimeRobot — monitor sobre `api.rl-logistica.com/api/health` | Avisa si la app se cae |
| Código | GitHub `iamevercaballero/rl_logistica` | Deploy key de solo lectura en el VPS |
| VPS | Hostinger hPanel | Snapshots, firewall de panel, consola de emergencia |

---

## Tareas de rutina

### Ver el estado del sistema

```bash
cd /opt/rl_logistica
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
curl -fsS http://127.0.0.1:3000/api/health
```

Los cinco contenedores en `Up` / `healthy`, y el health devuelve
`{"status":"ok", ... "database":{"status":"ok"}, "redis":{"status":"ok"}}`.

### Desplegar una actualización

```bash
cd /opt/rl_logistica
git pull
RCLONE_REMOTE=r2:rl-logistica-backups bash scripts/backup-db.sh    # backup fresco, no el de anoche
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Las migraciones pendientes se aplican solas al arrancar, antes de aceptar
tráfico. El build del frontend tarda 2-4 min en este VPS (2 vCPU).

> **Antes de la primera actualización que traiga migraciones nuevas, leé la
> Parte II de `DEPLOY.md`.** Hay una que corta todas las sesiones abiertas
> (desplegar fuera de horario), una que tiene que correr antes que el código
> nuevo, y una que puede fallar si hay datos inconsistentes.

Si el build o el arranque fallan, los contenedores viejos siguen corriendo:
`docker compose ... logs backend` para ver por qué.

### Verificar que los backups corren

```bash
tail -20 /home/deploy/rl_backup.log        # último run del cron
ls -lh /opt/rl_logistica/backups/          # backups locales
rclone ls r2:rl-logistica-backups          # copia off-site
```

O el dashboard de healthchecks.io: el check tiene que estar en verde.

### Restaurar desde un backup

**Nunca contra la base de producción sin necesidad.** Primero probá contra un
contenedor descartable:

```bash
cd /opt/rl_logistica
PGU=$(grep '^POSTGRES_USER=' .env.prod | cut -d= -f2); PGD=$(grep '^POSTGRES_DB=' .env.prod | cut -d= -f2)

docker run -d --name probe -e POSTGRES_USER="$PGU" -e POSTGRES_PASSWORD="$(openssl rand -base64 24)" -e POSTGRES_DB="$PGD" postgres:16-alpine
until docker exec probe psql -U "$PGU" -d "$PGD" -c "SELECT 1" >/dev/null 2>&1; do sleep 1; done

ULTIMO=$(ls -t backups/rl_*.sql.gz.gpg | head -1)
echo si | DB_CONTAINER=probe bash scripts/restore-db.sh "$ULTIMO"

docker exec probe psql -U "$PGU" -d "$PGD" -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
docker rm -f -v probe
```

Para restaurar **sobre producción** de verdad (recuperación real): parar el
backend primero (`docker compose ... stop backend`), correr `restore-db.sh` sin
el `DB_CONTAINER` override (usa `rl_logistica_db_prod`), y volver a levantar.
El dump trae `--clean --if-exists`: reemplaza todo el contenido.

### Tomar un snapshot del VPS

hPanel → tu VPS → Snapshots → crear uno manual. Hacelo **antes de cada cambio
grande**. Es la única forma de volver atrás un cambio de sistema (no de datos:
para datos está el backup de PostgreSQL).

---

## Backups — el detalle

| | |
|---|---|
| Script | `scripts/backup-db.sh` |
| Cuándo | Cron de `deploy`, **03:00** hora Paraguay |
| Qué hace | `pg_dump` → `gzip` → cifrado **AES-256** (`gpg`) → verificación → copia off-site → enlace mensual → poda |
| Cifrado | Frase en `BACKUP_PASSPHRASE` dentro de `.env.prod` |
| Retención local | 14 días de diarios; el **primer backup exitoso de cada mes** se archiva en `mensuales/` y se conserva **120 meses** (requisito legal de conservación) |
| Off-site | Cloudflare R2, `r2:rl-logistica-backups` (+ `/mensuales`) |
| Restore | `scripts/restore-db.sh` — pide confirmación, detecta el cifrado por la extensión |

> ### La frase de cifrado
>
> `BACKUP_PASSPHRASE` vive **solo** en `/opt/rl_logistica/.env.prod`. Si se pierde
> ese archivo, **todos los backups en R2 son irrecuperables** — el cifrado es
> simétrico y no hay otra copia de la clave.
>
> Guardá `BACKUP_PASSPHRASE` (idealmente el `.env.prod` entero) en un gestor de
> contraseñas, fuera del servidor. Lo mismo aplica a `DB_PASSWORD`, `JWT_SECRET`
> y `JWT_REFRESH_SECRET`.

`RCLONE_REMOTE` va **en la línea del cron** (el script solo lo lee del entorno).
`BACKUP_HEARTBEAT_URL` sí se lee de `.env.prod`.

---

## Monitoreo

| Alerta | Qué significa | Primer paso |
|---|---|---|
| **healthchecks.io** manda un aviso | El backup de las 03:00 no llegó — VPS apagado, cron caído, disco lleno, o el script falló | `tail /home/deploy/rl_backup.log`, `df -h`, `systemctl status cron` |
| **UptimeRobot** manda un aviso | `api.rl-logistica.com/api/health` no responde `"status":"ok"` — backend, DB, Redis o el túnel caídos | Ver *Incidentes* abajo |

El latido del backup solo se envía **si todo salió bien**. Que falle el envío del
latido no marca el backup como fallido (el archivo ya está escrito y verificado).

---

## Incidentes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `app.` y `api.` no responden | Túnel caído | `docker compose ... logs cloudflared --tail 50`; `docker compose ... restart cloudflared`; ver el estado del túnel en Cloudflare Zero Trust |
| `app.` carga pero `api.` no | Backend caído o no sano | `docker compose ... ps`; `logs backend`; `curl 127.0.0.1:3000/api/health` desde el VPS |
| Login "no hace nada", errores CORS en la consola del navegador | `CORS_ORIGIN` o `VITE_API_URL` no coinciden con los hostnames reales | Revisar `.env.prod`; si cambió algún `VITE_*`, **rebuild del frontend** (`up -d --build frontend`) |
| Adjuntos fallan con `EACCES` sobre `/app/uploads` | El volumen quedó de root tras un `--force-recreate` | `docker compose ... exec -u root backend chown -R node:node /app/uploads` |
| Un contenedor en `Exited (137)` después de un `--build` | OOM — sin swap, un pico de memoria del build lo mató | `docker stats`; reintentar el build con los contenedores viejos parados; a futuro, compilar imágenes en CI |
| El backend no levanta tras `git pull` | Una migración falló (datos inconsistentes o timeout) | `docker compose ... logs backend`; buscar el nombre de la migración en la **Parte II de `DEPLOY.md`** |
| `rclone` da `403 AccessDenied` al subir | Token de R2 sin permiso de escritura, o falta `no_check_bucket = true` | Ver *Gotchas* |
| `rclone` da `501 NotImplemented` | Versión vieja de rclone | Ver *Gotchas* |

Para investigar quién hizo qué: la bitácora `auth_events` (accesos) y
`document_events` (movimientos) registran IP real, user-agent y un id de
correlación. Consultas útiles en `DEPLOY.md` (RL-M-09).

---

## Gotchas conocidos de esta instalación

**rclone tiene que ser el `.deb` oficial, no el de Ubuntu.**
El paquete de Ubuntu 26.04 (rclone 1.60) falla contra R2 con `501 NotImplemented`
en cada subida (su reintento interno la salva, pero ensucia el log). Está
instalado el `.deb` de rclone.org (1.69+); `apt upgrade` no lo pisa porque la
versión es mayor. Para actualizarlo:

```bash
cd /tmp && curl -fsSLO https://downloads.rclone.org/rclone-current-linux-amd64.deb && sudo apt install -y ./rclone-current-linux-amd64.deb
```

**El remote de R2 necesita `no_check_bucket = true`.**
El token de R2 tiene permiso "Object Read & Write" pero **no** puede crear
buckets. Sin `no_check_bucket = true`, rclone intenta verificar/crear el bucket
antes de subir y recibe `403` en toda escritura (la lectura funciona igual — de
ahí la confusión). Ya está en `~/.config/rclone/rclone.conf`.

**Cambiar de dominio implica rebuild del frontend.**
`VITE_API_URL` y `VITE_WS_URL` se hornean en el build de la imagen del frontend
(y arman la CSP de nginx). Si alguna vez cambia el dominio, no alcanza con editar
`.env.prod`: hay que `up -d --build frontend`.

**Nada de comentarios al final de las líneas en `.env.prod`.**
`docker compose --env-file` puede tomar el comentario como parte del valor. Las
líneas con valor van `CLAVE=valor` y nada más. `scripts/check-env.sh` no lo
detecta del todo.

**Los drop-ins de SSH se leen en orden y gana el primero.**
`00-hardening.conf` tiene que ordenar **antes** de `50-cloud-init.conf` para que
`PasswordAuthentication no` gane. Verificar siempre con `sudo sshd -T`, no
leyendo el archivo. El servicio se llama `ssh`, no `sshd`.

---

## Deuda / pendientes

Ninguno bloquea la operación.

- **CD**: el deploy es manual por SSH. `.github/workflows/ci.yml` corre lint,
  build, tests y validación de migraciones, pero no despliega.
- **Imágenes en CI**: compilar el frontend en GitHub Actions y que el VPS solo
  haga `pull` — evita el build de 2-4 min en el VPS.
- **Token de R2 atado a IP**: hoy el token de R2 sirve desde cualquier origen.
  Se puede restringir a la IP del VPS en Cloudflare (hay que confirmar antes si
  rclone sale por IPv4 o IPv6).
- **logrotate** para `/home/deploy/rl_backup.log` (crece ~2 KB/día).
- **`forRoutes('*')`** deprecado en `logistica-palets-backend/src/app.module.ts`
  — NestJS lo auto-convierte hoy; conviene migrar a la sintaxis con parámetro
  nombrado antes de que ese fallback desaparezca.
- **Retención a largo plazo**: los 120 meses de backups mensuales viven en el
  VPS y en R2. Falta decidir si esas copias a diez años van a otro lado.
