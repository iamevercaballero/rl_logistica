# Cutover synchronize → migraciones

## El problema

Hoy el schema base lo crea `synchronize` (TypeORM lee las entidades y crea las
tablas). Las migraciones existentes (`1700000000100`…`700`) sólo **agregan** cosas
sobre ese base. Por eso una DB **fresca** construida sólo con migraciones falla:
la primera hace `CREATE INDEX` sobre `stocks`, que ninguna migración crea.

Mientras `DB_SYNCHRONIZE=true`, en prod funciona porque synchronize arma el base
antes de correr migraciones — pero eso es justo lo que querés apagar (riesgo de
que TypeORM altere tablas solo en prod).

## La solución: una migración baseline

Generar **una** migración `InitialSchema` con el schema completo actual (desde las
entidades) y dejarla como único punto de partida. A partir de ahí, `migration:run`
arma todo desde cero y `DB_SYNCHRONIZE=false` es seguro.

> El SQL del schema se **genera** con TypeORM (exacto), no se escribe a mano.

---

## Pasos

### 1. Generar InitialSchema

Con docker (un comando, levanta una DB vacía efímera y genera):

```bash
bash scripts/generate-baseline.sh
```

O manual, si ya tenés una DB vacía a mano:

```bash
DB_DATABASE=<una_db_vacia> DB_SYNCHRONIZE=false DB_MIGRATIONS_RUN=false \
  npm run migration:generate -- src/migrations/InitialSchema
```

Queda `src/migrations/<timestamp>-InitialSchema.ts` con todos los `CREATE TABLE`,
índices declarados en entidades y FKs.

### 2. Plegar el índice de expresión `uq_stock_cell`

El generador **no** incluye `uq_stock_cell` (es un índice de expresión, no está en
ninguna entidad). Agregá estas líneas al **final** del `up()` de `InitialSchema`,
y la inversa al `down()`:

```ts
// up()  — al final
await queryRunner.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS "uq_stock_cell"
  ON stocks ("productId",
             COALESCE("warehouseId", '00000000-0000-0000-0000-000000000000'::uuid),
             COALESCE("locationId",  '00000000-0000-0000-0000-000000000000'::uuid))
`);

// down() — al principio
await queryRunner.query(`DROP INDEX IF EXISTS "uq_stock_cell"`);
```

### 3. Archivar las migraciones incrementales

Su contenido ya está en `InitialSchema` (las entidades reflejan todo). Movelas
fuera del glob de migraciones para que no entren en conflicto:

```bash
mkdir -p src/migrations/_archive
git mv src/migrations/17000000001*.ts src/migrations/17000000002*.ts \
       src/migrations/17000000003*.ts src/migrations/17000000004*.ts \
       src/migrations/17000000005*.ts src/migrations/17000000006*.ts \
       src/migrations/17000000007*.ts src/migrations/_archive/
```

Queda **una sola** migración activa: `InitialSchema`. Sin las incrementales no hay
problemas de orden de timestamps ni de `CREATE TABLE` duplicados.

### 4. Verificar en una DB fresca

```bash
# DB vacía + sólo migraciones (sin synchronize)
DB_DATABASE=<otra_db_vacia> DB_SYNCHRONIZE=false npm run migration:run
```

La app debe arrancar contra esa DB. Comparala con una creada por synchronize
(mismas tablas/columnas) y pegale a `GET /reports/inventory-health` → `ok: true`.

### 5. Fake-apply en las DB existentes (prod / staging)

Esas DB **ya tienen** el schema (lo creó synchronize). NO deben re-ejecutar
`InitialSchema`. Marcala como aplicada con el SQL plantilla (reemplazá `<TS>` y
`<NAME>` por el timestamp y nombre de clase de la migración generada):

```bash
psql "$DATABASE_URL" -f scripts/fake-apply-baseline.sql
```

### 6. Apagar synchronize

En `.env` de prod (y staging): `DB_SYNCHRONIZE=false`. `DB_MIGRATIONS_RUN=true`
sigue corriendo migraciones al arrancar. Desde acá, todo cambio de schema va por
una migración nueva (`npm run migration:generate -- src/migrations/<Nombre>`).

### 7. CI a migraciones

Una vez con `InitialSchema`, el CI puede dejar de usar synchronize y validar el
camino real de prod. En `.github/workflows/ci.yml`, en el job backend, agregá
antes de `npm test`:

```yaml
      - run: npm run migration:run
        env:
          DB_HOST: localhost
          DB_PORT: 5432
          DB_USERNAME: rl_test
          DB_PASSWORD: test_password_change_me
          DB_DATABASE: logistica_palets_test
          DB_SYNCHRONIZE: "false"
```

y cambiá el harness de test (`test/test-datasource.ts`) de `synchronize: true` a
correr migraciones, o dejá synchronize sólo para los tests (más rápido) y validá
las migraciones en este paso aparte.

---

## Rollback

Si algo sale mal antes del paso 6, simplemente volvé a `DB_SYNCHRONIZE=true` y
restaurá las migraciones desde `_archive/`. Nada de esto toca datos: sólo schema
y la tabla `typeorm_migrations`.
