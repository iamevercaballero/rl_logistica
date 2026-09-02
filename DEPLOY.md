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
hostnames públicos hasta `frontend:8080` y `backend:3000` por la red interna del
compose. Nada entra al VPS desde internet, que es una superficie de ataque menos
que un reverse proxy escuchando en 443.

El documento tiene tres partes:

| Parte | Cuándo se usa |
|---|---|
| **I — Puesta en marcha** | Primer despliegue, base vacía. Pasos 1 a 8, en orden. |
| **II — Migraciones** | Al actualizar una instalación que ya existe (staging hoy, producción mañana). Qué hace cada migración pendiente y qué exige. |
| **III — Cambios de comportamiento** | Lo que cambia para quien opera el sistema, sin migración de por medio. |

---

## Antes de empezar — tres cosas que dependen de una persona

Ninguna de las tres la puede resolver el repositorio, y las tres bloquean el
despliegue:

1. **Elegir y contratar el VPS.** Todo lo demás asume Ubuntu LTS con Docker.
2. **Crear el túnel de producción en Cloudflare** y obtener su `TUNNEL_TOKEN`
   (paso 3).
3. **Corregir el puerto del hostname `app.`**, que pasó de `80` a `8080`
   (paso 3). Aplica **también al túnel de staging, que ya está configurado y
   hoy apunta al puerto viejo**: si no se cambia, staging deja de responder en
   el próximo despliegue.

---

# Parte I — Puesta en marcha

## 1. Preflight

```bash
bash scripts/check-env.sh .env.prod
```

Valida que estén todas las variables, que los secretos tengan largo suficiente y
sean distintos entre sí, que no haya quedado ningún valor de la plantilla, y que
`CORS_ORIGIN` y `VITE_*` sean coherentes con los hostnames publicados. Sale con
código distinto de cero si algo falta: encadenalo antes del `up` y no vas a
desplegar a medias. Nunca imprime el valor de un secreto.

Detecta solo el proxy que estés usando: si el archivo trae `TUNNEL_TOKEN` pide
las variables del túnel; si no, pide las de Caddy. No hay que pasarle ningún
flag.

## 2. Prerrequisitos en el VPS

- Ubuntu LTS, usuario no-root con sudo, SSH por clave (password deshabilitado).
- Firewall (ufw): permitir **sólo 22**; denegar el resto. El túnel es una
  conexión saliente, así que 80 y 443 no hacen falta.
- Docker + Docker Compose plugin instalados.
- Repo clonado en `/opt/rl_logistica` (por ejemplo).

## 3. Túnel (Cloudflare Zero Trust)

En **Zero Trust → Networks → Tunnels**, crear un túnel para producción y anotar
su token (*Install connector* → la parte que sigue a `--token`). Ese valor va en
`TUNNEL_TOKEN` dentro de `.env.prod`.

En **Public Hostname** del mismo túnel, agregar dos rutas:

| Hostname | Service |
|---|---|
| `app.rl-logistica.com` | `http://frontend:8080` |
| `api.rl-logistica.com` | `http://backend:3000` |

> **8080, no 80.** nginx corre sin privilegios desde RL-A-10 y un proceso sin
> privilegios no puede tomar un puerto por debajo de 1024. **El túnel de staging
> ya existe y apunta a `http://frontend:80`: hay que corregirlo ahí también.**
> El hostname de `api.` no cambia.

Los nombres de servicio son los del compose: `cloudflared` los alcanza por la red
interna, así que no hace falta publicar puertos ni crear registros DNS a mano —
Cloudflare crea los CNAME del túnel solo.

No abras 80 ni 443 en el firewall del VPS: el túnel es saliente. Con `ufw`
alcanza con permitir 22.

### Alternativa sin Cloudflare

El repo conserva un `Caddyfile` con HTTPS automático por Let's Encrypt. Para
usarlo hay que volver a agregar el servicio `caddy` al compose —**ya no está en
ningún `docker-compose*.yml`**—, abrir 80/443 en el firewall y definir
`APP_DOMAIN`, `API_DOMAIN` y `ACME_EMAIL` en lugar de `TUNNEL_TOKEN`. Esas tres
variables tampoco están en `.env.prod.example`, que asume el túnel: hay que
agregarlas a mano.

Creá además registros A hacia la IP del VPS, ponelos en *DNS only* (nube gris)
la primera vez para que Caddy emita los certificados, y recién después activá el
proxy en *Full (strict)*.

