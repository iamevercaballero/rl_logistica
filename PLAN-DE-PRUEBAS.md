# Plan de Pruebas — RL Logística WMS

Guía de carga manual para verificar el sistema de punta a punta. Los datos están
**encadenados**: cargá en orden (productos → estructura → transportes → entradas →
salidas → ajustes → …). Cada caso trae **Resultado esperado**, un `[ ]` para marcar
y **🔎 Detecta** (qué falla cazaría). Fecha base asumida: **hoy**.

> Convención de fechas: usá fechas reales. Donde dice "vence pronto" poné ~7 días
> desde hoy; "vence lejos" 6+ meses. Eso prueba el orden FEFO y los semáforos.

---

## 0. Estructura de depósito (prerequisito)

| # | Acción | Datos | Esperado | OK |
|---|--------|-------|----------|----|
| W1 | Depósitos → ⚙ Generar estructura | Zona **Almacenamiento**, pasillos `A,B`, 2 racks, 3 niveles, 4 posiciones | Se crean **48** ubicaciones (A-R1-N1-P1 … B-R2-N3-P4); aparecen en el mapa | [ ] |
| W2 | Generar otra zona | Zona **Recepción**, prefijo `REC`, sin pasillos, 6 posiciones | 6 ubicaciones `REC-P1…P6` | [ ] |
| W3 | Re-ejecutar W1 igual | mismos parámetros | "0 nuevas · 48 ya existían" (idempotente, no duplica) | [ ] |

🔎 Detecta: generación masiva, idempotencia, que las ubicaciones nuevas aparezcan luego en los selects de entrada/transferencia.

---

## 1. Productos (cargar primero) — 10 materiales

| # | Código | Descripción | UM | Apilable | Stock mín |
|---|--------|-------------|----|----|----|
| P1 | 40004808 | ROLHA MET BRAHMA 940CC | UN | Sí | 5.000 |
| P2 | 40015054 | COLLARIIN BRAHMA 340CC MUSICAL | TS | Sí | 2.000 |
| P3 | 40007857 | ROTULO NECK PILSEN NVBI 340CC | UN | Sí | 10.000 |
| P4 | 50858280 | SOLVENTE P/TINTA NEGRA V7206-L 1LT | PC | No | 50 |
| P5 | 40021100 | TAMPA PILSEN 600CC | UN | Sí | _(sin mínimo)_ |
| P6 | 60030055 | TINTA BLANCA BASE X 25KG | KG | No | 100 |
| P7 | 40009912 | ROTULO BRAHMA CHOPP 269CC | MIL | Sí | 3.000 |
| P8 | 50112233 | ADHESIVO HOT MELT X 20KG | KG | No | 80 |
| P9 | 40044556 | PRECINTO SEGURIDAD AZUL | UN | Sí | 1.000 |
| P10 | 70088990 | FILM STRETCH 23µ 500MM | UN | No | _(sin mínimo)_ |

- [ ] Los 10 se crean y aparecen en el buscador de materiales.
- [ ] **Negativo:** intentar crear de nuevo el código `40004808` → debe rechazar (código duplicado).

🔎 Detecta: variedad de unidades (UN/TS/PC/KG/MIL → la **KG** y los pesos disparan lógica de etiqueta), apilable sí/no, stock mínimo opcional, unicidad de código.

---

## 2. Transportes — 10 pruebas del módulo flota

| # | Acción | Datos | Esperado | OK |
|---|--------|-------|----------|----|
| T1 | Nuevo vehículo | Patente **BKH180**, tipo Scania R450, desc. "Ambev" | Aparece en la flota, estado **🟢 Disponible** | [ ] |
| T2 | Vehículo con 2 choferes | Patente **ABC123**, Mercedes Actros → tab Choferes: Juan Pérez (CI 1.234.567, 0981-111222) + Luis Gómez (CI 2.345.678) | Guarda 2 choferes; la card muestra "👤 2 choferes" | [ ] |
| T3 | Ficha & capacidad | En BKH180: capacidad **28** pallets / **28000** kg, notas "Seguro vence 12/2026" | Persiste al guardar | [ ] |
| T4 | Estado operativo | BKH180 → botón **🚚 En ruta** | Cambia estado; queda registrado en la bitácora | [ ] |
| T5 | Inspección aprobada | Tab Inspecciones → **✓ Aprobada**, notas "Frenos y neumáticos OK" | Aparece evento 🔍 en el timeline | [ ] |
| T6 | Inspección con observaciones + cambio de estado | ABC123 → **⚠ Con observaciones**, notas "Luz trasera", marcar **🔧 Mantenimiento** | Registra inspección Y cambia estado a Mantenimiento | [ ] |
| T7 | Foto del camión | BKH180 → Documentos & Foto → subir imagen, categoría **Camión** | Se muestra como foto grande del camión | [ ] |
| T8 | Documento | BKH180 → subir PDF "Cédula verde", categoría Remito/Otro | Aparece en la lista de documentos | [ ] |
| T9 | Vehículo de reparto | Patente **HIL456**, tipo Camioneta Hilux, capacidad 4 pallets | Se crea | [ ] |
| T10 | Eliminar | Borrar **HIL456** | Desaparece de la flota | [ ] |

