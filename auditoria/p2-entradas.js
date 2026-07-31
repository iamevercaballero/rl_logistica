/* FASE 2 — Entradas (remitos), lotes, pallets, integridad de stock. */
const { GET, POST, PATCH, DEL, db, closeDb, record, save, tokens, tripleCheck } = require('./lib');
const fs = require('fs');
const path = require('path');

const S = JSON.parse(fs.readFileSync(path.join(__dirname, 'state.json'), 'utf8'));
Object.assign(tokens, S.tokens);
const P = S.products;
const L = S.locs;

const today = new Date();
const d = (days) => new Date(today.getTime() + days * 86400000).toISOString().slice(0, 10);

const doc = (body, token = tokens.OPERATOR) => POST('/movements/documents', body, token);

(async () => {
  S.entries = {};
  let r;

  /* ══════════════ ENTRADAS ══════════════ */

  // E1 — entrada simple, 6 pallets de 2000
  r = await doc({
    type: 'ENTRY', date: d(-10), documentNumber: '001-001-0001234', supplier: 'CROWN',
    warehouseId: S.wh1, carrier: 'WINNER LOGISTICA', vehiclePlate: 'BKH180',
    lines: [{
      productId: P['40004808'], locationId: L['A-F1-N1-P1'],
      palletItems: Array.from({ length: 6 }, () => ({ lotCode: 'L1-AGO', quantity: 2000, fechaVencimiento: d(200), proveedor: 'CROWN' })),
    }],
  });
  S.entries.E1 = r.data;
  let t = await tripleCheck(P['40004808']);
  record({
    id: 'ENT-01', module: 'Entradas', caso: 'Entrada de 12.000 UN en 6 pallets de un lote',
    pasos: 'POST /movements/documents type=ENTRY, 6 palletItems de 2.000 con lote L1-AGO',
    esperado: 'Código RLNE-2026-000001, stock=12.000, lote=12.000, pallets=12.000',
    obtenido: `${r.status} code=${r.data?.code} stock=${t.stock} lote=${t.lote} pallet=${t.pallet}`,
    ok: r.status === 201 && /^RLNE-\d{4}-000001$/.test(r.data?.code || '') && t.stock === 12000 && t.lote === 12000 && t.pallet === 12000,
    crit: 'CRÍTICA',
  });

  // E2 — mismo producto, lote que vence pronto (para FEFO)
  r = await doc({
    type: 'ENTRY', date: d(-5), documentNumber: '001-001-0001235', supplier: 'CROWN', warehouseId: S.wh1,
    lines: [{
      productId: P['40004808'], locationId: L['A-F1-N1-P2'],
      palletItems: Array.from({ length: 2 }, () => ({ lotCode: 'L1-JUN', quantity: 2000, fechaVencimiento: d(7), proveedor: 'CROWN' })),
    }],
  });
  S.entries.E2 = r.data;
  t = await tripleCheck(P['40004808']);
  record({
    id: 'ENT-02', module: 'Entradas', caso: 'Segunda entrada del mismo producto con lote de vencimiento próximo',
    pasos: 'POST /movements/documents ENTRY 2×2.000 lote L1-JUN venc. +7 días',
    esperado: 'RLNE correlativo 000002 y stock acumulado 16.000 en las tres contabilidades',
    obtenido: `${r.status} code=${r.data?.code} stock=${t.stock} lote=${t.lote} pallet=${t.pallet}`,
    ok: r.status === 201 && r.data?.code?.endsWith('000002') && t.stock === 16000 && t.lote === 16000 && t.pallet === 16000,
    crit: 'CRÍTICA',
  });

  // E3 — multi-lote en una línea
  r = await doc({
    type: 'ENTRY', documentNumber: 'MIC-2026-0099', supplier: 'OWENS', warehouseId: S.wh1,
    lines: [{
      productId: P['40015054'], locationId: L['A-F1-N2-P1'],
      palletItems: [
        { lotCode: 'M1', quantity: 3000, fechaVencimiento: d(30) },
        { lotCode: 'M2', quantity: 5000, fechaVencimiento: d(120) },
      ],
    }],
  });
  S.entries.E3 = r.data;
  t = await tripleCheck(P['40015054']);
  const lotsE3 = await db(`SELECT "lotCode","stockActual" FROM lots WHERE "productId"=$1 ORDER BY "lotCode"`, [P['40015054']]);
  record({
    id: 'ENT-03', module: 'Entradas', caso: 'Entrada multi-lote en una sola línea (M1 3.000 + M2 5.000)',
    pasos: 'POST /movements/documents con 2 palletItems de lotes distintos',
    esperado: 'Dos lotes con 3.000 y 5.000; stock total 8.000',
    obtenido: `${r.status} lotes=${JSON.stringify(lotsE3)} stock=${t.stock}`,
    ok: r.status === 201 && t.stock === 8000 && lotsE3.length === 2 && lotsE3[0].stockActual === 3000 && lotsE3[1].stockActual === 5000,
    crit: 'ALTA',
  });

  // E4 — multi-producto en un remito
  r = await doc({
    type: 'ENTRY', documentNumber: 'FACT-555', supplier: 'MULTI', warehouseId: S.wh1,
    lines: [
      { productId: P['40007857'], locationId: L['A-F1-N3-P1'], palletItems: [{ lotCode: 'R3', quantity: 8000, fechaVencimiento: d(150) }] },
      { productId: P['50858280'], locationId: L['A-F1-N3-P1'], palletItems: [{ lotCode: 'S4', quantity: 40, fechaVencimiento: d(150) }] },
    ],
  });
  S.entries.E4 = r.data;
  const t3 = await tripleCheck(P['40007857']);
  const t4 = await tripleCheck(P['50858280']);
  record({
    id: 'ENT-04', module: 'Entradas', caso: 'Remito multi-producto (2 líneas, 2 materiales)',
    pasos: 'POST /movements/documents con 2 lines de productos distintos',
    esperado: 'Un solo RLNE con 2 movimientos; stock 8.000 y 40',
    obtenido: `${r.status} code=${r.data?.code} movs=${r.data?.movementIds?.length} P3=${t3.stock} P4=${t4.stock}`,
    ok: r.status === 201 && r.data?.movementIds?.length === 2 && t3.stock === 8000 && t4.stock === 40,
    crit: 'ALTA',
  });

  // E5 — entrada provisoria
  r = await doc({
    type: 'ENTRY', documentNumber: 'PROV-001', supplier: 'PENDIENTE', warehouseId: S.wh1,
    isProvisional: true, notes: 'Pendiente revisar remito del proveedor',
    lines: [{
      productId: P['40021100'], locationId: L['A-F1-N1-P3'],
      palletItems: Array.from({ length: 3 }, () => ({ lotCode: 'PROV-01', quantity: 2000 })),
    }],
  });
  S.entries.E5 = r.data;
  const provLot = await db(`SELECT status FROM lots WHERE "lotCode"='PROV-01'`);
  const provMov = await db(`SELECT status FROM movements WHERE "documentId"=$1`, [r.data?.documentId]);
  record({
    id: 'ENT-05', module: 'Entradas', caso: 'Entrada provisoria (pendiente de regularización)',
    pasos: 'POST /movements/documents isProvisional=true + observación obligatoria',
    esperado: 'Movimiento y lote en PENDING_REGULARIZATION',
    obtenido: `${r.status} lote=${provLot[0]?.status} movimiento=${provMov[0]?.status}`,
    ok: r.status === 201 && provLot[0]?.status === 'PENDING_REGULARIZATION' && provMov[0]?.status === 'PENDING_REGULARIZATION',
    crit: 'ALTA',
  });

  r = await doc({
    type: 'ENTRY', documentNumber: 'PROV-002', warehouseId: S.wh1, isProvisional: true,
    lines: [{ productId: P['40021100'], locationId: L['A-F1-N1-P3'], palletItems: [{ lotCode: 'PROV-02', quantity: 100 }] }],
  });
  record({
    id: 'ENT-06', module: 'Entradas', caso: 'Entrada provisoria sin observación',
    pasos: 'POST ENTRY isProvisional=true sin notes',
    esperado: '400 — la observación es obligatoria en provisorias',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 120)}`,
    ok: r.status === 400, crit: 'MEDIA',
  });

  // E6 — producto en KG
  r = await doc({
    type: 'ENTRY', documentNumber: 'KG-001', supplier: 'QUIMICA', warehouseId: S.wh1,
    lines: [{ productId: P['60030055'], locationId: L['A-F2-N1-P1'], palletItems: [{ lotCode: 'T6', quantity: 500, fechaVencimiento: d(400) }] }],
  });
  S.entries.E6 = r.data;
  t = await tripleCheck(P['60030055']);
  record({
    id: 'ENT-07', module: 'Entradas', caso: 'Entrada de material en KG',
    pasos: 'POST ENTRY 500 KG lote T6',
    esperado: 'Stock 500 KG consistente',
    obtenido: `${r.status} stock=${t.stock}`,
    ok: r.status === 201 && t.stock === 500, crit: 'MEDIA',
  });

  r = await doc({
    type: 'ENTRY', documentNumber: 'KG-DEC', warehouseId: S.wh1,
    lines: [{ productId: P['60030055'], locationId: L['A-F2-N1-P1'], palletItems: [{ lotCode: 'T6-DEC', quantity: 12.5 }] }],
  });
  const decLot = await db(`SELECT "stockActual" FROM lots WHERE "lotCode"='T6-DEC'`);
  record({
    id: 'ENT-08', module: 'Entradas', caso: 'Entrada de cantidad decimal en material KG (12,5 kg)',
    pasos: 'POST ENTRY quantity=12.5 en producto con unidad KG',
    esperado: 'Aceptar decimales o rechazar con mensaje claro — nunca truncar en silencio',
    obtenido: `${r.status} ${r.status === 201 ? `lote quedó en ${decLot[0]?.stockActual}` : JSON.stringify(r.data?.message)?.slice(0, 140)}`,
    ok: r.status === 400, crit: 'MEDIA',
    nota: 'Stock/lote/pallet son int en PostgreSQL: los materiales por peso (KG) no admiten fracciones.',
  });

  // E7..E10
  r = await doc({
    type: 'ENTRY', documentNumber: 'CH-007', warehouseId: S.wh1,
    lines: [{ productId: P['40009912'], locationId: L['A-F2-N1-P2'], palletItems: [{ lotCode: 'CH7', quantity: 9000, fechaVencimiento: d(90) }] }],
  });
  S.entries.E7 = r.data;
  r = await doc({
    type: 'ENTRY', documentNumber: 'HM-008', warehouseId: S.wh1, vehiclePlate: 'ABC123',
    lines: [{ productId: P['50112233'], locationId: L['A-F2-N2-P1'], palletItems: [{ lotCode: 'HM8', quantity: 600, fechaVencimiento: d(60) }, { lotCode: 'HM8', quantity: 600, fechaVencimiento: d(60) }] }],
  });
  S.entries.E8 = r.data;
  const hm8 = await db(`SELECT code, quantity FROM pallets p JOIN lots l ON l.id=p."lotId" WHERE l."lotCode"='HM8' ORDER BY code`);
  record({
    id: 'ENT-09', module: 'Entradas', caso: 'Dos pallets del mismo lote en una entrada (codificación automática)',
    pasos: 'POST ENTRY con 2 palletItems del lote HM8',
    esperado: 'Pallets HM8-P1 y HM8-P2 con 600 cada uno',
    obtenido: `${r.status} ${JSON.stringify(hm8)}`,
    ok: r.status === 201 && hm8.length === 2 && hm8[0].code === 'HM8-P1' && hm8[1].code === 'HM8-P2', crit: 'ALTA',
  });

  r = await doc({
    type: 'ENTRY', documentNumber: 'PR-009', warehouseId: S.wh1,
    lines: [{ productId: P['40044556'], locationId: L['A-F2-N2-P2'], palletItems: [{ lotCode: 'PR9', quantity: 1000 }] }],
  });
  S.entries.E9 = r.data;
  r = await doc({
    type: 'ENTRY', documentNumber: 'FS-010', warehouseId: S.wh1,
    lines: [{ productId: P['70088990'], locationId: L['A-F2-N3-P1'], palletItems: [{ lotCode: 'FS10', quantity: 1 }] }],
  });
  S.entries.E10 = r.data;
  t = await tripleCheck(P['70088990']);
  record({
    id: 'ENT-10', module: 'Entradas', caso: 'Entrada de cantidad mínima (1 unidad)',
    pasos: 'POST ENTRY quantity=1',
    esperado: '201 y stock=1',
    obtenido: `${r.status} stock=${t.stock}`, ok: r.status === 201 && t.stock === 1, crit: 'MEDIA',
  });

  /* ── Negativos de entrada ── */
  r = await doc({
    type: 'ENTRY', warehouseId: S.wh1,
    lines: [{ productId: P['40004808'], locationId: L['A-F1-N1-P1'], palletItems: [{ lotCode: 'ZERO', quantity: 0 }] }],
  });
  record({
    id: 'ENT-11', module: 'Entradas', caso: 'Entrada con cantidad 0',
    pasos: 'POST ENTRY palletItems quantity=0',
    esperado: '400 la cantidad debe ser mayor a cero',
    obtenido: `${r.status}`, ok: r.status === 400, crit: 'ALTA',
  });

  r = await doc({
    type: 'ENTRY', warehouseId: S.wh1,
    lines: [{ productId: P['40004808'], locationId: L['A-F1-N1-P1'], palletItems: [{ lotCode: 'NEG', quantity: -500 }] }],
  });
  record({
    id: 'ENT-12', module: 'Entradas', caso: 'Entrada con cantidad negativa',
    pasos: 'POST ENTRY quantity=-500',
    esperado: '400 validación',
    obtenido: `${r.status}`, ok: r.status === 400, crit: 'ALTA',
  });

  r = await doc({
    type: 'ENTRY', warehouseId: S.wh1,
    lines: [{ productId: '00000000-0000-0000-0000-000000000000', locationId: L['A-F1-N1-P1'], palletItems: [{ lotCode: 'X', quantity: 10 }] }],
  });
  record({
    id: 'ENT-13', module: 'Entradas', caso: 'Entrada con producto inexistente',
    pasos: 'POST ENTRY productId inexistente',
    esperado: '404 Material inexistente',
    obtenido: `${r.status}`, ok: r.status === 404, crit: 'ALTA',
  });

  r = await doc({
    type: 'ENTRY', warehouseId: S.wh1,
    lines: [{ productId: P['40004808'], locationId: '00000000-0000-0000-0000-000000000000', palletItems: [{ lotCode: 'X', quantity: 10 }] }],
  });
  record({
    id: 'ENT-14', module: 'Entradas', caso: 'Entrada con ubicación inexistente',
    pasos: 'POST ENTRY locationId inexistente',
    esperado: '404 ubicación inexistente',
    obtenido: `${r.status}`, ok: r.status === 404, crit: 'ALTA',
  });

  // Ubicación de OTRO depósito
  const wh2locs = (await GET('/locations', tokens.ADMIN)).data.filter((l) => l.warehouse?.id === S.wh2);
  S.wh2loc = wh2locs[0]?.id;
  r = await doc({
    type: 'ENTRY', warehouseId: S.wh1,
    lines: [{ productId: P['40004808'], locationId: S.wh2loc, palletItems: [{ lotCode: 'CRUZADO', quantity: 10 }] }],
  });
  record({
    id: 'ENT-15', module: 'Entradas', caso: 'Entrada con ubicación que pertenece a otro depósito',
    pasos: 'POST ENTRY warehouseId=DEP1 + locationId de DEP2',
    esperado: '400 la ubicación no pertenece al depósito indicado',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 120)}`,
    ok: r.status === 400, crit: 'ALTA',
  });

  r = await doc({ type: 'ENTRY', warehouseId: S.wh1, lines: [] });
  record({
    id: 'ENT-16', module: 'Entradas', caso: 'Remito de entrada sin líneas',
    pasos: 'POST /movements/documents lines=[]',
    esperado: '400 ArrayMinSize',
    obtenido: `${r.status}`, ok: r.status === 400, crit: 'MEDIA',
  });

  r = await doc({
    type: 'ENTRY', warehouseId: S.wh1,
    lines: [{ productId: P['40004808'], locationId: L['A-F1-N1-P1'], palletItems: [{ quantity: 100 }] }],
  });
  record({
    id: 'ENT-17', module: 'Entradas', caso: 'Entrada de pallet sin lotCode ni palletId',
    pasos: 'POST ENTRY palletItem sin lotCode',
    esperado: '400 — cada ítem debe indicar lote o pallet',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 120)}`,
    ok: r.status === 400, crit: 'ALTA',
  });

  const antes = await tripleCheck(P['40004808']);
  r = await doc({
    type: 'ENTRY', warehouseId: S.wh1,
    lines: [
      { productId: P['40004808'], locationId: L['A-F1-N1-P1'], palletItems: [{ lotCode: 'ATOMIC-OK', quantity: 500 }] },
      { productId: P['40004808'], locationId: L['A-F1-N1-P1'], palletItems: [{ lotCode: 'ATOMIC-BAD', quantity: 0 }] },
    ],
  });
  const despues = await tripleCheck(P['40004808']);
  const huerfano = await db(`SELECT count(*)::int c FROM lots WHERE "lotCode"='ATOMIC-OK'`);
  record({
    id: 'ENT-18', module: 'Entradas', caso: 'Atomicidad: remito con una línea válida y otra inválida',
    pasos: 'POST ENTRY con línea 1 correcta (500) y línea 2 con cantidad 0',
    esperado: '400 y rollback total: ni stock ni lote de la línea 1',
    obtenido: `${r.status} stock antes=${antes.stock} después=${despues.stock} lote ATOMIC-OK creado=${huerfano[0].c}`,
    ok: r.status === 400 && antes.stock === despues.stock && huerfano[0].c === 0, crit: 'CRÍTICA',
  });

  r = await doc({
    type: 'ENTRY', warehouseId: S.wh1,
    lines: [{ productId: P['40004808'], locationId: L['A-F1-N1-P1'], palletItems: [{ lotCode: 'l1-ago', quantity: 1000 }] }],
  });
  const lotDup = await db(`SELECT "lotCode","stockActual" FROM lots WHERE "productId"=$1 AND upper("lotCode")='L1-AGO'`, [P['40004808']]);
  record({
    id: 'LOT-01', module: 'Lotes', caso: 'Reingreso del mismo lote en minúsculas (normalización)',
    pasos: "POST ENTRY lotCode='l1-ago' cuando ya existe 'L1-AGO'",
    esperado: 'Un único lote L1-AGO con 13.000 — sin duplicar por mayúsculas',
    obtenido: `${r.status} lotes=${JSON.stringify(lotDup)}`,
    ok: r.status === 201 && lotDup.length === 1 && lotDup[0].stockActual === 13000, crit: 'ALTA',
  });

  r = await POST('/lots', { productId: P['40007857'], lotCode: 'R3' }, tokens.MANAGER);
  record({
    id: 'LOT-02', module: 'Lotes', caso: 'Alta manual de un lote ya existente para el mismo producto',
    pasos: "POST /lots lotCode='R3' (creado por la entrada E4)",
    esperado: '400 ya existe el lote para este producto',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 100)}`,
    ok: r.status === 400, crit: 'ALTA',
  });

  const dupCheck = await db(
    `SELECT "productId","lotCode",count(*)::int c FROM lots GROUP BY 1,2 HAVING count(*)>1`);
  record({
    id: 'LOT-03', module: 'Lotes', caso: 'No existen lotes duplicados (productId, lotCode) en la base',
    pasos: 'SELECT ... GROUP BY productId, lotCode HAVING count(*)>1',
    esperado: '0 filas duplicadas',
    obtenido: `${dupCheck.length} grupos duplicados ${JSON.stringify(dupCheck).slice(0, 200)}`,
    ok: dupCheck.length === 0, crit: 'ALTA',
    nota: 'La unicidad se aplica solo en la capa de servicio; la tabla lots no tiene índice único (productId, lotCode).',
  });

  const idx = await db(
    `SELECT indexdef FROM pg_indexes WHERE tablename='lots'
       AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%lotCode%'`);
  record({
    id: 'LOT-04', module: 'Lotes', caso: 'Restricción única en base de datos para (productId, lotCode)',
    pasos: 'Revisar pg_indexes sobre la tabla lots',
    esperado: 'Índice UNIQUE que impida duplicados ante carreras o cargas masivas',
    obtenido: idx.length ? JSON.stringify(idx) : 'No hay ningún índice único en lots',
    ok: idx.length > 0, crit: 'ALTA',
  });

  r = await GET(`/lots/fefo?productId=${P['40004808']}`, tokens.OPERATOR);
  const fefo = Array.isArray(r.data) ? r.data : r.data?.data ?? [];
  record({
    id: 'LOT-05', module: 'Lotes', caso: 'Consulta FEFO ordena por vencimiento más próximo',
    pasos: 'GET /lots/fefo?productId=',
    esperado: 'Primero L1-JUN (vence en 7 días), después L1-AGO',
    obtenido: `${r.status} orden=${fefo.map((l) => l.lotCode).join(' → ')}`,
    ok: r.status === 200 && fefo[0]?.lotCode === 'L1-JUN', crit: 'ALTA',
  });

  /* ══════════════ PALLETS ══════════════ */
  const pal = await GET(`/pallets?lotId=${(await db(`SELECT id FROM lots WHERE "lotCode"='L1-AGO'`))[0].id}`, tokens.OPERATOR);
  const palList = Array.isArray(pal.data) ? pal.data : pal.data?.data ?? [];
  record({
    id: 'PAL-01', module: 'Pallets', caso: 'Listar pallets de un lote',
    pasos: 'GET /pallets?lotId=',
    esperado: '7 pallets (6 de E1 + 1 del reingreso LOT-01)',
    obtenido: `${pal.status} total=${palList.length}`,
    ok: pal.status === 200 && palList.length === 7, crit: 'MEDIA',
  });

  const orphan = await db(`SELECT count(*)::int c FROM pallets p LEFT JOIN lots l ON l.id=p."lotId" WHERE l.id IS NULL`);
  record({
    id: 'PAL-02', module: 'Pallets', caso: 'No hay pallets huérfanos (sin lote)',
    pasos: 'LEFT JOIN pallets → lots',
    esperado: '0 pallets sin lote',
    obtenido: `${orphan[0].c}`, ok: orphan[0].c === 0, crit: 'ALTA',
  });

  const noLoc = await db(`SELECT count(*)::int c FROM pallets WHERE "currentLocationId" IS NULL AND status<>'EXITED'`);
  record({
    id: 'PAL-03', module: 'Pallets', caso: 'No hay pallets activos sin ubicación asignada',
    pasos: `SELECT pallets WHERE currentLocationId IS NULL AND status<>'EXITED'`,
    esperado: '0 pallets "fantasma"',
    obtenido: `${noLoc[0].c}`, ok: noLoc[0].c === 0, crit: 'ALTA',
  });

  const stockByLoc = await db(
    `SELECT s."locationId", s."currentQuantity",
            COALESCE((SELECT SUM(p.quantity) FROM pallets p JOIN lots l ON l.id=p."lotId"
                      WHERE l."productId"=s."productId" AND p."currentLocationId"=s."locationId" AND p.status<>'EXITED'),0)::int AS pallets
     FROM stocks s WHERE s."productId"=$1`, [P['40004808']]);
  const okCell = stockByLoc.every((row) => row.currentQuantity === row.pallets);
  record({
    id: 'STK-01', module: 'Stock', caso: 'Stock por celda coincide con la suma de pallets de esa celda',
    pasos: 'Comparar stocks.currentQuantity vs SUM(pallets.quantity) por ubicación',
    esperado: 'Coincidencia exacta en todas las celdas',
    obtenido: JSON.stringify(stockByLoc),
    ok: okCell, crit: 'CRÍTICA',
  });

  r = await GET('/reports/inventory-health', tokens.MANAGER);
  record({
    id: 'STK-02', module: 'Stock', caso: 'Invariante Stock = Lote = Pallet tras todas las entradas',
    pasos: 'GET /reports/inventory-health',
    esperado: 'ok:true sin divergencias',
    obtenido: `${r.status} ok=${r.data?.ok} divergencias=${r.data?.divergentCount ?? '?'}`,
    ok: r.status === 200 && r.data?.ok === true, crit: 'CRÍTICA',
  });

  const neg = await db(`SELECT count(*)::int c FROM stocks WHERE "currentQuantity" < 0`);
  record({
    id: 'STK-03', module: 'Stock', caso: 'Ninguna celda de stock quedó negativa',
    pasos: 'SELECT stocks WHERE currentQuantity < 0',
    esperado: '0 filas',
    obtenido: `${neg[0].c}`, ok: neg[0].c === 0, crit: 'CRÍTICA',
  });

  fs.writeFileSync(path.join(__dirname, 'state.json'), JSON.stringify({ ...S, tokens }, null, 2));
  save('res-p2.json');
  await closeDb();
})();
