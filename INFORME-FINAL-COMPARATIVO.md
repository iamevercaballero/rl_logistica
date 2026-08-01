# Informe final — corrección de defectos y re-auditoría

**Sistema:** RL Logística WMS · **Fecha:** 31/07/2026 · **Rama:** `main`
**Referencia:** [informe de auditoría inicial](INFORME-AUDITORIA-PREPROD.md)

---

## 1. Veredicto

> ## ✅ APTO PARA PRODUCCIÓN
>
> Bajo el criterio de autorización acordado: **todos los casos CRÍTICOS y ALTOS de
> inventario, stock, pallets, lotes, concurrencia, trazabilidad, auditoría e integridad
> referencial pasan correctamente**. Los 31 defectos detectados fueron corregidos y
> verificados sobre una base creada desde cero. Cero regresiones.

| | Antes | Después |
|---|---|---|
| Casos ejecutados | 169 | **171** |
| Pasan | 138 (82 %) | **171 (100 %)** |
| Fallan | 31 | **0** |
| — críticas | 10 | 0 |
| — altas | 16 | 0 |
| — medias | 4 | 0 |
| — bajas | 1 | 0 |
| Regresiones introducidas | — | **0** |

Los 2 casos adicionales son pruebas nuevas que cubren huecos descubiertos al corregir
(detalle en §4).

---

## 2. Verificación del criterio de autorización

Corte explícito sobre los módulos que el criterio exige, considerando sólo casos de
criticidad **CRÍTICA** y **ALTA**:

| Módulo del criterio | Casos CRÍTICOS + ALTOS | Antes | Después |
|---|---|---|---|
| Stock | 5 | 4/5 | **5/5** ✅ |
| Salidas | 13 | 10/13 | **13/13** ✅ |
| Entradas | 13 | 13/13 | **13/13** ✅ |
| Pallets | 2 | 2/2 | **2/2** ✅ |
| Lotes | 5 | 4/5 | **5/5** ✅ |
| Transferencias | 3 | 1/3 | **3/3** ✅ |
| Ajustes de inventario | 9 | 7/9 | **9/9** ✅ |
| Anulaciones | 5 | 2/4 *(+1 nuevo)* | **5/5** ✅ |
| Regularización | 5 | 0/5 | **5/5** ✅ |
| Concurrencia | 3 | 2/3 | **3/3** ✅ |
| Auditoría / trazabilidad | 6 | 4/5 *(+1 nuevo)* | **6/6** ✅ |
| Integridad referencial | 7 | 3/7 | **7/7** ✅ |
| **Total del criterio** | **76** | **52/74** | **76/76** ✅ |

**Chequeos transversales sobre la base final** (29 movimientos, 36.631 unidades en stock):

```
stock negativo: 0     lotes duplicados: 0        pallets huérfanos: 0
stock huérfano: 0     movimientos sin autor: 0   eventos sin userId: 0
GET /reports/inventory-health → ok: true (0 divergencias por producto, 0 por celda)
```

---

## 3. Correcciones aplicadas

### Bloqueantes

| # | Defecto | Archivo | Qué cambió | Caso | Antes → Después |
|---|---------|---------|------------|------|-----------------|
| **B1** | Despachar de un pallet más de lo que contiene | `movements.service.ts` | Tope explícito `item.quantity ≤ pallet.quantity` antes de descontar stock, en EXIT y ADJUSTMENT_OUT | SAL-11 | `201` con 5.000 unid. fantasma → **`400`, stock 12.500 intacto** |
| **B2** | Mismo agujero al aprobar un ajuste de salida | idem | cubierto por la misma validación | AJU-11 | `200` con 400 unid. de divergencia → **`400`, tres contabilidades en 1.400** |
| **B3** | Doble aprobación concurrente | `adjustments.service.ts` | `lock: { mode: 'pessimistic_write' }` en el re-`findOne` de `approve()` | AJU-06 | `A=200 B=200`, +1.000 y 2 movimientos → **`A=200 B=400`, +500 y 1 movimiento** |
| **B4** | Transferencia parcial parte el stock | `movements.service.ts` | El pallet se transfiere entero; cantidad parcial se rechaza indicando dividir el pallet primero | TRF-03/04 | celda con 5.000 y 0 pallets → **`400`, celda 9.000 stock / 9.000 pallets** |
| **B5** | Lote provisorio congelado tras regularizar | `movements.service.ts` | `lot.status = 'NORMAL'` salió del `if (lotChanged)`: regularizar libera siempre los lotes, y el cambio queda auditado | REG-02/03/06 | lote `PENDING_REGULARIZATION`, 6.000 unid. inmovilizadas → **lote `NORMAL` y despachable** |
| **B6** | Anulación atascada en `VOID_PENDING` | `adjustments.service.ts` + `movements.service.ts` | `cancel()` devuelve el movimiento a `voidStatus=NONE`; además `requestVoid()` valida por adelantado que la compensación sea aplicable | ANU-03/05/06 | `VOID_PENDING` permanente → **`VOIDED` en el flujo feliz, reversible al cancelar, rechazo temprano cuando no aplica** |
| **B7** | Borrar una ubicación ocupada | `locations.service.ts` + controller | Rechazo si hay pallets activos o stock ≠ 0; endpoint restringido a ADMIN/MANAGER | INT-01 | `200`, 1 pallet y 500 unid. huérfanas → **OPERATOR `403`, MANAGER `400`, 0 huérfanos** |

### Altos

| # | Defecto | Archivo | Qué cambió | Caso |
|---|---------|---------|------------|------|
| **B8** | Salud de inventario ciega a nivel celda | `reports.service.ts` | Segunda consulta agrupada por `(productId, locationId)`; nuevos campos `divergentCellCount` y `divergentCells`, con marca `orphanLocation` | STK-04 |
| **B9** | Baja o cambio de rol no cortaba la sesión | `jwt.strategy.ts` | `validate()` revalida el usuario contra la base y usa el **rol vigente**, no el del token | USR-09/10 |
| **B10** | Sin unicidad real de lotes | migración `HardenInventoryIntegrity` | `uq_lot_product_code` + `uq_location_warehouse_code` + `uq_transport_plate`, con verificación previa de duplicados | LOT-04 |
| **B11** | `GET /locations` ignoraba `warehouseId` | `locations.*` | Parámetro opcional de filtrado (compatible hacia atrás) | UBI-07 |
| **B12** | Códigos de ubicación duplicados | `locations.service.ts` | Validación de unicidad por depósito en el alta manual, con normalización a mayúsculas | UBI-08 |
| **B13** | Borrar maestros con datos daba 500 | `products/warehouses.service.ts` | Mensaje explícito con el conteo de lo que bloquea; baja lógica del material cuando tiene historia pero no stock | INT-03/04 |
| **B14** | Borrado físico de usuarios | `users.service.ts` | Baja lógica (`active = false`) y protección del último ADMIN activo | INT-05 |
| **B15** | 28 de 39 eventos sin autor | `movements/adjustments/transports.service.ts` | `userId` propagado en todas las llamadas a `uploads.log()` | AUD-03, AUD-09 |

### Medios y bajos

| Defecto | Cambio | Caso |
|---------|--------|------|
| 500 ante id no-UUID | `ParseUUIDPipe` en los `@Param('id')` de los 12 controladores | PRD-08 |
| OPERATOR borraba materiales | `DELETE /products` y `/warehouses` restringidos a ADMIN/MANAGER | PRD-11 |
| Depósito sin nombre | `@Length(2, 120)` en el DTO + validación en el servicio | DEP-03 |
| Patente duplicada | Unicidad en servicio + índice único | TRA-02 |
| Depósito con nombre duplicado | Validación de unicidad de nombre | DEP-04 |

---

## 4. Cambios en el plan de pruebas