> El **Historial de viajes** de BKH180 se prueba más abajo (caso T-HIST), después de cargar entradas/salidas con esa patente.

🔎 Detecta: ficha completa, choferes múltiples, estados operativos, inspecciones (3 resultados), adjuntos `VEHICLE`, foto, borrado.

---

## 3. Entradas — 10 remitos (MIC/Factura/Remito)

> En "Datos logísticos" usá el campo **MIC/Factura/Remito** y el selector de **Vehículo**.

| # | Producto(s) | Lote(s) y cantidad | Vencimiento | Pallets | Doc / Vehículo / Ubic. | OK |
|---|-------------|--------------------|-------------|---------|------------------------|----|
| E1 | P1 | `L1-AGO` 12.000 UN | vence lejos (ago) | 6×2.000 | Fact. `001-001-0001234`, prov. Crown, **BKH180**, A-R1-N1-P1 | [ ] |
| E2 | P1 | `L1-JUN` 4.000 UN | **vence pronto** (~7 d) | 2×2.000 | mismo prov., A-R1-N1-P2 | [ ] |
| E3 | P2 (multi-lote) | `M1` 3.000 + `M2` 5.000 TS | M1 jul / M2 nov | auto | MIC `MIC-2026-0099`, A-R1-N2-P1 | [ ] |
| E4 | P3 + P4 (multi-producto) | P3 `R3` 8.000 UN; P4 `S4` 40 PC | dic | auto | mismo remito `FACT-555`, A-R1-N3-P1 | [ ] |
| E5 | P5 | `PROV-01` 6.000 UN — **entrada provisoria** | sin vencimiento | 3×2.000 | Observación obligatoria "Pendiente revisar remito" | [ ] |
| E6 | P6 (KG) | `T6` 500 KG | 2027 | 1 | A-R2-N1-P1 | [ ] |
| E7 | P7 | `CH7` 9.000 MIL | oct | auto | adjuntar **foto del remito** antes de confirmar | [ ] |
| E8 | P8 | `HM8` 1.200 KG | sep | 2×600 | vehículo **ABC123** | [ ] |
| E9 | P9 | `PR9` 1.000 UN | _(sin venc.)_ | 1 | A-R2-N2-P1 | [ ] |
| E10 | P10 | `FS10` **1** UN (mínimo) | _(sin venc.)_ | 1 | borde: cantidad 1 | [ ] |

Verificaciones:
- [ ] Cada confirmación genera un código **RLNE-2026-xxxxxx** y muestra el panel verde.
- [ ] E5 queda **PROVISORIO** (pendiente de regularización) y aparece en la franja de pendientes.
- [ ] E7: el panel verde dice "📎 1 adjunto guardado en la bitácora"; se ve en la bitácora del remito.
- [ ] Stock de P1 = 16.000 (12.000 + 4.000) repartido en 8 pallets.

🔎 Detecta: multi-lote, multi-producto, entrada provisoria, adjunto en el formulario, KG, cantidad mínima, vinculación de vehículo, código correlativo.

---

## 4. Salidas — 10 despachos (incluye FEFO y negativos)

| # | Producto | Cantidad / modo | Esperado | OK |
|---|----------|-----------------|----------|----|
| S1 | P1 | 3.000 (FEFO) | Consume primero **`L1-JUN`** (vence pronto), no `L1-AGO` → L1-JUN queda 1.000 | [ ] |
| S2 | P1 | 1.500 | Se descuenta del resto de `L1-JUN` (1.000) y sigue por `L1-AGO` (500) → un pallet queda **PARCIAL** | [ ] |
| S3 | P2 | 4.000 | FEFO entre `M1` (jul) y `M2` (nov): sale M1 (3.000) + M2 (1.000) | [ ] |
| S4 | P3 + P4 | remito multi-producto: P3 2.000, P4 10 PC | Un solo RLNS con 2 líneas | [ ] |
| S5 | P9 | 1.000 (todo el stock) | El pallet queda **EXITED**; stock P9 = 0 | [ ] |
| S6 | P10 | **5** (stock es 1) | ❌ **Stock insuficiente** — debe rechazar, no dejar stock negativo | [ ] |
| S7 | P7 | 9.000 (todo) con destino + vehículo BKH180 | Despacha; RLNS con destino y patente | [ ] |
| S8 | P6 | 500 KG (todo) | Stock P6 = 0; etiqueta/nota muestran KG | [ ] |
| S9 | P5 | intentar despachar el lote **provisorio** `PROV-01` | ❌ Debe bloquear (lote pendiente de regularización) | [ ] |
| S10 | P1 | 0 / vacío | ❌ Validación: cantidad debe ser > 0 | [ ] |

