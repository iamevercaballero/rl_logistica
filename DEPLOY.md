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

## Índice de la pantalla de movimientos (RL-A-07)

`AddMovementDateIndex` agrega el índice `(date, createdAt)` sobre `movements`,
que es por donde ordena y filtra la pantalla más usada del sistema y no estaba
indexado.

No necesita ventana ni `CONCURRENTLY`: construirlo sobre 1,3 millones de filas
tomó **665 ms** en la medición, y la tabla en producción todavía es chica. Si
alguna vez hubiera que aplicarlo sobre una tabla ya grande, la alternativa es
crearlo a mano con `CREATE INDEX CONCURRENTLY` —que no puede ir dentro de una
transacción— y después marcar la migración como aplicada.

Medido sobre una copia del esquema real con un millón de movimientos y 800.000
líneas de detalle (diez años a ~275 movimientos por día):

| consulta | antes | después |
|---|---|---|
| pantalla principal, página 1 | 2.138 ms | **1,0 ms** |
| página profunda (offset 10000) | 110 ms | **7,1 ms** |
| filtro por rango de 30 días | 99 ms | **0,1 ms** |
| alcance de OPERATOR | 104 ms | **0,1 ms** |
| COUNT de la paginación | 48 ms | 73 ms (no lo toca el índice) |

El índice **solo** no arregla la pantalla principal: hizo falta además corregir
la consulta en `movements.service.ts`, que agregaba la tabla de detalles entera
para devolver 20 filas. Los dos cambios van juntos y ninguno sirve sin el otro.

Verificación, con el sistema arriba:

```bash
docker compose -f docker-compose.prod.yml exec db psql -U "$DB_USERNAME" -d "$DB_DATABASE" -c "SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_movement_date_created';"
```

## Bitácora de accesos y append-only (RL-M-09)

`CreateAuthEventsAndAppendOnly` crea `auth_events` —el registro de intentos de
login, con IP real, user-agent e id de correlación— y hace que la base **haga
cumplir** el append-only sobre las tres bitácoras (`document_events`,
`user_audit_log`, `auth_events`) con un trigger que rechaza `UPDATE` y `DELETE`.
Hasta acá era una convención escrita en un comentario.

**`TRUST_PROXY=1` es obligatorio.** Está explicado en `.env.prod.example` y lo
exige `check-env.sh`: sin eso la conexión la abre el proxy y `req.ip` es la
misma dirección para todos, con lo que la bitácora registra la IP del túnel y
el límite de 5 intentos de login por minuto "por IP" pasa a ser de 5 por minuto
para toda la empresa.

Verificación, con el sistema arriba: entrá con una contraseña incorrecta a
propósito y revisá que quede la fila con **tu** IP, no la del contenedor.

```bash
docker compose -f docker-compose.prod.yml exec db psql -U "$DB_USERNAME" -d "$DB_DATABASE" -c "SELECT \"createdAt\", \"eventType\", username, reason, ip FROM auth_events ORDER BY \"createdAt\" DESC LIMIT 5;"
```

Consultas útiles para investigar un incidente:

```bash
docker compose -f docker-compose.prod.yml exec db psql -U "$DB_USERNAME" -d "$DB_DATABASE" -c "SELECT ip, COUNT(*) FROM auth_events WHERE \"eventType\"='LOGIN_FAILED' AND \"createdAt\" > now() - interval '24 hours' GROUP BY ip ORDER BY 2 DESC LIMIT 10;"
```

**Purga.** La tabla no se limpia sola, a propósito: una bitácora que la
aplicación puede borrar no prueba nada. El volumen es chico (un login por
persona y turno), pero si alguna vez hay que podarla es un acto deliberado de
quien administra la base:

```sql
ALTER TABLE "auth_events" DISABLE TRIGGER "trg_auth_events_append_only";
DELETE FROM "auth_events" WHERE "createdAt" < now() - interval '2 years';
ALTER TABLE "auth_events" ENABLE TRIGGER "trg_auth_events_append_only";
```

## Migración de permisos finos (RL-M-10) — orden obligatorio

`AddMissingRolePermissions` incorpora proveedores, destinos, adjuntos, alertas y
la carga del corte de SAP al motor de permisos finos.

**Tiene que correr antes de que quede arriba el código nuevo, no después.**
`PermissionGuard` falla cerrado: la plantilla de cada rol sale de la tabla
`role_permissions`, y un módulo sin filas ahí no le da la acción a nadie. Si el
backend nuevo arranca contra una base sin migrar, esos cinco módulos responden
403 a **todos los usuarios, incluido el ADMIN** — no es una degradación parcial,
es el módulo entero caído.

Con `DB_MIGRATIONS_RUN=true` (lo que trae `.env.prod.example`) el backend aplica
las migraciones pendientes al arrancar, antes de aceptar tráfico, así que el
orden ya queda bien. Si desplegás con las migraciones en un paso aparte,
corrélas primero.

Verificación, con el sistema arriba:

```bash
docker compose -f docker-compose.prod.yml exec db psql -U "$DB_USERNAME" -d "$DB_DATABASE" -c "SELECT module, COUNT(*) FROM role_permissions WHERE module IN ('suppliers','destinations','attachments','alerts') GROUP BY module ORDER BY module;"
```

