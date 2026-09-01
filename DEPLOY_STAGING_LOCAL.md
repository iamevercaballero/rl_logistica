# Deploy a staging local — RL Logística WMS

Guía para levantar el stack en una VM propia (no VPS) con Docker Compose +
Cloudflare Tunnel, para que un cliente externo pruebe la app por internet
antes de contratar un VPS real. Complementa a `DEPLOY.md` (que asume un VPS
con dominio propio y Caddy) — acá no hay Caddy: Cloudflare termina TLS en su
borde y el túnel llega directo a `frontend`/`backend` por red interna.

```
Cliente (internet)
        ↓ HTTPS (TLS en el borde de Cloudflare)
Cloudflare Tunnel (saliente desde la VM, sin abrir puertos del router)
        ↓
VM Ubuntu (Hyper-V u otra) — Docker Compose: frontend · backend · postgres · redis · cloudflared
```

## 0. Prerrequisitos (fuera de este repo)

Esta parte es un runbook de una sola vez, no repetible desde el repo:
- VM Ubuntu Server con Docker + Compose plugin instalados, accesible por SSH.
- Un túnel de Cloudflare ya creado (Zero Trust → Networks → Tunnels →
  Create a tunnel → Cloudflared) con su `TUNNEL_TOKEN` a mano.

  > **El token no es el «Tunnel ID».** La pantalla de detalles del túnel muestra
  > un UUID (`3e20ae2b-…`) que lo identifica; el token es otra cosa: una cadena
  > larga en base64 que empieza con `eyJhIjoi…` y aparece dentro del comando de
  > instalación del conector (`cloudflared service install <TOKEN>`, o
  > `... tunnel run --token <TOKEN>` en la variante Docker). Por CLI, desde una
  > máquina con `cloudflared login` hecho: `cloudflared tunnel token <nombre>`.
  >
  > **No uses «Rotate token» para verlo.** Ese botón no revela el token actual:
  > lo invalida y genera uno nuevo, y cualquier conector que esté corriendo con
  > el anterior se cae hasta que lo actualices. Es para cuando el token se filtró.
- Dos rutas configuradas en la pestaña **"Published application routes"**
  del túnel (Networks → Tunnels → tu túnel → esa pestaña, NO "Hostname
  routes" — esa es para rutas privadas vía Cloudflare Gateway/WARP y no
  sirve acá): `staging.<dominio>` → `http://frontend:80`, `staging-api.
  <dominio>` → `http://backend:3000`. Cloudflare resuelve el destino por
  nombre de contenedor porque `cloudflared` corre en la misma red `internal`
  del compose (DNS embebido de Docker, sin config extra). Si el DNS no
  resuelve enseguida (ni con `nslookup <host> 1.1.1.1`), esperar
  propagación; si falla solo en el navegador pero `curl`/`nslookup` ya
  resuelven bien, es caché de DNS del navegador
  (`chrome://net-internals/#dns` → Clear host cache).

## 1. Código en la VM

Copiar el working tree (tar + scp) o `git pull` a `~/rl_logistica`.

## 2. Secretos — crear `.env.staging`

```bash
cp .env.staging.example .env.staging
openssl rand -base64 32   # → DB_PASSWORD (y POSTGRES_PASSWORD, mismo valor)
openssl rand -base64 64   # → JWT_SECRET
openssl rand -base64 64   # → JWT_REFRESH_SECRET (distinto al anterior)
```

Completar también `BOOTSTRAP_ADMIN_USER` + `BOOTSTRAP_ADMIN_PASSWORD`
(≥12 caracteres), `TUNNEL_TOKEN`, y los hostnames reales en `CORS_ORIGIN` /
`VITE_API_URL` / `VITE_WS_URL` (reemplazar `<dominio>`).

> El backend valida los secretos al arrancar (`validateEnv`). Si algo falta o
> es débil, el contenedor falla rápido con un mensaje claro en los logs.

## 3. Levantar

Primero sin `cloudflared`, para separar problemas de la app de problemas del
túnel:
```bash
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --build db redis backend frontend
```
Con una DB vacía, el backend aplica `InitialSchema` y crea el usuario admin
inicial (mismo comportamiento que `DEPLOY.md` describe para un VPS nuevo).

Una vez completado `TUNNEL_TOKEN` y creadas las rutas del túnel:
```bash
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d cloudflared
```

## 4. Verificar

```bash
curl -fsS http://127.0.0.1:3000/api/health          # desde adentro de la VM
curl -fsS https://staging-api.<dominio>/api/health  # desde afuera
docker compose -f docker-compose.staging.yml ps     # todo "healthy"
```
- Login en `https://staging.<dominio>` con el admin del `.env.staging`.
- Confirmá que el dashboard recibe updates en tiempo real (WebSocket
  autenticado, vía el túnel).
- Ningún puerto de db/redis expuesto al host (`docker ps` no debe mostrarlos).

## 5. Backups (opcional, reusando los scripts de prod)

```bash
ENV_FILE=.env.staging DB_CONTAINER=rl_logistica_db_staging bash scripts/backup-db.sh
```
`scripts/backup-db.sh` / `restore-db.sh` funcionan sin modificar contra
staging, solo pasando `ENV_FILE`/`DB_CONTAINER` por variable de entorno.

## 6. Actualizar (nuevo código)

```bash
git pull   # o repetir la transferencia tar+scp del working tree
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --build
```

## 7. Teardown (cuando el cliente termine de probar)

```bash
docker compose -f docker-compose.staging.yml --env-file .env.staging down -v
```
Borra también los datos (`-v`). Si además se quiere liberar la VM/túnel por
completo, ver las notas de teardown del runbook de setup (Hyper-V + Cloudflare
Tunnel), fuera del alcance de este documento.