🔎 Detecta: **orden FEFO correcto** (S1/S3), salida parcial (S2), agotar lote (S5), **no sobreventa / no stock negativo** (S6), bloqueo de lote provisorio (S9), validación de cantidad (S10), destino+vehículo.

---

## 5. Ajustes de entrada/salida (editar movimiento + circuito de aprobación)

> Movimientos → selector **Ajuste entrada** → buscar la entrada → **✏ Editar**.

| # | Acción sobre… | Cambio | Esperado | OK |
|---|---------------|--------|----------|----|
| A1 | E1 | Editar MIC/Factura/Remito y transportadora (motivo ≥5 car.) | Se aplica **directo**, queda auditado; sin pasar por aprobación | [ ] |
| A2 | E1 | Renombrar el lote `L1-AGO` → `L1-AGOSTO` | Directo; los pallets `L1-AGO-Pn` se renombran en cascada | [ ] |
| A3 | E1 | Editar **Lote SAP** y F. Vencimiento del lote | Directo, auditado | [ ] |
| A4 | E1 | En la tabla de pallets, **reducir** un pallet de 2.000 → 1.500 | Genera **RLAO** (−500) en **Pendiente de aprobación**; stock NO cambia aún | [ ] |
| A5 | E1 | **➕ Agregar unidades**: +3.000 en 2 pallets nuevos | Genera **RLAI** (+3.000) pendiente; stock NO cambia aún | [ ] |
| A6 | RLAO de A4 | Ir a Ajuste de inventario → aprobar | Recién ahí baja el stock y se descuenta del pallet | [ ] |
| A7 | RLAI de A5 | Aprobar | Stock sube; se crean los 2 pallets nuevos | [ ] |
| A8 | E9 | **⊘ Anular** la entrada | Crea RLAO compensatorio pendiente + marca **ANULACIÓN PENDIENTE**; al aprobar, la entrada queda **ANULADO** y el stock se corrige | [ ] |
| A9 | E2 | Reducir un pallet por **debajo** de lo disponible (ya despachado en S1/S2) | ❌ Avisa el máximo descontable; no permite sobre-descontar | [ ] |
| A10 | cualquiera | Guardar **sin motivo** o motivo < 5 caracteres | ❌ Validación del motivo | [ ] |

🔎 Detecta: edición directa auditada (A1-A3), edición por pallet + agregado (A4/A5), que el **stock solo se mueve al aprobar** (A6/A7), anulación con compensación (A8), tope de descuento (A9), motivo obligatorio (A10).

---

## 6. Ajuste de inventario (RLAI / RLAO standalone)

> Movimientos → **Ajuste de inventario**.

| # | Escenario | Datos | Esperado | OK |
|---|-----------|-------|----------|----|
| I1 | Sobrante por conteo | RLAI: P3 +200 UN, motivo **Conteo físico** | Borrador → enviar → aprobar → stock P3 +200 | [ ] |
| I2 | Merma | RLAO: P4 −5 PC, motivo **Merma** | Aprobado → stock P4 −5 | [ ] |
| I3 | Multi-producto | RLAI con P1 +100 y P7 +50 en una solicitud | Una solicitud, 2 líneas; al aprobar mueve ambos | [ ] |
| I4 | Rechazo | Crear RLAO P8 −1.000, enviar, **rechazar** con motivo | Vuelve a **Borrador**, stock intacto | [ ] |
| I5 | Anular borrador | Crear y luego **anular** un borrador | Queda Rechazado; nunca tocó stock | [ ] |

🔎 Detecta: circuito borrador→pendiente→aprobado/rechazado, multi-línea, que un rechazo/anulación **no** mueva stock.

---

## 7. Transferencias (flujo origen-primero, multi-producto)

| # | Acción | Datos | Esperado | OK |
|---|--------|-------|----------|----|
| TR1 | Mover contenido | Origen **A-R1-N1-P1**, destino **A-R2-N2-P1**; seleccionar pallets de P1 | Muestra todo el contenido del origen sin elegir producto; transfiere | [ ] |
| TR2 | Multi-producto | Origen con 2 productos → seleccionar pallets de ambos | Un botón "⇄ Transferir N pallets" mueve todo en una operación | [ ] |
| TR3 | Verificar | Tras TR1/TR2 | El stock cambia de celda; los pallets aparecen en la ubicación destino; el origen ya no los lista | [ ] |
| TR4 | Mismo origen/destino | elegir misma ubicación en ambos | ❌ Debe rechazar (origen = destino) | [ ] |
| TR5 | Encadenar | Tras transferir, repetir con otro destino | Mantiene origen/destino, limpia selección | [ ] |