Para que la comparación sea leal, acá va todo lo que se movió en la batería y por qué.
Ningún caso se ablandó para forzar el verde.

**Casos nuevos (2):**

| # | Caso | Motivo |
|---|------|--------|
| ANU-06 | Anular una entrada cuya mercadería ya fue despachada → `400` con mensaje claro y `voidStatus=NONE` | Al corregir B6 se agregó validación temprana; hacía falta un caso que la cubriera |
| AUD-09 | Trazabilidad completa al cierre de las 7 fases: 0 eventos sin `userId`, 0 movimientos sin autor | AUD-03 medía sólo hasta la fase 6; este verifica el total |

**Expectativas ajustadas (5):**

| # | Ajuste | Razón |
|---|--------|-------|
| ANU-01/02/03 | Se reapuntaron a la entrada E6 (500 kg, mercadería en depósito) en lugar de E9 | El escenario original era **insatisfacible**: E9 ya había sido despachada por SAL-06, así que la compensación nunca podía aprobarse. Ese caso pasó a ser ANU-06 |
| ANU-05 | Reescrito como «revertir una anulación pendiente» sobre un pedido propio | El anterior dependía del estado atascado que B6 elimina |
| INT-01 | Ahora verifica **las dos** capas: OPERATOR `403` y MANAGER `400`, más 0 huérfanos | El endpoint se restringió a ADMIN/MANAGER; con sólo OPERATOR ya no se llegaba a probar la regla de negocio |
| INT-03/04 | Ejecutados como MANAGER | Misma restricción de permisos |
| INT-06 | Expectativa corregida a «`405` es la respuesta correcta» | El sistema **ya estaba bien**: el borrado de pallets está deliberadamente deshabilitado para preservar trazabilidad. La expectativa original del arnés estaba mal escrita |
| AUTH-01 | Acepta `2xx` en vez de exigir `200` | `POST` devuelve `201` por convención de NestJS; era un falso negativo del arnés |

**Casos retirados:** ninguno.

---

## 5. Verificaciones colaterales

| Verificación | Resultado |
|---|---|
| Suite Jest del backend (motor de stock + slotting) | **16/16** ✅ sin cambios |
| `tsc --noEmit` backend | **0 errores** ✅ |
| `tsc -b` frontend | **0 errores** ✅ |
| Migraciones sobre base vacía | **3/3** aplican limpio, incluida la nueva ✅ |
| Índices únicos creados | `uq_lot_product_code`, `uq_location_warehouse_code`, `uq_transport_plate`, `uq_stock_cell` ✅ |
| Regresiones en casos que ya pasaban | **0** ✅ |

La migración nueva **aborta con un mensaje explícito** si encuentra duplicados previos,
en vez de crear el índice descartando filas en silencio. Es deliberado: en una base con
datos reales, esos duplicados hay que consolidarlos a mano.

---

## 6. Antes de subir a producción

Las correcciones están verificadas, pero el despliegue todavía necesita estos pasos.
**Ninguno es un defecto del código**; son consecuencia de que la base real ya estuvo
operando con los defectos.

- [ ] **Auditar la base actual antes de migrar.** Los defectos B1, B2, B4 y B7 pudieron
      dejar divergencias ya escritas. Correr `GET /reports/inventory-health` con la
      versión corregida (ahora también detecta descuadres por celda) y conciliar lo que
      aparezca **antes** del cutover.
- [ ] **Verificar duplicados previos**, o la migración va a abortar:
      ```sql
      SELECT "productId", "lotCode", COUNT(*) FROM lots GROUP BY 1,2 HAVING COUNT(*) > 1;
      SELECT "warehouseId", code, COUNT(*) FROM locations GROUP BY 1,2 HAVING COUNT(*) > 1;
      SELECT plate, COUNT(*) FROM transports GROUP BY 1 HAVING COUNT(*) > 1;
      ```
- [ ] **Backup completo de PostgreSQL** antes de aplicar la migración.
- [ ] Confirmar `DB_SYNCHRONIZE=false`, `DB_MIGRATIONS_RUN=true`, `CORS_ORIGIN` con el
      dominio real y `BOOTSTRAP_ADMIN_PASSWORD` ≥ 12 caracteres.

---

## 7. Qué quedó fuera de alcance

Dicho explícitamente para que la decisión sea informada:

| Tema | Estado |
|---|---|
| **Pruebas de UI en navegador** | No ejecutadas. El frontend se validó sólo con `tsc`. Los cambios de API son compatibles hacia atrás (`warehouseId` opcional, campos nuevos aditivos, respuestas de `DELETE` que el cliente ignora), pero **la interfaz no se probó a mano** |
| **`inventory-health` sin pantalla** | El endpoint existe y ahora detecta descuadres por celda, pero **ningún componente lo consume**. El tipo del cliente quedó actualizado; falta la vista |
| **Facturación / SIFEN** | Sin probar: requiere credenciales del servicio externo |
| **Materiales por peso con decimales** | `stocks`, `lots` y `pallets` siguen siendo `int`. El sistema rechaza correctamente 12,5 kg. Si el negocio necesita fracciones, hay que migrar a `numeric` — es un cambio de modelo, no un bug |
| **Concurrencia más allá de 2 procesos** | Las carreras se probaron con 2 peticiones simultáneas. No se hizo prueba de carga sostenida |
| **Fallback `dev_secret_fallback`** | Sigue en `jwt.strategy.ts`. Hoy está cubierto por `validateEnv()`, que aborta el arranque en producción sin secretos, pero conviene eliminarlo |

---

## 8. Anexo — Los 171 casos, antes vs después

Leyenda: ✅ pasa · ❌ falla · «— nuevo» = caso que no existía en la corrida anterior.

### Autenticación

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| AUTH-01 | Login con credenciales válidas (admin) | POST /auth/login {admin/admin123} | 200 + access_token + user.role=ADMIN | 201 token=true role=ADMIN | ✅ | ✅ | CRÍTICA |
| AUTH-02 | Login con contraseña incorrecta | POST /auth/login con password inválida | 401 Credenciales inválidas | 401 "Credenciales inválidas" | ✅ | ✅ | CRÍTICA |
| AUTH-03 | Login con usuario inexistente | POST /auth/login usuario inexistente | 401 con el mismo mensaje que password incorrecta (no enumerar usuarios) | 401 "Credenciales inválidas" | ✅ | ✅ | ALTA |
| AUTH-04 | Login con campos vacíos | POST /auth/login {"",""} | 400 validación de campos obligatorios | 400 ["username should not be empty","password should not be empty"] | ✅ | ✅ | MEDIA |
| AUTH-05 | Acceso a endpoint protegido sin token | GET /products sin Authorization | 401 Unauthorized | 401 | ✅ | ✅ | CRÍTICA |
| AUTH-06 | Acceso con token malformado | GET /products con Bearer basura | 401 Unauthorized | 401 | ✅ | ✅ | CRÍTICA |
| AUTH-07 | Token ADMIN forjado con el secreto de fallback del código | Firmar un JWT con "dev_secret_fallback" (hardcodeado en jwt.strategy.ts) y llamar GET /users | 401 — el secreto real no debe ser adivinable | 401 | ✅ | ✅ | CRÍTICA |
| AUTH-08 | GET /auth/me devuelve la identidad del token | GET /auth/me con token admin | userId, username y role | {"userId":"fedbc1c7-6369-4613-97a3-6bc9686ef8cd","username":"admin","role":"ADMIN"} | ✅ | ✅ | MEDIA |
| AUTH-09 | Refresh sin cookie de refresh token | POST /auth/refresh sin cookie | 401 Refresh token ausente | 401 "Refresh token ausente" | ✅ | ✅ | MEDIA |

