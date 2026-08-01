# RL Logística — Guía rápida de uso

Guía de primer uso para el personal operativo. Cada módulo explica para qué sirve, qué cargar
y qué pasa con el stock después de confirmar.

> **Regla base:** el stock **solo se mueve cuando confirmás** una entrada, una salida o una
> transferencia. Mirar, buscar o imprimir nunca cambia nada.

---

## Tu día en el depósito

| | Paso | Qué hacés |
|---|---|---|
| 1 | Llega el camión | Registrás una **Entrada** con el remito del proveedor |
| 2 | Guardás | Indicás en qué ubicación quedan los palets |
| 3 | *(si hace falta)* | **Transferencia** entre ubicaciones |
| 4 | Sale un pedido | Registrás una **Salida**; el sistema elige los lotes |
| 5 | Controlás | **Reportes** para ver stock y vencimientos |

---

## Antes de empezar

### Iniciar sesión

Tu usuario y contraseña te los da el administrador.

Después de **5 intentos fallidos** el sistema te bloquea un minuto. Esperá y volvé a intentar.

Tu **rol** define qué podés hacer. El menú de la izquierda ya te muestra solo lo que te
corresponde: si no ves una opción, no es un error.

| Podés… | Operador | Gerente | Admin | Auditor |
|---|:---:|:---:|:---:|:---:|
| Cargar entradas, salidas y transferencias | Sí | Sí | Sí | No |
| Pedir un ajuste o una corrección | Sí | Sí | Sí | No |
| **Aprobar** ajustes y correcciones | No | Sí | Sí | No |
| Regularizar entradas provisorias | No | Sí | Sí | No |
| Dar de baja materiales, depósitos o ubicaciones | No | Sí | Sí | No |
| Administrar usuarios | No | No | Sí | No |
| Ver todo y exportar | Sí | Sí | Sí | Sí |

### Dashboard — *Menú → Dashboard*

La pantalla de inicio: materiales con stock, unidades totales, movimientos del período,
**lotes por vencer**, alertas y últimos movimientos. Arriba podés filtrar por período y depósito.

 Si aparece una alerta de **lote por vencer**, avisá a tu supervisor: ese material debería salir primero.

---

## Configuración *(se hace una vez, al arrancar)*

### Materiales — *Menú → Materiales*

El catálogo de lo que manejás. Un material tiene que existir acá antes de poder recibirlo.

**Cargás:** código (del proveedor o SAP) · descripción · unidad (UN, KG, MIL, PC…) · si es
apilable y cuántos niveles · si recibe peso encima.

**Pasos:** completá código y descripción → elegí la unidad → marcá apilable / recibe peso →
**Guardar material**.

> *Ejemplo:* código `40004808`, «ROLHA MET BRAHMA 940CC», unidad UN, apilable.

-  No podés repetir un código. Si ya existe, buscalo en la lista en vez de crear otro.
-  Las cantidades son **números enteros**. Un material en KG no admite 12,5 — cargá 12 o 13.
- **Dar de baja** un material que ya tuvo movimientos no lo borra: queda inactivo y su historial se conserva.

### Depósitos — *Menú → Depósitos*

Los galpones donde guardás. Acá también ves el **mapa de ocupación**: pasillos, racks y niveles,
con cuántos palets hay en cada posición y el % de ocupación.

**Cargás:** nombre y dirección.

- No se puede eliminar un depósito que tiene ubicaciones o stock. Primero hay que vaciarlo.

### Ubicaciones — *Menú → Ubicaciones*

Las posiciones concretas donde apoyás un palet. Son las que elegís al recibir o transferir.

**Cómo se leen:** `A-F1-N2-P3` = pasillo **A**, fila **1**, nivel **2**, posición **3**.
Las de recepción suelen ser `REC-P1`, `REC-P2`…

**Crear muchas de una vez:** con **⚙ Generar estructura** (desde Depósitos) indicás pasillos,
racks, niveles y posiciones, y se crean todas juntas.
-  Si generás dos veces lo mismo, no se duplica: te avisa cuántas ya existían.
- No se puede eliminar una ubicación que tiene palets. Transferí el contenido primero.

---

## Operación diaria

### Entrada — *Movimientos → Entrada*

Registrar mercadería que llega. Es lo que crea los lotes y los palets.

**Cargás:** material · ubicación destino · por cada palet: código de lote, cantidad y
vencimiento · datos del remito: N° MIC/Factura/Remito, proveedor, transportadora, vehículo.

**Pasos:**
1. Elegí **Entrada** y buscá el material (o abrí **Ver productos**).
2. Elegí la ubicación en el mapa guiado.
3. Cargá los lotes con su cantidad y vencimiento. Podés poner varios lotes.
4. Completá los datos del remito.
5. **Registrar remito**.