🔎 Detecta: selección multi-producto por ubicación, movimiento de stock+pallet, validación origen≠destino.

---

## 8. KPIs, salud de inventario e historial

| # | Dónde | Esperado | OK |
|---|-------|----------|----|
| K1 | Depósitos → mapa | Las celdas con pallets se ven ocupadas (color + número); ocupación % coherente | [ ] |
| K2 | Reportes → **KPIs Almacén** → Ocupación | Ubicaciones ocupadas/libres y pallets vs capacidad por depósito | [ ] |
| K3 | KPIs Almacén → Rotación | P1/P2 (con salidas) aparecen en **top movers**; un producto con stock y **sin** salidas figura en **stock estancado** | [ ] |
| K4 | KPIs Almacén → Dwell-time | Pallets muestran antigüedad en días; buckets 0-7/8-30/…; pallet-días acumulados > 0 | [ ] |
| K5 | `GET /reports/inventory-health` | Tras E/S/ajustes con pallets: **`ok: true`** (Stock = Lote = Pallet) | [ ] |
| K6 | inventory-health tras un **ajuste bulk sin pallets** (I2) | Puede mostrar **divergencia** para ese producto → correcto que la detecte | [ ] |
| T-HIST | Transportes → BKH180 → Historial | Aparecen los remitos E1, S7 (vinculados por patente) | [ ] |

🔎 Detecta: ocupación real, rotación/dead-stock, antigüedad (base de facturación), el **invariante de las tres contabilidades**, y el historial de viajes del vehículo.

---

## 9. Impresos (notas y etiquetas)

| # | Acción | Esperado | OK |
|---|--------|----------|----|
| PR1 | Imprimir **Nota de entrada** de E3 (multi-lote) | La columna **LOTE** muestra `M1` y `M2` con su SAP; **VENCIMIENTO** por lote (no "—") | [ ] |
| PR2 | Imprimir **Etiquetas de pallet** de E6 (KG) | QR + Lote + SAP; la unidad/peso se muestra correctamente para KG | [ ] |
| PR3 | Revisar cualquier nota/etiqueta | Dice **MIC/Factura/Remito** (no "Remito proveedor"/"N° documento") | [ ] |

🔎 Detecta: que la nota **estire los lotes** (bug corregido), etiquetas con QR/peso, y el renombre **MIC/Factura/Remito** en impresos.

---

## 10. Casos borde / caza-bugs (revisar al final)

- [ ] **B1 — FEFO estricto:** confirmá que S1 sacó `L1-JUN` (vence antes) y no `L1-AGO`, aunque L1-AGO se cargó primero.
- [ ] **B2 — Sin stock negativo:** ningún producto debe quedar con stock < 0 tras S6 y todos los despachos.
- [ ] **B3 — Invariante:** `inventory-health` en `ok:true` salvo donde hiciste ajustes bulk a propósito (K6).
- [ ] **B4 — MIC/Factura/Remito en todo:** formularios, buscadores, reportes (tab Entradas), export Excel/PDF, impresos, historial de pallet → en ningún lado quedó "Remito"/"Documento" suelto para ese campo. (Los códigos internos **RLNE/RLNS** SÍ siguen como "remito"/nota — es correcto.)
- [ ] **B5 — Provisorio bloquea salida:** S9 no dejó despachar el lote provisorio.
- [ ] **B6 — Adjuntos por entidad:** los archivos de un remito, de un ajuste y de un vehículo no se mezclan entre sí.
- [ ] **B7 — Aprobación mueve stock:** en A4/A5 el stock NO cambió hasta aprobar (A6/A7).
- [ ] **B8 — Concurrencia (opcional, avanzado):** si podés, disparar dos salidas del mismo producto casi simultáneas → el total despachado nunca supera el stock (lo cubren los locks + el test automático `npm test`).

---

### Resumen de cobertura
Productos (unidades/apilable/mínimos) · Estructura de depósito · Flota (ficha, choferes,
estados, inspecciones, adjuntos, historial) · Entradas (multi-lote/producto, provisoria,
KG, adjuntos) · Salidas (FEFO, parciales, agotar, negativos) · Ajustes con aprobación
(por pallet, agregado, anulación) · Ajuste de inventario · Transferencias multi-producto ·
KPIs (ocupación/rotación/dwell/invariante) · Impresos · Casos negativos.