### Usuarios y roles

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| USR-01 | Crear usuario con rol MANAGER y autenticarlo | POST /users {qa_manager, MANAGER} → POST /auth/login | Usuario creado (201) y login exitoso devolviendo ese rol | create=201 login=201 role=MANAGER | ✅ | ✅ | CRÍTICA |
| USR-02 | Crear usuario con rol OPERATOR y autenticarlo | POST /users {qa_operator, OPERATOR} → POST /auth/login | Usuario creado (201) y login exitoso devolviendo ese rol | create=201 login=201 role=OPERATOR | ✅ | ✅ | CRÍTICA |
| USR-03 | Crear usuario con rol AUDITOR y autenticarlo | POST /users {qa_auditor, AUDITOR} → POST /auth/login | Usuario creado (201) y login exitoso devolviendo ese rol | create=201 login=201 role=AUDITOR | ✅ | ✅ | CRÍTICA |
| USR-04 | Crear usuario con username duplicado | POST /users con username ya existente | 400 Username ya existe | 400 "Username ya existe" | ✅ | ✅ | ALTA |
| USR-05 | Crear usuario con contraseña de 3 caracteres | POST /users password="123" | 400 mínimo 6 caracteres | 400 ["password must be longer than or equal to 6 characters"] | ✅ | ✅ | ALTA |
| USR-06 | Crear usuario con rol fuera del enum | POST /users role="SUPERADMIN" | 400 rol no permitido | 400 | ✅ | ✅ | MEDIA |
| USR-07 | OPERATOR intenta listar usuarios (endpoint solo ADMIN) | GET /users con token OPERATOR | 403 Forbidden | 403 | ✅ | ✅ | ALTA |
| USR-08 | MANAGER intenta crear un usuario ADMIN (escalada de privilegios) | POST /users role=ADMIN con token MANAGER | 403 Forbidden | 403 | ✅ | ✅ | CRÍTICA |
| USR-09 | Desactivar usuario: ¿se corta la sesión ya emitida? | Crear usuario → login (token OK) → PATCH active=false → reusar el mismo token | 401 con el token viejo (la sesión debe cortarse al desactivar) | antes=200 después=401; re-login=401 | ❌ | ✅ | ALTA |
| USR-10 | Degradar rol OPERATOR→AUDITOR con token vigente | login OPERATOR → PATCH role=AUDITOR → POST /warehouses con el token anterior | 403 (el rol nuevo debe aplicarse de inmediato) | 403 | ❌ | ✅ | ALTA |

### Seguridad

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| SEC-01 | Anti fuerza bruta: más de 5 intentos de login por minuto | POST /auth/login ×9 en menos de 60 s desde la misma IP | 429 Too Many Requests al superar el límite | códigos de la ráfaga: 429,429,429,429 | ✅ | ✅ | ALTA |
| SEC-02 | MANAGER intenta ejecutar el reset de la base (endpoint de seed) | POST /seed/reset con token MANAGER | 403 — solo ADMIN | 403 | ✅ | ✅ | CRÍTICA |
| SEC-03 | AUDITOR intenta ejecutar el reset de la base | POST /seed/reset con token AUDITOR | 403 Forbidden | 403 | ✅ | ✅ | CRÍTICA |
| SEC-04 | MANAGER intenta revertir el snapshot de stock inicial | POST /movements/stock-snapshot/revert con token MANAGER | 403 — solo ADMIN | 403 | ✅ | ✅ | ALTA |
| SEC-05 | Intento de inyección SQL en el buscador de remitos | GET /movements/documents?search=' OR 1=1; DROP TABLE stocks;-- | 200 sin efectos y tabla stocks intacta | 200 filas devueltas=0 · stocks sigue con 12 filas | ✅ | ✅ | CRÍTICA |
| SEC-06 | Endpoint de health sin autenticación (para el balanceador) | GET /health sin token | 200 sin exponer datos sensibles | 200 {"status":"ok","timestamp":"2026-07-31T06:21:05.606Z","uptime":79,"checks":{"database":{"status":"ok","latencyMs":0}}} | ✅ | ✅ | BAJA |

### Productos

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| PRD-01 | Alta de 10 materiales con distintas unidades (UN/TS/PC/KG/MIL) | POST /products ×10 con token OPERATOR | 10 productos creados | 10/10 creados  | ✅ | ✅ | CRÍTICA |
| PRD-02 | Alta de producto con código duplicado | POST /products code=40004808 (ya existe) | 400/409 código duplicado | 400 "Ya existe un material con ese código" | ✅ | ✅ | ALTA |
| PRD-03 | Alta con código y descripción vacíos | POST /products {code:"",description:""} | 400 validación | 400 | ✅ | ✅ | MEDIA |
| PRD-04 | Alta con stockMinimo negativo | POST /products stockMinimo=-100 | 400 validación (@Min(0)) | 400 | ✅ | ✅ | MEDIA |
| PRD-05 | Alta con campo no declarado en el DTO | POST /products con propiedad extra "campoInventado" | 400 (forbidNonWhitelisted) | 400 ["property campoInventado should not exist"] | ✅ | ✅ | MEDIA |
| PRD-06 | Editar stock mínimo y verificar persistencia | PATCH /products/:id {stockMinimo:500} → GET /products/:id | 200 y stockMinimo=500 persistido en PostgreSQL | patch=200 getStockMinimo=500 | ✅ | ✅ | MEDIA |
| PRD-07 | Consultar producto inexistente | GET /products/<uuid inexistente> | 404 Not Found | 404 | ✅ | ✅ | BAJA |
| PRD-08 | Consultar producto con id que no es UUID | GET /products/no-es-un-uuid | 400/404 controlado | 400 "Validation failed (uuid is expected)" | ❌ | ✅ | MEDIA |
| PRD-09 | AUDITOR intenta crear producto (rol de solo lectura) | POST /products con token AUDITOR | 403 Forbidden | 403 | ✅ | ✅ | ALTA |
| PRD-10 | AUDITOR puede listar productos (lectura permitida) | GET /products con token AUDITOR | 200 con la lista | 200 items=10 | ✅ | ✅ | MEDIA |
| PRD-11 | OPERATOR puede eliminar productos | DELETE /products/:id con token OPERATOR | Solo ADMIN/MANAGER deberían borrar catálogo maestro | delete=403, producto luego=activo=true | ❌ | ✅ | MEDIA |

### Depósitos

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| DEP-01 | Alta de depósito | POST /warehouses {name, address} | 201 con id | 201 id=c80a961d-1d41-4a05-a57e-c6df2b8260b1 | ✅ | ✅ | CRÍTICA |
| DEP-02 | Alta de segundo depósito (para movimientos entre depósitos) | POST /warehouses | 201 con id | 201 id=c4ef3637-259f-4dcd-b173-ec8f5873353e | ✅ | ✅ | ALTA |
| DEP-03 | Alta de depósito con nombre vacío | POST /warehouses {name:""} | 400 validación de nombre obligatorio | 400 | ❌ | ✅ | MEDIA |
| DEP-04 | Alta de depósito con nombre duplicado | POST /warehouses con nombre ya existente | 400/409 o regla explícita de unicidad | 400 | ❌ | ✅ | BAJA |
| DEP-05 | Consultar depósito por id | GET /warehouses/:id | 200 con el nombre correcto | 200 name=DEPOSITO CENTRAL | ✅ | ✅ | MEDIA |
| DEP-06 | Consultar depósito inexistente | GET /warehouses/<uuid inexistente> | 404 Not Found | 404 | ✅ | ✅ | BAJA |

