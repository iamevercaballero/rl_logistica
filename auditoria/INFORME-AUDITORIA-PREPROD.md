# Informe de auditoría funcional — RL Logística WMS

**Objetivo:** determinar si el sistema está funcionalmente listo para pasar a producción.
**Fecha:** 31/07/2026 · **Rama:** `main` (`08edd0d8`)

---

## 1. Veredicto

> ## ⛔ NO LISTO PARA PRODUCCIÓN
>
> **7 defectos bloqueantes** permiten que el stock del sistema deje de reflejar el stock físico,
> de forma **silenciosa e irreversible desde la interfaz**. Cuatro de ellos se disparan con
> operaciones normales del día a día (despachar por pallet, transferir parcialmente, aprobar un
> ajuste, regularizar una entrada provisoria), no con casos exóticos.

El motor de entradas y el FEFO están sólidos (18/18 y 11/14). El problema está concentrado en
**tres puntos**: la falta de tope por saldo de pallet, la ausencia de bloqueo pesimista en la
aprobación de ajustes, y máquinas de estado que se quedan trabadas sin salida (lote provisorio,
anulación pendiente).

Ninguno de los siete requiere refactor: son validaciones y una cláusula `lock` faltantes.
Estimación razonable de corrección: **2–4 días de desarrollo + 1 día de re-testeo**.

| | Casos | ✅ Pasa | ❌ Falla |
|---|---|---|---|
| **Total** | **169** | **138 (82 %)** | **31 (18 %)** |
| Críticas | | | 10 |
| Altas | | | 16 |
| Medias | | | 4 |
| Bajas | | | 1 |

---

## 2. Alcance y entorno de pruebas

**Entorno aislado** (no se tocó ninguna base de datos real):

| Componente | Detalle |
|---|---|
| PostgreSQL 16 | contenedor `rl_test_db`, puerto 5434, base `audit_db` creada **vacía** |
| Esquema | generado con `npm run migration:run` desde cero — ✅ las 2 migraciones aplican limpio |
| Backend | NestJS compilado (`nest build`) corriendo en `:3001` contra `audit_db` |
| Redis | contenedor `rl_test_redis`, puerto 6380 |
| Ejecución | 169 casos vía HTTP contra la API real + verificación directa en PostgreSQL con `pg` |

**Verificaciones previas que sí pasaron:**

- `npm test` (backend): **16/16** — `stock-engine.spec.ts` y `slotting.spec.ts`.
- `npx tsc -b` (frontend): **0 errores** de tipos.
- `migration:run` sobre base vacía: 22 tablas + `uuid-ossp` + `uq_stock_cell`, idempotente.

**Metodología por caso:** cada operación se ejecutó por la API y luego se verificó el estado
real en PostgreSQL con el invariante de las tres contabilidades:

```sql
SUM(stocks.currentQuantity) = SUM(lots.stockActual) = SUM(pallets.quantity WHERE status <> 'EXITED')
```

---

## 3. Resultado por módulo

| Módulo | Casos | Pasa | Estado |
|---|---|---|---|
| Entradas | 18 | 18 | ✅ |
| Autenticación | 9 | 9 | ✅ |
| Reportes | 11 | 11 | ✅ |
| Correcciones de movimiento | 8 | 8 | ✅ |
| Seguridad | 6 | 6 | ✅ |
| Diferencias de inventario (SAP) | 4 | 4 | ✅ |
| Pallets | 3 | 3 | ✅ |
| Ajustes de inventario | 11 | 9 | ⚠️ |
| Salidas | 14 | 11 | ⚠️ |
| Auditoría / bitácora | 8 | 7 | ⚠️ |
| Lotes | 5 | 4 | ⚠️ |
| Stock | 5 | 4 | ⚠️ |
| Ubicaciones | 10 | 8 | ⚠️ |
| Usuarios y roles | 10 | 8 | ⚠️ |
| Depósitos | 6 | 4 | ⚠️ |
| Transportes | 4 | 3 | ⚠️ |
| Concurrencia | 3 | 2 | ❌ |
| Anulaciones | 5 | 3 | ❌ |
| Transferencias | 4 | 2 | ❌ |
| Integridad referencial | 7 | 3 | ❌ |
| Regularización | 7 | 2 | ❌ |

---

## 4. Defectos bloqueantes — corregir antes del deploy

### 🔴 B1 — Se puede despachar de un pallet más de lo que contiene

**Caso:** SAL-11 · **Archivo:** `logistica-palets-backend/src/modules/movements/movements.service.ts:396-407`

El motor descuenta del stock la cantidad **pedida**, pero del pallet solo lo que el pallet
**tiene**. No hay validación de tope.

```ts
await this.applyDecrease(manager, dto.productId, stockWarehouseId, stockLocationId, item.quantity);
// ...
pallet.quantity = Math.max(0, pallet.quantity - item.quantity);   // ← se come el exceso en silencio
```

`applyDecrease` solo valida contra el stock **de la celda**, que incluye otros pallets. Si en la
ubicación hay 12.500 unidades repartidas en varios pallets, se puede pedir 7.000 contra un pallet
de 2.000 y la operación se acepta.

**Evidencia medida:**

| | Antes | Después | Δ |
|---|---|---|---|
| `stocks` | 12.500 | 5.500 | −7.000 |
| `lots` | 12.500 | 5.500 | −7.000 |
| `pallets` | 12.500 | 10.500 | −2.000 |

Resultado: **5.000 unidades fantasma** que el sistema cree despachadas y que siguen físicamente
en el depósito. `GET /reports/inventory-health` lo detecta *después* (`lotVsPallet: -5000`), pero
la transacción ya se confirmó y no hay forma de revertirla desde la interfaz.

**Corrección:** validar `item.quantity <= pallet.quantity` antes de `applyDecrease`, y lanzar
`BadRequestException` con el saldo real del pallet.

---

### 🔴 B2 — El mismo agujero en la aprobación de ajustes de salida

**Caso:** AJU-11 · **Mismo código** (`ADJUSTMENT_OUT` recorre la misma rama)

Un `ADJUSTMENT_OUT` de 1.000 unidades sobre un pallet de 600 se aprueba sin error:
stock y lote bajan 1.000, los pallets bajan 600 → **400 unidades de divergencia**.

Es más grave que B1 porque el ajuste **ya pasó por aprobación de un MANAGER**: la revisión humana
no tiene forma de ver el problema, la pantalla muestra la cifra pedida como válida.

**Corrección:** la misma validación de B1 cubre ambos casos.

---

### 🔴 B3 — Dos aprobaciones simultáneas postean el stock dos veces

**Caso:** AJU-06 · **Archivo:** `logistica-palets-backend/src/modules/adjustments/adjustments.service.ts:153-157`

```ts
// Re-leer con lock para evitar doble-aprobación concurrente
const locked = await manager.findOne(AdjustmentRequest, { where: { id } });   // ← sin lock
```

El comentario promete un bloqueo pesimista que no existe. Dos `PATCH /adjustments/:id/approve`
concurrentes (un MANAGER y un ADMIN aprobando la misma solicitud desde dos pantallas) pasan
ambos el chequeo de estado y **crean dos movimientos**.

**Evidencia:** solicitud de +500 aprobada dos veces → stock 2.200 → **3.200** (esperado 2.700),
2 movimientos generados. La respuesta HTTP fue **200 en ambas**: nadie se entera.

**Corrección:**

```ts
const locked = await manager.findOne(AdjustmentRequest, {
  where: { id },
  lock: { mode: 'pessimistic_write' },
});
```

> El resto del motor sí está bien protegido: dos salidas concurrentes de 4.000 con 6.000 en stock
> se resolvieron correctamente (CON-01 ✅), y las entradas concurrentes del mismo lote no lo
> duplicaron (CON-02 ✅). El problema es puntual de este método.

---

### 🔴 B4 — La transferencia parcial mueve el pallet entero pero parte el stock

**Casos:** TRF-03, TRF-04 · **Archivo:** `movements.service.ts:417-419`

```ts
await this.applyDecrease(..., fromLocationId, item.quantity);
await this.applyIncrease(..., dto.toLocationId, item.quantity);
pallet.currentLocationId = dto.toLocationId ?? null;   // ← el pallet se va entero
```

Al transferir 4.000 de un pallet de 9.000, el pallet físico se mueve completo al destino pero
solo 4.000 unidades de stock lo acompañan.

**Evidencia medida:**

| Ubicación | Stock según sistema | Pallets reales |
|---|---|---|
| Origen | 5.000 | 0 |
| Destino | 4.000 | 9.000 |

El operario va a buscar 5.000 unidades a una ubicación vacía. **`inventory-health` no lo detecta**
porque el total del producto sigue cerrando (ver B8).

**Corrección:** rechazar `quantity < pallet.quantity` en TRANSFER, o implementar la división real
del pallet (crear un pallet hijo en el destino con la cantidad movida).

---

### 🔴 B5 — Una entrada provisoria regularizada deja el stock congelado para siempre