Tienen que aparecer los cuatro módulos. Si la consulta vuelve vacía, la
migración no corrió: no abras el sistema a los operadores hasta resolverlo.

Reversión: `migration:revert` borra esas filas y también los overrides por
usuario que apunten a ellas. Los endpoints vuelven a quedar protegidos sólo por
rol, que es como estaban antes — no queda ninguno sin control.

## Migración de integridad referencial (RL-C-03)

La migración `AddInventoryForeignKeys` agrega 38 claves foráneas y 5
restricciones de rango a las tablas de inventario. Es la primera que puede
**fallar por datos**, no por esquema: si hay filas apuntando a registros que ya
no existen, aborta. Eso es deliberado — decidir qué hacer con un movimiento cuyo
producto desapareció es una decisión de negocio, no de esquema.

### 1. Antes de la ventana (con el sistema en marcha)

```bash
docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" rl_logistica_db_prod   psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < scripts/check-referential-integrity.sql
```

Es de sólo lectura y se puede correr las veces que haga falta. Si todas las
filas dicen `ok`, la migración va a pasar. Si alguna dice `BLOQUEA LA
MIGRACIÓN`, hay que resolver esas filas primero — y conviene saberlo días antes,
no durante la ventana.

El mismo informe trae el volumen de las tablas: sirve para estimar cuánto va a
tardar. Postgres valida cada clave foránea recorriendo la tabla una vez.

### 1.b Desvío del contador de lotes (RL-A-09)

```bash
docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" rl_logistica_db_prod   psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < scripts/check-lot-stock-drift.sql
```

También de sólo lectura. Lista los lotes cuyo `stockActual` no coincide con la
suma de sus pallets.

Importa correrlo **antes**, no después: hasta este cambio, una resta que dejaba
el contador en negativo se recortaba a cero en silencio, así que puede haber
desvíos arrastrados hace tiempo. Desde ahora esas salidas **cortan** con un
mensaje que pide reconciliar — que es lo correcto, pero mejor resolverlo en frío
que descubrirlo cuando un operador no pueda despachar.

Si hay desvíos: `POST /api/lots/reconcile-all` los recalcula desde los pallets.

### 2. Durante la ventana

```bash
bash scripts/backup-db.sh                    # backup fresco, no el de anoche
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

El backend corre las migraciones al arrancar (`DB_MIGRATIONS_RUN=true`). Si la
migración aborta, el contenedor no levanta y la base queda **intacta**: todo
corre dentro de una transacción y el `ROLLBACK` es automático.

### 3. Verificación

```bash
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" rl_logistica_db_prod   psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At   -c "SELECT 'FK: ' || count(*) FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace;"   -c "SELECT 'CHECK: ' || count(*) FROM pg_constraint WHERE contype='c' AND connamespace='public'::regnamespace;"
```

Esperado: **44 claves foráneas** y **6 CHECK** (antes: 6 y 1). Después, una
entrada y una salida de prueba para confirmar que la operación normal sigue
funcionando.

### 4. Rollback

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend   npm run migration:revert
```

Revierte sólo esta migración y devuelve el esquema a 6 claves foráneas y 1
CHECK — verificado. No hace falta restaurar el backup: la migración no modifica
ni una fila de datos, sólo agrega restricciones.

### Qué cambia para el usuario

Borrar un material, una ubicación o un depósito **con historial** pasa a
desactivarlo en lugar de eliminarlo, con un aviso que lo explica. Antes se
borraba y dejaba movimientos apuntando al vacío. Es el mismo criterio que ya
tenían Materiales y Lotes, ahora también en Ubicaciones y Depósitos.

## 2.b Quién aprueba los ajustes (RL-A-12)

Desde esta versión **quien crea un ajuste de inventario no puede aprobarlo**, y
lo mismo vale para la anulación de un movimiento: la solicitud la aprueba otra
persona. Es el único circuito que corrige stock sin un documento físico detrás.

La excepción es automática: si el sistema verifica que **no hay ningún otro
usuario habilitado** para aprobar esa solicitud, deja aprobarla y la registra en
la bitácora como `AUTOAPROBADO`. No hay nada que configurar, y el control se
reactiva solo en cuanto exista un segundo aprobador.

**Revisar antes de arrancar.** Cuenta como aprobador disponible todo usuario que
esté activo, tenga rol ADMIN o MANAGER y conserve el permiso
`adjustments.approve`. Una cuenta técnica o de desarrollo con rol ADMIN cuenta
igual que una operativa: si existe, el encargado real deja de poder aprobar sus
propios ajustes y el sistema le va a decir que se los pida a esa cuenta.

Si esa cuenta no va a aprobar ajustes en la práctica, sacale el permiso en
**Usuarios → (usuario) → Permisos → Ajustes → Aprobar → Denegar**
(`PUT /users/:id/permissions`). Conserva ADMIN para todo lo demás y deja de
contar como segunda firma. Verificación: con un solo aprobador operativo, sus
aprobaciones aparecen en la bitácora del ajuste como `AUTOAPROBADO`; si aparecen
sólo como `APROBADO`, es que había otro aprobador y el control cruzado actuó.

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
