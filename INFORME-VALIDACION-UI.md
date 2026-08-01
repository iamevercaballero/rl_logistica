# Validación de UI y correcciones de experiencia de uso

**Sistema:** RL Logística WMS · **Fecha:** 31/07/2026
**Continuación de:** [informe final comparativo](INFORME-FINAL-COMPARATIVO.md)

---

## 1. Qué se hizo

Pasada dirigida en navegador con rol **OPERATOR** contra el backend corregido, más la
corrección de los tres hallazgos de experiencia de uso detectados en la validación previa.

Entorno: instancia paralela (Vite `:5174` → backend `:3001` → base `audit_db` creada desde
cero). El stack de desarrollo del usuario (`:5173` → `:3000`) no se tocó.

---

## 2. Correcciones de experiencia de uso

### 2.1 Rate limit de login

**Antes:** el operador veía `ThrottlerException: Too Many Requests`.

Se agregó `FriendlyThrottlerGuard` (`src/common/friendly-throttler.guard.ts`), que sobreescribe
`getErrorMessage()` del guard de NestJS. Se resuelve **en el backend** para que valga igual
desde el frontend, una app móvil o cualquier integración.

**Verificado** — al 6.º intento en un minuto:

> `429` · *"Demasiados intentos de inicio de sesión. Esperá un minuto e intentá nuevamente."*

### 2.2 Bajas lógicas nombradas como tales

| Módulo | Antes | Ahora |
|---|---|---|
| Usuarios | Botón «Eliminar» · *"Esta acción no se puede deshacer"* | Botón **«Desactivar»** · *"El usuario quedará inactivo y no podrá iniciar sesión. Podrá reactivarse posteriormente."* · deshabilitado si ya está inactivo |
| Materiales | Botón «Eliminar» · toast *"Material eliminado"* | Botón **«Dar de baja»** · el confirm explica los dos casos y el toast dice cuál ocurrió: *"Material desactivado. Se conserva porque tiene movimientos registrados"* o *"Material eliminado"* |

Para que el toast pueda decir la verdad, `deleteProduct()` ahora devuelve la respuesta del
backend (`{deleted, deactivated, reason}`) en lugar de descartarla.

Depósitos, ubicaciones y transportes **no** se renombraron: ahí el borrado sigue siendo físico
(bloqueado si tienen contenido), así que «Eliminar» es correcto.

### 2.3 Salida parcial silenciosa

El más importante de los tres. Al investigarlo en el navegador encontré que **el escenario que
temíamos no era alcanzable**, pero por un motivo que igual había que corregir:

- Pedir más de lo que tiene el lote → lo bloqueaba la **validación nativa del navegador**
  (`max` en el input), con su propio texto: *"El valor debe ser menor de o igual a 4000"*.
- Destildar palets → la cantidad se auto-ajustaba hacia abajo.

O sea: no había despacho silencioso, pero el mensaje que veía el operador lo ponía el navegador
—no la aplicación—, en su propia redacción y dependiente del idioma del navegador.

**Cambios:**

1. Se quitó `max` del input, para que la validación nativa no se adelante al mensaje propio.
2. El aviso inline pasó a la redacción pedida.
3. Se agregó una guarda al armar el remito que compara lo solicitado contra lo que suman los
   **palets seleccionados** (no sólo el total del lote) y aborta antes de llamar a la API.

**Verificado en navegador** — solicitando 5.000 de un lote con 4.000:

- Inline: *"Cantidad seleccionada insuficiente: solicitaste 5.000 unidades y el lote tiene 4.000. Faltan 1.000 unidades."*
- Al enviar: *"Cantidad seleccionada insuficiente. Lote L1-JUN: solicitaste 5.000 unidades, pero los palets seleccionados contienen 4.000. Faltan seleccionar 1.000 unidades."*
- **No salió ninguna petición a la API.**

### 2.4 Divergencia de permisos (detectada y corregida en esta pasada)

El RBAC del frontend (`src/auth/rbac.ts`) seguía permitiendo a `OPERATOR` borrar materiales,
depósitos y ubicaciones, mientras el backend ya lo restringía a ADMIN/MANAGER. El operador
habría visto el botón y recibido un `403` sin explicación.

**Verificado** con sesión OPERATOR real: 10 botones «Editar» y **cero** botones de baja.

---

## 3. Cadena completa verificada: una salida real desde el navegador

Ejecutada como **qa_operator**, sin atajos por API.

| Eslabón | Evidencia |
|---|---|
| **UI** | Panel FEFO ordenado correctamente: L1-JUN (vence en 7 d) antes que L1-AGO (200 d). Se piden 3.000 |
| **API** | `POST /api/movements/documents` → **201 Created** |
| **Documento** | `RLNS-2026-000001` · MIC/Fac/Rem. `UI-SALIDA-001` · destino AMBEV PLANTA ASUNCION · 3.000 · creado por `qa_operator` |
| **Movimiento** | `EXIT` · 3.000 · 2 palets · autor `qa_operator` |
| **Palets** | `L1-JUN-P1` → 0, **EXITED** (salieron 2.000) · `L1-JUN-P2` → 1.000, **PARTIAL** (salieron 1.000) |
| **Lote** | L1-JUN 4.000 → **1.000** · L1-AGO intacto en 13.000 → **FEFO respetado** |
| **Stock** | 17.000 → **14.000**, igual a la suma de palets |
| **Auditoría** | `document_events`: `DOCUMENT / CREADO`, `entityCode = RLNS-2026-000001`, autor `qa_operator` |