**Casos:** REG-02, REG-03, REG-04, REG-06, REG-07 · **Archivo:** `movements.service.ts:1128-1131`

```ts
if (lotChanged) {          // ← solo si cambió sapLot / proveedor / fechaVencimiento / fechaFabricacion
  lot.status = 'NORMAL';
  await manager.save(Lot, lot);
}
```

El desbloqueo del lote está dentro de un `if` que depende de que se edite **un dato del lote**.
El caso de uso real —*"llegó el remito definitivo, cargo el número y el proveedor"*— solo toca
campos del **movimiento**, así que `lotChanged` queda en `false`.

**Secuencia reproducida:**

1. Entrada provisoria de 6.000 unidades → movimiento y lote en `PENDING_REGULARIZATION`. ✅
2. `PATCH /movements/:id/regularize` con `documentNumber` + `supplier` → **200 OK**, el movimiento
   pasa a `NORMAL`. El lote sigue en `PENDING_REGULARIZATION`.
3. `POST /movements/documents` (EXIT) → **400 "Stock insuficiente: se pueden despachar 0 de 500"**.
4. Reintentar regularizar → **400 "El movimiento no está pendiente de regularización"** (ya es `NORMAL`).
5. `PATCH /lots/:id {status:"NORMAL"}` → **400 "property status should not exist"** (`UpdateLotDto` no lo expone).

**Resultado: 6.000 unidades inmovilizadas y ninguna vía por API para liberarlas.** En producción
esto se arregla con un `UPDATE` manual sobre PostgreSQL.

**Corrección:** sacar `lot.status = 'NORMAL'` fuera del `if (lotChanged)` — regularizar el
movimiento debe desbloquear siempre sus lotes.

---

### 🔴 B6 — Una anulación que no puede aprobarse deja el movimiento trabado

**Casos:** ANU-03, ANU-05 · **Archivo:** `adjustments.service.ts:235-246`

Al pedir la anulación de una entrada cuyo stock ya fue despachado, se genera el `ADJUSTMENT_OUT`
compensatorio y el movimiento queda en `VOID_PENDING`. Al aprobarlo → **400 "Stock insuficiente"**
(correcto: no se puede des-recibir mercadería que ya salió). Pero:

- `PATCH /adjustments/:id/cancel` → 200, pero **no revierte `movements.voidStatus`**.
- `POST /movements/:id/void` de nuevo → 400 *"ya tiene una solicitud de anulación pendiente"*.

El movimiento queda **permanentemente en `VOID_PENDING`**: ni anulado ni operable, y aparece así
en todas las pantallas.

**Corrección:** `cancel()` debe limpiar `voidStatus = 'NONE'` y `voidAdjRequestId = null` cuando la
solicitud tiene `originalMovementId`. Complementario: avisar al *solicitar* la anulación si el
stock ya no alcanza, en lugar de dejar que falle recién en la aprobación.

---

### 🔴 B7 — Se puede borrar una ubicación que tiene pallets y stock

**Caso:** INT-01 · **Archivo:** `logistica-palets-backend/src/modules/locations/locations.service.ts:341-344`

```ts
async remove(id: string) {
  const location = await this.findOne(id);
  return this.locationRepo.remove(location);   // ← sin verificar referencias
}
```

`stocks.locationId` y `pallets.currentLocationId` son columnas `uuid` planas **sin foreign key**,
así que la base no frena nada.

**Evidencia:** `DELETE /locations/:id` sobre una ubicación con 1 pallet y 500 unidades →
**200 OK**, ubicación borrada, **1 pallet huérfano y 500 unidades de stock huérfano** apuntando a
un UUID que ya no existe. Ese stock desaparece del mapa del depósito pero sigue sumando en los
totales. Y lo puede hacer un **OPERATOR**.

**Corrección:** rechazar el borrado si hay pallets activos o stock ≠ 0 en la ubicación; restringir
el endpoint a ADMIN/MANAGER; agregar FKs en migración.

---

## 5. Defectos altos — corregir antes del deploy o con mitigación explícita

### 🟠 B8 — `inventory-health` no ve las divergencias por ubicación

**Caso:** STK-04 · `reports.service.ts:32-75`

La consulta agrupa **por producto** (`GROUP BY productId`). Una transferencia parcial (B4)
descuadra las celdas pero el total del producto cierra, así que el chequeo devuelve `ok: true`.

En la corrida quedaron **4 celdas descuadradas** y el reporte solo señaló **2 productos**:

```
40009912: ubicación A → stock 5.000 / pallets 0      ← no reportado
40009912: ubicación B → stock 4.000 / pallets 9.000  ← no reportado
```

Es el control que va a usar el equipo para validar la salud del inventario en producción: si no
detecta el descuadre por celda, da una falsa sensación de seguridad. **Agregar una segunda
consulta por `(productId, locationId)`.**

### 🟠 B9 — Desactivar un usuario o bajarle el rol no corta la sesión

**Casos:** USR-09, USR-10 · `auth/jwt.strategy.ts`

`JwtStrategy.validate()` devuelve el payload del token sin consultar la base. Consecuencias medidas:

- Usuario desactivado (`active: false`) → su token siguió operando (200) hasta **8 h** (`JWT_EXPIRES_IN`).
- Usuario degradado de OPERATOR a AUDITOR → **creó un depósito igual** (201) con el token viejo.

Para dar de baja a alguien de verdad hoy hay que esperar a que expire el token. **Validar el
usuario contra la base en `validate()`** (con caché corto si preocupa la latencia), o bajar
`JWT_EXPIRES_IN` y documentar la ventana.

### 🟠 B10 — La tabla `lots` no tiene índice único `(productId, lotCode)`

**Caso:** LOT-04 · `migrations/1782626569588-InitialSchema.ts`

La unicidad se aplica solo en la capa de servicio (`findOrCreateLot` hace `SELECT` y después
`INSERT`). Verificado en `pg_indexes`: los únicos índices de `lots` son la PK y tres índices no
únicos.

En esta corrida las entradas concurrentes del mismo lote **no** lo duplicaron (CON-02 ✅), pero es
suerte de timing: sin restricción en base, una carga masiva o dos operarios simultáneos pueden
partir un lote en dos filas y romper el FEFO. **Agregar `CREATE UNIQUE INDEX` en migración.**

### 🟠 B11 — `GET /locations` ignora el filtro `warehouseId`

**Caso:** UBI-07 · `locations.controller.ts:26-30`

`findAll()` no recibe ningún parámetro: devuelve **todas** las ubicaciones de **todos** los
depósitos. Pedidas las 54 del depósito central, devolvió 57 (incluyendo las 3 del secundario).

Con dos depósitos el operario ve ubicaciones de otro depósito en los selects de entrada y
transferencia. Escala mal: con 10 depósitos de 500 ubicaciones, cada apertura de formulario baja
5.000 filas.

### 🟠 B12 — Se pueden crear dos ubicaciones con el mismo código en un depósito

**Caso:** UBI-08 · `locations.service.ts:28-53`

`create()` no verifica duplicados (el generador masivo sí es idempotente, UBI-02 ✅, pero el alta
manual no). Dos ubicaciones `A-F1-N1-P1` en el mismo depósito son indistinguibles para el operario
y parten el stock en dos celdas.

### 🟠 B13 — Borrar producto o depósito con datos devuelve 500

**Casos:** INT-03, INT-04

`DELETE /products/:id` con lotes → **500 Internal server error** (violación de FK filtrada tal cual).
Igual con `DELETE /warehouses/:id` con ubicaciones. El dato se salva (la FK cumple su función),
pero el usuario ve un error genérico en vez de *"no se puede borrar: tiene stock asociado"*.

Nótese el contraste: **pallets sí está bien resuelto** (`DELETE /pallets/:id` → 405 con mensaje
explícito de preservación de trazabilidad). Ese criterio debería replicarse en los demás maestros.

### 🟠 B14 — Borrar un usuario es físico y rompe la autoría de los movimientos

**Caso:** INT-05 · `users.service.ts:96-101`

`DELETE /users/:id` ejecuta `userRepo.remove()`. Al borrar al operador de prueba, **24 movimientos
quedaron sin autor válido** (`movements.createdById` apunta a un UUID inexistente, sin FK).

Para un sistema con requisitos de auditoría es una pérdida de trazabilidad irrecuperable.
**Convertir en baja lógica (`active = false`).**

### 🟠 B15 — 28 de 39 eventos de bitácora no registran quién los hizo

**Caso:** AUD-03

`uploads.log()` se invoca sin `userId` en varios puntos (entre ellos la creación de remitos en
`movements.service.ts:576`). El 72 % de la bitácora no dice quién ejecutó la acción.

Los `movements.createdById` y los `regularization_logs.reason` **sí** están completos al 100 %
(AUD-04 ✅, AUD-05 ✅) — el hueco es específico de `document_events`.

---

## 6. Defectos medios y bajos

