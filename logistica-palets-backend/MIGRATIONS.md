# Migraciones — estado y operación

## Estado actual ✅

El **cutover de synchronize → migraciones está hecho**. Existe una única migración
baseline que crea el schema completo desde cero:

```
src/migrations/1782626569588-InitialSchema.ts   ← schema completo (tablas, índices, FKs)
src/migrations/_archive/                          ← incrementales 100→700 (históricas, fuera del glob)
```

Validado contra una DB vacía con `DB_SYNCHRONIZE=false`:
- `migration:run` crea las 22 tablas + `uuid-ossp` + `uq_stock_cell`. ✓
- Segunda corrida no aplica nada (idempotente). ✓
- El único "drift" que reporta `migration:generate` es un `DROP INDEX uq_stock_cell`
  espurio (ver más abajo) — no es un problema real.

Por eso un **VPS nuevo con DB vacía** arranca limpio: `DB_SYNCHRONIZE=false` +
`DB_MIGRATIONS_RUN=true` aplican `InitialSchema` en el primer boot.

## Detalles de la baseline (no quitar al regenerar)

Dos cosas se **agregaron a mano** al `InitialSchema` generado, porque el generador
de TypeORM no las produce:

1. `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` al inicio de `up()`.
   Las tablas usan `DEFAULT uuid_generate_v4()`. Con synchronize TypeORM creaba la
   extensión sola; con migraciones hay que crearla explícitamente o el primer
   `CREATE TABLE` falla.
2. `uq_stock_cell` al final de `up()` (y su `DROP` al inicio de `down()`).
   Es un índice único **de expresión** (`COALESCE(...)`), no declarable en una
   entidad, así que el generador no lo incluye.

## ⚠️ Gotcha al generar migraciones nuevas

Como `uq_stock_cell` no está en ninguna entidad, **cada** `migration:generate`
futuro incluirá un `DROP INDEX "public"."uq_stock_cell"` espurio. **Borrá esa
línea** de la migración generada antes de commitearla (si no, perderías el índice
único de stock en el próximo deploy).

## Agregar un cambio de schema (flujo normal)

1. Modificá la entidad.
2. Generá la migración (contra una DB que tenga el schema actual aplicado):
   ```bash
   npm run migration:generate -- src/migrations/<NombreDescriptivo>
   ```
3. **Revisá el archivo generado** y borrá el `DROP INDEX uq_stock_cell` espurio.
4. Commiteá. En prod se aplica sola al arrancar (`DB_MIGRATIONS_RUN=true`).

> Sin Node local podés generar dentro de Docker (igual que la baseline): levantá un
> `postgres:16-alpine` efímero, corré `migration:run` para tener el schema actual,
> y luego `migration:generate` apuntando a esa DB.

## DB existentes creadas por synchronize (dev viejo / prod viejo)

Una DB que ya tiene el schema (lo armó synchronize) **no** debe re-ejecutar
`InitialSchema`. Marcala como aplicada una sola vez, ANTES de deployar con
migraciones:

```bash
psql "$DATABASE_URL" -f scripts/fake-apply-baseline.sql
```

(El script ya tiene el timestamp/nombre reales de la baseline.)

## Comandos

```bash
npm run migration:run        # aplica pendientes (ts-node, dev)
npm run migration:run:prod   # aplica pendientes (dist, lo que corre en el contenedor)
npm run migration:show       # lista aplicadas/pendientes
npm run migration:revert     # revierte la última
```
