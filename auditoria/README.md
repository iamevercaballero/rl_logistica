# Arnés de auditoría funcional

Suite de 169 casos que se ejecutan **contra la API real** y verifican el resultado
directamente en PostgreSQL. Es la forma ejecutable del
[informe de auditoría](INFORME-AUDITORIA-PREPROD.md): sirve para re-testear después de
corregir los defectos y como regresión antes de cada deploy.

> ⚠️ **Nunca apuntar a la base de producción ni a la de desarrollo.** Los scripts crean,
> modifican y **borran** datos, e incluyen casos destructivos a propósito (fase 7).

## Entorno

```bash
docker compose -f docker-compose.test.yml --env-file .env.test up -d db-test redis-test
```

Crear la base de auditoría y aplicar migraciones desde cero:

```bash
docker exec rl_test_db psql -U rl_test -d postgres -c "DROP DATABASE IF EXISTS audit_db WITH (FORCE);" -c "CREATE DATABASE audit_db;"
```

```bash
cd logistica-palets-backend && DB_HOST=localhost DB_PORT=5434 DB_USERNAME=rl_test DB_PASSWORD=<pass> DB_DATABASE=audit_db npx typeorm-ts-node-commonjs -d src/data-source.ts migration:run
```

Levantar el backend en `:3001` apuntando a `audit_db` (`NODE_ENV=development`,
`DB_SYNCHRONIZE=false`, `DB_MIGRATIONS_RUN=false`, `THROTTLE_LIMIT` alto, Redis en 6380).

Las credenciales de la base se pasan por entorno:

```bash
export AUDIT_BASE=http://localhost:3001/api AUDIT_DB_PASSWORD=<pass>
```

## Ejecución

Las fases son **secuenciales y encadenadas**: cada una deja su estado en `state.json` para la
siguiente. Hay que correrlas en orden sobre una base recién creada.

```bash
cd auditoria && for f in p1-base p2-entradas p3-salidas p4-ajustes p5-probe p6-reportes p7-borrados; do node $f.js; done
```

| Fase | Cobertura |
|---|---|
| `p1-base` | Autenticación, roles y usuarios, productos, depósitos, ubicaciones |
| `p2-entradas` | Remitos de entrada, lotes, pallets, invariante de stock |
| `p3-salidas` | Salidas FEFO, sobreventa, transferencias, concurrencia |
| `p4-ajustes` | Ajustes de inventario, correcciones de movimiento, anulaciones, regularización |
| `p5-probe` | Confirmación de los defectos de lote provisorio y anulación atascada |
| `p6-reportes` | Reportes, diferencias SAP, bitácora, transportes, endpoints sensibles |
| `p7-borrados` | Integridad referencial al borrar entidades maestras |

`p1-base` incluye una espera de 62 s para liberar la ventana del rate-limit de login (5/min).

Cada fase escribe `res-pN.json` con `{caso, pasos, esperado, obtenido, estado, criticidad}`.

## Configuración

`AUDIT_BASE`, `AUDIT_DB_HOST`, `AUDIT_DB_PORT`, `AUDIT_DB_USER`, `AUDIT_DB_PASSWORD` y
`AUDIT_DB_NAME` configuran destino y credenciales (ver `lib.js`). El helper `tripleCheck()`
verifica el invariante `Stock = Lote = Pallet` por producto — es la aserción que detecta las
divergencias silenciosas del motor de stock.