| # | Caso | Descripción | Impacto |
|---|---|---|---|
| M1 | PRD-08 | `GET /products/no-es-uuid` → **500**. Falta `ParseUUIDPipe`; aplica a todos los controladores con `@Param('id')`. | Ruido en logs, 500 en vez de 400 ante cualquier URL manipulada |
| M2 | PRD-11 | Un **OPERATOR** puede borrar productos y el borrado es **físico**. | Pérdida de catálogo maestro por error de un operario |
| M3 | DEP-03 | `POST /warehouses {name:""}` → 201. `CreateWarehouseDto` usa `@IsString()` sin `@IsNotEmpty()`. | El depósito sin nombre aparece como `""` en el reporte de ocupación |
| M4 | TRA-02 | Patente de vehículo duplicada aceptada. | El historial de viajes por patente mezcla dos vehículos |
| L1 | DEP-04 | Nombre de depósito duplicado aceptado. | Dos depósitos homónimos en los selects |

---

## 7. Lo que quedó verificado y funciona

Vale dejarlo asentado para no tocarlo al corregir lo anterior:

- **Entradas — 18/18.** Multi-lote, multi-producto, provisoria con observación obligatoria,
  materiales en KG, cantidad mínima 1, codificación automática de pallets (`LOTE-P1`, `LOTE-P2`),
  correlativos `RLNE-2026-000001` sin huecos.
- **Atomicidad (ENT-18).** Un remito con una línea válida y otra inválida hace rollback total:
  no quedó ni el lote ni el stock de la línea buena.
- **FEFO — correcto.** Consume primero el lote que vence antes aunque haya entrado después
  (SAL-01), encadena entre lotes (SAL-04) y marca `PARTIAL`/`EXITED` según corresponda.
- **Sin sobreventa ni stock negativo.** SAL-07 rechazó despachar 5 con 1 en stock; 0 celdas
  negativas en toda la corrida.
- **Lote provisorio bloquea la salida** (SAL-08) — la regla de negocio funciona; lo que falla es
  el desbloqueo (B5).
- **Concurrencia de salidas y de entradas** (CON-01, CON-02): los locks pesimistas de `stocks` y
  `lots` hacen su trabajo.
- **Circuito de aprobación de ajustes.** El stock **no** se mueve hasta aprobar; OPERATOR no puede
  aprobar (403); rechazo y anulación de borrador no tocan stock; re-aprobar secuencialmente da 400.
- **Correcciones de movimiento — 8/8.** Edición directa auditada, renombre de lote con cascada a
  los códigos de pallets, tope de reducción, motivo obligatorio de ≥5 caracteres.
- **Reportes — 11/11.** Stock, ocupación, rotación, dwell-time, frescura, KPIs y trazabilidad
  cuadran contra PostgreSQL.
- **Diferencias SAP — 4/4.** Carga del snapshot, cálculo de la diferencia e idempotencia por
  producto/fecha.
- **Seguridad — 6/6.** Rate limiting de login (429 al 6.º intento), inyección SQL neutralizada,
  `/seed/reset` y `stock-snapshot/revert` restringidos a ADMIN, `validateEnv()` corta el arranque
  en producción si faltan secretos.
- **Matriz de roles.** AUDITOR es efectivamente de solo lectura; MANAGER no puede crear ADMIN;
  OPERATOR no accede a `/users`.

---

## 8. Checklist antes del deploy

**Bloqueantes (obligatorios):**

- [ ] B1/B2 — validar `item.quantity <= pallet.quantity` en EXIT y ADJUSTMENT_OUT
- [ ] B3 — `lock: { mode: 'pessimistic_write' }` en `AdjustmentsService.approve()`
- [ ] B4 — rechazar (o implementar) la transferencia parcial de pallet
- [ ] B5 — mover `lot.status = 'NORMAL'` fuera del `if (lotChanged)`
- [ ] B6 — `cancel()` debe revertir `movements.voidStatus`
- [ ] B7 — impedir el borrado de ubicaciones ocupadas + restringir a ADMIN/MANAGER
- [ ] **Script de reparación** para las divergencias que estos defectos ya hayan podido generar en
      la base actual (`GET /reports/inventory-health` + el chequeo por celda de B8)

**Altos (recomendados antes de producción):**

- [ ] B8 — chequeo de salud por `(productId, locationId)`
- [ ] B9 — revalidar usuario/rol en `JwtStrategy.validate()`
- [ ] B10 — `CREATE UNIQUE INDEX` en `lots (productId, lotCode)`
- [ ] B11 — que `GET /locations` acepte `warehouseId`
- [ ] B12 — unicidad de código de ubicación por depósito
- [ ] B13 — mensaje claro en vez de 500 al borrar maestros con datos
- [ ] B14 — baja lógica de usuarios
- [ ] B15 — propagar `userId` en todos los `uploads.log()`

**Configuración de despliegue (no son fallas, revisar igual):**

- [ ] Quitar el fallback `'dev_secret_fallback'` de `jwt.strategy.ts` — hoy está cubierto por
      `validateEnv()`, pero es una red de seguridad de más
- [ ] Confirmar `DB_SYNCHRONIZE=false` y `DB_MIGRATIONS_RUN=true` en `.env.prod`
- [ ] `BOOTSTRAP_ADMIN_PASSWORD` ≥ 12 caracteres y distinto del default
- [ ] `CORS_ORIGIN` con el dominio real (vacío = refleja cualquier origen)
- [ ] Backup automático de PostgreSQL antes del primer deploy
- [ ] **Limitación conocida:** `stocks.currentQuantity`, `lots.stockActual` y `pallets.quantity`
      son `int`. Los materiales por peso (KG) **no admiten decimales** — el sistema rechaza
      correctamente `12,5 kg` (ENT-08 ✅), pero si el negocio necesita fracciones hay que migrar
      a `numeric`

---

## 9. Anexo — Detalle de los 169 casos

Leyenda de estado: ✅ PASA · ❌ FALLA

### Autenticación

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| AUTH-01 | Login con credenciales válidas (admin) | POST /auth/login {admin/admin123} | 200 + access_token + user.role=ADMIN | 201 token=true role=ADMIN | ✅ PASA | CRÍTICA |
| AUTH-02 | Login con contraseña incorrecta | POST /auth/login con password inválida | 401 Credenciales inválidas | 401 "Credenciales inválidas" | ✅ PASA | CRÍTICA |
| AUTH-03 | Login con usuario inexistente | POST /auth/login usuario inexistente | 401 con el mismo mensaje que password incorrecta (no enumerar usuarios) | 401 "Credenciales inválidas" | ✅ PASA | ALTA |
| AUTH-04 | Login con campos vacíos | POST /auth/login {"",""} | 400 validación de campos obligatorios | 400 ["username should not be empty","password should not be empty"] | ✅ PASA | MEDIA |
| AUTH-05 | Acceso a endpoint protegido sin token | GET /products sin Authorization | 401 Unauthorized | 401 | ✅ PASA | CRÍTICA |
| AUTH-06 | Acceso con token malformado | GET /products con Bearer basura | 401 Unauthorized | 401 | ✅ PASA | CRÍTICA |
| AUTH-07 | Token ADMIN forjado con el secreto de fallback del código | Firmar un JWT con "dev_secret_fallback" (hardcodeado en jwt.strategy.ts) y llamar GET /users | 401 — el secreto real no debe ser adivinable | 401 | ✅ PASA | CRÍTICA |
| AUTH-08 | GET /auth/me devuelve la identidad del token | GET /auth/me con token admin | userId, username y role | {"userId":"c85a72c1-b9b4-4afd-995d-3c911a812f83","username":"admin","role":"ADMIN"} | ✅ PASA | MEDIA |
| AUTH-09 | Refresh sin cookie de refresh token | POST /auth/refresh sin cookie | 401 Refresh token ausente | 401 "Refresh token ausente" | ✅ PASA | MEDIA |

### Usuarios y roles

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| USR-01 | Crear usuario con rol MANAGER y autenticarlo | POST /users {qa_manager, MANAGER} → POST /auth/login | Usuario creado (201) y login exitoso devolviendo ese rol | create=201 login=201 role=MANAGER | ✅ PASA | CRÍTICA |
| USR-02 | Crear usuario con rol OPERATOR y autenticarlo | POST /users {qa_operator, OPERATOR} → POST /auth/login | Usuario creado (201) y login exitoso devolviendo ese rol | create=201 login=201 role=OPERATOR | ✅ PASA | CRÍTICA |
| USR-03 | Crear usuario con rol AUDITOR y autenticarlo | POST /users {qa_auditor, AUDITOR} → POST /auth/login | Usuario creado (201) y login exitoso devolviendo ese rol | create=201 login=201 role=AUDITOR | ✅ PASA | CRÍTICA |
| USR-04 | Crear usuario con username duplicado | POST /users con username ya existente | 400 Username ya existe | 400 "Username ya existe" | ✅ PASA | ALTA |
| USR-05 | Crear usuario con contraseña de 3 caracteres | POST /users password="123" | 400 mínimo 6 caracteres | 400 ["password must be longer than or equal to 6 characters"] | ✅ PASA | ALTA |
| USR-06 | Crear usuario con rol fuera del enum | POST /users role="SUPERADMIN" | 400 rol no permitido | 400 | ✅ PASA | MEDIA |
| USR-07 | OPERATOR intenta listar usuarios (endpoint solo ADMIN) | GET /users con token OPERATOR | 403 Forbidden | 403 | ✅ PASA | ALTA |
| USR-08 | MANAGER intenta crear un usuario ADMIN (escalada de privilegios) | POST /users role=ADMIN con token MANAGER | 403 Forbidden | 403 | ✅ PASA | CRÍTICA |
| USR-09 | Desactivar usuario: ¿se corta la sesión ya emitida? | Crear usuario → login (token OK) → PATCH active=false → reusar el mismo token | 401 con el token viejo (la sesión debe cortarse al desactivar) | antes=200 después=200; re-login=401 | ❌ FALLA | ALTA |
| USR-10 | Degradar rol OPERATOR→AUDITOR con token vigente | login OPERATOR → PATCH role=AUDITOR → POST /warehouses con el token anterior | 403 (el rol nuevo debe aplicarse de inmediato) | 201 — creó el depósito igual | ❌ FALLA | ALTA |