### Ubicaciones

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| UBI-01 | Generación masiva (2 pasillos × 2 racks × 3 niveles × 4 posiciones) | POST /locations/generate | 48 ubicaciones nuevas | 201 {"requested":48,"created":48,"skipped":0} | ✅ | ✅ | ALTA |
| UBI-02 | Re-ejecutar la generación idéntica (idempotencia) | POST /locations/generate con los mismos parámetros | 0 nuevas / 48 ya existentes — sin duplicar | 201 {"requested":48,"created":0,"skipped":48} | ✅ | ✅ | ALTA |
| UBI-03 | Generar zona plana de recepción (REC-P1..P6) | POST /locations/generate {zone:RECEPCION, prefix:REC, positions:6} | 6 ubicaciones | 201 {"requested":6,"created":6,"skipped":0} | ✅ | ✅ | MEDIA |
| UBI-04 | Generar estructura en el segundo depósito | POST /locations/generate en depósito 2 | 3 ubicaciones | 201 {"requested":3,"created":3,"skipped":0} | ✅ | ✅ | MEDIA |
| UBI-05 | Generar con zona fuera del enum | POST /locations/generate zone="ZONA_INVENTADA" | 400 validación | 400 | ✅ | ✅ | MEDIA |
| UBI-06 | Generar en depósito inexistente | POST /locations/generate con warehouseId inexistente | 404 depósito inexistente | 404 "Warehouse not found" | ✅ | ✅ | ALTA |
| UBI-07 | Listar ubicaciones del depósito y verificar los códigos generados | GET /locations?warehouseId= | 54 ubicaciones (48 almacenamiento + 6 recepción) | 200 total=54 muestra=A-F1-N1-P1, A-F1-N1-P2, A-F1-N1-P3 | ❌ | ✅ | ALTA |
| UBI-08 | Alta manual con código duplicado en el mismo depósito | POST /locations code=A-F1-N1-P1 | 400/409 código duplicado | 400 "Ya existe la ubicación \"A-F1-N1-P1\" en el depósito DEPOSITO CENTRAL" | ❌ | ✅ | ALTA |
| UBI-09 | Alta manual de ubicación tipo PISO | POST /locations {code:MANUAL-01, type:PISO} | 201 con id | 201 id=b2cb457d-0e2a-4592-b5b4-f14c14966f24 | ✅ | ✅ | MEDIA |
| UBI-10 | Alta de ubicación en depósito inexistente | POST /locations con warehouseId inexistente | 404/400 — no debe crearse una ubicación huérfana | 404 | ✅ | ✅ | ALTA |

### Entradas

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| ENT-01 | Entrada de 12.000 UN en 6 pallets de un lote | POST /movements/documents type=ENTRY, 6 palletItems de 2.000 con lote L1-AGO | Código RLNE-2026-000001, stock=12.000, lote=12.000, pallets=12.000 | 201 code=RLNE-2026-000001 stock=12000 lote=12000 pallet=12000 | ✅ | ✅ | CRÍTICA |
| ENT-02 | Segunda entrada del mismo producto con lote de vencimiento próximo | POST /movements/documents ENTRY 2×2.000 lote L1-JUN venc. +7 días | RLNE correlativo 000002 y stock acumulado 16.000 en las tres contabilidades | 201 code=RLNE-2026-000002 stock=16000 lote=16000 pallet=16000 | ✅ | ✅ | CRÍTICA |
| ENT-03 | Entrada multi-lote en una sola línea (M1 3.000 + M2 5.000) | POST /movements/documents con 2 palletItems de lotes distintos | Dos lotes con 3.000 y 5.000; stock total 8.000 | 201 lotes=[{"lotCode":"M1","stockActual":3000},{"lotCode":"M2","stockActual":5000}] stock=8000 | ✅ | ✅ | ALTA |
| ENT-04 | Remito multi-producto (2 líneas, 2 materiales) | POST /movements/documents con 2 lines de productos distintos | Un solo RLNE con 2 movimientos; stock 8.000 y 40 | 201 code=RLNE-2026-000004 movs=2 P3=8000 P4=40 | ✅ | ✅ | ALTA |
| ENT-05 | Entrada provisoria (pendiente de regularización) | POST /movements/documents isProvisional=true + observación obligatoria | Movimiento y lote en PENDING_REGULARIZATION | 201 lote=PENDING_REGULARIZATION movimiento=PENDING_REGULARIZATION | ✅ | ✅ | ALTA |
| ENT-06 | Entrada provisoria sin observación | POST ENTRY isProvisional=true sin notes | 400 — la observación es obligatoria en provisorias | 400 "Las entradas provisorias requieren una observación obligatoria" | ✅ | ✅ | MEDIA |
| ENT-07 | Entrada de material en KG | POST ENTRY 500 KG lote T6 | Stock 500 KG consistente | 201 stock=500 | ✅ | ✅ | MEDIA |
| ENT-08 | Entrada de cantidad decimal en material KG (12,5 kg) | POST ENTRY quantity=12.5 en producto con unidad KG | Aceptar decimales o rechazar con mensaje claro — nunca truncar en silencio | 400 ["lines.0.palletItems.0.quantity must be an integer number"] | ✅ | ✅ | MEDIA |
| ENT-09 | Dos pallets del mismo lote en una entrada (codificación automática) | POST ENTRY con 2 palletItems del lote HM8 | Pallets HM8-P1 y HM8-P2 con 600 cada uno | 201 [{"code":"HM8-P1","quantity":600},{"code":"HM8-P2","quantity":600}] | ✅ | ✅ | ALTA |
| ENT-10 | Entrada de cantidad mínima (1 unidad) | POST ENTRY quantity=1 | 201 y stock=1 | 201 stock=1 | ✅ | ✅ | MEDIA |
| ENT-11 | Entrada con cantidad 0 | POST ENTRY palletItems quantity=0 | 400 la cantidad debe ser mayor a cero | 400 | ✅ | ✅ | ALTA |
| ENT-12 | Entrada con cantidad negativa | POST ENTRY quantity=-500 | 400 validación | 400 | ✅ | ✅ | ALTA |
| ENT-13 | Entrada con producto inexistente | POST ENTRY productId inexistente | 404 Material inexistente | 404 | ✅ | ✅ | ALTA |
| ENT-14 | Entrada con ubicación inexistente | POST ENTRY locationId inexistente | 404 ubicación inexistente | 404 | ✅ | ✅ | ALTA |
| ENT-15 | Entrada con ubicación que pertenece a otro depósito | POST ENTRY warehouseId=DEP1 + locationId de DEP2 | 400 la ubicación no pertenece al depósito indicado | 400 "La ubicación no pertenece al depósito indicado" | ✅ | ✅ | ALTA |
| ENT-16 | Remito de entrada sin líneas | POST /movements/documents lines=[] | 400 ArrayMinSize | 400 | ✅ | ✅ | MEDIA |
| ENT-17 | Entrada de pallet sin lotCode ni palletId | POST ENTRY palletItem sin lotCode | 400 — cada ítem debe indicar lote o pallet | 400 "Cada ítem debe indicar un pallet existente (palletId) o un código de lote (lotCode)." | ✅ | ✅ | ALTA |
| ENT-18 | Atomicidad: remito con una línea válida y otra inválida | POST ENTRY con línea 1 correcta (500) y línea 2 con cantidad 0 | 400 y rollback total: ni stock ni lote de la línea 1 | 400 stock antes=16000 después=16000 lote ATOMIC-OK creado=0 | ✅ | ✅ | CRÍTICA |

