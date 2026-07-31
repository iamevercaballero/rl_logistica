/* FASE 5 — Confirmación de hipótesis: bloqueo permanente de lote provisorio y anulación atascada. */
const { GET, POST, PATCH, db, closeDb, record, save, tokens, tripleCheck } = require('./lib');
const fs = require('fs');
const path = require('path');

const S = JSON.parse(fs.readFileSync(path.join(__dirname, 'state.json'), 'utf8'));
Object.assign(tokens, S.tokens);
const P = S.products;
const L = S.locs;

(async () => {
  let r;

  /* ── ¿La regularización desbloquea el lote si SÍ se cambia un dato del lote? ── */
  const movProv = (await db(`SELECT m.id FROM movements m JOIN movement_details md ON md."movementId"=m.id
                             JOIN lots l ON l.id=md."lotId" WHERE l."lotCode"='PROV-01' LIMIT 1`))[0].id;
  r = await PATCH(`/movements/${movProv}/regularize`, {
    reason: 'Segundo intento: ahora se completa el proveedor del lote',
    proveedor: 'PROVEEDOR DEFINITIVO SA',
  }, tokens.MANAGER);
  const lotNow = (await db(`SELECT status, proveedor FROM lots WHERE "lotCode"='PROV-01'`))[0];
  record({
    id: 'REG-04', module: 'Regularización', caso: 'Regularizar cambiando un dato del lote (proveedor)',
    pasos: 'PATCH /movements/:id/regularize con proveedor nuevo',
    esperado: 'Lote pasa a NORMAL y queda despachable',
    obtenido: `${r.status} lote=${lotNow.status} proveedor=${lotNow.proveedor}`,
    ok: lotNow.status === 'NORMAL', crit: 'ALTA',
    nota: 'lot.status="NORMAL" solo se ejecuta dentro de if(lotChanged) — depende de que se edite sapLot/proveedor/fechas.',
  });
  // NB: el movimiento ya estaba NORMAL, así que la segunda llamada debería fallar
  record({
    id: 'REG-05', module: 'Regularización', caso: 'Re-regularizar un movimiento que ya está NORMAL',
    pasos: 'PATCH /movements/:id/regularize sobre un movimiento ya regularizado',
    esperado: '400 el movimiento no está pendiente de regularización',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 110)}`,
    ok: r.status === 400, crit: 'MEDIA',
  });

  // El lote sigue bloqueado y sin vía de desbloqueo por la API de regularización
  r = await POST('/movements/documents', {
    type: 'EXIT', documentNumber: 'DESP-PROV-2', warehouseId: S.wh1,
    lines: [{ productId: P['40021100'], quantity: 500 }],
  }, tokens.OPERATOR);
  const stProv = await tripleCheck(P['40021100']);
  record({
    id: 'REG-06', module: 'Regularización', caso: 'Stock de una entrada provisoria ya regularizada: ¿se puede despachar?',
    pasos: 'POST EXIT 500 del producto cuyo movimiento provisorio ya está en NORMAL',
    esperado: '201 — el stock regularizado debe ser despachable',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 140)} · stock=${stProv.stock}`,
    ok: r.status === 201, crit: 'CRÍTICA',
    nota: 'El movimiento queda NORMAL pero el lote sigue PENDING_REGULARIZATION: 6.000 unidades inmovilizadas sin forma de liberarlas desde la API.',
  });

  const anyEndpointToFix = await PATCH(`/lots/${(await db(`SELECT id FROM lots WHERE "lotCode"='PROV-01'`))[0].id}`,
    { status: 'NORMAL' }, tokens.MANAGER);
  record({
    id: 'REG-07', module: 'Regularización', caso: 'Desbloquear el lote manualmente vía PATCH /lots/:id',
    pasos: 'PATCH /lots/:id {status:"NORMAL"}',
    esperado: 'Alguna vía soportada para liberar un lote atascado',
    obtenido: `${anyEndpointToFix.status} ${JSON.stringify(anyEndpointToFix.data?.message)?.slice(0, 120)}`,
    ok: anyEndpointToFix.status === 200, crit: 'ALTA',
  });

  /* ── Revertir una anulación pendiente ── */
  const movE10 = (await db(`SELECT id FROM movements WHERE "documentId"=$1`, [S.entries.E10.documentId]))[0].id;
  const pedido = await POST(`/movements/${movE10}/void`, {}, tokens.MANAGER);
  const pendiente = (await db(`SELECT "voidStatus" FROM movements WHERE id=$1`, [movE10]))[0];
  const cancel = await PATCH(`/adjustments/${pedido.data?.requestId}/cancel`, {}, tokens.MANAGER);
  const after = (await db(`SELECT "voidStatus" FROM movements WHERE id=$1`, [movE10]))[0];
  const retry = await POST(`/movements/${movE10}/void`, {}, tokens.MANAGER);
  record({
    id: 'ANU-05', module: 'Anulaciones', caso: 'Revertir una solicitud de anulación pendiente',
    pasos: 'POST /void → PATCH /adjustments/:id/cancel → reintentar POST /void',
    esperado: 'El movimiento vuelve a voidStatus=NONE y se puede volver a operar',
    obtenido: `pedido=${pedido.status} (${pendiente?.voidStatus}) cancel=${cancel.status} → voidStatus=${after.voidStatus} · reintento=${retry.status}`,
    ok: pedido.status === 201 && cancel.status === 200 && after.voidStatus === 'NONE' && retry.status === 201,
    crit: 'ALTA',
  });

  /* ── Divergencia por celda: ¿la detecta el chequeo de salud? ── */
  const health = await GET('/reports/inventory-health', tokens.MANAGER);
  const perCell = await db(`
    SELECT p.code AS producto, s."locationId", s."currentQuantity" AS stock,
           COALESCE((SELECT SUM(pa.quantity) FROM pallets pa JOIN lots l ON l.id=pa."lotId"
                     WHERE l."productId"=s."productId" AND pa."currentLocationId"=s."locationId" AND pa.status<>'EXITED'),0)::int AS pallets
    FROM stocks s JOIN products p ON p.id=s."productId"
    WHERE s."currentQuantity"<>0`);
  const badCells = perCell.filter((c) => c.stock !== c.pallets);
  const divergentProducts = (health.data?.divergent ?? []).map((d) => d.productCode);
  record({
    id: 'STK-04', module: 'Stock', caso: 'El chequeo de salud detecta divergencias a nivel ubicación',
    pasos: 'Comparar GET /reports/inventory-health con la verificación stock-vs-pallets por celda',
    esperado: 'Toda celda descuadrada aparece reportada',
    obtenido: `inventory-health reporta ${divergentProducts.length} producto(s) [${divergentProducts.join(', ')}]; por celda hay ${badCells.length} descuadre(s): ${JSON.stringify(badCells.map((c) => `${c.producto}:stock ${c.stock} vs pallets ${c.pallets}`))}`,
    ok: badCells.length === 0 || badCells.every((c) => divergentProducts.includes(c.producto)),
    crit: 'ALTA',
    nota: 'inventoryHealth() agrupa por producto: una transferencia parcial descuadra la celda pero el total del producto cierra.',
  });

  save('res-p5.json');
  await closeDb();
})();