### Seguridad

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| SEC-01 | Anti fuerza bruta: más de 5 intentos de login por minuto | POST /auth/login ×9 en menos de 60 s desde la misma IP | 429 Too Many Requests al superar el límite | códigos de la ráfaga: 429,429,429,429 | ✅ PASA | ALTA |
| SEC-02 | MANAGER intenta ejecutar el reset de la base (endpoint de seed) | POST /seed/reset con token MANAGER | 403 — solo ADMIN | 403 | ✅ PASA | CRÍTICA |
| SEC-03 | AUDITOR intenta ejecutar el reset de la base | POST /seed/reset con token AUDITOR | 403 Forbidden | 403 | ✅ PASA | CRÍTICA |
| SEC-04 | MANAGER intenta revertir el snapshot de stock inicial | POST /movements/stock-snapshot/revert con token MANAGER | 403 — solo ADMIN | 403 | ✅ PASA | ALTA |
| SEC-05 | Intento de inyección SQL en el buscador de remitos | GET /movements/documents?search=' OR 1=1; DROP TABLE stocks;-- | 200 sin efectos y tabla stocks intacta | 200 filas devueltas=0 · stocks sigue con 13 filas | ✅ PASA | CRÍTICA |
| SEC-06 | Endpoint de health sin autenticación (para el balanceador) | GET /health sin token | 200 sin exponer datos sensibles | 200 {"status":"ok","timestamp":"2026-07-31T04:21:57.341Z","uptime":71,"checks":{"database":{"status":"ok","latencyMs":0}}} | ✅ PASA | BAJA |

### Productos

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| PRD-01 | Alta de 10 materiales con distintas unidades (UN/TS/PC/KG/MIL) | POST /products ×10 con token OPERATOR | 10 productos creados | 10/10 creados  | ✅ PASA | CRÍTICA |
| PRD-02 | Alta de producto con código duplicado | POST /products code=40004808 (ya existe) | 400/409 código duplicado | 400 "Ya existe un material con ese código" | ✅ PASA | ALTA |
| PRD-03 | Alta con código y descripción vacíos | POST /products {code:"",description:""} | 400 validación | 400 | ✅ PASA | MEDIA |
| PRD-04 | Alta con stockMinimo negativo | POST /products stockMinimo=-100 | 400 validación (@Min(0)) | 400 | ✅ PASA | MEDIA |
| PRD-05 | Alta con campo no declarado en el DTO | POST /products con propiedad extra "campoInventado" | 400 (forbidNonWhitelisted) | 400 ["property campoInventado should not exist"] | ✅ PASA | MEDIA |
| PRD-06 | Editar stock mínimo y verificar persistencia | PATCH /products/:id {stockMinimo:500} → GET /products/:id | 200 y stockMinimo=500 persistido en PostgreSQL | patch=200 getStockMinimo=500 | ✅ PASA | MEDIA |
| PRD-07 | Consultar producto inexistente | GET /products/<uuid inexistente> | 404 Not Found | 404 | ✅ PASA | BAJA |
| PRD-08 | Consultar producto con id que no es UUID | GET /products/no-es-un-uuid | 400/404 controlado | 500 "Internal server error" | ❌ FALLA | MEDIA |
| PRD-09 | AUDITOR intenta crear producto (rol de solo lectura) | POST /products con token AUDITOR | 403 Forbidden | 403 | ✅ PASA | ALTA |
| PRD-10 | AUDITOR puede listar productos (lectura permitida) | GET /products con token AUDITOR | 200 con la lista | 200 items=10 | ✅ PASA | MEDIA |
| PRD-11 | OPERATOR puede eliminar productos | DELETE /products/:id con token OPERATOR | Solo ADMIN/MANAGER deberían borrar catálogo maestro | delete=200, producto luego=borrado | ❌ FALLA | MEDIA |

### Depósitos

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| DEP-01 | Alta de depósito | POST /warehouses {name, address} | 201 con id | 201 id=f3f005b0-731c-4156-a910-d5affc4aa1c0 | ✅ PASA | CRÍTICA |
| DEP-02 | Alta de segundo depósito (para movimientos entre depósitos) | POST /warehouses | 201 con id | 201 id=0a3d5844-8b5e-40ae-bf0b-18799714c3a4 | ✅ PASA | ALTA |
| DEP-03 | Alta de depósito con nombre vacío | POST /warehouses {name:""} | 400 validación de nombre obligatorio | 201 — depósito sin nombre creado | ❌ FALLA | MEDIA |
| DEP-04 | Alta de depósito con nombre duplicado | POST /warehouses con nombre ya existente | 400/409 o regla explícita de unicidad | 201 — segundo depósito homónimo creado | ❌ FALLA | BAJA |
| DEP-05 | Consultar depósito por id | GET /warehouses/:id | 200 con el nombre correcto | 200 name=DEPOSITO CENTRAL | ✅ PASA | MEDIA |
| DEP-06 | Consultar depósito inexistente | GET /warehouses/<uuid inexistente> | 404 Not Found | 404 | ✅ PASA | BAJA |

### Ubicaciones

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| UBI-01 | Generación masiva (2 pasillos × 2 racks × 3 niveles × 4 posiciones) | POST /locations/generate | 48 ubicaciones nuevas | 201 {"requested":48,"created":48,"skipped":0} | ✅ PASA | ALTA |
| UBI-02 | Re-ejecutar la generación idéntica (idempotencia) | POST /locations/generate con los mismos parámetros | 0 nuevas / 48 ya existentes — sin duplicar | 201 {"requested":48,"created":0,"skipped":48} | ✅ PASA | ALTA |
| UBI-03 | Generar zona plana de recepción (REC-P1..P6) | POST /locations/generate {zone:RECEPCION, prefix:REC, positions:6} | 6 ubicaciones | 201 {"requested":6,"created":6,"skipped":0} | ✅ PASA | MEDIA |
| UBI-04 | Generar estructura en el segundo depósito | POST /locations/generate en depósito 2 | 3 ubicaciones | 201 {"requested":3,"created":3,"skipped":0} | ✅ PASA | MEDIA |
| UBI-05 | Generar con zona fuera del enum | POST /locations/generate zone="ZONA_INVENTADA" | 400 validación | 400 | ✅ PASA | MEDIA |
| UBI-06 | Generar en depósito inexistente | POST /locations/generate con warehouseId inexistente | 404 depósito inexistente | 404 "Warehouse not found" | ✅ PASA | ALTA |
| UBI-07 | Listar ubicaciones del depósito y verificar los códigos generados | GET /locations?warehouseId= | 54 ubicaciones (48 almacenamiento + 6 recepción) | 200 total=57 muestra=REC-P6, REC-P5, REC-P4 | ❌ FALLA | ALTA |
| UBI-08 | Alta manual con código duplicado en el mismo depósito | POST /locations code=REC-P6 | 400/409 código duplicado | 201 undefined | ❌ FALLA | ALTA |
| UBI-09 | Alta manual de ubicación tipo PISO | POST /locations {code:MANUAL-01, type:PISO} | 201 con id | 201 id=d0ad83ca-54e0-4899-a6ae-6f7f91bfdac5 | ✅ PASA | MEDIA |
| UBI-10 | Alta de ubicación en depósito inexistente | POST /locations con warehouseId inexistente | 404/400 — no debe crearse una ubicación huérfana | 404 | ✅ PASA | ALTA |