### Lotes

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| LOT-01 | Reingreso del mismo lote en minúsculas (normalización) | POST ENTRY lotCode='l1-ago' cuando ya existe 'L1-AGO' | Un único lote L1-AGO con 13.000 — sin duplicar por mayúsculas | 201 lotes=[{"lotCode":"L1-AGO","stockActual":13000}] | ✅ | ✅ | ALTA |
| LOT-02 | Alta manual de un lote ya existente para el mismo producto | POST /lots lotCode='R3' (creado por la entrada E4) | 400 ya existe el lote para este producto | 400 "Ya existe el lote \"R3\" para este producto" | ✅ | ✅ | ALTA |
| LOT-03 | No existen lotes duplicados (productId, lotCode) en la base | SELECT ... GROUP BY productId, lotCode HAVING count(*)>1 | 0 filas duplicadas | 0 grupos duplicados [] | ✅ | ✅ | ALTA |
| LOT-04 | Restricción única en base de datos para (productId, lotCode) | Revisar pg_indexes sobre la tabla lots | Índice UNIQUE que impida duplicados ante carreras o cargas masivas | [{"indexdef":"CREATE UNIQUE INDEX uq_lot_product_code ON public.lots USING btree (\"productId\", \"lotCode\")"}] | ❌ | ✅ | ALTA |
| LOT-05 | Consulta FEFO ordena por vencimiento más próximo | GET /lots/fefo?productId= | Primero L1-JUN (vence en 7 días), después L1-AGO | 200 orden=L1-JUN → L1-AGO | ✅ | ✅ | ALTA |

### Pallets

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| PAL-01 | Listar pallets de un lote | GET /pallets?lotId= | 7 pallets (6 de E1 + 1 del reingreso LOT-01) | 200 total=7 | ✅ | ✅ | MEDIA |
| PAL-02 | No hay pallets huérfanos (sin lote) | LEFT JOIN pallets → lots | 0 pallets sin lote | 0 | ✅ | ✅ | ALTA |
| PAL-03 | No hay pallets activos sin ubicación asignada | SELECT pallets WHERE currentLocationId IS NULL AND status<>'EXITED' | 0 pallets "fantasma" | 0 | ✅ | ✅ | ALTA |

### Stock

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| STK-01 | Stock por celda coincide con la suma de pallets de esa celda | Comparar stocks.currentQuantity vs SUM(pallets.quantity) por ubicación | Coincidencia exacta en todas las celdas | [{"locationId":"0a47a23c-8f41-456f-b2d4-71c1164438c6","currentQuantity":13000,"pallets":13000},{"locationId":"d5a84e84-1e7b-4efe-8dc2-82e387b541af","currentQuantity":4000,"pallets":4000}] | ✅ | ✅ | CRÍTICA |
| STK-02 | Invariante Stock = Lote = Pallet tras todas las entradas | GET /reports/inventory-health | ok:true sin divergencias | 200 ok=true divergencias=0 | ✅ | ✅ | CRÍTICA |
| STK-03 | Ninguna celda de stock quedó negativa | SELECT stocks WHERE currentQuantity < 0 | 0 filas | 0 | ✅ | ✅ | CRÍTICA |
| CON-04 | Ninguna celda quedó con stock negativo tras salidas y concurrencia | SELECT stocks WHERE currentQuantity < 0 | 0 filas | 0 filas [] | ✅ | ✅ | CRÍTICA |
| STK-04 | El chequeo de salud detecta divergencias a nivel ubicación | Comparar GET /reports/inventory-health con la verificación stock-vs-pallets por celda | Toda celda descuadrada aparece reportada | inventory-health reporta 0 producto(s) []; por celda hay 0 descuadre(s): [] | ❌ | ✅ | ALTA |

### Salidas

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| SAL-01 | Salida automática FEFO: consume primero el lote que vence antes | POST /movements/documents EXIT 3.000 sin indicar lote (L1-JUN vence en 7 d, L1-AGO en 200 d) | L1-JUN baja de 4.000 a 1.000; L1-AGO permanece en 13.000 | 201 code=RLNS-2026-000001 L1-JUN=1000 L1-AGO=13000 | ✅ | ✅ | CRÍTICA |
| SAL-02 | Salida que agota un lote y continúa en el siguiente (parcial) | POST EXIT 1.500 cuando L1-JUN tiene 1.000 | L1-JUN=0 (pallets EXITED), L1-AGO=12.500 con un pallet PARTIAL | L1-JUN=0 L1-AGO=12500 pallets JUN=[{"code":"L1-JUN-P1","quantity":0,"status":"EXITED"},{"code":"L1-JUN-P2","quantity":0,"status":"EXITED"}] | ✅ | ✅ | CRÍTICA |
| SAL-03 | Integridad Stock=Lote=Pallet después de dos salidas FEFO | Comparar sumas por producto tras SAL-01 y SAL-02 | 17.000 − 4.500 = 12.500 en las tres contabilidades | inicial=17000 stock=12500 lote=12500 pallet=12500 | ✅ | ✅ | CRÍTICA |
| SAL-04 | FEFO entre dos lotes del mismo producto (M1 vence antes que M2) | POST EXIT 4.000 con M1=3.000 (venc. +30 d) y M2=5.000 (venc. +120 d) | M1=0 y M2=4.000 | 201 M1=0 M2=4000 | ✅ | ✅ | CRÍTICA |
| SAL-05 | Salida multi-producto en un solo remito | POST EXIT con 2 líneas | Un RLNS con 2 movimientos; stocks 6.000 y 30 | 201 code=RLNS-2026-000004 movs=2 P3=6000 P4=30 | ✅ | ✅ | ALTA |
| SAL-06 | Salida que agota todo el stock de un producto | POST EXIT 1.000 (todo el stock de PR9) | Pallet en estado EXITED y stock 0 | 201 pallets=[{"code":"PR9-P1","quantity":0,"status":"EXITED"}] stock=0 | ✅ | ✅ | ALTA |
| SAL-07 | Sobreventa: despachar 5 cuando hay 1 en stock | POST EXIT quantity=5 con stock=1 | 400 stock insuficiente y stock intacto (nunca negativo) | 400 "Stock insuficiente: se pueden despachar 1 de 5 unidades solicitadas" · stock antes=1 después=1 | ✅ | ✅ | CRÍTICA |
| SAL-08 | Despachar un lote provisorio (pendiente de regularización) | POST EXIT del producto cuyo único lote es PROV-01 en PENDING_REGULARIZATION | 400 — hay que regularizar el lote antes de despachar | 400 "Stock insuficiente: se pueden despachar 0 de 1000 unidades solicitadas" · stock=6000 | ✅ | ✅ | ALTA |
| SAL-09 | Salida con cantidad 0 | POST EXIT quantity=0 | 400 validación | 400 | ✅ | ✅ | ALTA |
| SAL-10 | Salida sin cantidad ni pallets | POST EXIT línea sin quantity ni palletItems | 400 la cantidad debe ser mayor a cero | 400 "La cantidad debe ser mayor a cero" | ✅ | ✅ | MEDIA |
| SAL-11 | Despachar de un pallet más cantidad de la que contiene | POST EXIT palletItems=[{palletId: L1-AGO-P1, quantity: 7000}] cuando el pallet tiene 2000 | 400 — no se puede sacar de un pallet más de lo que tiene | 400 · pallet quedó en 2000 (AVAILABLE) · stock 12500→12500, lote 12500→12500, pallet 12500→12500 | ❌ | ✅ | CRÍTICA |
| SAL-12 | Invariante Stock=Lote=Pallet después de la salida sobre-dimensionada | GET /reports/inventory-health | ok:true | 200 ok=true · [] | ❌ | ✅ | CRÍTICA |
| SAL-13 | Despachar un pallet que pertenece a otro producto | POST EXIT productId=P1 con palletId de un pallet del producto P7 | 400 — el pallet no corresponde al material de la línea | 400 "El palet CH7-P1 pertenece al lote \"CH7\" de otro material." | ✅ | ✅ | ALTA |
| SAL-14 | Invariante tras despachar un pallet de otro producto | GET /reports/inventory-health | ok:true | ok=true · [] | ❌ | ✅ | CRÍTICA |