**Después:** se genera un código `RLNE-2026-000001`, sube el stock, se crean o actualizan los
**lotes** y se crea un **palet por cada línea** (`L1-AGO-P1`, `L1-AGO-P2`…). Podés imprimir la
nota y las etiquetas.

> *Ejemplo:* llegan 12.000 tapas en 6 palets de 2.000, lote `L1-AGO`, vence en agosto. Cargás
> 6 líneas de 2.000 y quedan 6 palets en `A-F1-N1-P1`.

-  Si te equivocás en un renglón, el remito **completo** no se guarda. Corregí y volvé a enviar: no queda nada a medias.

### Entrada provisoria — *Movimientos → Entrada → marcar «provisoria»*

Para cuando la mercadería llega pero **falta el remito definitivo**.

- **Cuándo sí:** el camión descarga y el papel viene después, o el N° de factura está mal.
- **Cuándo no:** si tenés el remito en la mano. Una provisoria deja el material **bloqueado para salidas**.

- La **observación es obligatoria**: explicá qué falta. Ej.: «Pendiente revisar remito del proveedor».
- Aparece una franja **Pendientes de regularización** arriba de Movimientos, para que nadie se olvide.

### Salida — *Movimientos → Salida*

Despachar mercadería. El sistema te propone los lotes en orden de vencimiento.

**Cargás:** material · cantidad por lote · destino, N° de remito, transportadora y vehículo.

**Pasos:**
1. Elegí **Salida** y el material.
2. El panel muestra los lotes **del que vence primero al que vence último**.
3. Escribí la cantidad en el lote que corresponde; el sistema tilda los palets solo.
4. Completá destino y datos del transporte.
5. **Registrar remito**.

**Después:** se genera `RLNS-2026-000001`, baja el stock y el lote, y cada palet queda
**Despachado** (si salió entero) o **Parcial** (si quedó saldo).

> *Ejemplo:* pedís 3.000 y hay dos lotes: uno que vence en 7 días con 4.000 y otro en 200 días
> con 13.000. El sistema saca del que vence antes: quedan 1.000 de ese lote y el otro no se toca.

- No podés despachar más de lo que hay. Si pedís de más, el sistema **no despacha de menos en silencio**: te avisa cuánto falta y no registra nada.
- Un lote de entrada **provisoria** no se puede despachar hasta que se regularice.

### Transferencia — *Movimientos → Transferencia*

Mover palets de una ubicación a otra. No cambia el stock total, solo dónde está.

**Pasos:** elegí la **ubicación origen** (se listan los palets que hay ahí) → tildá los que vas
a mover (pueden ser de distintos materiales) → elegí la **ubicación destino** → **⇄ Transferir**.

- Los palets se mueven **enteros**. Si necesitás mover solo una parte, hablá con tu supervisor: hay que dividir el palet primero.
- Origen y destino no pueden ser la misma ubicación.

### Lotes y Palets — *Menú → Lotes · Palets*

Pantallas de **consulta**. No se cargan a mano: se crean solos con las entradas.

- **Lotes:** buscás por material y ves lote, lote SAP, vencimiento y cuánto queda. Responde
  «¿qué tengo de este material y para cuándo vence?».
- **Palets:** cada palet físico, con su ubicación y estado.

| Estado | Significa |
|---|---|
| **Disponible** | Entero, listo para salir |
| **Parcial** | Salió una parte |
| **Despachado** | Ya salió todo |
| **Bloqueado / Dañado** | No se usa |

- Los palets **no se borran nunca**: así queda el historial completo de qué entró y qué salió.

---

## Cuando algo salió mal

> Todo lo que cambie cantidades **pasa por aprobación del gerente**. Vos lo pedís con un motivo;
> el stock recién se mueve cuando lo aprueban. Si te equivocaste, no borres: pedí la corrección.

### Corregir movimiento — *Movimientos → Corregir movimiento*

Arreglar una entrada o salida **ya registrada**.

- **Se aplica solo:** datos que no tocan cantidades — N° de remito, proveedor, transportadora,
  chofer, destino, código de lote, lote SAP, vencimiento. Queda registrado quién lo cambió y por qué.
- **Va a aprobación:** cambios de **cantidad** (reducir lo que trajo un palet, o agregar unidades
  que aparecieron).
- **Anular:** con **⊘ Anular** das de baja toda la entrada o salida. También pasa por aprobación.

> *Ejemplo:* cargaste 2.000 en un palet pero eran 1.500. Pedís la corrección con el motivo; al
> aprobarla, el stock baja 500.

- El **motivo es obligatorio** y debe tener al menos 5 caracteres.
- Si la mercadería de esa entrada **ya salió** del depósito, no se puede anular. Ahí corresponde una **Diferencia de inventario**.

### Diferencia de inventario — *Movimientos → Diferencia de inventario*

Corregir el stock cuando lo que contás **no coincide** con lo que dice el sistema, sin que haya
una entrada o salida de por medio.