### Entradas

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| ENT-01 | Entrada de 12.000 UN en 6 pallets de un lote | POST /movements/documents type=ENTRY, 6 palletItems de 2.000 con lote L1-AGO | Código RLNE-2026-000001, stock=12.000, lote=12.000, pallets=12.000 | 201 code=RLNE-2026-000001 stock=12000 lote=12000 pallet=12000 | ✅ PASA | CRÍTICA |
| ENT-02 | Segunda entrada del mismo producto con lote de vencimiento próximo | POST /movements/documents ENTRY 2×2.000 lote L1-JUN venc. +7 días | RLNE correlativo 000002 y stock acumulado 16.000 en las tres contabilidades | 201 code=RLNE-2026-000002 stock=16000 lote=16000 pallet=16000 | ✅ PASA | CRÍTICA |
| ENT-03 | Entrada multi-lote en una sola línea (M1 3.000 + M2 5.000) | POST /movements/documents con 2 palletItems de lotes distintos | Dos lotes con 3.000 y 5.000; stock total 8.000 | 201 lotes=[{"lotCode":"M1","stockActual":3000},{"lotCode":"M2","stockActual":5000}] stock=8000 | ✅ PASA | ALTA |
| ENT-04 | Remito multi-producto (2 líneas, 2 materiales) | POST /movements/documents con 2 lines de productos distintos | Un solo RLNE con 2 movimientos; stock 8.000 y 40 | 201 code=RLNE-2026-000004 movs=2 P3=8000 P4=40 | ✅ PASA | ALTA |
| ENT-05 | Entrada provisoria (pendiente de regularización) | POST /movements/documents isProvisional=true + observación obligatoria | Movimiento y lote en PENDING_REGULARIZATION | 201 lote=PENDING_REGULARIZATION movimiento=PENDING_REGULARIZATION | ✅ PASA | ALTA |
| ENT-06 | Entrada provisoria sin observación | POST ENTRY isProvisional=true sin notes | 400 — la observación es obligatoria en provisorias | 400 "Las entradas provisorias requieren una observación obligatoria" | ✅ PASA | MEDIA |
| ENT-07 | Entrada de material en KG | POST ENTRY 500 KG lote T6 | Stock 500 KG consistente | 201 stock=500 | ✅ PASA | MEDIA |
| ENT-08 | Entrada de cantidad decimal en material KG (12,5 kg) | POST ENTRY quantity=12.5 en producto con unidad KG | Aceptar decimales o rechazar con mensaje claro — nunca truncar en silencio | 400 ["lines.0.palletItems.0.quantity must be an integer number"] | ✅ PASA | MEDIA |
| ENT-09 | Dos pallets del mismo lote en una entrada (codificación automática) | POST ENTRY con 2 palletItems del lote HM8 | Pallets HM8-P1 y HM8-P2 con 600 cada uno | 201 [{"code":"HM8-P1","quantity":600},{"code":"HM8-P2","quantity":600}] | ✅ PASA | ALTA |
| ENT-10 | Entrada de cantidad mínima (1 unidad) | POST ENTRY quantity=1 | 201 y stock=1 | 201 stock=1 | ✅ PASA | MEDIA |
| ENT-11 | Entrada con cantidad 0 | POST ENTRY palletItems quantity=0 | 400 la cantidad debe ser mayor a cero | 400 | ✅ PASA | ALTA |
| ENT-12 | Entrada con cantidad negativa | POST ENTRY quantity=-500 | 400 validación | 400 | ✅ PASA | ALTA |
| ENT-13 | Entrada con producto inexistente | POST ENTRY productId inexistente | 404 Material inexistente | 404 | ✅ PASA | ALTA |
| ENT-14 | Entrada con ubicación inexistente | POST ENTRY locationId inexistente | 404 ubicación inexistente | 404 | ✅ PASA | ALTA |
| ENT-15 | Entrada con ubicación que pertenece a otro depósito | POST ENTRY warehouseId=DEP1 + locationId de DEP2 | 400 la ubicación no pertenece al depósito indicado | 400 "La ubicación no pertenece al depósito indicado" | ✅ PASA | ALTA |
| ENT-16 | Remito de entrada sin líneas | POST /movements/documents lines=[] | 400 ArrayMinSize | 400 | ✅ PASA | MEDIA |
| ENT-17 | Entrada de pallet sin lotCode ni palletId | POST ENTRY palletItem sin lotCode | 400 — cada ítem debe indicar lote o pallet | 400 "Cada ítem debe indicar un pallet existente (palletId) o un código de lote (lotCode)." | ✅ PASA | ALTA |
| ENT-18 | Atomicidad: remito con una línea válida y otra inválida | POST ENTRY con línea 1 correcta (500) y línea 2 con cantidad 0 | 400 y rollback total: ni stock ni lote de la línea 1 | 400 stock antes=16000 después=16000 lote ATOMIC-OK creado=0 | ✅ PASA | CRÍTICA |

### Lotes

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| LOT-01 | Reingreso del mismo lote en minúsculas (normalización) | POST ENTRY lotCode='l1-ago' cuando ya existe 'L1-AGO' | Un único lote L1-AGO con 13.000 — sin duplicar por mayúsculas | 201 lotes=[{"lotCode":"L1-AGO","stockActual":13000}] | ✅ PASA | ALTA |
| LOT-02 | Alta manual de un lote ya existente para el mismo producto | POST /lots lotCode='R3' (creado por la entrada E4) | 400 ya existe el lote para este producto | 400 "Ya existe el lote \"R3\" para este producto" | ✅ PASA | ALTA |
| LOT-03 | No existen lotes duplicados (productId, lotCode) en la base | SELECT ... GROUP BY productId, lotCode HAVING count(*)>1 | 0 filas duplicadas | 0 grupos duplicados [] | ✅ PASA | ALTA |
| LOT-04 | Restricción única en base de datos para (productId, lotCode) | Revisar pg_indexes sobre la tabla lots | Índice UNIQUE que impida duplicados ante carreras o cargas masivas | No hay ningún índice único en lots | ❌ FALLA | ALTA |
| LOT-05 | Consulta FEFO ordena por vencimiento más próximo | GET /lots/fefo?productId= | Primero L1-JUN (vence en 7 días), después L1-AGO | 200 orden=L1-JUN → L1-AGO | ✅ PASA | ALTA |

### Pallets

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| PAL-01 | Listar pallets de un lote | GET /pallets?lotId= | 7 pallets (6 de E1 + 1 del reingreso LOT-01) | 200 total=7 | ✅ PASA | MEDIA |
| PAL-02 | No hay pallets huérfanos (sin lote) | LEFT JOIN pallets → lots | 0 pallets sin lote | 0 | ✅ PASA | ALTA |
| PAL-03 | No hay pallets activos sin ubicación asignada | SELECT pallets WHERE currentLocationId IS NULL AND status<>'EXITED' | 0 pallets "fantasma" | 0 | ✅ PASA | ALTA |

### Stock

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| STK-01 | Stock por celda coincide con la suma de pallets de esa celda | Comparar stocks.currentQuantity vs SUM(pallets.quantity) por ubicación | Coincidencia exacta en todas las celdas | [{"locationId":"9ea8d15d-39b7-42c8-9f15-648e78026071","currentQuantity":13000,"pallets":13000},{"locationId":"cb05a958-b386-445e-99e7-17817d392013","currentQuantity":4000,"pallets":4000}] | ✅ PASA | CRÍTICA |
| STK-02 | Invariante Stock = Lote = Pallet tras todas las entradas | GET /reports/inventory-health | ok:true sin divergencias | 200 ok=true divergencias=0 | ✅ PASA | CRÍTICA |
| STK-03 | Ninguna celda de stock quedó negativa | SELECT stocks WHERE currentQuantity < 0 | 0 filas | 0 | ✅ PASA | CRÍTICA |
| CON-04 | Ninguna celda quedó con stock negativo tras salidas y concurrencia | SELECT stocks WHERE currentQuantity < 0 | 0 filas | 0 filas [] | ✅ PASA | CRÍTICA |
| STK-04 | El chequeo de salud detecta divergencias a nivel ubicación | Comparar GET /reports/inventory-health con la verificación stock-vs-pallets por celda | Toda celda descuadrada aparece reportada | inventory-health reporta 2 producto(s) [40004808, 50112233]; por celda hay 4 descuadre(s): ["40009912:stock 5000 vs pallets 0","40009912:stock 4000 vs pallets 9000","50112233:stock 400 vs pallets 800","40004808:stock 8000 vs pallets 13000"] | ❌ FALLA | ALTA |