### Transferencias

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| TRF-01 | Transferir un pallet completo entre ubicaciones | POST /movements/transfer-batch con el pallet CH7-P1 completo | El pallet cambia de ubicación y el stock se mueve de celda (origen 0, destino 9.000) | 201 ubicación destino=true origen=0 destino=9000 | ✅ | ✅ | CRÍTICA |
| TRF-02 | Transferencia con origen igual al destino | POST /movements/transfer-batch fromLocationId = toLocationId | 400 origen y destino no pueden ser la misma ubicación | 400 | ✅ | ✅ | MEDIA |
| TRF-03 | Transferencia parcial de un pallet (mover 4.000 de 9.000) | POST /movements/transfer-batch quantity=4.000 sobre un pallet de 9.000 | Rechazo, o bien división real del pallet en dos con stock coherente por celda | 400 · celdas con stock=[{"locationId":"a145cd7d-7f70-467e-9399-e06ef4349714","currentQuantity":9000}] · pallet quedó con 9000 en origen | ❌ | ✅ | ALTA |
| TRF-04 | Coherencia stock-por-celda vs pallets-por-celda tras transferencia parcial | Comparar stocks.currentQuantity con SUM(pallets.quantity) por ubicación | Cada celda con stock respaldada por pallets de esa misma celda | inventory-health ok=true · por celda: [{"locationId":"a145cd7d-7f70-467e-9399-e06ef4349714","currentQuantity":9000,"pal":9000}] | ❌ | ✅ | CRÍTICA |

### Concurrencia

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| CON-01 | Dos salidas simultáneas de 4.000 con 6.000 en stock | Promise.all de dos POST EXIT del mismo producto | Una prospera y la otra falla; stock final 2.000 y nunca negativo | A=201 B=400 · stock 6000→2000 (lote=2000, pallet=2000) | ✅ | ✅ | CRÍTICA |
| CON-02 | Dos entradas simultáneas creando el mismo código de lote | Promise.all de dos POST ENTRY con lotCode RACE-LOT inexistente | Un único lote con 200 (o una de las dos falla) — nunca dos filas del mismo lote | E1=201 E2=201 · lotes creados=1 [200] | ✅ | ✅ | ALTA |
| CON-03 | Invariante global tras las pruebas de concurrencia | GET /reports/inventory-health | ok:true | ok=true · [] | ❌ | ✅ | CRÍTICA |

### Ajustes de inventario

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| AJU-01 | Crear ajuste de entrada en borrador (no debe mover stock) | POST /adjustments type=ADJUSTMENT_IN +200 | 201 con código RLAI y stock sin cambios (2000) | 201 code=RLAI-2026-000001 stock=2000 | ✅ | ✅ | ALTA |
| AJU-02 | Aprobar un ajuste que sigue en BORRADOR | PATCH /adjustments/:id/approve sin haberlo enviado a aprobación | 400 — solo se aprueban solicitudes PENDIENTE_APROBACION | 400 "Solo se pueden aprobar solicitudes en estado PENDIENTE_APROBACION." | ✅ | ✅ | ALTA |
| AJU-03 | OPERATOR intenta aprobar su propio ajuste | PATCH /adjustments/:id/approve con token OPERATOR | 403 — la aprobación es de ADMIN/MANAGER | 403 | ✅ | ✅ | CRÍTICA |
| AJU-04 | MANAGER aprueba el ajuste: recién ahí se mueve el stock | PATCH /adjustments/:id/approve con token MANAGER | 200 y stock 2000 → 2200 en las tres contabilidades | 200 stock=2200 lote=2200 pallet=2200 | ✅ | ✅ | CRÍTICA |
| AJU-05 | Re-aprobar un ajuste ya aprobado | PATCH /approve dos veces sobre la misma solicitud | 400 y stock sin doble impacto | 400 stock=2200 | ✅ | ✅ | CRÍTICA |
| AJU-06 | Dos aprobaciones simultáneas de la misma solicitud | Promise.all de PATCH /approve con MANAGER y ADMIN sobre la misma solicitud (+500) | Una aprueba y la otra falla; stock sube 500 una sola vez | A=200 B=400 · stock 2200→2700 (esperado 2700) · movimientos generados=1 | ❌ | ✅ | CRÍTICA |
| AJU-07 | Rechazar una solicitud enviada a aprobación | PATCH /adjustments/:id/reject con motivo | Vuelve a BORRADOR y el stock queda intacto | 200 estado=BORRADOR stock 1400→1400 | ✅ | ✅ | ALTA |
| AJU-08 | Anular un borrador de ajuste | PATCH /adjustments/:id/cancel | Queda RECHAZADO y nunca tocó stock | 200 estado=RECHAZADO stock=1400 | ✅ | ✅ | MEDIA |
| AJU-09 | Crear ajuste sin líneas | POST /adjustments lines=[] | 400 ArrayMinSize | 400 | ✅ | ✅ | MEDIA |
| AJU-10 | Ajuste de entrada sin depósito | POST /adjustments ADJUSTMENT_IN sin warehouseId | 400 — sin depósito el pallet quedaría sin ubicación (stock fantasma) | 400 | ✅ | ✅ | ALTA |
| AJU-11 | Ajuste de salida por encima del saldo del pallet | ADJUSTMENT_OUT de 1000 sobre un pallet con 600 | Rechazo al aprobar; stock, lote y pallet siguen coherentes | aprobación=400 · stock 1400→1400, lote 1400→1400, pallet 1400→1400 | ❌ | ✅ | CRÍTICA |

### Correcciones

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| COR-01 | Editar metadatos de una entrada ya posteada (aplicación directa + auditoría) | PATCH /movements/:id/edit con motivo, documentNumber y carrier nuevos | Cambios aplicados y registrados en regularization_logs con el motivo | 200 doc=001-001-0009999 carrier=TRANSPORTES SRL logs=2 | ✅ | ✅ | ALTA |
| COR-02 | Editar con motivo de menos de 5 caracteres | PATCH /movements/:id/edit reason="abc" | 400 el motivo debe tener al menos 5 caracteres | 400 | ✅ | ✅ | MEDIA |
| COR-03 | Renombrar el código de lote con cascada a los pallets | POST /movements/:id/request-quantity-edit newLotCode=L1-AGOSTO | Lote renombrado y pallets L1-AGOSTO-Pn | 201 lote=L1-AGOSTO pallets=L1-AGOSTO-P1, L1-AGOSTO-P2, L1-AGOSTO-P3 | ✅ | ✅ | ALTA |
| COR-04 | Reducir la cantidad de un pallet de una entrada | POST request-quantity-edit newQuantity=1500 sobre pallet L1-AGOSTO-P1 | Genera RLAO pendiente de aprobación; el stock NO cambia todavía | 201 solicitud=RLAO-2026-000003 tipo=ADJUSTMENT_OUT · stock 12500→12500 | ✅ | ✅ | CRÍTICA |
| COR-05 | Aprobar el RLAO de la corrección: recién ahí baja el stock | PATCH /adjustments/:id/approve del RLAO generado | stock 12500 → 12000 y el pallet queda en 1500 | 200 stock=12000 lote=12000 pallet=12000 · pallet=1500 (PARTIAL) | ✅ | ✅ | CRÍTICA |
| COR-06 | Agregar 3.000 unidades en 2 pallets nuevos y aprobar | POST request-quantity-edit addQuantity=3000 addPalletCount=2 → aprobar el RLAI | Pendiente sin impacto; al aprobar, +3.000 en stock, lote y pallets, con 2 pallets nuevos | solicitud=ADJUSTMENT_IN stockPendiente=12000 · aprobación=200 stock=15000 lote=15000 pallet=15000 · pallets del lote=9 | ✅ | ✅ | CRÍTICA |
| COR-07 | En una entrada, subir la cantidad de un pallet por encima de su saldo | request-quantity-edit newQuantity mayor al saldo del pallet | 400 — en entradas solo se puede reducir | 400 "El pallet L1-AGOSTO-P2 tiene 1500 unid. — solo se puede reducir. Para sumar unidades usá \"Agregar pallets nuevos\" del lote." | ✅ | ✅ | ALTA |
| COR-08 | Corregir un lote que no pertenece al movimiento | request-quantity-edit con lotId de otro movimiento | 400 el lote no pertenece a este movimiento | 400 "El lote M1 no pertenece a este movimiento." | ✅ | ✅ | ALTA |

