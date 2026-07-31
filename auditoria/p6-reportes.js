/* FASE 6 — Reportes, diferencias SAP, auditoría/bitácora, adjuntos, transportes, endpoints sensibles. */
const { GET, POST, PATCH, DEL, db, closeDb, record, save, tokens } = require('./lib');
const fs = require('fs');
const path = require('path');

const S = JSON.parse(fs.readFileSync(path.join(__dirname, 'state.json'), 'utf8'));
Object.assign(tokens, S.tokens);
const P = S.products;
const today = new Date().toISOString().slice(0, 10);

(async () => {
  let r;

  /* ══════════════ REPORTES ══════════════ */
  r = await GET('/reports/stock', tokens.OPERATOR);
  const sumApi = Number(r.data?.totalQuantity ?? 0);
  const sumDb = (await db(`SELECT COALESCE(SUM("currentQuantity"),0)::int t FROM stocks`))[0].t;
  record({
    id: 'REP-01', module: 'Reportes', caso: 'Reporte de stock coincide con la tabla stocks',
    pasos: 'GET /reports/stock vs SUM(stocks.currentQuantity)',
    esperado: 'Totales iguales',
    obtenido: `${r.status} totalQuantity(api)=${sumApi} SUM(stocks)=${sumDb}`,
    ok: r.status === 200 && sumApi === sumDb, crit: 'ALTA',
  });

  r = await GET('/reports/movements?limit=100', tokens.AUDITOR);
  const movs = r.data?.data ?? r.data ?? [];
  const movCount = (await db(`SELECT count(*)::int c FROM movements`))[0].c;
  record({
    id: 'REP-02', module: 'Reportes', caso: 'Reporte de movimientos accesible por AUDITOR',
    pasos: 'GET /reports/movements con token AUDITOR',
    esperado: '200 con los movimientos registrados',
    obtenido: `${r.status} filas=${Array.isArray(movs) ? movs.length : '?'} (movimientos en base=${movCount})`,
    ok: r.status === 200, crit: 'MEDIA',
  });

  r = await GET(`/reports/trace?materialId=${P['40004808']}`, tokens.OPERATOR);
  record({
    id: 'REP-03', module: 'Reportes', caso: 'Trazabilidad por material',
    pasos: 'GET /reports/trace?materialId=',
    esperado: '200 con el historial del material',
    obtenido: `${r.status} claves=${r.data ? Object.keys(r.data).slice(0, 6).join(',') : '-'}`,
    ok: r.status === 200, crit: 'MEDIA',
  });

  r = await GET('/reports/trace', tokens.OPERATOR);
  record({
    id: 'REP-04', module: 'Reportes', caso: 'Trazabilidad sin materialId',
    pasos: 'GET /reports/trace sin parámetros',
    esperado: '400 parámetro obligatorio (no 500)',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 100)}`,
    ok: r.status === 400, crit: 'BAJA',
  });

  r = await GET('/reports/kpis', tokens.OPERATOR);
  record({
    id: 'REP-05', module: 'Reportes', caso: 'KPIs del tablero',
    pasos: 'GET /reports/kpis',
    esperado: '200 con métricas',
    obtenido: `${r.status} ${JSON.stringify(r.data)?.slice(0, 200)}`,
    ok: r.status === 200, crit: 'MEDIA',
  });

  r = await GET('/reports/occupancy', tokens.MANAGER);
  const occ = r.data?.warehouses ?? [];
  const dbPallets = (await db(`SELECT count(*)::int c FROM pallets WHERE status<>'EXITED' AND "currentLocationId" IS NOT NULL`))[0].c;
  const apiPallets = occ.reduce((s, w) => s + Number(w.palletsStored ?? 0), 0);
  record({
    id: 'REP-06', module: 'Reportes', caso: 'Ocupación por depósito coincide con los pallets almacenados',
    pasos: 'GET /reports/occupancy vs COUNT(pallets activos)',
    esperado: 'Mismo número de pallets',
    obtenido: `${r.status} api=${apiPallets} db=${dbPallets} · ${JSON.stringify(occ).slice(0, 220)}`,
    ok: r.status === 200 && apiPallets === dbPallets, crit: 'MEDIA',
  });

  r = await GET('/reports/rotation', tokens.MANAGER);
  record({
    id: 'REP-07', module: 'Reportes', caso: 'Rotación de inventario (top movers / stock estancado)',
    pasos: 'GET /reports/rotation',
    esperado: '200 con datos de rotación',
    obtenido: `${r.status} claves=${r.data ? Object.keys(r.data).join(',') : '-'}`,
    ok: r.status === 200, crit: 'BAJA',
  });

  r = await GET('/reports/dwell-time', tokens.MANAGER);
  record({
    id: 'REP-08', module: 'Reportes', caso: 'Dwell-time (antigüedad de pallets, base de facturación)',
    pasos: 'GET /reports/dwell-time',
    esperado: '200 con buckets de antigüedad',
    obtenido: `${r.status} ${JSON.stringify(r.data)?.slice(0, 200)}`,
    ok: r.status === 200, crit: 'BAJA',
  });

  r = await GET('/reports/freshness', tokens.OPERATOR);
  record({
    id: 'REP-09', module: 'Reportes', caso: 'Frescura / vencimientos próximos',
    pasos: 'GET /reports/freshness',
    esperado: '200; el lote que vence en 7 días debe aparecer marcado',
    obtenido: `${r.status} ${JSON.stringify(r.data)?.slice(0, 220)}`,
    ok: r.status === 200, crit: 'MEDIA',
  });

  r = await GET('/reports/daily-stock?date=' + today, tokens.OPERATOR);
  record({
    id: 'REP-10', module: 'Reportes', caso: 'Stock diario',
    pasos: 'GET /reports/daily-stock?date=hoy',
    esperado: '200',
    obtenido: `${r.status}`, ok: r.status === 200, crit: 'BAJA',
  });

  r = await GET('/reports/occupancy', tokens.OPERATOR);
  record({
    id: 'REP-11', module: 'Reportes', caso: 'OPERATOR intenta ver ocupación (endpoint ADMIN/MANAGER/AUDITOR)',
    pasos: 'GET /reports/occupancy con token OPERATOR',
    esperado: '403 Forbidden',
    obtenido: `${r.status}`, ok: r.status === 403, crit: 'BAJA',
  });

  /* ══════════════ DIFERENCIAS DE INVENTARIO (SAP) ══════════════ */
  const stockP1 = (await db(`SELECT COALESCE(SUM("currentQuantity"),0)::int t FROM stocks WHERE "productId"=$1`, [P['40004808']]))[0].t;
  r = await POST('/reports/sap-stock', {
    date: today, productId: P['40004808'], sapQuantity: stockP1 - 750,
  }, tokens.MANAGER);
  record({
    id: 'DIF-01', module: 'Diferencias de inventario', caso: 'Cargar snapshot de stock SAP del día',
    pasos: 'POST /reports/sap-stock con la cantidad de SAP',
    esperado: '200/201 guardado',
    obtenido: `${r.status} ${JSON.stringify(r.data)?.slice(0, 150)}`,
    ok: r.status === 200 || r.status === 201, crit: 'ALTA',
  });

  r = await GET(`/reports/differences-sap?date=${today}`, tokens.MANAGER);
  const diffs = r.data?.data ?? r.data ?? [];
  const mine = (Array.isArray(diffs) ? diffs : []).find((d) => (d.material?.code ?? d.productCode) === '40004808');
  record({
    id: 'DIF-02', module: 'Diferencias de inventario', caso: 'Comparativo WMS vs SAP muestra la diferencia exacta',
    pasos: 'GET /reports/differences-sap?date=hoy',
    esperado: `Diferencia de +750 para el material 40004808 (WMS ${stockP1} vs SAP ${stockP1 - 750})`,
    obtenido: `${r.status} ${JSON.stringify(mine ?? diffs)?.slice(0, 260)}`,
    ok: r.status === 200 && !!mine && Math.abs(Number(mine.diferencia ?? mine.difference ?? 0)) === 750, crit: 'ALTA',
  });

  r = await POST('/reports/sap-stock', { date: today, productId: P['40004808'], sapQuantity: stockP1 }, tokens.MANAGER);
  const diffs2 = (await GET(`/reports/differences-sap?date=${today}`, tokens.MANAGER)).data;
  const arr2 = diffs2?.data ?? diffs2 ?? [];
  const mine2 = (Array.isArray(arr2) ? arr2 : []).filter((d) => (d.material?.code ?? d.productCode) === '40004808');
  record({
    id: 'DIF-03', module: 'Diferencias de inventario', caso: 'Re-cargar el snapshot SAP del mismo día (idempotencia)',
    pasos: 'POST /reports/sap-stock dos veces para la misma fecha y producto',
    esperado: 'Una sola fila por producto/fecha, con la diferencia recalculada en 0',
    obtenido: `${r.status} filas para el producto=${mine2.length} · diferencia=${mine2[0]?.diferencia} · snapshots en base=${(await db(`SELECT count(*)::int c FROM sap_stock_snapshots WHERE "productId"=$1 AND date=$2`, [P['40004808'], today]))[0].c}`,
    ok: (r.status === 200 || r.status === 201) && mine2.length === 1 && Number(mine2[0]?.diferencia) === 0, crit: 'ALTA',
  });

  r = await GET(`/reports/differences-sap?date=${today}`, tokens.OPERATOR);
  record({
    id: 'DIF-04', module: 'Diferencias de inventario', caso: 'OPERATOR intenta ver diferencias SAP',
    pasos: 'GET /reports/differences-sap con token OPERATOR',
    esperado: '403 Forbidden',
    obtenido: `${r.status}`, ok: r.status === 403, crit: 'BAJA',
  });

  /* ══════════════ AUDITORÍA / BITÁCORA ══════════════ */
  r = await GET('/attachments/events?limit=200', tokens.AUDITOR);
  const events = r.data?.data ?? r.data ?? [];
  const evDb = (await db(`SELECT count(*)::int c FROM document_events`))[0].c;
  const tipos = [...new Set((Array.isArray(events) ? events : []).map((e) => e.eventType))];
  record({
    id: 'AUD-01', module: 'Auditoría', caso: 'Bitácora global de eventos',
    pasos: 'GET /attachments/events',
    esperado: 'Eventos de creación de remitos, ajustes y anulaciones',
    obtenido: `${r.status} eventos=${Array.isArray(events) ? events.length : '?'} (base=${evDb}) tipos=${tipos.join(', ')}`,
    ok: r.status === 200 && evDb > 0, crit: 'ALTA',
  });

  const evAdj = (await db(`SELECT count(*)::int c FROM document_events WHERE "entityType"='ADJUSTMENT' AND "eventType"='APROBADO'`))[0].c;
  record({
    id: 'AUD-02', module: 'Auditoría', caso: 'Las aprobaciones de ajuste quedan registradas',
    pasos: "SELECT document_events WHERE entityType='ADJUSTMENT' AND eventType='APROBADO'",
    esperado: 'Al menos un evento de aprobación',
    obtenido: `${evAdj} eventos`, ok: evAdj > 0, crit: 'ALTA',
  });

  const evUser = (await db(`SELECT count(*)::int c FROM document_events WHERE "userId" IS NULL`))[0].c;
  const evTot = (await db(`SELECT count(*)::int c FROM document_events`))[0].c;
  record({
    id: 'AUD-03', module: 'Auditoría', caso: 'Todo evento de bitácora tiene usuario responsable',
    pasos: 'SELECT document_events WHERE userId IS NULL',
    esperado: '0 eventos sin autor (trazabilidad completa)',
    obtenido: `${evUser} de ${evTot} eventos sin userId`,
    ok: evUser === 0, crit: 'ALTA',
    nota: 'uploads.log() se invoca sin userId en la creación de documentos y en varios puntos del flujo.',
  });

  const regLogs = await db(`SELECT count(*)::int c FROM regularization_logs WHERE reason IS NULL OR reason=''`);
  const regTot = (await db(`SELECT count(*)::int c FROM regularization_logs`))[0].c;
  record({
    id: 'AUD-04', module: 'Auditoría', caso: 'Toda corrección tiene motivo registrado',
    pasos: 'SELECT regularization_logs WHERE reason vacío',
    esperado: '0 correcciones sin motivo',
    obtenido: `${regLogs[0].c} de ${regTot} sin motivo`,
    ok: regLogs[0].c === 0 && regTot > 0, crit: 'ALTA',
  });

  const movNoUser = (await db(`SELECT count(*)::int c FROM movements WHERE "createdById" IS NULL`))[0].c;
  record({
    id: 'AUD-05', module: 'Auditoría', caso: 'Todo movimiento tiene usuario creador',
    pasos: 'SELECT movements WHERE createdById IS NULL',
    esperado: '0 movimientos anónimos',
    obtenido: `${movNoUser}`, ok: movNoUser === 0, crit: 'ALTA',
  });

  r = await GET(`/attachments/log?entityType=MOVEMENT&entityId=${(await db(`SELECT id FROM movements LIMIT 1`))[0].id}`, tokens.AUDITOR);
  record({
    id: 'AUD-06', module: 'Auditoría', caso: 'Historial completo de una entidad (eventos + adjuntos)',
    pasos: 'GET /attachments/log?entityType=MOVEMENT&entityId=',
    esperado: '200 con el historial',
    obtenido: `${r.status} ${JSON.stringify(r.data)?.slice(0, 150)}`,
    ok: r.status === 200, crit: 'MEDIA',
  });

  const palletHist = (await db(`SELECT id FROM pallets LIMIT 1`))[0].id;
  r = await GET(`/pallets/${palletHist}/history`, tokens.AUDITOR);
  record({
    id: 'AUD-07', module: 'Auditoría', caso: 'Historial de un pallet',
    pasos: 'GET /pallets/:id/history',
    esperado: '200 con los movimientos del pallet',
    obtenido: `${r.status} ${Array.isArray(r.data) ? r.data.length + ' eventos' : JSON.stringify(r.data)?.slice(0, 120)}`,
    ok: r.status === 200, crit: 'MEDIA',
  });

  r = await GET(`/pallets/${palletHist}/history`, tokens.OPERATOR);
  record({
    id: 'AUD-08', module: 'Auditoría', caso: 'OPERATOR intenta ver el historial de un pallet',
    pasos: 'GET /pallets/:id/history con token OPERATOR',
    esperado: '403 (endpoint declarado ADMIN/MANAGER/AUDITOR)',
    obtenido: `${r.status}`, ok: r.status === 403, crit: 'BAJA',
  });

  /* ══════════════ TRANSPORTES ══════════════ */
  r = await POST('/transports', { plate: 'BKH180', type: 'Scania R450', description: 'Ambev', capacityPallets: 28, capacityKg: 28000 }, tokens.OPERATOR);
  const tr1 = r.data?.id;
  record({
    id: 'TRA-01', module: 'Transportes', caso: 'Alta de vehículo',
    pasos: 'POST /transports',
    esperado: '201 con id y estado DISPONIBLE',
    obtenido: `${r.status} id=${tr1} status=${r.data?.status}`,
    ok: r.status === 201 && r.data?.status === 'DISPONIBLE', crit: 'MEDIA',
  });

  r = await POST('/transports', { plate: 'BKH180', type: 'Otro' }, tokens.OPERATOR);
  record({
    id: 'TRA-02', module: 'Transportes', caso: 'Alta de vehículo con patente duplicada',
    pasos: 'POST /transports con la misma patente',
    esperado: '400/409 patente duplicada',
    obtenido: `${r.status}`, ok: r.status === 400 || r.status === 409, crit: 'MEDIA',
  });

  r = await POST(`/transports/${tr1}/inspection`, { result: 'APROBADA', notes: 'Frenos y neumáticos OK' }, tokens.OPERATOR);
  record({
    id: 'TRA-03', module: 'Transportes', caso: 'Registrar inspección del vehículo',
    pasos: 'POST /transports/:id/inspection',
    esperado: '200/201 con evento en la bitácora',
    obtenido: `${r.status} ${JSON.stringify(r.data)?.slice(0, 120)}`,
    ok: r.status === 200 || r.status === 201, crit: 'BAJA',
  });

  r = await GET(`/transports/${tr1}/history`, tokens.OPERATOR);
  record({
    id: 'TRA-04', module: 'Transportes', caso: 'Historial de viajes del vehículo (remitos vinculados por patente)',
    pasos: 'GET /transports/:id/history',
    esperado: '200 incluyendo el remito de entrada cargado con BKH180',
    obtenido: `${r.status} ${JSON.stringify(r.data)?.slice(0, 200)}`,
    ok: r.status === 200, crit: 'BAJA',
  });

  /* ══════════════ ENDPOINTS SENSIBLES ══════════════ */
  r = await POST('/seed/reset', { confirm: true }, tokens.MANAGER);
  record({
    id: 'SEC-02', module: 'Seguridad', caso: 'MANAGER intenta ejecutar el reset de la base (endpoint de seed)',
    pasos: 'POST /seed/reset con token MANAGER',
    esperado: '403 — solo ADMIN',
    obtenido: `${r.status}`, ok: r.status === 403, crit: 'CRÍTICA',
  });

  r = await POST('/seed/reset', {}, tokens.AUDITOR);
  record({
    id: 'SEC-03', module: 'Seguridad', caso: 'AUDITOR intenta ejecutar el reset de la base',
    pasos: 'POST /seed/reset con token AUDITOR',
    esperado: '403 Forbidden',
    obtenido: `${r.status}`, ok: r.status === 403, crit: 'CRÍTICA',
  });

  r = await POST('/movements/stock-snapshot/revert', { commit: false }, tokens.MANAGER);
  record({
    id: 'SEC-04', module: 'Seguridad', caso: 'MANAGER intenta revertir el snapshot de stock inicial',
    pasos: 'POST /movements/stock-snapshot/revert con token MANAGER',
    esperado: '403 — solo ADMIN',
    obtenido: `${r.status}`, ok: r.status === 403, crit: 'ALTA',
  });

  // Inyección SQL en filtros de búsqueda
  r = await GET(`/movements/documents?search=${encodeURIComponent("' OR 1=1; DROP TABLE stocks;--")}`, tokens.OPERATOR);
  const stocksAlive = await db(`SELECT count(*)::int c FROM stocks`);
  record({
    id: 'SEC-05', module: 'Seguridad', caso: 'Intento de inyección SQL en el buscador de remitos',
    pasos: `GET /movements/documents?search=' OR 1=1; DROP TABLE stocks;--`,
    esperado: '200 sin efectos y tabla stocks intacta',
    obtenido: `${r.status} filas devueltas=${Array.isArray(r.data) ? r.data.length : '?'} · stocks sigue con ${stocksAlive[0].c} filas`,
    ok: r.status === 200 && stocksAlive[0].c > 0, crit: 'CRÍTICA',
  });

  r = await GET('/health');
  record({
    id: 'SEC-06', module: 'Seguridad', caso: 'Endpoint de health sin autenticación (para el balanceador)',
    pasos: 'GET /health sin token',
    esperado: '200 sin exponer datos sensibles',
    obtenido: `${r.status} ${JSON.stringify(r.data)?.slice(0, 160)}`,
    ok: r.status === 200, crit: 'BAJA',
  });

  save('res-p6.json');
  await closeDb();
})();