### Salidas

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| SAL-01 | Salida automática FEFO: consume primero el lote que vence antes | POST /movements/documents EXIT 3.000 sin indicar lote (L1-JUN vence en 7 d, L1-AGO en 200 d) | L1-JUN baja de 4.000 a 1.000; L1-AGO permanece en 13.000 | 201 code=RLNS-2026-000001 L1-JUN=1000 L1-AGO=13000 | ✅ PASA | CRÍTICA |
| SAL-02 | Salida que agota un lote y continúa en el siguiente (parcial) | POST EXIT 1.500 cuando L1-JUN tiene 1.000 | L1-JUN=0 (pallets EXITED), L1-AGO=12.500 con un pallet PARTIAL | L1-JUN=0 L1-AGO=12500 pallets JUN=[{"code":"L1-JUN-P1","quantity":0,"status":"EXITED"},{"code":"L1-JUN-P2","quantity":0,"status":"EXITED"}] | ✅ PASA | CRÍTICA |
| SAL-03 | Integridad Stock=Lote=Pallet después de dos salidas FEFO | Comparar sumas por producto tras SAL-01 y SAL-02 | 17.000 − 4.500 = 12.500 en las tres contabilidades | inicial=17000 stock=12500 lote=12500 pallet=12500 | ✅ PASA | CRÍTICA |
| SAL-04 | FEFO entre dos lotes del mismo producto (M1 vence antes que M2) | POST EXIT 4.000 con M1=3.000 (venc. +30 d) y M2=5.000 (venc. +120 d) | M1=0 y M2=4.000 | 201 M1=0 M2=4000 | ✅ PASA | CRÍTICA |
| SAL-05 | Salida multi-producto en un solo remito | POST EXIT con 2 líneas | Un RLNS con 2 movimientos; stocks 6.000 y 30 | 201 code=RLNS-2026-000004 movs=2 P3=6000 P4=30 | ✅ PASA | ALTA |
| SAL-06 | Salida que agota todo el stock de un producto | POST EXIT 1.000 (todo el stock de PR9) | Pallet en estado EXITED y stock 0 | 201 pallets=[{"code":"PR9-P1","quantity":0,"status":"EXITED"}] stock=0 | ✅ PASA | ALTA |
| SAL-07 | Sobreventa: despachar 5 cuando hay 1 en stock | POST EXIT quantity=5 con stock=1 | 400 stock insuficiente y stock intacto (nunca negativo) | 400 "Stock insuficiente: se pueden despachar 1 de 5 unidades solicitadas" · stock antes=1 después=1 | ✅ PASA | CRÍTICA |
| SAL-08 | Despachar un lote provisorio (pendiente de regularización) | POST EXIT del producto cuyo único lote es PROV-01 en PENDING_REGULARIZATION | 400 — hay que regularizar el lote antes de despachar | 400 "Stock insuficiente: se pueden despachar 0 de 1000 unidades solicitadas" · stock=6000 | ✅ PASA | ALTA |
| SAL-09 | Salida con cantidad 0 | POST EXIT quantity=0 | 400 validación | 400 | ✅ PASA | ALTA |
| SAL-10 | Salida sin cantidad ni pallets | POST EXIT línea sin quantity ni palletItems | 400 la cantidad debe ser mayor a cero | 400 "La cantidad debe ser mayor a cero" | ✅ PASA | MEDIA |
| SAL-11 | Despachar de un pallet más cantidad de la que contiene | POST EXIT palletItems=[{palletId: L1-AGO-P1, quantity: 7000}] cuando el pallet tiene 2000 | 400 — no se puede sacar de un pallet más de lo que tiene | 201 · pallet quedó en 0 (EXITED) · stock 12500→5500, lote 12500→5500, pallet 12500→10500 | ❌ FALLA | CRÍTICA |
| SAL-12 | Invariante Stock=Lote=Pallet después de la salida sobre-dimensionada | GET /reports/inventory-health | ok:true | 200 ok=false · [{"productId":"d2833af7-922f-45b5-a979-d5e613ebbee3","productCode":"40004808","productDescription":"ROLHA MET BRAHMA 940CC","stockSum":5500,"lotSum":5500,"palletSum":10500,"stockVsLot":0,"lotVsPallet":-5000}] | ❌ FALLA | CRÍTICA |
| SAL-13 | Despachar un pallet que pertenece a otro producto | POST EXIT productId=P1 con palletId de un pallet del producto P7 | 400 — el pallet no corresponde al material de la línea | 400 "Stock insuficiente para completar la operación" | ✅ PASA | ALTA |
| SAL-14 | Invariante tras despachar un pallet de otro producto | GET /reports/inventory-health | ok:true | ok=false · [{"productId":"d2833af7-922f-45b5-a979-d5e613ebbee3","productCode":"40004808","productDescription":"ROLHA MET BRAHMA 940CC","stockSum":5500,"lotSum":5500,"palletSum":10500,"stockVsLot":0,"lotVsPallet":-5000}] | ❌ FALLA | CRÍTICA |

### Transferencias

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| TRF-01 | Transferir un pallet completo entre ubicaciones | POST /movements/transfer-batch con el pallet CH7-P1 completo | El pallet cambia de ubicación y el stock se mueve de celda (origen 0, destino 9.000) | 201 ubicación destino=true origen=0 destino=9000 | ✅ PASA | CRÍTICA |
| TRF-02 | Transferencia con origen igual al destino | POST /movements/transfer-batch fromLocationId = toLocationId | 400 origen y destino no pueden ser la misma ubicación | 400 | ✅ PASA | MEDIA |
| TRF-03 | Transferencia parcial de un pallet (mover 4.000 de 9.000) | POST /movements/transfer-batch quantity=4.000 sobre un pallet de 9.000 | Rechazo, o bien división real del pallet en dos con stock coherente por celda | 201 · celdas con stock=[{"locationId":"830ae890-7009-4ce6-95ad-8d8ae9caa247","currentQuantity":5000},{"locationId":"cd2de294-7768-43be-8d25-9da79a1bcd70","currentQuantity":4000}] · pallet quedó con 9000 en destino | ❌ FALLA | ALTA |
| TRF-04 | Coherencia stock-por-celda vs pallets-por-celda tras transferencia parcial | Comparar stocks.currentQuantity con SUM(pallets.quantity) por ubicación | Cada celda con stock respaldada por pallets de esa misma celda | inventory-health ok=false · por celda: [{"locationId":"830ae890-7009-4ce6-95ad-8d8ae9caa247","currentQuantity":5000,"pal":0},{"locationId":"cd2de294-7768-43be-8d25-9da79a1bcd70","currentQuantity":4000,"pal":9000}] | ❌ FALLA | CRÍTICA |

### Concurrencia

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| CON-01 | Dos salidas simultáneas de 4.000 con 6.000 en stock | Promise.all de dos POST EXIT del mismo producto | Una prospera y la otra falla; stock final 2.000 y nunca negativo | A=201 B=400 · stock 6000→2000 (lote=2000, pallet=2000) | ✅ PASA | CRÍTICA |
| CON-02 | Dos entradas simultáneas creando el mismo código de lote | Promise.all de dos POST ENTRY con lotCode RACE-LOT inexistente | Un único lote con 200 (o una de las dos falla) — nunca dos filas del mismo lote | E1=201 E2=201 · lotes creados=1 [200] | ✅ PASA | ALTA |
| CON-03 | Invariante global tras las pruebas de concurrencia | GET /reports/inventory-health | ok:true | ok=false · [{"productId":"d2833af7-922f-45b5-a979-d5e613ebbee3","productCode":"40004808","productDescription":"ROLHA MET BRAHMA 940CC","stockSum":5500,"lotSum":5500,"palletSum":10500,"stockVsLot":0,"lotVsPallet":-5000}] | ❌ FALLA | CRÍTICA |

### Ajustes de inventario

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| AJU-01 | Crear ajuste de entrada en borrador (no debe mover stock) | POST /adjustments type=ADJUSTMENT_IN +200 | 201 con código RLAI y stock sin cambios (2000) | 201 code=RLAI-2026-000001 stock=2000 | ✅ PASA | ALTA |
| AJU-02 | Aprobar un ajuste que sigue en BORRADOR | PATCH /adjustments/:id/approve sin haberlo enviado a aprobación | 400 — solo se aprueban solicitudes PENDIENTE_APROBACION | 400 "Solo se pueden aprobar solicitudes en estado PENDIENTE_APROBACION." | ✅ PASA | ALTA |
| AJU-03 | OPERATOR intenta aprobar su propio ajuste | PATCH /adjustments/:id/approve con token OPERATOR | 403 — la aprobación es de ADMIN/MANAGER | 403 | ✅ PASA | CRÍTICA |
| AJU-04 | MANAGER aprueba el ajuste: recién ahí se mueve el stock | PATCH /adjustments/:id/approve con token MANAGER | 200 y stock 2000 → 2200 en las tres contabilidades | 200 stock=2200 lote=2200 pallet=2200 | ✅ PASA | CRÍTICA |
| AJU-05 | Re-aprobar un ajuste ya aprobado | PATCH /approve dos veces sobre la misma solicitud | 400 y stock sin doble impacto | 400 stock=2200 | ✅ PASA | CRÍTICA |
| AJU-06 | Dos aprobaciones simultáneas de la misma solicitud | Promise.all de PATCH /approve con MANAGER y ADMIN sobre la misma solicitud (+500) | Una aprueba y la otra falla; stock sube 500 una sola vez | A=200 B=200 · stock 2200→3200 (esperado 2700) · movimientos generados=2 | ❌ FALLA | CRÍTICA |
| AJU-07 | Rechazar una solicitud enviada a aprobación | PATCH /adjustments/:id/reject con motivo | Vuelve a BORRADOR y el stock queda intacto | 200 estado=BORRADOR stock 1400→1400 | ✅ PASA | ALTA |
| AJU-08 | Anular un borrador de ajuste | PATCH /adjustments/:id/cancel | Queda RECHAZADO y nunca tocó stock | 200 estado=RECHAZADO stock=1400 | ✅ PASA | MEDIA |
| AJU-09 | Crear ajuste sin líneas | POST /adjustments lines=[] | 400 ArrayMinSize | 400 | ✅ PASA | MEDIA |
| AJU-10 | Ajuste de entrada sin depósito | POST /adjustments ADJUSTMENT_IN sin warehouseId | 400 — sin depósito el pallet quedaría sin ubicación (stock fantasma) | 400 | ✅ PASA | ALTA |
| AJU-11 | Ajuste de salida por encima del saldo del pallet | ADJUSTMENT_OUT de 1000 sobre un pallet con 600 | Rechazo al aprobar; stock, lote y pallet siguen coherentes | aprobación=200 · stock 1400→400, lote 1400→400, pallet 1400→800 | ❌ FALLA | CRÍTICA |

