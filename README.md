# RL Logística — WMS

Sistema de gestión de depósito (WMS) para RL Servicio Logístico: control de
stock por lote y palet, entradas y salidas con remito, ajustes de inventario con
circuito de aprobación, y reportes de rotación, ocupación y vencimientos.

Monorepo con dos aplicaciones:

| Carpeta | Qué es |
|---|---|
| `logistica-palets-backend/` | API REST y WebSocket — NestJS 11, TypeORM, PostgreSQL 16, Redis |
| `logistica-palets-frontend/` | Interfaz — React 19, Vite 7, TanStack Query |

## Cómo correrlo en desarrollo

Las bases y Redis van en Docker; las aplicaciones, en la máquina.

```bash
docker compose up -d db redis
```

**Backend** — el `.env` trae `DB_HOST=db`, que es el nombre del servicio dentro
de Docker: desde la máquina hay que apuntar a `localhost` y al puerto publicado.

```bash
cd logistica-palets-backend && DB_HOST=localhost DB_PORT=5433 npm run start:dev
```

**Frontend** — escucha en `:5173` y apunta a `http://localhost:3000/api`.

```bash
cd logistica-palets-frontend && npm run dev
```

> **Si los adjuntos fallan con `EACCES` sobre `/app/uploads`**, es el volumen:
> el backend corre como `node` desde RL-A-10 y un volumen creado por un arranque
> anterior pertenece a root. Pasa igual en desarrollo, no sólo al desplegar.
>
> ```bash
> docker compose exec -u root backend chown -R node:node /app/uploads
> ```

Usuario inicial de desarrollo: `admin` / `admin123`. El login está limitado a
5 intentos por minuto por IP y, desde RL-M-11, a 10 fallos por usuario en 15
minutos; si te trabás, esperá o reiniciá el backend.

## Variables de entorno

`.env.example` (desarrollo) y `.env.prod.example` (producción) son la referencia:
cada variable está documentada ahí, con lo que pasa si falta. Las que más
confusión generan:

| Variable | Por qué importa |
|---|---|
| `DB_USERNAME` / `DB_DATABASE` | Se llaman así, no `DB_USER` / `DB_NAME` |
| `DB_SYNCHRONIZE` | **Nunca** `true` fuera de desarrollo: TypeORM alteraría el esquema y puede descartar columnas con datos |
| `CORS_ORIGIN` | Obligatoria en producción; el arranque aborta si falta |
| `TRUST_PROXY` | Obligatoria detrás del túnel: sin ella todos los usuarios comparten una IP y el límite de intentos de login se vuelve global |
| `ALLOW_SEED` | Habilita `/seed`; en producción va en `false` |

Antes de desplegar, `bash scripts/check-env.sh .env.prod` valida el archivo
entero sin imprimir un solo secreto.

## Pruebas

El backend prueba contra un PostgreSQL real, no contra dobles:

```bash
docker compose -f docker-compose.test.yml --env-file .env.test up -d db-test
```

```bash
cd logistica-palets-backend && npm test
```

`test/test-datasource.ts` lee variables `TEST_DB_*` (no `DB_*`) y su contraseña
por defecto no coincide con la de `.env.test`, así que hay que pasarla explícita.

Frontend: `cd logistica-palets-frontend && npm test` (vitest). Chequeo de tipos:
`npx tsc -b` — `tsc --noEmit` no verifica nada por las referencias de proyecto.

## Migraciones

```bash
cd logistica-palets-backend && npm run migration:show
```

En producción se aplican solas al arrancar (`DB_MIGRATIONS_RUN=true`). Varias
tienen consecuencias que conviene conocer antes de desplegar —una corta las
sesiones abiertas, otra debe correr *antes* que el código nuevo o deja módulos
enteros con 403— y todas están explicadas en `DEPLOY.md`.

## Documentación

| Archivo | Para qué |
|---|---|
| `DEPLOY.md` | Puesta en producción: túnel, secretos, migraciones con su orden, backups |
| `DEPLOY_STAGING_LOCAL.md` | Ensayo del despliegue en local |
| `GUIA-OPERATIVA.md` | Uso del sistema desde el lado del depósito |
| `auditoria/` | Informes de auditoría y los scripts que los generaron |

## Estado

El sistema todavía no está desplegado en un VPS. `DEPLOY.md` tiene el
procedimiento completo y marca lo que queda pendiente del lado de
infraestructura: backups verificados y monitoreo externo.