Es un camino sostenido pero no ejercitado: la ruta probada es el túnel.

## 4. Secretos — crear `.env.prod`

```bash
cp .env.prod.example .env.prod
# Generar secretos fuertes:
openssl rand -base64 32   # → DB_PASSWORD (y POSTGRES_PASSWORD, mismo valor)
openssl rand -base64 64   # → JWT_SECRET
openssl rand -base64 64   # → JWT_REFRESH_SECRET (distinto al anterior)
```

Además de los secretos, hay cinco valores que decide quien despliega:

| Variable | Qué poner |
|---|---|
| `TUNNEL_TOKEN` | El token del paso 3 |
| `CORS_ORIGIN` | El origen exacto del frontend, con esquema (`https://app.…`) |
| `VITE_API_URL` / `VITE_WS_URL` | Los hostnames públicos; el build los incrusta en la app **y** en la CSP |
| `TRUST_PROXY` | `1`. Obligatoria detrás del túnel — ver RL-M-09 en la Parte II |
| `ALLOW_SEED` | `false` |
| `BOOTSTRAP_ADMIN_USER` / `BOOTSTRAP_ADMIN_PASSWORD` | El admin inicial; la contraseña, ≥12 caracteres |

> El backend valida los secretos al arrancar (`validateEnv`). Si algo falta o es
> débil, el contenedor falla rápido con un mensaje claro en los logs. `DB_SYNCHRONIZE`
> tiene que quedar en `false`: en `true` TypeORM altera el esquema solo y puede
> descartar columnas con datos.

## 5. Levantar

```bash
bash scripts/check-env.sh .env.prod && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

En el **primer** arranque, con una base vacía, el backend aplica las migraciones
en orden (`DB_SYNCHRONIZE=false`, `DB_MIGRATIONS_RUN=true`) y crea el usuario
admin inicial. Sobre una base vacía no hay ningún cuidado especial que tomar: el
orden lo resuelve la propia secuencia. Las advertencias de la Parte II aplican
cuando se actualiza una instalación que **ya tiene datos**.

> Si la base **ya existía** (creada por `synchronize` en un despliegue viejo),
> antes de arrancar corré una sola vez
> `psql ... -f logistica-palets-backend/scripts/fake-apply-baseline.sql`
> (ver `logistica-palets-backend/MIGRATIONS.md`).

## 6. Verificar

**El servicio responde:**

```bash
curl -fsS https://api.tudominio.com/api/health        # 200 OK
docker compose -f docker-compose.prod.yml ps           # todo "healthy"
```

- Login en `https://app.tudominio.com` con el admin del `.env.prod`.
- El dashboard recibe updates en tiempo real (WebSocket autenticado).
- Ningún puerto de db/redis expuesto al host (`docker ps` no debe mostrarlos).

**Los contenedores no corren como root y pueden escribir adjuntos** (RL-A-10):

```bash
docker compose -f docker-compose.prod.yml exec backend id
docker compose -f docker-compose.prod.yml exec backend sh -c 'touch /app/uploads/.probe && rm /app/uploads/.probe && echo "adjuntos escribibles"'
```

El primero tiene que devolver `uid=1000(node)`. Si el segundo falla, es el
volumen heredado de un despliegue anterior: ver RL-A-10 en la Parte III.

**Las cabeceras de seguridad llegan al navegador:**

```bash
curl -sI https://app.tudominio.com/ | grep -iE 'content-security-policy|x-frame-options|referrer-policy'
curl -sI https://app.tudominio.com/assets/ -o /dev/null -w '%{http_code}\n'
```

La CSP se arma en tiempo de build a partir de `VITE_API_URL` / `VITE_WS_URL`, y
el build **falla** si algún placeholder quedó sin sustituir. Vale la pena mirar
además la consola del navegador después del primer login: si la CSP quedara
corta, ahí aparece bloqueado el WebSocket.

**La bitácora registra la IP real y no la del túnel** (RL-M-09): entrá con una
contraseña incorrecta a propósito y confirmá que la fila tenga **tu** IP.

```bash
docker compose -f docker-compose.prod.yml exec db psql -U "$DB_USERNAME" -d "$DB_DATABASE" -c "SELECT \"createdAt\", \"eventType\", username, reason, ip FROM auth_events ORDER BY \"createdAt\" DESC LIMIT 5;"
```