### Correcciones

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| COR-01 | Editar metadatos de una entrada ya posteada (aplicación directa + auditoría) | PATCH /movements/:id/edit con motivo, documentNumber y carrier nuevos | Cambios aplicados y registrados en regularization_logs con el motivo | 200 doc=001-001-0009999 carrier=TRANSPORTES SRL logs=2 | ✅ PASA | ALTA |
| COR-02 | Editar con motivo de menos de 5 caracteres | PATCH /movements/:id/edit reason="abc" | 400 el motivo debe tener al menos 5 caracteres | 400 | ✅ PASA | MEDIA |
| COR-03 | Renombrar el código de lote con cascada a los pallets | POST /movements/:id/request-quantity-edit newLotCode=L1-AGOSTO | Lote renombrado y pallets L1-AGOSTO-Pn | 201 lote=L1-AGOSTO pallets=L1-AGOSTO-P1, L1-AGOSTO-P2, L1-AGOSTO-P3 | ✅ PASA | ALTA |
| COR-04 | Reducir la cantidad de un pallet de una entrada | POST request-quantity-edit newQuantity=1000 sobre pallet L1-AGOSTO-P2 | Genera RLAO pendiente de aprobación; el stock NO cambia todavía | 201 solicitud=RLAO-2026-000003 tipo=ADJUSTMENT_OUT · stock 5500→5500 | ✅ PASA | CRÍTICA |
| COR-05 | Aprobar el RLAO de la corrección: recién ahí baja el stock | PATCH /adjustments/:id/approve del RLAO generado | stock 5500 → 5000 y el pallet queda en 1000 | 200 stock=5000 lote=5000 pallet=10000 · pallet=1000 (PARTIAL) | ✅ PASA | CRÍTICA |
| COR-06 | Agregar 3.000 unidades en 2 pallets nuevos y aprobar | POST request-quantity-edit addQuantity=3000 addPalletCount=2 → aprobar el RLAI | Pendiente sin impacto; al aprobar, +3.000 en stock, lote y pallets, con 2 pallets nuevos | solicitud=ADJUSTMENT_IN stockPendiente=5000 · aprobación=200 stock=8000 lote=8000 pallet=13000 · pallets del lote=9 | ✅ PASA | CRÍTICA |
| COR-07 | En una entrada, subir la cantidad de un pallet por encima de su saldo | request-quantity-edit newQuantity mayor al saldo del pallet | 400 — en entradas solo se puede reducir | 400 "El pallet L1-AGOSTO-P2 tiene 1000 unid. — solo se puede reducir. Para sumar unidades usá \"Agregar pallets nuevos\" del lote." | ✅ PASA | ALTA |
| COR-08 | Corregir un lote que no pertenece al movimiento | request-quantity-edit con lotId de otro movimiento | 400 el lote no pertenece a este movimiento | 400 "El lote M1 no pertenece a este movimiento." | ✅ PASA | ALTA |

### Anulaciones

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| ANU-01 | Solicitar anulación de una entrada (genera compensación pendiente) | POST /movements/:id/void | Movimiento en VOID_PENDING, RLAO pendiente, stock sin cambios | 201 code=RLAO-2026-000004 voidStatus=VOID_PENDING stock 0→0 | ✅ PASA | ALTA |
| ANU-02 | Solicitar anulación dos veces del mismo movimiento | POST /movements/:id/void repetido | 400 ya tiene una anulación pendiente | 400 "Este movimiento ya tiene una solicitud de anulación pendiente de aprobación." | ✅ PASA | ALTA |
| ANU-03 | Aprobar la anulación: el movimiento queda VOIDED y el stock se corrige | PATCH /adjustments/:id/approve del RLAO de anulación | voidStatus=VOIDED (el stock del producto ya estaba en 0 por la salida previa) | 400 voidStatus=VOID_PENDING stock=0 lote=0 pallet=0 | ❌ FALLA | CRÍTICA |
| ANU-04 | Intentar anular una transferencia | POST /movements/:id/void sobre un TRANSFER | 400 — las transferencias no se anulan automáticamente | 400 "Las transferencias no pueden anularse automáticamente. Usá el Ajuste de Inventario." | ✅ PASA | MEDIA |
| ANU-05 | Anulación que no puede aprobarse (stock ya despachado): ¿se puede revertir? | Anular la solicitud compensatoria → PATCH /adjustments/:id/cancel → reintentar POST /movements/:id/void | El movimiento vuelve a voidStatus=NONE y puede volver a operarse | cancel=200 voidStatus=VOID_PENDING reintento=400 "Este movimiento ya tiene una solicitud de anulación pendiente de aprobación." | ❌ FALLA | ALTA |

### Regularización

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| REG-01 | OPERATOR intenta regularizar una entrada provisoria | PATCH /movements/:id/regularize con token OPERATOR | 403 — regularizar es de ADMIN/MANAGER | 403 | ✅ PASA | MEDIA |
| REG-02 | MANAGER regulariza la entrada provisoria | PATCH /movements/:id/regularize con datos definitivos | Movimiento NORMAL y lote fuera de PENDING_REGULARIZATION | 200 movimiento=NORMAL doc=REM-DEFINITIVO-001 lote=PENDING_REGULARIZATION | ❌ FALLA | ALTA |
| REG-03 | Despachar el lote una vez regularizado | POST EXIT 1.000 del lote antes bloqueado | 201 y stock 6.000 → 5.000 | 400 stock=6000 | ❌ FALLA | ALTA |
| REG-04 | Regularizar cambiando un dato del lote (proveedor) | PATCH /movements/:id/regularize con proveedor nuevo | Lote pasa a NORMAL y queda despachable | 400 lote=PENDING_REGULARIZATION proveedor=null | ❌ FALLA | ALTA |
| REG-05 | Re-regularizar un movimiento que ya está NORMAL | PATCH /movements/:id/regularize sobre un movimiento ya regularizado | 400 el movimiento no está pendiente de regularización | 400 "El movimiento no está pendiente de regularización" | ✅ PASA | MEDIA |
| REG-06 | Stock de una entrada provisoria ya regularizada: ¿se puede despachar? | POST EXIT 500 del producto cuyo movimiento provisorio ya está en NORMAL | 201 — el stock regularizado debe ser despachable | 400 "Stock insuficiente: se pueden despachar 0 de 500 unidades solicitadas" · stock=6000 | ❌ FALLA | CRÍTICA |
| REG-07 | Desbloquear el lote manualmente vía PATCH /lots/:id | PATCH /lots/:id {status:"NORMAL"} | Alguna vía soportada para liberar un lote atascado | 400 ["property status should not exist"] | ❌ FALLA | ALTA |