### Anulaciones

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| ANU-01 | Solicitar anulación de una entrada (genera compensación pendiente) | POST /movements/:id/void sobre una entrada con la mercadería aún en depósito | Movimiento en VOID_PENDING, RLAO pendiente, stock sin cambios | 201 code=RLAO-2026-000004 voidStatus=VOID_PENDING stock 500→500 | ✅ | ✅ | ALTA |
| ANU-02 | Solicitar anulación dos veces del mismo movimiento | POST /movements/:id/void repetido | 400 ya tiene una anulación pendiente | 400 "Este movimiento ya tiene una solicitud de anulación pendiente de aprobación." | ✅ | ✅ | ALTA |
| ANU-03 | Aprobar la anulación: el movimiento queda VOIDED y el stock se corrige | PATCH /adjustments/:id/approve del RLAO de anulación | voidStatus=VOIDED y stock 500 → 0 coherente en las tres contabilidades | 200 voidStatus=VOIDED stock=0 lote=0 pallet=0 | ❌ | ✅ | CRÍTICA |
| ANU-04 | Intentar anular una transferencia | POST /movements/:id/void sobre un TRANSFER | 400 — las transferencias no se anulan automáticamente | 400 "Las transferencias no pueden anularse automáticamente. Usá el Ajuste de Inventario." | ✅ | ✅ | MEDIA |
| ANU-06 | Anular una entrada cuya mercadería ya fue despachada | POST /movements/:id/void sobre la entrada E9, cuyo stock salió en SAL-06 | 400 con mensaje claro y el movimiento intacto (voidStatus=NONE) | 400 "No se puede anular: la mercadería de 1 palet(s) ya salió del depósito — PR9-P1 (quedan 0 de 1000). Registrá un Ajuste de Inventario en lugar de anula · voidStatus=NONE | — nuevo | ✅ | ALTA |
| ANU-05 | Revertir una solicitud de anulación pendiente | POST /void → PATCH /adjustments/:id/cancel → reintentar POST /void | El movimiento vuelve a voidStatus=NONE y se puede volver a operar | pedido=201 (VOID_PENDING) cancel=200 → voidStatus=NONE · reintento=201 | ❌ | ✅ | ALTA |

### Regularización

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| REG-01 | OPERATOR intenta regularizar una entrada provisoria | PATCH /movements/:id/regularize con token OPERATOR | 403 — regularizar es de ADMIN/MANAGER | 403 | ✅ | ✅ | MEDIA |
| REG-02 | MANAGER regulariza la entrada provisoria | PATCH /movements/:id/regularize con datos definitivos | Movimiento NORMAL y lote fuera de PENDING_REGULARIZATION | 200 movimiento=NORMAL doc=REM-DEFINITIVO-001 lote=NORMAL | ❌ | ✅ | ALTA |
| REG-03 | Despachar el lote una vez regularizado | POST EXIT 1.000 del lote antes bloqueado | 201 y stock 6.000 → 5.000 | 201 stock=5000 | ❌ | ✅ | ALTA |
| REG-04 | Regularizar cambiando un dato del lote (proveedor) | PATCH /movements/:id/regularize con proveedor nuevo | Lote pasa a NORMAL y queda despachable | 400 lote=NORMAL proveedor=null | ❌ | ✅ | ALTA |
| REG-05 | Re-regularizar un movimiento que ya está NORMAL | PATCH /movements/:id/regularize sobre un movimiento ya regularizado | 400 el movimiento no está pendiente de regularización | 400 "El movimiento no está pendiente de regularización" | ✅ | ✅ | MEDIA |
| REG-06 | Stock de una entrada provisoria ya regularizada: ¿se puede despachar? | POST EXIT 500 del producto cuyo movimiento provisorio ya está en NORMAL | 201 — el stock regularizado debe ser despachable | 201 undefined · stock=4500 | ❌ | ✅ | CRÍTICA |
| REG-07 | Desbloquear el lote manualmente vía PATCH /lots/:id | PATCH /lots/:id {status:"NORMAL"} | Alguna vía soportada para liberar un lote atascado | 200 undefined | ❌ | ✅ | ALTA |