## 7. Backups (diarios + off-site)

```bash
# Prueba manual:
bash scripts/backup-db.sh
# Cron (03:00 cada día):
0 3 * * * cd /opt/rl_logistica && bash scripts/backup-db.sh >> /var/log/rl_backup.log 2>&1
```

Off-site a Cloudflare R2 / Backblaze B2: configurar `rclone` y exportar
`RCLONE_REMOTE=r2:rl-logistica-backups`. Sumar snapshot automático del VPS (OVH).

**Probar el restore** contra una base descartable:

```bash
bash scripts/restore-db.sh backups/<ultimo>.sql.gz   # pide confirmación
```

> **Pendiente (RL-M-13).** Los scripts existen y funcionan, pero hasta que no
> haya VPS no hay cron instalado, no hay copia fuera del servidor y **el restore
> nunca se probó de punta a punta**. Un backup que nunca se restauró no es un
> backup. Esto queda abierto a propósito hasta el despliegue real.

## 8. Actualizar una instalación existente

```bash
git pull
bash scripts/backup-db.sh    # fresco, no el de anoche
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Las migraciones pendientes se aplican solas al arrancar, antes de aceptar
tráfico. **Antes de la primera actualización que incluya este trabajo, leé la
Parte II**: hay una migración que puede fallar por datos, una que tiene que
correr antes que el código nuevo, y una que corta todas las sesiones abiertas.

---

# Parte II — Migraciones

Seis migraciones quedan pendientes de aplicar sobre cualquier base que ya exista.
Se aplican solas y en este orden; la tabla dice cuál necesita algo de quien
despliega.

| Orden | Migración | Qué hace | Qué exige |
|---|---|---|---|
| 1784600000000 | `AddInventoryForeignKeys` (RL-C-03) | 38 claves foráneas y 5 restricciones de rango | **Puede fallar por datos.** Chequeo previo |
| 1784700000000 | `CreateIdempotencyKeys` | Tabla de claves de idempotencia | Nada |
| 1784800000000 | `AddMissingRolePermissions` (RL-M-10) | Permisos finos de 5 módulos | **Antes que el código nuevo** |
| 1784900000000 | `CreateAuthEventsAndAppendOnly` (RL-M-09) | Bitácora de accesos y append-only real | `TRUST_PROXY=1` |
| 1785000000000 | `AddMovementDateIndex` (RL-A-07) | Índice `(date, createdAt)` | Nada (665 ms) |
| 1785100000000 | `CreateRefreshSessions` (RL-M-02) | Sesiones de refresco revocables | **Corta las sesiones abiertas** |

Ninguna modifica datos existentes. Todas corren dentro de una transacción: si una
aborta, el contenedor no levanta y la base queda intacta.

## 1784600000000 — Integridad referencial (RL-C-03)

Agrega 38 claves foráneas y 5 restricciones de rango a las tablas de inventario.
Es la única que puede **fallar por datos**, no por esquema: si hay filas
apuntando a registros que ya no existen, aborta. Eso es deliberado — decidir qué
hacer con un movimiento cuyo producto desapareció es una decisión de negocio, no
de esquema.

### Antes de la ventana, con el sistema en marcha

```bash
docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" rl_logistica_db_prod psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < scripts/check-referential-integrity.sql
```

Es de sólo lectura y se puede correr las veces que haga falta. Si todas las
filas dicen `ok`, la migración va a pasar. Si alguna dice `BLOQUEA LA
MIGRACIÓN`, hay que resolver esas filas primero — y conviene saberlo días antes,
no durante la ventana.

El mismo informe trae el volumen de las tablas: sirve para estimar cuánto va a
tardar. Postgres valida cada clave foránea recorriendo la tabla una vez.

### Desvío del contador de lotes (RL-A-09)

```bash
docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" rl_logistica_db_prod psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < scripts/check-lot-stock-drift.sql
```

También de sólo lectura. Lista los lotes cuyo `stockActual` no coincide con la
suma de sus pallets.

Importa correrlo **antes**, no después: hasta este cambio, una resta que dejaba
el contador en negativo se recortaba a cero en silencio, así que puede haber
desvíos arrastrados hace tiempo. Desde ahora esas salidas **cortan** con un
mensaje que pide reconciliar — que es lo correcto, pero mejor resolverlo en frío
que descubrirlo cuando un operador no pueda despachar.

Si hay desvíos: `POST /api/lots/reconcile-all` los recalcula desde los pallets.

### Verificación

```bash
docker compose -f docker-compose.prod.yml exec db psql -U "$DB_USERNAME" -d "$DB_DATABASE" -At -c "SELECT 'FK: ' || count(*) FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace;" -c "SELECT 'CHECK: ' || count(*) FROM pg_constraint WHERE contype='c' AND connamespace='public'::regnamespace;"
```

Esperado: **44 claves foráneas** y **6 CHECK** (antes: 6 y 1). Después, una
entrada y una salida de prueba para confirmar que la operación normal sigue
funcionando.

### Rollback

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend npm run migration:revert
```

