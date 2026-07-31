/* FASE 4 — Ajustes de inventario, correcciones de movimiento, anulaciones, regularización. */
const { GET, POST, PATCH, db, closeDb, record, save, tokens, tripleCheck } = require('./lib');
const fs = require('fs');
const path = require('path');

const S = JSON.parse(fs.readFileSync(path.join(__dirname, 'state.json'), 'utf8'));
Object.assign(tokens, S.tokens);
const P = S.products;
const L = S.locs;

(async () => {
  let r;

  /* ══════════════ AJUSTE DE INVENTARIO (RLAI / RLAO) ══════════════ */
  const p3 = P['40007857'];
  let before = await tripleCheck(p3);

  r = await POST('/adjustments', {
    type: 'ADJUSTMENT_IN', reason: 'CONTEO_FISICO', warehouseId: S.wh1, locationId: L['A-F1-N3-P1'],
    notes: 'Sobrante detectado en conteo físico',
    lines: [{ productId: p3, palletItems: [{ lotCode: 'CONTEO-01', quantity: 200 }] }],
  }, tokens.OPERATOR);
  const adj1 = r.data?.requestId;
  const afterDraft = await tripleCheck(p3);
  record({
    id: 'AJU-01', module: 'Ajustes de inventario', caso: 'Crear ajuste de entrada en borrador (no debe mover stock)',
    pasos: 'POST /adjustments type=ADJUSTMENT_IN +200',
    esperado: `201 con código RLAI y stock sin cambios (${before.stock})`,
    obtenido: `${r.status} code=${r.data?.code} stock=${afterDraft.stock}`,
    ok: r.status === 201 && /^RLAI-/.test(r.data?.code || '') && afterDraft.stock === before.stock, crit: 'ALTA',
  });

  r = await PATCH(`/adjustments/${adj1}/approve`, {}, tokens.MANAGER);
  record({
    id: 'AJU-02', module: 'Ajustes de inventario', caso: 'Aprobar un ajuste que sigue en BORRADOR',
    pasos: 'PATCH /adjustments/:id/approve sin haberlo enviado a aprobación',
    esperado: '400 — solo se aprueban solicitudes PENDIENTE_APROBACION',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 110)}`,
    ok: r.status === 400, crit: 'ALTA',
  });

  await PATCH(`/adjustments/${adj1}/submit`, {}, tokens.OPERATOR);
  r = await PATCH(`/adjustments/${adj1}/approve`, {}, tokens.OPERATOR);
  record({
    id: 'AJU-03', module: 'Ajustes de inventario', caso: 'OPERATOR intenta aprobar su propio ajuste',
    pasos: 'PATCH /adjustments/:id/approve con token OPERATOR',
    esperado: '403 — la aprobación es de ADMIN/MANAGER',
    obtenido: `${r.status}`, ok: r.status === 403, crit: 'CRÍTICA',
  });

  r = await PATCH(`/adjustments/${adj1}/approve`, {}, tokens.MANAGER);
  const afterApprove = await tripleCheck(p3);
  record({
    id: 'AJU-04', module: 'Ajustes de inventario', caso: 'MANAGER aprueba el ajuste: recién ahí se mueve el stock',
    pasos: 'PATCH /adjustments/:id/approve con token MANAGER',
    esperado: `200 y stock ${before.stock} → ${before.stock + 200} en las tres contabilidades`,
    obtenido: `${r.status} stock=${afterApprove.stock} lote=${afterApprove.lote} pallet=${afterApprove.pallet}`,
    ok: r.status === 200 && afterApprove.stock === before.stock + 200
        && afterApprove.lote === before.lote + 200 && afterApprove.pallet === before.pallet + 200,
    crit: 'CRÍTICA',
  });

  r = await PATCH(`/adjustments/${adj1}/approve`, {}, tokens.MANAGER);
  const afterDouble = await tripleCheck(p3);
  record({
    id: 'AJU-05', module: 'Ajustes de inventario', caso: 'Re-aprobar un ajuste ya aprobado',
    pasos: 'PATCH /approve dos veces sobre la misma solicitud',
    esperado: '400 y stock sin doble impacto',
    obtenido: `${r.status} stock=${afterDouble.stock}`,
    ok: r.status === 400 && afterDouble.stock === afterApprove.stock, crit: 'CRÍTICA',
  });

  /* ── Doble aprobación CONCURRENTE ── */
  before = await tripleCheck(p3);
  r = await POST('/adjustments', {
    type: 'ADJUSTMENT_IN', reason: 'SOBRANTE', warehouseId: S.wh1, locationId: L['A-F1-N3-P1'],
    lines: [{ productId: p3, palletItems: [{ lotCode: 'RACE-ADJ', quantity: 500 }] }],
  }, tokens.OPERATOR);
  const raceAdj = r.data?.requestId;
  await PATCH(`/adjustments/${raceAdj}/submit`, {}, tokens.OPERATOR);
  const [ap1, ap2] = await Promise.all([
    PATCH(`/adjustments/${raceAdj}/approve`, {}, tokens.MANAGER),
    PATCH(`/adjustments/${raceAdj}/approve`, {}, tokens.ADMIN),
  ]);
  const afterRace = await tripleCheck(p3);
  const raceMovs = await db(`SELECT count(*)::int c FROM movements WHERE "adjustmentReason"='SOBRANTE'`);
  record({
    id: 'AJU-06', module: 'Ajustes de inventario', caso: 'Dos aprobaciones simultáneas de la misma solicitud',
    pasos: 'Promise.all de PATCH /approve con MANAGER y ADMIN sobre la misma solicitud (+500)',
    esperado: 'Una aprueba y la otra falla; stock sube 500 una sola vez',
    obtenido: `A=${ap1.status} B=${ap2.status} · stock ${before.stock}→${afterRace.stock} (esperado ${before.stock + 500}) · movimientos generados=${raceMovs[0].c}`,
    ok: afterRace.stock === before.stock + 500 && raceMovs[0].c === 1, crit: 'CRÍTICA',
    nota: 'AdjustmentsService.approve() re-lee la solicitud con manager.findOne SIN lock pesimista, pese al comentario del código.',
  });

  /* ── Rechazo y anulación de borrador ── */
  before = await tripleCheck(P['50112233']);
  const palHM = (await db(`SELECT p.id FROM pallets p JOIN lots l ON l.id=p."lotId" WHERE l."lotCode"='HM8' AND p.status<>'EXITED' LIMIT 1`))[0].id;
  r = await POST('/adjustments', {
    type: 'ADJUSTMENT_OUT', reason: 'MERMA', warehouseId: S.wh1,
    lines: [{ productId: P['50112233'], palletItems: [{ palletId: palHM, quantity: 100 }] }],
  }, tokens.OPERATOR);
  const adjRej = r.data?.requestId;
  await PATCH(`/adjustments/${adjRej}/submit`, {}, tokens.OPERATOR);
  r = await PATCH(`/adjustments/${adjRej}/reject`, { rejectReason: 'No corresponde, revisar conteo' }, tokens.MANAGER);
  const afterReject = await tripleCheck(P['50112233']);
  const rejStatus = (await db(`SELECT status FROM adjustment_requests WHERE id=$1`, [adjRej]))[0]?.status;
  record({
    id: 'AJU-07', module: 'Ajustes de inventario', caso: 'Rechazar una solicitud enviada a aprobación',
    pasos: 'PATCH /adjustments/:id/reject con motivo',
    esperado: 'Vuelve a BORRADOR y el stock queda intacto',
    obtenido: `${r.status} estado=${rejStatus} stock ${before.stock}→${afterReject.stock}`,
    ok: r.status === 200 && rejStatus === 'BORRADOR' && afterReject.stock === before.stock, crit: 'ALTA',
  });

  r = await PATCH(`/adjustments/${adjRej}/cancel`, {}, tokens.MANAGER);
  const cancelStatus = (await db(`SELECT status FROM adjustment_requests WHERE id=$1`, [adjRej]))[0]?.status;
  const afterCancel = await tripleCheck(P['50112233']);
  record({
    id: 'AJU-08', module: 'Ajustes de inventario', caso: 'Anular un borrador de ajuste',
    pasos: 'PATCH /adjustments/:id/cancel',
    esperado: 'Queda RECHAZADO y nunca tocó stock',
    obtenido: `${r.status} estado=${cancelStatus} stock=${afterCancel.stock}`,
    ok: r.status === 200 && cancelStatus === 'RECHAZADO' && afterCancel.stock === before.stock, crit: 'MEDIA',
  });

  r = await POST('/adjustments', {
    type: 'ADJUSTMENT_IN', reason: 'CONTEO_FISICO', warehouseId: S.wh1, locationId: L['A-F1-N3-P1'],
    lines: [],
  }, tokens.OPERATOR);
  record({
    id: 'AJU-09', module: 'Ajustes de inventario', caso: 'Crear ajuste sin líneas',
    pasos: 'POST /adjustments lines=[]',
    esperado: '400 ArrayMinSize',
    obtenido: `${r.status}`, ok: r.status === 400, crit: 'MEDIA',
  });

  r = await POST('/adjustments', {
    type: 'ADJUSTMENT_IN', reason: 'CONTEO_FISICO',
    lines: [{ productId: p3, palletItems: [{ lotCode: 'SIN-DEPOSITO', quantity: 10 }] }],
  }, tokens.OPERATOR);
  record({
    id: 'AJU-10', module: 'Ajustes de inventario', caso: 'Ajuste de entrada sin depósito',
    pasos: 'POST /adjustments ADJUSTMENT_IN sin warehouseId',
    esperado: '400 — sin depósito el pallet quedaría sin ubicación (stock fantasma)',
    obtenido: `${r.status}`, ok: r.status === 400, crit: 'ALTA',
  });

  // Ajuste de salida por encima del saldo del pallet
  const palHM2 = (await db(`SELECT p.id, p.quantity FROM pallets p JOIN lots l ON l.id=p."lotId" WHERE l."lotCode"='HM8' AND p.status<>'EXITED' LIMIT 1`))[0];
  before = await tripleCheck(P['50112233']);
  r = await POST('/adjustments', {
    type: 'ADJUSTMENT_OUT', reason: 'ROTURA', warehouseId: S.wh1,
    lines: [{ productId: P['50112233'], palletItems: [{ palletId: palHM2.id, quantity: palHM2.quantity + 400 }] }],
  }, tokens.OPERATOR);
  const adjOver = r.data?.requestId;
  await PATCH(`/adjustments/${adjOver}/submit`, {}, tokens.OPERATOR);
  const apr = await PATCH(`/adjustments/${adjOver}/approve`, {}, tokens.MANAGER);
  const afterOver = await tripleCheck(P['50112233']);
  record({
    id: 'AJU-11', module: 'Ajustes de inventario', caso: 'Ajuste de salida por encima del saldo del pallet',
    pasos: `ADJUSTMENT_OUT de ${palHM2.quantity + 400} sobre un pallet con ${palHM2.quantity}`,
    esperado: 'Rechazo al aprobar; stock, lote y pallet siguen coherentes',
    obtenido: `aprobación=${apr.status} · stock ${before.stock}→${afterOver.stock}, lote ${before.lote}→${afterOver.lote}, pallet ${before.pallet}→${afterOver.pallet}`,
    ok: apr.status === 400 && afterOver.stock === afterOver.lote && afterOver.lote === afterOver.pallet,
    crit: 'CRÍTICA',
  });

  /* ══════════════ CORRECCIÓN DE MOVIMIENTOS ══════════════ */
  const movE1 = (await db(`SELECT id FROM movements WHERE "documentId"=$1`, [S.entries.E1.documentId]))[0].id;

  r = await PATCH(`/movements/${movE1}/edit`, {
    reason: 'Corrección del número de factura del proveedor',
    documentNumber: '001-001-0009999', carrier: 'TRANSPORTES SRL',
  }, tokens.OPERATOR);
  const movAfter = (await db(`SELECT "documentNumber", carrier FROM movements WHERE id=$1`, [movE1]))[0];
  const logs = await db(`SELECT field, "oldValue", "newValue", reason FROM regularization_logs WHERE "movementId"=$1 ORDER BY field`, [movE1]);
  record({
    id: 'COR-01', module: 'Correcciones', caso: 'Editar metadatos de una entrada ya posteada (aplicación directa + auditoría)',
    pasos: 'PATCH /movements/:id/edit con motivo, documentNumber y carrier nuevos',
    esperado: 'Cambios aplicados y registrados en regularization_logs con el motivo',
    obtenido: `${r.status} doc=${movAfter.documentNumber} carrier=${movAfter.carrier} logs=${logs.length}`,
    ok: r.status === 200 && movAfter.documentNumber === '001-001-0009999' && logs.length === 2, crit: 'ALTA',
  });

  r = await PATCH(`/movements/${movE1}/edit`, { reason: 'abc', documentNumber: 'X' }, tokens.OPERATOR);
  record({
    id: 'COR-02', module: 'Correcciones', caso: 'Editar con motivo de menos de 5 caracteres',
    pasos: 'PATCH /movements/:id/edit reason="abc"',
    esperado: '400 el motivo debe tener al menos 5 caracteres',
    obtenido: `${r.status}`, ok: r.status === 400, crit: 'MEDIA',
  });

  const lotAgo = (await db(`SELECT id FROM lots WHERE "lotCode"='L1-AGO'`))[0].id;
  r = await POST(`/movements/${movE1}/request-quantity-edit`, {
    reason: 'Renombrar el lote según el remito del proveedor',
    lots: [{ lotId: lotAgo, newLotCode: 'L1-AGOSTO' }],
  }, tokens.OPERATOR);
  const renamed = await db(`SELECT "lotCode" FROM lots WHERE id=$1`, [lotAgo]);
  const renamedPallets = await db(`SELECT code FROM pallets WHERE "lotId"=$1 ORDER BY code LIMIT 3`, [lotAgo]);
  record({
    id: 'COR-03', module: 'Correcciones', caso: 'Renombrar el código de lote con cascada a los pallets',
    pasos: 'POST /movements/:id/request-quantity-edit newLotCode=L1-AGOSTO',
    esperado: 'Lote renombrado y pallets L1-AGOSTO-Pn',
    obtenido: `${r.status} lote=${renamed[0]?.lotCode} pallets=${renamedPallets.map((p) => p.code).join(', ')}`,
    ok: r.status === 201 && renamed[0]?.lotCode === 'L1-AGOSTO' && renamedPallets.every((p) => p.code.startsWith('L1-AGOSTO-P')),
    crit: 'ALTA',
  });

  // Reducir un pallet → RLAO pendiente (el stock NO debe moverse todavía)
  const palE1 = (await db(
    `SELECT p.id, p.quantity, p.code FROM pallets p JOIN movement_details md ON md."palletId"=p.id
     WHERE md."movementId"=$1 AND p.status<>'EXITED' AND p.quantity>0 ORDER BY p.code LIMIT 1`, [movE1]))[0];
  before = await tripleCheck(P['40004808']);
  r = await POST(`/movements/${movE1}/request-quantity-edit`, {
    reason: 'Se recibieron 500 unidades menos que lo declarado',
    lots: [{ lotId: lotAgo, palletEdits: [{ palletId: palE1.id, newQuantity: palE1.quantity - 500 }] }],
  }, tokens.OPERATOR);
  const pendReq = r.data?.requests?.[0];
  const afterReq = await tripleCheck(P['40004808']);
  record({
    id: 'COR-04', module: 'Correcciones', caso: 'Reducir la cantidad de un pallet de una entrada',
    pasos: `POST request-quantity-edit newQuantity=${palE1.quantity - 500} sobre pallet ${palE1.code}`,
    esperado: 'Genera RLAO pendiente de aprobación; el stock NO cambia todavía',
    obtenido: `${r.status} solicitud=${pendReq?.code} tipo=${pendReq?.type} · stock ${before.stock}→${afterReq.stock}`,
    ok: r.status === 201 && pendReq?.type === 'ADJUSTMENT_OUT' && afterReq.stock === before.stock, crit: 'CRÍTICA',
  });

  r = await PATCH(`/adjustments/${pendReq?.requestId}/approve`, {}, tokens.MANAGER);
  const afterApprove2 = await tripleCheck(P['40004808']);
  const palNow = (await db(`SELECT quantity, status FROM pallets WHERE id=$1`, [palE1.id]))[0];
  record({
    id: 'COR-05', module: 'Correcciones', caso: 'Aprobar el RLAO de la corrección: recién ahí baja el stock',
    pasos: 'PATCH /adjustments/:id/approve del RLAO generado',
    esperado: `stock ${before.stock} → ${before.stock - 500} y el pallet queda en ${palE1.quantity - 500}`,
    obtenido: `${r.status} stock=${afterApprove2.stock} lote=${afterApprove2.lote} pallet=${afterApprove2.pallet} · pallet=${palNow.quantity} (${palNow.status})`,
    ok: r.status === 200 && afterApprove2.stock === before.stock - 500 && palNow.quantity === palE1.quantity - 500,
    crit: 'CRÍTICA',
  });

  // Agregar unidades → RLAI pendiente
  before = await tripleCheck(P['40004808']);
  r = await POST(`/movements/${movE1}/request-quantity-edit`, {
    reason: 'Aparecieron 3000 unidades más en el descargue',
    lots: [{ lotId: lotAgo, addQuantity: 3000, addPalletCount: 2 }],
  }, tokens.OPERATOR);
  const addReq = r.data?.requests?.[0];
  const afterAdd = await tripleCheck(P['40004808']);
  const apr2 = await PATCH(`/adjustments/${addReq?.requestId}/approve`, {}, tokens.MANAGER);
  const afterAddApprove = await tripleCheck(P['40004808']);
  const newPallets = await db(`SELECT count(*)::int c FROM pallets WHERE "lotId"=$1`, [lotAgo]);
  record({
    id: 'COR-06', module: 'Correcciones', caso: 'Agregar 3.000 unidades en 2 pallets nuevos y aprobar',
    pasos: 'POST request-quantity-edit addQuantity=3000 addPalletCount=2 → aprobar el RLAI',
    esperado: `Pendiente sin impacto; al aprobar, +3.000 en stock, lote y pallets, con 2 pallets nuevos`,
    obtenido: `solicitud=${addReq?.type} stockPendiente=${afterAdd.stock} · aprobación=${apr2.status} stock=${afterAddApprove.stock} lote=${afterAddApprove.lote} pallet=${afterAddApprove.pallet} · pallets del lote=${newPallets[0].c}`,
    ok: addReq?.type === 'ADJUSTMENT_IN' && afterAdd.stock === before.stock
        && afterAddApprove.stock === before.stock + 3000
        && afterAddApprove.lote === before.lote + 3000
        && afterAddApprove.pallet === before.pallet + 3000,
    crit: 'CRÍTICA',
  });

  // Reducir por debajo de lo disponible
  const palLow = (await db(
    `SELECT p.id, p.quantity FROM pallets p JOIN movement_details md ON md."palletId"=p.id
     WHERE md."movementId"=$1 AND p.status<>'EXITED' ORDER BY p.quantity ASC LIMIT 1`, [movE1]))[0];
  r = await POST(`/movements/${movE1}/request-quantity-edit`, {
    reason: 'Intento de reducir más de lo que hay disponible',
    lots: [{ lotId: lotAgo, palletEdits: [{ palletId: palLow.id, newQuantity: palLow.quantity + 10000 }] }],
  }, tokens.OPERATOR);
  record({
    id: 'COR-07', module: 'Correcciones', caso: 'En una entrada, subir la cantidad de un pallet por encima de su saldo',
    pasos: 'request-quantity-edit newQuantity mayor al saldo del pallet',
    esperado: '400 — en entradas solo se puede reducir',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 130)}`,
    ok: r.status === 400, crit: 'ALTA',
  });

  r = await POST(`/movements/${movE1}/request-quantity-edit`, {
    reason: 'ok motivo',
    lots: [{ lotId: (await db(`SELECT id FROM lots WHERE "lotCode"='M1'`))[0].id, newLotCode: 'AJENO' }],
  }, tokens.OPERATOR);
  record({
    id: 'COR-08', module: 'Correcciones', caso: 'Corregir un lote que no pertenece al movimiento',
    pasos: 'request-quantity-edit con lotId de otro movimiento',
    esperado: '400 el lote no pertenece a este movimiento',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 110)}`,
    ok: r.status === 400, crit: 'ALTA',
  });

  /* ══════════════ ANULACIÓN ══════════════ */
  // Se anula una entrada cuya mercadería sigue en el depósito (E6, 500 KG del lote T6).
  const movE6 = (await db(`SELECT id FROM movements WHERE "documentId"=$1`, [S.entries.E6.documentId]))[0].id;
  before = await tripleCheck(P['60030055']);
  r = await POST(`/movements/${movE6}/void`, {}, tokens.OPERATOR);
  const voidReq = r.data?.requestId;
  const voidStatus = (await db(`SELECT "voidStatus" FROM movements WHERE id=$1`, [movE6]))[0]?.voidStatus;
  const afterVoidReq = await tripleCheck(P['60030055']);
  record({
    id: 'ANU-01', module: 'Anulaciones', caso: 'Solicitar anulación de una entrada (genera compensación pendiente)',
    pasos: 'POST /movements/:id/void sobre una entrada con la mercadería aún en depósito',
    esperado: 'Movimiento en VOID_PENDING, RLAO pendiente, stock sin cambios',
    obtenido: `${r.status} code=${r.data?.code} voidStatus=${voidStatus} stock ${before.stock}→${afterVoidReq.stock}`,
    ok: r.status === 201 && voidStatus === 'VOID_PENDING' && afterVoidReq.stock === before.stock, crit: 'ALTA',
  });

  r = await POST(`/movements/${movE6}/void`, {}, tokens.OPERATOR);
  record({
    id: 'ANU-02', module: 'Anulaciones', caso: 'Solicitar anulación dos veces del mismo movimiento',
    pasos: 'POST /movements/:id/void repetido',
    esperado: '400 ya tiene una anulación pendiente',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 110)}`,
    ok: r.status === 400, crit: 'ALTA',
  });

  r = await PATCH(`/adjustments/${voidReq}/approve`, {}, tokens.MANAGER);
  const finalVoid = (await db(`SELECT "voidStatus" FROM movements WHERE id=$1`, [movE6]))[0]?.voidStatus;
  const afterVoid = await tripleCheck(P['60030055']);
  record({
    id: 'ANU-03', module: 'Anulaciones', caso: 'Aprobar la anulación: el movimiento queda VOIDED y el stock se corrige',
    pasos: 'PATCH /adjustments/:id/approve del RLAO de anulación',
    esperado: `voidStatus=VOIDED y stock ${before.stock} → ${before.stock - 500} coherente en las tres contabilidades`,
    obtenido: `${r.status} voidStatus=${finalVoid} stock=${afterVoid.stock} lote=${afterVoid.lote} pallet=${afterVoid.pallet}`,
    ok: r.status === 200 && finalVoid === 'VOIDED' && afterVoid.stock === before.stock - 500
        && afterVoid.stock === afterVoid.lote && afterVoid.lote === afterVoid.pallet,
    crit: 'CRÍTICA',
  });

  const movTrf = (await db(`SELECT id FROM movements WHERE type='TRANSFER' LIMIT 1`))[0]?.id;
  r = await POST(`/movements/${movTrf}/void`, {}, tokens.MANAGER);
  record({
    id: 'ANU-04', module: 'Anulaciones', caso: 'Intentar anular una transferencia',
    pasos: 'POST /movements/:id/void sobre un TRANSFER',
    esperado: '400 — las transferencias no se anulan automáticamente',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 110)}`,
    ok: r.status === 400, crit: 'MEDIA',
  });

  // Anular una entrada cuya mercadería ya salió: debe rechazarse al pedirlo, no
  // dejar el movimiento atascado en VOID_PENDING sin compensación aprobable.
  const movE9 = (await db(`SELECT id FROM movements WHERE "documentId"=$1`, [S.entries.E9.documentId]))[0].id;
  r = await POST(`/movements/${movE9}/void`, {}, tokens.MANAGER);
  const e9Status = (await db(`SELECT "voidStatus" FROM movements WHERE id=$1`, [movE9]))[0]?.voidStatus;
  record({
    id: 'ANU-06', module: 'Anulaciones', caso: 'Anular una entrada cuya mercadería ya fue despachada',
    pasos: 'POST /movements/:id/void sobre la entrada E9, cuyo stock salió en SAL-06',
    esperado: '400 con mensaje claro y el movimiento intacto (voidStatus=NONE)',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 150)} · voidStatus=${e9Status}`,
    ok: r.status === 400 && e9Status === 'NONE', crit: 'ALTA',
  });

  /* ══════════════ REGULARIZACIÓN DE PROVISORIO ══════════════ */
  const movProv = (await db(`SELECT id FROM movements WHERE status='PENDING_REGULARIZATION' LIMIT 1`))[0].id;
  r = await PATCH(`/movements/${movProv}/regularize`, {
    reason: 'Llegó el remito definitivo del proveedor',
    documentNumber: 'REM-DEFINITIVO-001', supplier: 'PROVEEDOR REAL',
  }, tokens.OPERATOR);
  record({
    id: 'REG-01', module: 'Regularización', caso: 'OPERATOR intenta regularizar una entrada provisoria',
    pasos: 'PATCH /movements/:id/regularize con token OPERATOR',
    esperado: '403 — regularizar es de ADMIN/MANAGER',
    obtenido: `${r.status}`, ok: r.status === 403, crit: 'MEDIA',
  });

  r = await PATCH(`/movements/${movProv}/regularize`, {
    reason: 'Llegó el remito definitivo del proveedor',
    documentNumber: 'REM-DEFINITIVO-001', supplier: 'PROVEEDOR REAL',
  }, tokens.MANAGER);
  const provAfter = (await db(`SELECT status, "documentNumber" FROM movements WHERE id=$1`, [movProv]))[0];
  const lotProvAfter = (await db(`SELECT status FROM lots WHERE "lotCode"='PROV-01'`))[0];
  record({
    id: 'REG-02', module: 'Regularización', caso: 'MANAGER regulariza la entrada provisoria',
    pasos: 'PATCH /movements/:id/regularize con datos definitivos',
    esperado: 'Movimiento NORMAL y lote fuera de PENDING_REGULARIZATION',
    obtenido: `${r.status} movimiento=${provAfter.status} doc=${provAfter.documentNumber} lote=${lotProvAfter?.status}`,
    ok: r.status === 200 && provAfter.status === 'NORMAL' && lotProvAfter?.status !== 'PENDING_REGULARIZATION',
    crit: 'ALTA',
  });

  r = await POST('/movements/documents', {
    type: 'EXIT', documentNumber: 'DESP-PROV', warehouseId: S.wh1,
    lines: [{ productId: P['40021100'], quantity: 1000 }],
  }, tokens.OPERATOR);
  const provStock = await tripleCheck(P['40021100']);
  record({
    id: 'REG-03', module: 'Regularización', caso: 'Despachar el lote una vez regularizado',
    pasos: 'POST EXIT 1.000 del lote antes bloqueado',
    esperado: '201 y stock 6.000 → 5.000',
    obtenido: `${r.status} stock=${provStock.stock}`,
    ok: r.status === 201 && provStock.stock === 5000, crit: 'ALTA',
  });

  fs.writeFileSync(path.join(__dirname, 'state.json'), JSON.stringify({ ...S, tokens }, null, 2));
  save('res-p4.json');
  await closeDb();
})();
