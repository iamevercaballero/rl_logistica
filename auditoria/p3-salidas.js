/* FASE 3 — Salidas (FEFO, parciales, sobreventa), transferencias, concurrencia. */
const { GET, POST, db, closeDb, record, save, tokens, tripleCheck } = require('./lib');
const fs = require('fs');
const path = require('path');

const S = JSON.parse(fs.readFileSync(path.join(__dirname, 'state.json'), 'utf8'));
Object.assign(tokens, S.tokens);
const P = S.products;
const L = S.locs;
const doc = (body, token = tokens.OPERATOR) => POST('/movements/documents', body, token);
const lotStock = async (code) => (await db(`SELECT "stockActual" FROM lots WHERE "lotCode"=$1`, [code]))[0]?.stockActual;
const palletsOf = (code) => db(
  `SELECT p.code, p.quantity, p.status FROM pallets p JOIN lots l ON l.id=p."lotId" WHERE l."lotCode"=$1 ORDER BY p.code`, [code]);

(async () => {
  let r;

  /* ══════════════ SALIDAS ══════════════ */
  // Estado inicial P1: L1-AGO 13.000 (7 pallets), L1-JUN 4.000 (2 pallets) = 17.000
  const ini = await tripleCheck(P['40004808']);

  r = await doc({
    type: 'EXIT', documentNumber: 'DESP-001', destination: 'AMBEV PLANTA', warehouseId: S.wh1,
    lines: [{ productId: P['40004808'], quantity: 3000 }],
  });
  S.exit1 = r.data;
  let jun = await lotStock('L1-JUN'), ago = await lotStock('L1-AGO');
  record({
    id: 'SAL-01', module: 'Salidas', caso: 'Salida automática FEFO: consume primero el lote que vence antes',
    pasos: 'POST /movements/documents EXIT 3.000 sin indicar lote (L1-JUN vence en 7 d, L1-AGO en 200 d)',
    esperado: 'L1-JUN baja de 4.000 a 1.000; L1-AGO permanece en 13.000',
    obtenido: `${r.status} code=${r.data?.code} L1-JUN=${jun} L1-AGO=${ago}`,
    ok: r.status === 201 && jun === 1000 && ago === 13000, crit: 'CRÍTICA',
  });

  r = await doc({
    type: 'EXIT', documentNumber: 'DESP-002', destination: 'AMBEV PLANTA', warehouseId: S.wh1,
    lines: [{ productId: P['40004808'], quantity: 1500 }],
  });
  jun = await lotStock('L1-JUN'); ago = await lotStock('L1-AGO');
  const junPal = await palletsOf('L1-JUN');
  record({
    id: 'SAL-02', module: 'Salidas', caso: 'Salida que agota un lote y continúa en el siguiente (parcial)',
    pasos: 'POST EXIT 1.500 cuando L1-JUN tiene 1.000',
    esperado: 'L1-JUN=0 (pallets EXITED), L1-AGO=12.500 con un pallet PARTIAL',
    obtenido: `L1-JUN=${jun} L1-AGO=${ago} pallets JUN=${JSON.stringify(junPal)}`,
    ok: jun === 0 && ago === 12500 && junPal.every((p) => p.status === 'EXITED'), crit: 'CRÍTICA',
  });

  const t1 = await tripleCheck(P['40004808']);
  record({
    id: 'SAL-03', module: 'Salidas', caso: 'Integridad Stock=Lote=Pallet después de dos salidas FEFO',
    pasos: 'Comparar sumas por producto tras SAL-01 y SAL-02',
    esperado: `17.000 − 4.500 = 12.500 en las tres contabilidades`,
    obtenido: `inicial=${ini.stock} stock=${t1.stock} lote=${t1.lote} pallet=${t1.pallet}`,
    ok: t1.stock === 12500 && t1.lote === 12500 && t1.pallet === 12500, crit: 'CRÍTICA',
  });

  r = await doc({
    type: 'EXIT', documentNumber: 'DESP-003', destination: 'AMBEV', warehouseId: S.wh1,
    lines: [{ productId: P['40015054'], quantity: 4000 }],
  });
  const m1 = await lotStock('M1'), m2 = await lotStock('M2');
  record({
    id: 'SAL-04', module: 'Salidas', caso: 'FEFO entre dos lotes del mismo producto (M1 vence antes que M2)',
    pasos: 'POST EXIT 4.000 con M1=3.000 (venc. +30 d) y M2=5.000 (venc. +120 d)',
    esperado: 'M1=0 y M2=4.000',
    obtenido: `${r.status} M1=${m1} M2=${m2}`,
    ok: r.status === 201 && m1 === 0 && m2 === 4000, crit: 'CRÍTICA',
  });

  r = await doc({
    type: 'EXIT', documentNumber: 'DESP-004', destination: 'CLIENTE X', warehouseId: S.wh1,
    lines: [
      { productId: P['40007857'], quantity: 2000 },
      { productId: P['50858280'], quantity: 10 },
    ],
  });
  const s3 = await tripleCheck(P['40007857']), s4 = await tripleCheck(P['50858280']);
  record({
    id: 'SAL-05', module: 'Salidas', caso: 'Salida multi-producto en un solo remito',
    pasos: 'POST EXIT con 2 líneas',
    esperado: 'Un RLNS con 2 movimientos; stocks 6.000 y 30',
    obtenido: `${r.status} code=${r.data?.code} movs=${r.data?.movementIds?.length} P3=${s3.stock} P4=${s4.stock}`,
    ok: r.status === 201 && r.data?.movementIds?.length === 2 && s3.stock === 6000 && s4.stock === 30, crit: 'ALTA',
  });

  r = await doc({
    type: 'EXIT', documentNumber: 'DESP-005', destination: 'CLIENTE Y', warehouseId: S.wh1,
    lines: [{ productId: P['40044556'], quantity: 1000 }],
  });
  const pr9 = await palletsOf('PR9');
  const s9 = await tripleCheck(P['40044556']);
  record({
    id: 'SAL-06', module: 'Salidas', caso: 'Salida que agota todo el stock de un producto',
    pasos: 'POST EXIT 1.000 (todo el stock de PR9)',
    esperado: 'Pallet en estado EXITED y stock 0',
    obtenido: `${r.status} pallets=${JSON.stringify(pr9)} stock=${s9.stock}`,
    ok: r.status === 201 && pr9[0]?.status === 'EXITED' && s9.stock === 0, crit: 'ALTA',
  });

  const beforeOver = await tripleCheck(P['70088990']);
  r = await doc({
    type: 'EXIT', documentNumber: 'DESP-006', warehouseId: S.wh1,
    lines: [{ productId: P['70088990'], quantity: 5 }],
  });
  const afterOver = await tripleCheck(P['70088990']);
  record({
    id: 'SAL-07', module: 'Salidas', caso: 'Sobreventa: despachar 5 cuando hay 1 en stock',
    pasos: 'POST EXIT quantity=5 con stock=1',
    esperado: '400 stock insuficiente y stock intacto (nunca negativo)',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 110)} · stock antes=${beforeOver.stock} después=${afterOver.stock}`,
    ok: r.status === 400 && afterOver.stock === beforeOver.stock, crit: 'CRÍTICA',
  });

  r = await doc({
    type: 'EXIT', documentNumber: 'DESP-007', warehouseId: S.wh1,
    lines: [{ productId: P['40021100'], quantity: 1000 }],
  });
  const provStock = await tripleCheck(P['40021100']);
  record({
    id: 'SAL-08', module: 'Salidas', caso: 'Despachar un lote provisorio (pendiente de regularización)',
    pasos: 'POST EXIT del producto cuyo único lote es PROV-01 en PENDING_REGULARIZATION',
    esperado: '400 — hay que regularizar el lote antes de despachar',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 140)} · stock=${provStock.stock}`,
    ok: r.status === 400 && provStock.stock === 6000, crit: 'ALTA',
  });

  r = await doc({ type: 'EXIT', warehouseId: S.wh1, lines: [{ productId: P['40004808'], quantity: 0 }] });
  record({
    id: 'SAL-09', module: 'Salidas', caso: 'Salida con cantidad 0',
    pasos: 'POST EXIT quantity=0',
    esperado: '400 validación',
    obtenido: `${r.status}`, ok: r.status === 400, crit: 'ALTA',
  });

  r = await doc({ type: 'EXIT', warehouseId: S.wh1, lines: [{ productId: P['40004808'] }] });
  record({
    id: 'SAL-10', module: 'Salidas', caso: 'Salida sin cantidad ni pallets',
    pasos: 'POST EXIT línea sin quantity ni palletItems',
    esperado: '400 la cantidad debe ser mayor a cero',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 110)}`,
    ok: r.status === 400, crit: 'MEDIA',
  });

  /* ── Salida indicando pallet concreto: ¿valida el saldo del pallet? ── */
  const agoPallets = await palletsOf('L1-AGO');
  const target = agoPallets.find((p) => p.status !== 'EXITED' && p.quantity > 0);
  const targetId = (await db(`SELECT id FROM pallets WHERE code=$1`, [target.code]))[0].id;
  const beforeP = await tripleCheck(P['40004808']);
  r = await doc({
    type: 'EXIT', documentNumber: 'DESP-008', warehouseId: S.wh1,
    lines: [{ productId: P['40004808'], palletItems: [{ palletId: targetId, quantity: target.quantity + 5000 }] }],
  });
  const afterP = await tripleCheck(P['40004808']);
  const palAfter = (await palletsOf('L1-AGO')).find((p) => p.code === target.code);
  record({
    id: 'SAL-11', module: 'Salidas', caso: 'Despachar de un pallet más cantidad de la que contiene',
    pasos: `POST EXIT palletItems=[{palletId: ${target.code}, quantity: ${target.quantity + 5000}}] cuando el pallet tiene ${target.quantity}`,
    esperado: '400 — no se puede sacar de un pallet más de lo que tiene',
    obtenido: `${r.status} · pallet quedó en ${palAfter?.quantity} (${palAfter?.status}) · stock ${beforeP.stock}→${afterP.stock}, lote ${beforeP.lote}→${afterP.lote}, pallet ${beforeP.pallet}→${afterP.pallet}`,
    ok: r.status === 400 && afterP.stock === beforeP.stock, crit: 'CRÍTICA',
    nota: 'createInTransaction hace applyDecrease(item.quantity) y luego pallet.quantity = max(0, ...): la resta de stock y la del pallet pueden divergir.',
  });

  const health1 = await GET('/reports/inventory-health', tokens.MANAGER);
  record({
    id: 'SAL-12', module: 'Salidas', caso: 'Invariante Stock=Lote=Pallet después de la salida sobre-dimensionada',
    pasos: 'GET /reports/inventory-health',
    esperado: 'ok:true',
    obtenido: `${health1.status} ok=${health1.data?.ok} · ${JSON.stringify(health1.data?.divergent ?? []).slice(0, 300)}`,
    ok: health1.data?.ok === true, crit: 'CRÍTICA',
  });

  // Pallet de otro producto
  const otroPallet = (await db(`SELECT p.id FROM pallets p JOIN lots l ON l.id=p."lotId" WHERE l."productId"=$1 AND p.status<>'EXITED' LIMIT 1`, [P['40009912']]))[0]?.id;
  r = await doc({
    type: 'EXIT', warehouseId: S.wh1,
    lines: [{ productId: P['40004808'], palletItems: [{ palletId: otroPallet, quantity: 100 }] }],
  });
  record({
    id: 'SAL-13', module: 'Salidas', caso: 'Despachar un pallet que pertenece a otro producto',
    pasos: 'POST EXIT productId=P1 con palletId de un pallet del producto P7',
    esperado: '400 — el pallet no corresponde al material de la línea',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 120)}`,
    ok: r.status === 400, crit: 'ALTA',
    nota: 'Si se acepta, se descuenta stock del producto A moviendo un pallet del producto B.',
  });

  const healthCross = await GET('/reports/inventory-health', tokens.MANAGER);
  record({
    id: 'SAL-14', module: 'Salidas', caso: 'Invariante tras despachar un pallet de otro producto',
    pasos: 'GET /reports/inventory-health',
    esperado: 'ok:true',
    obtenido: `ok=${healthCross.data?.ok} · ${JSON.stringify(healthCross.data?.divergent ?? []).slice(0, 300)}`,
    ok: healthCross.data?.ok === true, crit: 'CRÍTICA',
  });

  /* ══════════════ TRANSFERENCIAS ══════════════ */
  const chPallet = (await db(`SELECT p.id, p.quantity, p."currentLocationId" FROM pallets p JOIN lots l ON l.id=p."lotId" WHERE l."lotCode"='CH7'`))[0];
  const destino = L['A-F2-N3-P2'];
  r = await POST('/movements/transfer-batch', {
    fromLocationId: chPallet.currentLocationId, toLocationId: destino,
    lines: [{ productId: P['40009912'], palletItems: [{ palletId: chPallet.id, quantity: chPallet.quantity }] }],
  }, tokens.OPERATOR);
  const chAfter = (await db(`SELECT "currentLocationId" FROM pallets WHERE id=$1`, [chPallet.id]))[0];
  const stockOrigen = await db(`SELECT "currentQuantity" FROM stocks WHERE "productId"=$1 AND "locationId"=$2`, [P['40009912'], chPallet.currentLocationId]);
  const stockDestino = await db(`SELECT "currentQuantity" FROM stocks WHERE "productId"=$1 AND "locationId"=$2`, [P['40009912'], destino]);
  record({
    id: 'TRF-01', module: 'Transferencias', caso: 'Transferir un pallet completo entre ubicaciones',
    pasos: 'POST /movements/transfer-batch con el pallet CH7-P1 completo',
    esperado: 'El pallet cambia de ubicación y el stock se mueve de celda (origen 0, destino 9.000)',
    obtenido: `${r.status} ubicación destino=${chAfter.currentLocationId === destino} origen=${stockOrigen[0]?.currentQuantity} destino=${stockDestino[0]?.currentQuantity}`,
    ok: r.status === 201 && chAfter.currentLocationId === destino && stockOrigen[0]?.currentQuantity === 0 && stockDestino[0]?.currentQuantity === 9000,
    crit: 'CRÍTICA',
  });

  r = await POST('/movements/transfer-batch', {
    fromLocationId: destino, toLocationId: destino,
    lines: [{ productId: P['40009912'], palletItems: [{ palletId: chPallet.id, quantity: 100 }] }],
  }, tokens.OPERATOR);
  record({
    id: 'TRF-02', module: 'Transferencias', caso: 'Transferencia con origen igual al destino',
    pasos: 'POST /movements/transfer-batch fromLocationId = toLocationId',
    esperado: '400 origen y destino no pueden ser la misma ubicación',
    obtenido: `${r.status}`, ok: r.status === 400, crit: 'MEDIA',
  });

  // Transferencia parcial: mover 4.000 de un pallet de 9.000
  const before2 = await tripleCheck(P['40009912']);
  r = await POST('/movements/transfer-batch', {
    fromLocationId: destino, toLocationId: L['A-F2-N3-P3'],
    lines: [{ productId: P['40009912'], palletItems: [{ palletId: chPallet.id, quantity: 4000 }] }],
  }, tokens.OPERATOR);
  const after2 = await tripleCheck(P['40009912']);
  const cells = await db(`SELECT "locationId","currentQuantity" FROM stocks WHERE "productId"=$1 AND "currentQuantity"<>0`, [P['40009912']]);
  const palLoc = (await db(`SELECT "currentLocationId", quantity FROM pallets WHERE id=$1`, [chPallet.id]))[0];
  record({
    id: 'TRF-03', module: 'Transferencias', caso: 'Transferencia parcial de un pallet (mover 4.000 de 9.000)',
    pasos: 'POST /movements/transfer-batch quantity=4.000 sobre un pallet de 9.000',
    esperado: 'Rechazo, o bien división real del pallet en dos con stock coherente por celda',
    obtenido: `${r.status} · celdas con stock=${JSON.stringify(cells)} · pallet quedó con ${palLoc.quantity} en ${palLoc.currentLocationId === L['A-F2-N3-P3'] ? 'destino' : 'origen'}`,
    ok: r.status === 400, crit: 'ALTA',
    nota: 'El pallet se mueve entero pero el stock se reparte: la celda queda con stock sin pallet que lo respalde.',
  });

  const healthT = await GET('/reports/inventory-health', tokens.MANAGER);
  const cellMismatch = await db(
    `SELECT s."locationId", s."currentQuantity",
            COALESCE((SELECT SUM(p.quantity) FROM pallets p JOIN lots l ON l.id=p."lotId"
                      WHERE l."productId"=s."productId" AND p."currentLocationId"=s."locationId" AND p.status<>'EXITED'),0)::int AS pal
     FROM stocks s WHERE s."productId"=$1 AND s."currentQuantity"<>0`, [P['40009912']]);
  record({
    id: 'TRF-04', module: 'Transferencias', caso: 'Coherencia stock-por-celda vs pallets-por-celda tras transferencia parcial',
    pasos: 'Comparar stocks.currentQuantity con SUM(pallets.quantity) por ubicación',
    esperado: 'Cada celda con stock respaldada por pallets de esa misma celda',
    obtenido: `inventory-health ok=${healthT.data?.ok} · por celda: ${JSON.stringify(cellMismatch)}`,
    ok: cellMismatch.every((c) => c.currentQuantity === c.pal), crit: 'CRÍTICA',
  });

  /* ══════════════ CONCURRENCIA ══════════════ */
  // Dos salidas simultáneas del mismo producto: el total despachado no puede superar el stock
  const conc = await tripleCheck(P['40007857']); // 6.000
  const [a, b] = await Promise.all([
    doc({ type: 'EXIT', documentNumber: 'CONC-A', warehouseId: S.wh1, lines: [{ productId: P['40007857'], quantity: 4000 }] }),
    doc({ type: 'EXIT', documentNumber: 'CONC-B', warehouseId: S.wh1, lines: [{ productId: P['40007857'], quantity: 4000 }] }),
  ]);
  const concAfter = await tripleCheck(P['40007857']);
  record({
    id: 'CON-01', module: 'Concurrencia', caso: 'Dos salidas simultáneas de 4.000 con 6.000 en stock',
    pasos: 'Promise.all de dos POST EXIT del mismo producto',
    esperado: 'Una prospera y la otra falla; stock final 2.000 y nunca negativo',
    obtenido: `A=${a.status} B=${b.status} · stock ${conc.stock}→${concAfter.stock} (lote=${concAfter.lote}, pallet=${concAfter.pallet})`,
    ok: concAfter.stock === 2000 && concAfter.stock === concAfter.lote && concAfter.lote === concAfter.pallet,
    crit: 'CRÍTICA',
  });

  // Dos entradas simultáneas del MISMO lote nuevo → ¿se duplica el lote?
  const [c1, c2] = await Promise.all([
    doc({ type: 'ENTRY', documentNumber: 'RACE-1', warehouseId: S.wh1, lines: [{ productId: P['50112233'], locationId: L['A-F2-N2-P1'], palletItems: [{ lotCode: 'RACE-LOT', quantity: 100 }] }] }),
    doc({ type: 'ENTRY', documentNumber: 'RACE-2', warehouseId: S.wh1, lines: [{ productId: P['50112233'], locationId: L['A-F2-N2-P1'], palletItems: [{ lotCode: 'RACE-LOT', quantity: 100 }] }] }),
  ]);
  const raceLots = await db(`SELECT id,"lotCode","stockActual" FROM lots WHERE "lotCode"='RACE-LOT'`);
  record({
    id: 'CON-02', module: 'Concurrencia', caso: 'Dos entradas simultáneas creando el mismo código de lote',
    pasos: 'Promise.all de dos POST ENTRY con lotCode RACE-LOT inexistente',
    esperado: 'Un único lote con 200 (o una de las dos falla) — nunca dos filas del mismo lote',
    obtenido: `E1=${c1.status} E2=${c2.status} · lotes creados=${raceLots.length} ${JSON.stringify(raceLots.map((l) => l.stockActual))}`,
    ok: raceLots.length === 1, crit: 'ALTA',
    nota: 'findOrCreateLot hace SELECT + INSERT sin índice único que respalde la unicidad.',
  });

  const healthFinal = await GET('/reports/inventory-health', tokens.MANAGER);
  record({
    id: 'CON-03', module: 'Concurrencia', caso: 'Invariante global tras las pruebas de concurrencia',
    pasos: 'GET /reports/inventory-health',
    esperado: 'ok:true',
    obtenido: `ok=${healthFinal.data?.ok} · ${JSON.stringify(healthFinal.data?.divergent ?? []).slice(0, 400)}`,
    ok: healthFinal.data?.ok === true, crit: 'CRÍTICA',
  });

  const negStock = await db(`SELECT "productId","currentQuantity" FROM stocks WHERE "currentQuantity"<0`);
  record({
    id: 'CON-04', module: 'Stock', caso: 'Ninguna celda quedó con stock negativo tras salidas y concurrencia',
    pasos: 'SELECT stocks WHERE currentQuantity < 0',
    esperado: '0 filas',
    obtenido: `${negStock.length} filas ${JSON.stringify(negStock).slice(0, 200)}`,
    ok: negStock.length === 0, crit: 'CRÍTICA',
  });

  fs.writeFileSync(path.join(__dirname, 'state.json'), JSON.stringify({ ...S, tokens }, null, 2));
  save('res-p3.json');
  await closeDb();
})();