Revierte sólo esta migración y devuelve el esquema a 6 claves foráneas y 1
CHECK — verificado. No hace falta restaurar el backup: la migración no modifica
ni una fila de datos, sólo agrega restricciones.

## 1784700000000 — Claves de idempotencia

Crea `idempotency_keys` y su índice. Tabla nueva, vacía, sin efecto sobre datos
existentes ni sobre el arranque. Sostiene el reintento seguro de las operaciones
que crean documentos: un cliente que reenvía la misma petición obtiene la
respuesta original en lugar de duplicar el movimiento.

## 1784800000000 — Permisos finos (RL-M-10) · orden obligatorio

Incorpora proveedores, destinos, adjuntos, alertas y la carga del corte de SAP al
motor de permisos finos.

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

```bash
docker compose -f docker-compose.prod.yml exec db psql -U "$DB_USERNAME" -d "$DB_DATABASE" -c "SELECT module, COUNT(*) FROM role_permissions WHERE module IN ('suppliers','destinations','attachments','alerts') GROUP BY module ORDER BY module;"
```

Tienen que aparecer los cuatro módulos. Si la consulta vuelve vacía, la
migración no corrió: no abras el sistema a los operadores hasta resolverlo.

Reversión: `migration:revert` borra esas filas y también los overrides por
usuario que apunten a ellas. Los endpoints vuelven a quedar protegidos sólo por
rol, que es como estaban antes — no queda ninguno sin control.

## 1784900000000 — Bitácora de accesos y append-only (RL-M-09)

Crea `auth_events` —el registro de intentos de login, con IP real, user-agent e
id de correlación— y hace que la base **haga cumplir** el append-only sobre las
tres bitácoras (`document_events`, `user_audit_log`, `auth_events`) con un
trigger que rechaza `UPDATE` y `DELETE`. Hasta acá era una convención escrita en
un comentario.

**`TRUST_PROXY=1` es obligatorio.** Está explicado en `.env.prod.example` y lo
exige `check-env.sh`: sin eso la conexión la abre el proxy y `req.ip` es la
misma dirección para todos, con lo que la bitácora registra la IP del túnel y
el límite de 5 intentos de login por minuto "por IP" pasa a ser de 5 por minuto
para toda la empresa.

Consulta útil para investigar un incidente:

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

## 1785000000000 — Índice de la pantalla de movimientos (RL-A-07)

Agrega el índice `(date, createdAt)` sobre `movements`, que es por donde ordena y
filtra la pantalla más usada del sistema y no estaba indexado.

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

```bash
docker compose -f docker-compose.prod.yml exec db psql -U "$DB_USERNAME" -d "$DB_DATABASE" -c "SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_movement_date_created';"
```

## 1785100000000 — Sesiones de refresco (RL-M-02) · corta las sesiones abiertas

Crea `refresh_sessions`: una fila por cada refresh token vigente, cuyo `id` viaja
dentro del token. Sin fila viva, el token no vale — eso es lo que convierte
`logout` en una revocación real (antes sólo borraba la cookie y el token seguía
sirviendo siete días).

**Al desplegar, todas las sesiones abiertas se cortan.** Los tokens emitidos
antes no llevan ese identificador y se rechazan a propósito: admitirlos dejaría
abierta una vía que evita la revocación. La gente vuelve a iniciar sesión una
vez. Conviene desplegar fuera del horario de operación.

Desde ahora cada refresco entrega un token nuevo y deja el anterior inservible.
Si alguien presenta un token ya rotado —dos copias en circulación— se cierran
todas las sesiones de esa cadena y queda registrado:

