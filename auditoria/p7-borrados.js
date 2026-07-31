/* FASE 7 — Borrado de entidades maestras con datos asociados (integridad referencial). */
const { GET, POST, DEL, db, closeDb, record, save, tokens } = require('./lib');
const fs = require('fs');
const path = require('path');

const S = JSON.parse(fs.readFileSync(path.join(__dirname, 'state.json'), 'utf8'));
Object.assign(tokens, S.tokens);
const P = S.products;
const L = S.locs;

(async () => {
  let r;

  /* ── Borrar una ubicación que tiene pallets y stock ── */
  const ocupada = (await db(
    `SELECT l.id, l.code, count(p.id)::int pallets,
            (SELECT COALESCE(SUM("currentQuantity"),0)::int FROM stocks WHERE "locationId"=l.id) AS stock
     FROM locations l JOIN pallets p ON p."currentLocationId"=l.id AND p.status<>'EXITED'
     GROUP BY l.id, l.code LIMIT 1`))[0];

  const denegadoOperador = await DEL(`/locations/${ocupada.id}`, tokens.OPERATOR);
  r = await DEL(`/locations/${ocupada.id}`, tokens.MANAGER);
  const stillThere = (await db(`SELECT count(*)::int c FROM locations WHERE id=$1`, [ocupada.id]))[0].c;
  const huerfanos = (await db(
    `SELECT count(*)::int c FROM pallets p LEFT JOIN locations l ON l.id=p."currentLocationId"
     WHERE p."currentLocationId" IS NOT NULL AND l.id IS NULL`))[0].c;
  const stockHuerfano = (await db(
    `SELECT COALESCE(SUM(s."currentQuantity"),0)::int c FROM stocks s LEFT JOIN locations l ON l.id=s."locationId"
     WHERE s."locationId" IS NOT NULL AND l.id IS NULL`))[0].c;
  record({
    id: 'INT-01', module: 'Integridad referencial', caso: 'Eliminar una ubicación que tiene pallets y stock',
    pasos: `DELETE /locations/${ocupada.code} (con ${ocupada.pallets} pallets y ${ocupada.stock} unidades), primero como OPERATOR y luego como MANAGER`,
    esperado: 'OPERATOR 403 · MANAGER 400 — no se puede borrar una ubicación ocupada; sin pallets ni stock huérfanos',
    obtenido: `operador=${denegadoOperador.status} manager=${r.status} · ubicación existe=${stillThere === 1} · pallets huérfanos=${huerfanos} · stock huérfano=${stockHuerfano} unid.`,
    ok: denegadoOperador.status === 403 && (r.status === 400 || r.status === 409)
        && stillThere === 1 && huerfanos === 0 && stockHuerfano === 0, crit: 'CRÍTICA',
    nota: 'locations.remove() borra sin verificar referencias; stocks.locationId y pallets.currentLocationId no tienen FK.',
  });

  const healthAfter = await GET('/reports/inventory-health', tokens.MANAGER);
  const layout = await GET(`/warehouses/${S.wh1}/layout`, tokens.OPERATOR);
  record({
    id: 'INT-02', module: 'Integridad referencial', caso: 'Estado del inventario tras borrar la ubicación',
    pasos: 'GET /reports/inventory-health y GET /warehouses/:id/layout',
    esperado: 'El mapa del depósito y la salud del inventario siguen siendo consistentes',
    obtenido: `inventory-health=${healthAfter.status} ok=${healthAfter.data?.ok} divergentes=${healthAfter.data?.divergentCount} · layout=${layout.status}`,
    ok: layout.status === 200 && healthAfter.status === 200, crit: 'ALTA',
  });

  /* ── Borrar un producto con lotes/stock/movimientos ── */
  const stockAntes = (await db(`SELECT COALESCE(SUM("currentQuantity"),0)::int c FROM stocks WHERE "productId"=$1`, [P['40004808']]))[0].c;
  r = await DEL(`/products/${P['40004808']}`, tokens.MANAGER);
  const prodExiste = (await db(`SELECT count(*)::int c FROM products WHERE id=$1`, [P['40004808']]))[0].c;
  record({
    id: 'INT-03', module: 'Integridad referencial', caso: 'Eliminar un material que tiene stock, lotes y movimientos',
    pasos: `DELETE /products/40004808 como MANAGER (con ${stockAntes} unidades en stock)`,
    esperado: '400/409 con mensaje claro (o baja lógica), nunca un 500',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 90)} · producto existe=${prodExiste === 1}`,
    ok: (r.status === 400 || r.status === 409) && prodExiste === 1, crit: 'ALTA',
  });

  /* ── Borrar un depósito con ubicaciones y stock ── */
  r = await DEL(`/warehouses/${S.wh1}`, tokens.MANAGER);
  const whExiste = (await db(`SELECT count(*)::int c FROM warehouses WHERE id=$1`, [S.wh1]))[0].c;
  record({
    id: 'INT-04', module: 'Integridad referencial', caso: 'Eliminar un depósito con ubicaciones y stock',
    pasos: 'DELETE /warehouses/:id del depósito principal, como MANAGER',
    esperado: '400/409 con mensaje claro, nunca un 500',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 90)} · depósito existe=${whExiste === 1}`,
    ok: (r.status === 400 || r.status === 409) && whExiste === 1, crit: 'ALTA',
  });

  /* ── Borrar un usuario que creó movimientos ── */
  const opId = (await db(`SELECT id FROM users WHERE username='qa_operator'`))[0].id;
  const movsDelOp = (await db(`SELECT count(*)::int c FROM movements WHERE "createdById"=$1`, [opId]))[0].c;
  r = await DEL(`/users/${opId}`, tokens.ADMIN);
  const userExiste = (await db(`SELECT count(*)::int c FROM users WHERE id=$1`, [opId]))[0].c;
  const movsHuerfanos = (await db(
    `SELECT count(*)::int c FROM movements m LEFT JOIN users u ON u.id=m."createdById" WHERE u.id IS NULL`))[0].c;
  record({
    id: 'INT-05', module: 'Integridad referencial', caso: 'Eliminar un usuario que registró movimientos',
    pasos: `DELETE /users/:id del operador que creó ${movsDelOp} movimientos`,
    esperado: 'Baja lógica (active=false) — el borrado físico rompe la trazabilidad de quién hizo cada movimiento',
    obtenido: `${r.status} · usuario existe=${userExiste === 1} · movimientos sin autor válido=${movsHuerfanos}`,
    ok: userExiste === 1 && movsHuerfanos === 0, crit: 'ALTA',
    nota: 'users.remove() hace un DELETE físico; movements.createdById no tiene FK.',
  });

  /* ── Pallet borrado con stock vivo ── */
  const palVivo = (await db(`SELECT id, code, quantity, "lotId" FROM pallets WHERE status<>'EXITED' AND quantity>0 LIMIT 1`))[0];
  const lotAntes = (await db(`SELECT "stockActual" FROM lots WHERE id=$1`, [palVivo.lotId]))[0].stockActual;
  r = await DEL(`/pallets/${palVivo.id}`, tokens.MANAGER);
  const palExiste = (await db(`SELECT count(*)::int c FROM pallets WHERE id=$1`, [palVivo.id]))[0].c;
  const lotDespues = (await db(`SELECT "stockActual" FROM lots WHERE id=$1`, [palVivo.lotId]))[0].stockActual;
  record({
    id: 'INT-06', module: 'Integridad referencial', caso: 'Eliminar un pallet que todavía tiene unidades',
    pasos: `DELETE /pallets/${palVivo.code} (con ${palVivo.quantity} unidades)`,
    esperado: 'Rechazo explícito (405) — los pallets no deben borrarse, se preserva la trazabilidad',
    obtenido: `${r.status} · pallet existe=${palExiste === 1} · lote ${lotAntes}→${lotDespues}`,
    ok: [400, 405, 409].includes(r.status) && palExiste === 1 && lotDespues === lotAntes,
    crit: 'ALTA',
  });

  const finalHealth = await GET('/reports/inventory-health', tokens.MANAGER);
  record({
    id: 'INT-07', module: 'Integridad referencial', caso: 'Salud del inventario tras la batería de borrados',
    pasos: 'GET /reports/inventory-health',
    esperado: 'ok:true — sin divergencias, ni por producto ni por celda',
    obtenido: `ok=${finalHealth.data?.ok} divergentes=${finalHealth.data?.divergentCount} · ${JSON.stringify((finalHealth.data?.divergent ?? []).map((d) => `${d.productCode}: stock ${d.stockSum} / lote ${d.lotSum} / pallet ${d.palletSum}`))}`,
    ok: finalHealth.data?.ok === true, crit: 'ALTA',
  });

  // Chequeo global de trazabilidad al cierre de toda la batería
  const evSinUser = (await db(`SELECT count(*)::int c FROM document_events WHERE "userId" IS NULL`))[0].c;
  const evTot = (await db(`SELECT count(*)::int c FROM document_events`))[0].c;
  const movSinAutor = (await db(
    `SELECT count(*)::int c FROM movements m LEFT JOIN users u ON u.id=m."createdById" WHERE u.id IS NULL`))[0].c;
  record({
    id: 'AUD-09', module: 'Auditoría', caso: 'Trazabilidad completa al cierre de la batería',
    pasos: 'Contar eventos de bitácora sin userId y movimientos sin autor válido después de las 7 fases',
    esperado: '0 eventos anónimos y 0 movimientos sin autor',
    obtenido: `${evSinUser} de ${evTot} eventos sin userId · ${movSinAutor} movimientos sin autor`,
    ok: evSinUser === 0 && movSinAutor === 0, crit: 'ALTA',
  });

  save('res-p7.json');
  await closeDb();
})();