### Transferencia (mismo recorrido)

Palet `L1-JUN-P2` movido de `A-F1-N1-P2` a `A-F1-N2-P1`:

- El botón anuncia *"⇄ Transferir 1 palet (1.000 unid.)"* — palet entero, coherente con la regla del backend.
- Origen queda en **stock 0 / 0 palets**; destino en **stock 1.000 / 1.000 en palets**.
- Coherencia por celda mantenida.

### Reporte

`Stock actual por depósito` refleja exactamente la cadena: 13.000 en `A-F1-N1-P1`, 0 en
`A-F1-N1-P2` y 1.000 en `A-F1-N2-P1` → 14.000, idéntico a la base.

---

## 4. Módulos recorridos

Los 10 visibles para OPERATOR renderizan **sin un solo error de consola**: Dashboard,
Materiales, Depósitos (con mapa de ocupación), Ubicaciones, Lotes, Palets, Movimientos,
Registros, Transportes y Reportes. El menú excluye correctamente Facturación, Usuarios y
Carga masiva.

Bloqueantes verificados en pantalla, con el mensaje que ve el operador:

- **B5** — Regularicé la entrada provisoria corrigiendo sólo el remito (el caso que congelaba el
  stock): el lote quedó `NORMAL` con 6.000 unidades despachables.
- **B7** — *"No se puede eliminar la ubicación A-F1-N1-P1: tiene 7 palet(s) y 12500 unidad(es) de stock."*
- **B13** — *"No se puede eliminar el material 40004808: tiene 12500 unidad(es) en stock."* y el equivalente para depósitos.
- **B14** — Baja lógica reflejada en la lista: «6 usuarios · 4 activos», fila en «Inactivo».

---

## 5. Lo que sigue sin verificarse en navegador

Dicho explícitamente:

| Tema | Estado |
|---|---|
| **Formulario de ajuste de inventario** | Renderiza sin errores y carga motivos, depósitos y ubicaciones, pero **no completé un ajuste de punta a punta** por la UI. El circuito está cubierto por la batería de API (11/11) |
| **Aprobación de ajustes** | Requiere ADMIN/MANAGER; no se ejerció desde la UI |
| **Autocompletado de materiales** | El desplegable de `ProductSearch` no respondió a los clicks automatizados. Se usó el catálogo modal («Ver productos»), que sí funciona. **No concluyo que el autocompletado esté roto** — es fricción de automatización; conviene una pasada manual |
| **Facturación / SIFEN** | Sin probar: requiere credenciales del servicio externo |
| **Impresos (notas y etiquetas)** | Sin probar |

---

## 6. Regresión tras estos cambios

Batería completa re-ejecutada sobre base creada desde cero, después de las correcciones:

| Fase | Casos | Resultado |
|---|---|---|
| p1 · auth, roles, productos, depósitos, ubicaciones | 47 | 47 ✅ |
| p2 · entradas, lotes, palets, stock | 29 | 29 ✅ |
| p3 · salidas, transferencias, concurrencia | 22 | 22 ✅ |
| p4 · ajustes, correcciones, anulaciones | 27 | 27 ✅ |
| p5 · regularización y salud de inventario | 6 | 6 ✅ |
| p6 · reportes, diferencias SAP, auditoría | 32 | 32 ✅ |
| p7 · integridad referencial | 8 | 8 ✅ |
| **Total** | **171** | **171 ✅ · 0 fallas** |

Suite Jest del backend: **16/16**. `tsc` de backend y frontend: sin errores.
Base final: 0 stock negativo, 0 movimientos sin autor, 0 eventos de bitácora sin usuario.

---

## 7. Archivos modificados en esta ronda

**Backend**
- `src/common/friendly-throttler.guard.ts` *(nuevo)* — mensajes de rate limit para el operador
- `src/app.module.ts` — registra el guard nuevo

**Frontend**
- `src/pages/Movements.tsx` — guarda de cantidad insuficiente al armar el remito; quitado el
  `max` nativo; mensaje inline con la redacción pedida
- `src/pages/Users.tsx` — «Desactivar» + confirm explicativo + botón deshabilitado si ya está inactivo
- `src/pages/Products.tsx` — «Dar de baja» + confirm que explica los dos casos + toast según resultado
- `src/api/products.ts` — `deleteProduct()` devuelve la respuesta del backend
- `src/auth/rbac.ts` — permisos de borrado alineados con el backend
- `.env.audit` *(nuevo)* — modo `audit` para apuntar la UI al backend aislado