**Cargás:** motivo (conteo físico, merma, pérdida, rotura, sobrante, obsoleto…) · depósito y
ubicación · el material y la cantidad contada.

**Circuito:** **Borrador** (lo armás, todavía no impacta) → **Enviar a aprobación** → el gerente
**aprueba** (recién ahí cambia el stock) o **rechaza** (vuelve a borrador).

> *Ejemplo:* contás 200 unidades de más en el conteo mensual → ajuste de entrada, motivo «Conteo
> físico». Se rompen 5 bidones → ajuste de salida, motivo «Rotura».

- Mientras esté en borrador o pendiente, **el stock no cambió**. Podés anularlo sin consecuencias.

### Regularización — *Movimientos → franja «Pendientes de regularización»*

Cerrar una entrada provisoria cuando llegan los datos definitivos. La hace el **gerente**.

**Pasos:** en la franja de pendientes, **Regularizar datos** → escribí el motivo y completá lo
que faltaba (N° de remito, proveedor, vencimiento…) → **Regularizar y cerrar**.

**Después:** la entrada deja de estar pendiente y el material **queda liberado para despachar**.

- El stock no cambia: ya había entrado. Lo único que cambia es que se destraba.

---

## Consulta y control

### Reportes — *Menú → Reportes*

| Pestaña | Te responde |
|---|---|
| **Stock actual** | ¿Qué tengo y en qué ubicación, ahora mismo? |
| **Historial** | ¿Qué movimientos se hicieron en un período? |
| **Entradas** / **Salidas** | Detalle de lo que entró o salió |
| **Lotes & SAP** | Equivalencia entre lote del proveedor y lote SAP |
| **Control diario** | El stock a una fecha determinada |
| **Trazabilidad** | Toda la historia de un material |
| **Control Frescura** | Qué vence pronto |
| **KPIs Almacén** | Ocupación, rotación y antigüedad de los palets |

- Casi todas se exportan a **Excel, PDF o CSV** con los botones de arriba a la derecha.

### Registros — *Menú → Registros*

El archivo de todos los remitos de entrada y salida.

Sirve para buscar un remito por número, proveedor, destino o fecha · reimprimir la **nota** 🖨 o
las **etiquetas** 🏷 · ver los archivos adjuntos.

**Auditoría:** cada remito guarda quién lo creó, cuándo, y toda corrección posterior con su
motivo. **Nada se pierde y nada se edita sin dejar rastro.**

### Transportes — *Menú → Transportes*

La flota: fichas de vehículos, choferes e inspecciones.

**Cargás:** patente · tipo · capacidad en palets y kg · choferes con CI y teléfono · fotos y documentos.

**Pestañas:** Choferes · Documentos & Foto · **Historial de viajes** (los remitos cargados con esa
patente) · Inspecciones.

- Si cargás la patente al registrar una entrada o salida, el viaje aparece solo en el historial del vehículo.
- No se puede repetir una patente.

### Usuarios — *Menú → Usuarios (solo Admin)*

Altas, roles y contraseñas. **Cargás:** usuario, nombre completo, contraseña (mínimo 6
caracteres) y rol.

- **Desactivar** no borra: la persona no puede entrar más, pero se conserva qué movimientos hizo. Se puede reactivar.

---

## Mensajes que vas a ver

| El sistema dice… | Qué hacer |
|---|---|
| «Stock insuficiente…» | Pedís más de lo que hay. Revisá la cantidad o el material. |
| «Cantidad seleccionada insuficiente…» | Los palets tildados no llegan a lo que pediste. Tildá más palets o bajá la cantidad. |
| «El lote está pendiente de regularización» | Vino de una entrada provisoria. Pedile al gerente que la regularice. |
| «No se puede eliminar… tiene stock» | Vaciá primero la ubicación, el material o el depósito. |
| «El palet ya fue despachado» | Ese palet salió. Elegí otro o revisá el historial. |
| «Demasiados intentos de inicio de sesión» | Esperá un minuto antes de volver a probar. |
| «El motivo debe tener al menos 5 caracteres» | Explicá el cambio con una frase, no con una letra. |

---

## Cinco reglas de oro

1. **Primero sale lo que vence antes.** El sistema ya te lo ordena; no lo saltees a mano.
2. **No borres, corregí.** Toda corrección queda registrada. Borrar rompe el historial.
3. **Motivo siempre.** El que revise mañana necesita entender qué pasó.
4. **La ubicación importa.** Un palet mal ubicado es un palet perdido.
5. **Ante la duda, no confirmes.** Preguntá: deshacer cuesta más que preguntar.

---

*Los códigos `RLNE` son remitos de entrada, `RLNS` de salida, `RLAI` y `RLAO` ajustes de
inventario. Ante cualquier duda operativa, consultá a tu supervisor antes de confirmar.*