```bash
docker compose -f docker-compose.prod.yml exec db psql -U "$DB_USERNAME" -d "$DB_DATABASE" -c "SELECT \"createdAt\", username, ip FROM auth_events WHERE reason = 'REFRESH_REUSED' ORDER BY \"createdAt\" DESC LIMIT 10;"
```

Si aparecen filas ahí, no es un falso positivo por sí solo —una app móvil con
reintentos agresivos puede provocarlo— pero merece mirarse junto con la IP.

Las sesiones vencidas se purgan solas a las 4 de la mañana.

**Ventana de gracia de 30 segundos.** El token de acceso vive en memoria del
navegador (RL-M-01), así que cada pestaña pide un refresco al abrirse y dos
pestañas presentan la misma cookie. Sin la ventana, la segunda se leería como
reuso y cerraría la sesión cada vez que alguien abre dos pestañas. Dentro de esos
30 segundos, y sólo si el reemplazo sigue vivo, se devuelve ese reemplazo. El
precio es explícito: un token robado y usado dentro de esos 30 segundos de la
rotación legítima obtiene la sesión; fuera de esa ventana —el escenario real de
un robo— la detección sigue intacta.

---

# Parte III — Cambios de comportamiento

Lo que cambia para quien opera el sistema, sin migración de por medio.

## Contenedores sin root y con límites (RL-A-10)

Los contenedores corrían **todos como root** y sin ningún límite de recursos. El
backend —el que recibe los archivos que sube un operador— corría como root de
punta a punta, y el master de nginx también. Además, el backend de desarrollo
figuraba como `Exited (137)`: señal 9, típicamente el kernel matándolo por
memoria.

| Servicio | Usuario | Capacidades | Techo de memoria |
|---|---|---|---|
| `backend` | `node` (1000) | ninguna, `read_only` | 1 GB |
| `frontend` | `nginx` (101) | ninguna, `read_only` | 128 MB |
| `db` | root → baja a `postgres` | sólo las 5 que necesita para bajar | 1 GB |
| `redis` | root → baja a `redis` | sólo las 4 que necesita | 256 MB |
| `cloudflared` | — | ninguna, `read_only` | 128 MB |

`db` y `redis` conservan unas pocas capacidades porque sus *entrypoints* arrancan
como root y bajan de usuario por su cuenta (verificado: sus procesos de servidor
ya corrían como `postgres` y `redis`). Quitarles `SETUID`/`SETGID` les impide
hacer ese descenso y no arrancan.

`NODE_OPTIONS=--max-old-space-size=768` es lo que ataca el `Exited (137)`: Node no
ve el límite del cgroup y por defecto dimensiona su heap contra la RAM del host,
así que crece hasta que el kernel lo mata. Con el techo declarado el recolector
actúa antes y el proceso se ralentiza en vez de morir.

### El volumen de adjuntos, si ya existe

El backend pasa a correr como `node` (uid 1000). Un volumen nuevo hereda el dueño
correcto desde la imagen, pero uno creado por un despliegue anterior es de root y
el backend no va a poder escribir un solo adjunto. Con el stack levantado:

```bash
docker compose -f docker-compose.prod.yml exec -u root backend chown -R node:node /app/uploads
```

La verificación está en el paso 6. El cambio de puerto del hostname `app.`, que
también sale de este hallazgo, está en el paso 3.

## Quién aprueba los ajustes de inventario (RL-A-12)

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

## Borrar deja de borrar cuando hay historial (RL-C-03)

Borrar un material, una ubicación o un depósito **con historial** pasa a
desactivarlo en lugar de eliminarlo, con un aviso que lo explica. Antes se
borraba y dejaba movimientos apuntando al vacío. Es el mismo criterio que ya
tenían Materiales y Lotes, ahora también en Ubicaciones y Depósitos.

## Bloqueo de cuenta por intentos fallidos (RL-M-11)

Diez fallos de una misma cuenta en 15 minutos la bloquean por lo que resta de la
ventana, además del límite de 5 intentos por minuto por IP que ya existía. El
bloqueo se levanta solo; no hay nada que administrar. Queda registrado en
`auth_events` con `reason = 'ACCOUNT_LOCKED'`.

Los bloqueos no se cuentan a sí mismos: si lo hicieran, un atacante que siguiera
intentando mantendría la cuenta bloqueada para siempre.