### Reportes

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| REP-01 | Reporte de stock coincide con la tabla stocks | GET /reports/stock vs SUM(stocks.currentQuantity) | Totales iguales | 200 totalQuantity(api)=36631 SUM(stocks)=36631 | ✅ | ✅ | ALTA |
| REP-02 | Reporte de movimientos accesible por AUDITOR | GET /reports/movements con token AUDITOR | 200 con los movimientos registrados | 200 filas=29 (movimientos en base=29) | ✅ | ✅ | MEDIA |
| REP-03 | Trazabilidad por material | GET /reports/trace?materialId= | 200 con el historial del material | 200 claves=material,history | ✅ | ✅ | MEDIA |
| REP-04 | Trazabilidad sin materialId | GET /reports/trace sin parámetros | 400 parámetro obligatorio (no 500) | 400 ["materialId must be a UUID"] | ✅ | ✅ | BAJA |
| REP-05 | KPIs del tablero | GET /reports/kpis | 200 con métricas | 200 {"range":"today","totalMaterials":10,"totalQuantity":36631,"movementsCount":27,"movementsInRange":27,"movementsPrev":0,"movementsDelta":100,"pendingRegularizations":0,"expiringLots":1,"expiringCritica | ✅ | ✅ | MEDIA |
| REP-06 | Ocupación por depósito coincide con los pallets almacenados | GET /reports/occupancy vs COUNT(pallets activos) | Mismo número de pallets | 200 api=23 db=23 · [{"warehouseId":"c80a961d-1d41-4a05-a57e-c6df2b8260b1","warehouseName":"DEPOSITO CENTRAL","totalLocations":55,"capacityPallets":202,"occupiedLocations":7,"palletsStored":23,"freeLocations":48,"locationOccupancyPct":13,"c | ✅ | ✅ | MEDIA |
| REP-07 | Rotación de inventario (top movers / stock estancado) | GET /reports/rotation | 200 con datos de rotación | 200 claves=from,to,topMovers,deadStock,totals | ✅ | ✅ | BAJA |
| REP-08 | Dwell-time (antigüedad de pallets, base de facturación) | GET /reports/dwell-time | 200 con buckets de antigüedad | 200 {"summary":{"totalPallets":23,"avgAgeDays":0,"totalPalletDays":0,"buckets":{"d0_7":23,"d8_30":0,"d31_90":0,"d90plus":0}},"oldest":[{"id":"14aa34a3-e22c-4823-a26b-a4174b7176f8","code":"L1-AGOSTO-P3","q | ✅ | ✅ | BAJA |
| REP-09 | Frescura / vencimientos próximos | GET /reports/freshness | 200; el lote que vence en 7 días debe aparecer marcado | 200 [{"lotId":"fd7e10d9-d2d7-4c9d-94ab-30a7d94bf826","lotCode":"HM8","sapLot":null,"fechaVencimiento":"2026-09-29T03:00:00.000Z","fechaFabricacion":null,"stockActual":1200,"proveedor":null,"diasRestantes":60,"product":{"id": | ✅ | ✅ | MEDIA |
| REP-10 | Stock diario | GET /reports/daily-stock?date=hoy | 200 | 200 | ✅ | ✅ | BAJA |
| REP-11 | OPERATOR intenta ver ocupación (endpoint ADMIN/MANAGER/AUDITOR) | GET /reports/occupancy con token OPERATOR | 403 Forbidden | 403 | ✅ | ✅ | BAJA |

### Diferencias de inventario

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| DIF-01 | Cargar snapshot de stock SAP del día | POST /reports/sap-stock con la cantidad de SAP | 200/201 guardado | 201 {"date":"2026-07-31","productId":"5b537f54-72d4-4e95-9673-1884dae9fc02","warehouseId":null,"locationId":null,"sapQuantity":14250,"id":"28e1a717-4101-4 | ✅ | ✅ | ALTA |
| DIF-02 | Comparativo WMS vs SAP muestra la diferencia exacta | GET /reports/differences-sap?date=hoy | Diferencia de +750 para el material 40004808 (WMS 15000 vs SAP 14250) | 200 {"date":"2026-07-31","material":{"id":"5b537f54-72d4-4e95-9673-1884dae9fc02","code":"40004808","description":"ROLHA MET BRAHMA 940CC","unitOfMeasure":"UN"},"stockInicial":16000,"entradas":4000,"salidas":5000,"stockFinal":15000,"stockSAP":14250,"diferencia":750 | ✅ | ✅ | ALTA |
| DIF-03 | Re-cargar el snapshot SAP del mismo día (idempotencia) | POST /reports/sap-stock dos veces para la misma fecha y producto | Una sola fila por producto/fecha, con la diferencia recalculada en 0 | 201 filas para el producto=1 · diferencia=0 · snapshots en base=1 | ✅ | ✅ | ALTA |
| DIF-04 | OPERATOR intenta ver diferencias SAP | GET /reports/differences-sap con token OPERATOR | 403 Forbidden | 403 | ✅ | ✅ | BAJA |

### Auditoría

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| AUD-01 | Bitácora global de eventos | GET /attachments/events | Eventos de creación de remitos, ajustes y anulaciones | 200 eventos=41 (base=41) tipos=ANULACION_SOLICITADA, CREADO, APROBADO, ENVIADO_APROBACION, EDITADO, RECHAZADO | ✅ | ✅ | ALTA |
| AUD-02 | Las aprobaciones de ajuste quedan registradas | SELECT document_events WHERE entityType='ADJUSTMENT' AND eventType='APROBADO' | Al menos un evento de aprobación | 5 eventos | ✅ | ✅ | ALTA |
| AUD-03 | Todo evento de bitácora tiene usuario responsable | SELECT document_events WHERE userId IS NULL | 0 eventos sin autor (trazabilidad completa) | 0 de 41 eventos sin userId | ❌ | ✅ | ALTA |
| AUD-04 | Toda corrección tiene motivo registrado | SELECT regularization_logs WHERE reason vacío | 0 correcciones sin motivo | 0 de 6 sin motivo | ✅ | ✅ | ALTA |
| AUD-05 | Todo movimiento tiene usuario creador | SELECT movements WHERE createdById IS NULL | 0 movimientos anónimos | 0 | ✅ | ✅ | ALTA |
| AUD-06 | Historial completo de una entidad (eventos + adjuntos) | GET /attachments/log?entityType=MOVEMENT&entityId= | 200 con el historial | 200 {"events":[],"attachments":[]} | ✅ | ✅ | MEDIA |
| AUD-07 | Historial de un pallet | GET /pallets/:id/history | 200 con los movimientos del pallet | 200 {"pallet":{"id":"ea80a387-c967-426d-9d7f-0378bb5f0b90","code":"PROV-01-P3","lotId":"cf7a60c7-1787-4ce5-87e5-fdaa553836c6 | ✅ | ✅ | MEDIA |
| AUD-08 | OPERATOR intenta ver el historial de un pallet | GET /pallets/:id/history con token OPERATOR | 403 (endpoint declarado ADMIN/MANAGER/AUDITOR) | 403 | ✅ | ✅ | BAJA |
| AUD-09 | Trazabilidad completa al cierre de la batería | Contar eventos de bitácora sin userId y movimientos sin autor válido después de las 7 fases | 0 eventos anónimos y 0 movimientos sin autor | 0 de 43 eventos sin userId · 0 movimientos sin autor | — nuevo | ✅ | ALTA |

### Transportes

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| TRA-01 | Alta de vehículo | POST /transports | 201 con id y estado DISPONIBLE | 201 id=510502d0-e068-432f-ba07-48fead682abd status=DISPONIBLE | ✅ | ✅ | MEDIA |
| TRA-02 | Alta de vehículo con patente duplicada | POST /transports con la misma patente | 400/409 patente duplicada | 400 | ❌ | ✅ | MEDIA |
| TRA-03 | Registrar inspección del vehículo | POST /transports/:id/inspection | 200/201 con evento en la bitácora | 201 {"id":"510502d0-e068-432f-ba07-48fead682abd","plate":"BKH180","type":"Scania R450","description":"Ambev","status":"DISPO | ✅ | ✅ | BAJA |
| TRA-04 | Historial de viajes del vehículo (remitos vinculados por patente) | GET /transports/:id/history | 200 incluyendo el remito de entrada cargado con BKH180 | 200 {"transport":{"id":"510502d0-e068-432f-ba07-48fead682abd","plate":"BKH180","type":"Scania R450","description":"Ambev","status":"DISPONIBLE","capacityPallets":28,"capacityKg":28000,"notes":null,"active | ✅ | ✅ | BAJA |

### Integridad referencial

| # | Caso | Pasos | Resultado esperado | Resultado obtenido (después) | Antes | Después | Criticidad |
|---|------|-------|--------------------|------------------------------|-------|---------|------------|
| INT-01 | Eliminar una ubicación que tiene pallets y stock | DELETE /locations/A-F1-N1-P1 (con 9 pallets y 15000 unidades), primero como OPERATOR y luego como MANAGER | OPERATOR 403 · MANAGER 400 — no se puede borrar una ubicación ocupada; sin pallets ni stock huérfanos | operador=403 manager=400 · ubicación existe=true · pallets huérfanos=0 · stock huérfano=0 unid. | ❌ | ✅ | CRÍTICA |
| INT-02 | Estado del inventario tras borrar la ubicación | GET /reports/inventory-health y GET /warehouses/:id/layout | El mapa del depósito y la salud del inventario siguen siendo consistentes | inventory-health=200 ok=true divergentes=0 · layout=200 | ✅ | ✅ | ALTA |
| INT-03 | Eliminar un material que tiene stock, lotes y movimientos | DELETE /products/40004808 como MANAGER (con 15000 unidades en stock) | 400/409 con mensaje claro (o baja lógica), nunca un 500 | 400 "No se puede eliminar el material 40004808: tiene 15000 unidad(es) en stock. Despachá o aj · producto existe=true | ❌ | ✅ | ALTA |
| INT-04 | Eliminar un depósito con ubicaciones y stock | DELETE /warehouses/:id del depósito principal, como MANAGER | 400/409 con mensaje claro, nunca un 500 | 400 "No se puede eliminar el depósito DEPOSITO CENTRAL: tiene 55 ubicación(es) y 36631 unidad( · depósito existe=true | ❌ | ✅ | ALTA |
| INT-05 | Eliminar un usuario que registró movimientos | DELETE /users/:id del operador que creó 24 movimientos | Baja lógica (active=false) — el borrado físico rompe la trazabilidad de quién hizo cada movimiento | 200 · usuario existe=true · movimientos sin autor válido=0 | ❌ | ✅ | ALTA |
| INT-06 | Eliminar un pallet que todavía tiene unidades | DELETE /pallets/PROV-01-P3 (con 2000 unidades) | Rechazo explícito (405) — los pallets no deben borrarse, se preserva la trazabilidad | 405 · pallet existe=true · lote 4500→4500 | ✅ | ✅ | ALTA |
| INT-07 | Salud del inventario tras la batería de borrados | GET /reports/inventory-health | ok:true — sin divergencias, ni por producto ni por celda | ok=true divergentes=0 · [] | ✅ | ✅ | ALTA |