### Reportes

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| REP-01 | Reporte de stock coincide con la tabla stocks | GET /reports/stock vs SUM(stocks.currentQuantity) | Totales iguales | 200 totalQuantity(api)=31131 SUM(stocks)=31131 | ✅ PASA | ALTA |
| REP-02 | Reporte de movimientos accesible por AUDITOR | GET /reports/movements con token AUDITOR | 200 con los movimientos registrados | 200 filas=30 (movimientos en base=30) | ✅ PASA | MEDIA |
| REP-03 | Trazabilidad por material | GET /reports/trace?materialId= | 200 con el historial del material | 200 claves=material,history | ✅ PASA | MEDIA |
| REP-04 | Trazabilidad sin materialId | GET /reports/trace sin parámetros | 400 parámetro obligatorio (no 500) | 400 ["materialId must be a UUID"] | ✅ PASA | BAJA |
| REP-05 | KPIs del tablero | GET /reports/kpis | 200 con métricas | 200 {"range":"today","totalMaterials":10,"totalQuantity":31131,"movementsCount":28,"movementsInRange":28,"movementsPrev":0,"movementsDelta":100,"pendingRegularizations":0,"expiringLots":1,"expiringCritica | ✅ PASA | MEDIA |
| REP-06 | Ocupación por depósito coincide con los pallets almacenados | GET /reports/occupancy vs COUNT(pallets activos) | Mismo número de pallets | 200 api=23 db=23 · [{"warehouseId":"9f9d3980-9ea2-4d05-ad34-1375cadb3040","warehouseName":"","totalLocations":0,"capacityPallets":0,"occupiedLocations":0,"palletsStored":0,"freeLocations":0,"locationOccupancyPct":0,"capacityOccupancyPct":n | ✅ PASA | MEDIA |
| REP-07 | Rotación de inventario (top movers / stock estancado) | GET /reports/rotation | 200 con datos de rotación | 200 claves=from,to,topMovers,deadStock,totals | ✅ PASA | BAJA |
| REP-08 | Dwell-time (antigüedad de pallets, base de facturación) | GET /reports/dwell-time | 200 con buckets de antigüedad | 200 {"summary":{"totalPallets":23,"avgAgeDays":0,"totalPalletDays":0,"buckets":{"d0_7":23,"d8_30":0,"d31_90":0,"d90plus":0}},"oldest":[{"id":"c678681d-4e01-4679-ac59-327961cf9577","code":"L1-AGOSTO-P5","q | ✅ PASA | BAJA |
| REP-09 | Frescura / vencimientos próximos | GET /reports/freshness | 200; el lote que vence en 7 días debe aparecer marcado | 200 [{"lotId":"b5bb5937-9b5c-4b9d-8f06-668541c38d35","lotCode":"HM8","sapLot":null,"fechaVencimiento":"2026-09-29T03:00:00.000Z","fechaFabricacion":null,"stockActual":200,"proveedor":null,"diasRestantes":60,"product":{"id":" | ✅ PASA | MEDIA |
| REP-10 | Stock diario | GET /reports/daily-stock?date=hoy | 200 | 200 | ✅ PASA | BAJA |
| REP-11 | OPERATOR intenta ver ocupación (endpoint ADMIN/MANAGER/AUDITOR) | GET /reports/occupancy con token OPERATOR | 403 Forbidden | 403 | ✅ PASA | BAJA |

### Diferencias de inventario

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| DIF-01 | Cargar snapshot de stock SAP del día | POST /reports/sap-stock con la cantidad de SAP | 200/201 guardado | 201 {"date":"2026-07-31","productId":"d2833af7-922f-45b5-a979-d5e613ebbee3","warehouseId":null,"locationId":null,"sapQuantity":7250,"id":"9ed9b149-dc91-43 | ✅ PASA | ALTA |
| DIF-02 | Comparativo WMS vs SAP muestra la diferencia exacta | GET /reports/differences-sap?date=hoy | Diferencia de +750 para el material 40004808 (WMS 8000 vs SAP 7250) | 200 {"date":"2026-07-31","material":{"id":"d2833af7-922f-45b5-a979-d5e613ebbee3","code":"40004808","description":"ROLHA MET BRAHMA 940CC","unitOfMeasure":"UN"},"stockInicial":16000,"entradas":4000,"salidas":12000,"stockFinal":8000,"stockSAP":7250,"diferencia":750} | ✅ PASA | ALTA |
| DIF-03 | Re-cargar el snapshot SAP del mismo día (idempotencia) | POST /reports/sap-stock dos veces para la misma fecha y producto | Una sola fila por producto/fecha, con la diferencia recalculada en 0 | 201 filas para el producto=1 · diferencia=0 · snapshots en base=1 | ✅ PASA | ALTA |
| DIF-04 | OPERATOR intenta ver diferencias SAP | GET /reports/differences-sap con token OPERATOR | 403 Forbidden | 403 | ✅ PASA | BAJA |

### Auditoría

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| AUD-01 | Bitácora global de eventos | GET /attachments/events | Eventos de creación de remitos, ajustes y anulaciones | 200 eventos=39 (base=39) tipos=ANULACION_SOLICITADA, APROBADO, ENVIADO_APROBACION, EDITADO, CREADO, RECHAZADO | ✅ PASA | ALTA |
| AUD-02 | Las aprobaciones de ajuste quedan registradas | SELECT document_events WHERE entityType='ADJUSTMENT' AND eventType='APROBADO' | Al menos un evento de aprobación | 6 eventos | ✅ PASA | ALTA |
| AUD-03 | Todo evento de bitácora tiene usuario responsable | SELECT document_events WHERE userId IS NULL | 0 eventos sin autor (trazabilidad completa) | 28 de 39 eventos sin userId | ❌ FALLA | ALTA |
| AUD-04 | Toda corrección tiene motivo registrado | SELECT regularization_logs WHERE reason vacío | 0 correcciones sin motivo | 0 de 5 sin motivo | ✅ PASA | ALTA |
| AUD-05 | Todo movimiento tiene usuario creador | SELECT movements WHERE createdById IS NULL | 0 movimientos anónimos | 0 | ✅ PASA | ALTA |
| AUD-06 | Historial completo de una entidad (eventos + adjuntos) | GET /attachments/log?entityType=MOVEMENT&entityId= | 200 con el historial | 200 {"events":[],"attachments":[]} | ✅ PASA | MEDIA |
| AUD-07 | Historial de un pallet | GET /pallets/:id/history | 200 con los movimientos del pallet | 200 {"pallet":{"id":"71bcbd35-f927-49e9-8c39-103299fc1d43","code":"PROV-01-P1","lotId":"a0be9e95-b2c5-4722-ac46-d7412ff9c19c | ✅ PASA | MEDIA |
| AUD-08 | OPERATOR intenta ver el historial de un pallet | GET /pallets/:id/history con token OPERATOR | 403 (endpoint declarado ADMIN/MANAGER/AUDITOR) | 403 | ✅ PASA | BAJA |

### Transportes

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| TRA-01 | Alta de vehículo | POST /transports | 201 con id y estado DISPONIBLE | 201 id=4e8ec101-c419-4b47-878d-475de9294a8a status=DISPONIBLE | ✅ PASA | MEDIA |
| TRA-02 | Alta de vehículo con patente duplicada | POST /transports con la misma patente | 400/409 patente duplicada | 201 | ❌ FALLA | MEDIA |
| TRA-03 | Registrar inspección del vehículo | POST /transports/:id/inspection | 200/201 con evento en la bitácora | 201 {"id":"4e8ec101-c419-4b47-878d-475de9294a8a","plate":"BKH180","type":"Scania R450","description":"Ambev","status":"DISPO | ✅ PASA | BAJA |
| TRA-04 | Historial de viajes del vehículo (remitos vinculados por patente) | GET /transports/:id/history | 200 incluyendo el remito de entrada cargado con BKH180 | 200 {"transport":{"id":"4e8ec101-c419-4b47-878d-475de9294a8a","plate":"BKH180","type":"Scania R450","description":"Ambev","status":"DISPONIBLE","capacityPallets":28,"capacityKg":28000,"notes":null,"active | ✅ PASA | BAJA |

### Integridad referencial

| # | Caso | Pasos | Resultado esperado | Resultado obtenido | Estado | Criticidad |
|---|------|-------|--------------------|--------------------|--------|------------|
| INT-01 | Eliminar una ubicación que tiene pallets y stock | DELETE /locations/A-F2-N1-P1 (con 1 pallets y 500 unidades) | 400/409 — no se puede borrar una ubicación ocupada | 200 · ubicación existe=false · pallets huérfanos=1 · stock huérfano=500 unid. | ❌ FALLA | CRÍTICA |
| INT-02 | Estado del inventario tras borrar la ubicación | GET /reports/inventory-health y GET /warehouses/:id/layout | El mapa del depósito y la salud del inventario siguen siendo consistentes | inventory-health=200 ok=false divergentes=2 · layout=200 | ✅ PASA | ALTA |
| INT-03 | Eliminar un material que tiene stock, lotes y movimientos | DELETE /products/40004808 (con 8000 unidades en stock) | 400/409 con mensaje claro (o baja lógica), nunca un 500 | 500 "Internal server error" · producto existe=true | ❌ FALLA | ALTA |
| INT-04 | Eliminar un depósito con ubicaciones y stock | DELETE /warehouses/:id del depósito principal | 400/409 con mensaje claro, nunca un 500 | 500 "Internal server error" · depósito existe=true | ❌ FALLA | ALTA |
| INT-05 | Eliminar un usuario que registró movimientos | DELETE /users/:id del operador que creó 24 movimientos | Baja lógica (active=false) — el borrado físico rompe la trazabilidad de quién hizo cada movimiento | 200 · usuario existe=false · movimientos sin autor válido=24 | ❌ FALLA | ALTA |
| INT-06 | Eliminar un pallet que todavía tiene unidades | DELETE /pallets/PROV-01-P1 (con 2000 unidades) | Rechazo explícito (405) — los pallets no deben borrarse, se preserva la trazabilidad | 405 · pallet existe=true · lote 6000→6000 | ✅ PASA | ALTA |
| INT-07 | Salud del inventario tras la batería de borrados | GET /reports/inventory-health | Sin divergencias nuevas atribuibles a los borrados | ok=false divergentes=2 · ["40004808: stock 8000 / lote 8000 / pallet 13000","50112233: stock 400 / lote 400 / pallet 800"] | ✅ PASA | ALTA |
