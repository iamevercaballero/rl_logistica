/**
 * Seed script: lee el Excel de RL Logística y carga los datos en el sistema.
 *
 * Uso:
 *   node scripts/seed-from-excel.js
 *   node scripts/seed-from-excel.js --url http://localhost:3000 --user admin --pass admin123
 *   node scripts/seed-from-excel.js --solo-productos
 *   node scripts/seed-from-excel.js --max-movimientos 100
 */

const XLSX  = require('xlsx');
const axios = require('axios');
const path  = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (name) => args.includes(name);

const BASE_URL   = getArg('--url')   || process.env.SEED_URL  || 'http://localhost:3000';
const API_URL    = `${BASE_URL}/api`;
const USERNAME   = getArg('--user')  || process.env.SEED_USER || 'admin';
const PASSWORD   = getArg('--pass')  || process.env.SEED_PASS || 'admin123';
const EXCEL_PATH = getArg('--excel') || process.env.SEED_EXCEL
                || path.join(__dirname, '../../CONTROL DE STOCK RL LOG Actualizado.xlsx');
const SOLO_PROD  = hasFlag('--solo-productos');
const MAX_MOV    = parseInt(getArg('--max-movimientos') || '300', 10);

// ─── HTTP helper (usa axios — evita el crash libuv de fetch en Windows) ───────

const http = axios.create({ baseURL: API_URL, timeout: 15000 });

let token = null;

async function call(method, endpoint, body) {
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await http.request({ method, url: endpoint, data: body, headers });
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    const msg    = JSON.stringify(err.response?.data ?? err.message);
    // 409 Conflict o "ya existe" → silenciar (idempotente)
    if (status === 409) return null;
    if (status === 400 && msg.includes('exist')) return null;
    throw new Error(`${method.toUpperCase()} ${endpoint} → ${status}: ${msg.slice(0, 200)}`);
  }
}

// ─── Utils ────────────────────────────────────────────────────────────────────

const excelDate = (n) => {
  if (!n || typeof n !== 'number') return new Date().toISOString().slice(0, 10);
  return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
};

const log     = (m) => console.log(`  ✓ ${m}`);
const warn    = (m) => console.log(`  ⚠ ${m}`);
const section = (m) => console.log(`\n${'─'.repeat(60)}\n  ${m}\n${'─'.repeat(60)}`);
const sleep   = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Lectura del Excel ────────────────────────────────────────────────────────

function leerExcel() {
  console.log(`\nLeyendo: ${EXCEL_PATH}`);
  const wb = XLSX.readFile(EXCEL_PATH);

  // Hoja Entrada — col[2]=fecha, [3]=cod, [4]=desc, [5]=palets, [6]=cant, [7]=um, [9]=remito, [11]=prov, [12]=transp, [13]=cond
  const dataE = XLSX.utils.sheet_to_json(wb.Sheets['Entrada'], { header: 1, defval: '' });
  const entradas = dataE
    .filter((r, i) => i >= 6 && r[3] && typeof r[3] === 'number' && r[4] && Number(r[6]) > 0)
    .map(r => ({
      fecha:    excelDate(r[2]),
      codigo:   String(r[3]),
      desc:     String(r[4]).trim().slice(0, 160),
      paletas:  Number(r[5]) || 0,
      cantidad: Math.max(1, Math.round(Number(r[6]))),
      um:       String(r[7] || 'UN').trim().slice(0, 20),
      remito:   r[9] ? String(r[9]).trim() : null,
      proveedor:String(r[11] || 'AMBEV').trim().slice(0, 100) || 'AMBEV',
      transport:String(r[12] || '').trim().slice(0, 100) || null,
      conductor:String(r[13] || '').trim().slice(0, 100) || null,
    }));

  // Hoja Salida — col[1]=fecha, [2]=cod, [3]=desc, [5]=palets, [6]=cant, [7]=um, [10]=remito, [11]=transp, [12]=destino, [13]=cond
  const dataSal = XLSX.utils.sheet_to_json(wb.Sheets['Salida'], { header: 1, defval: '' });
  const salidas = dataSal
    .filter((r, i) => i >= 6 && r[2] && typeof r[2] === 'number' && r[3] && Number(r[6]) > 0)
    .map(r => ({
      fecha:    excelDate(r[1]),
      codigo:   String(r[2]),
      desc:     String(r[3]).trim().slice(0, 160),
      paletas:  Number(r[5]) || 0,
      cantidad: Math.max(1, Math.round(Number(r[6]))),
      um:       String(r[7] || 'UN').trim().slice(0, 20),
      remito:   r[10] ? String(r[10]).trim() : null,
      transport:String(r[11] || '').trim().slice(0, 100) || null,
      destino:  String(r[12] || '').trim().slice(0, 100) || null,
      conductor:String(r[13] || '').trim().slice(0, 100) || null,
    }));

  // Hoja2 — stock actual: col[0]=cod, [1]=desc, [2]=lote, [3]=cant, [4]=palets
  const data2 = XLSX.utils.sheet_to_json(wb.Sheets['Hoja2'], { header: 1, defval: '' });
  const stockActual = data2
    .filter((r, i) => i >= 2 && r[0] && typeof r[0] === 'number' && Number(r[3]) > 0)
    .map(r => ({
      codigo:   String(r[0]),
      desc:     String(r[1]).trim().slice(0, 160),
      lote:     String(r[2]).trim(),
      cantidad: Math.max(1, Math.round(Number(r[3]))),
      paletas:  Number(r[4]) || 0,
    }));

  // Productos únicos
  const prodMap = new Map();
  [...entradas, ...salidas].forEach(r => {
    if (!prodMap.has(r.codigo)) prodMap.set(r.codigo, { code: r.codigo, description: r.desc, unitOfMeasure: r.um });
  });
  stockActual.forEach(r => {
    if (!prodMap.has(r.codigo)) prodMap.set(r.codigo, { code: r.codigo, description: r.desc, unitOfMeasure: 'UN' });
  });

  // Tomar los N más recientes de cada tipo
  const entradasRec = [...entradas].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, MAX_MOV);
  const salidasRec  = [...salidas].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, MAX_MOV);

  console.log(`  Productos únicos : ${prodMap.size}`);
  console.log(`  Entradas totales : ${entradas.length} → cargando ${entradasRec.length}`);
  console.log(`  Salidas totales  : ${salidas.length} → cargando ${salidasRec.length}`);
  console.log(`  Stock Hoja2      : ${stockActual.length} filas`);

  return { productos: Array.from(prodMap.values()), entradas: entradasRec, salidas: salidasRec, stockActual };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║     SEED — RL Logística: carga masiva desde Excel       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  API: ${API_URL} | Max movimientos: ${MAX_MOV}`);

  // 1. Login
  section('1/7 — Autenticación');
  const auth = await call('post', '/auth/login', { username: USERNAME, password: PASSWORD });
  if (!auth?.access_token) throw new Error('Login fallido. Verificá usuario/contraseña.');
  token = auth.access_token;
  log(`Autenticado como "${USERNAME}"`);

  // 2. Excel
  section('2/7 — Lectura del Excel');
  const { productos, entradas, salidas, stockActual } = leerExcel();

  // 3. Depósito
  section('3/7 — Depósito y Ubicación');

  let deposito = await call('post', '/warehouses', { name: 'DEPÓSITO RL LOGÍSTICA', address: 'Asunción, Paraguay' });
  if (!deposito?.id) {
    const lista = await call('get', '/warehouses');
    deposito = (Array.isArray(lista) ? lista : lista?.data ?? []).find(w => w.name === 'DEPÓSITO RL LOGÍSTICA');
  }
  if (!deposito?.id) throw new Error('No se pudo crear/encontrar el depósito');
  log(`Depósito: ${deposito.name} (${deposito.id})`);

  // Location usa "code" (no "name") y "warehouseId"
  let ubicacion = await call('post', '/locations', { code: 'ALMACEN-GENERAL', warehouseId: deposito.id });
  if (!ubicacion?.id) {
    const lista = await call('get', '/locations');
    ubicacion = (Array.isArray(lista) ? lista : lista?.data ?? []).find(l => l.warehouse?.id === deposito.id || l.warehouseId === deposito.id);
  }
  if (!ubicacion?.id) throw new Error('No se pudo crear/encontrar la ubicación');
  log(`Ubicación: ${ubicacion.code ?? ubicacion.id}`);

  // 4. Productos
  section('4/7 — Productos');
  const productIdMap = new Map();
  let creados = 0, omitidos = 0;

  for (const prod of productos) {
    const r = await call('post', '/products', {
      code: prod.code,
      description: prod.description,
      unitOfMeasure: prod.unitOfMeasure,
    });
    if (r?.id) { productIdMap.set(prod.code, r.id); creados++; }
    else omitidos++;
    if ((creados + omitidos) % 50 === 0) await sleep(80);
  }

  if (omitidos > 0) {
    // Recuperar IDs de los que ya existían
    let cursor = 1;
    while (true) {
      const res = await call('get', `/products?limit=100&page=${cursor}`);
      const lista = res?.data ?? (Array.isArray(res) ? res : []);
      if (!lista.length) break;
      lista.forEach(p => { if (!productIdMap.has(p.code)) productIdMap.set(p.code, p.id); });
      if (lista.length < 100) break;
      cursor++;
      await sleep(50);
    }
  }
  log(`Creados: ${creados} | Ya existían: ${omitidos} | Mapeados: ${productIdMap.size}`);

  if (SOLO_PROD) {
    console.log('\n  Modo --solo-productos: fin del seed.\n');
    return;
  }

  // 5. Lotes
  section('5/7 — Lotes (Hoja2)');
  let lotesOk = 0;
  for (const row of stockActual) {
    const productId = productIdMap.get(row.codigo);
    if (!productId) { warn(`Sin producto: ${row.codigo}`); continue; }
    const r = await call('post', '/lots', { lotCode: row.lote, productId });
    if (r?.id) { lotesOk++; log(`Lote ${row.lote} → ${row.desc.slice(0, 40)}`); }
  }
  log(`Lotes: ${lotesOk}`);

  // 6. Stock inicial (Hoja2 → ADJUSTMENT_IN)
  section('6/7 — Stock inicial');
  let stockOk = 0;
  for (const row of stockActual) {
    const productId = productIdMap.get(row.codigo);
    if (!productId || row.cantidad <= 0) continue;
    const r = await call('post', '/movements', {
      type: 'ADJUSTMENT_IN', productId,
      quantity: row.cantidad,
      pallets: row.paletas || undefined,
      warehouseId: deposito.id, locationId: ubicacion.id,
      supplier: 'AMBEV',
      documentNumber: `STOCK-INI-${row.lote}`,
    });
    if (r?.id) { stockOk++; log(`${row.desc.slice(0, 35)} | ${row.lote} | ${row.cantidad} uds`); }
    else warn(`No cargó stock: ${row.codigo} ${row.lote}`);
    await sleep(30);
  }
  log(`Stock inicial: ${stockOk} movimientos`);

  // 7. Movimientos históricos
  section('7/7 — Movimientos históricos');

  // 7a. Entradas
  let entOk = 0, entFail = 0;
  process.stdout.write(`  Entradas (${entradas.length}):`);
  for (const e of entradas) {
    const productId = productIdMap.get(e.codigo);
    if (!productId) { entFail++; continue; }
    const r = await call('post', '/movements', {
      type: 'ENTRY', date: e.fecha, productId,
      quantity: e.cantidad,
      pallets: e.paletas || undefined,
      warehouseId: deposito.id, locationId: ubicacion.id,
      supplier: e.proveedor,
      carrier: e.transport || undefined,
      driver: e.conductor || undefined,
      documentNumber: e.remito || undefined,
    });
    if (r?.id) entOk++; else entFail++;
    if ((entOk + entFail) % 50 === 0) { process.stdout.write(` ${entOk + entFail}`); await sleep(150); }
  }
  console.log();
  log(`Entradas: ${entOk} ok | ${entFail} fallidas`);

  // 7b. Salidas — pre-ajuste de stock si hace falta
  let salOk = 0, salFail = 0;
  const stockCache = new Map();
  process.stdout.write(`  Salidas (${salidas.length}):`);

  for (const s of salidas) {
    const productId = productIdMap.get(s.codigo);
    if (!productId) { salFail++; continue; }

    let disp = stockCache.get(productId) ?? 0;
    if (disp < s.cantidad) {
      const ajuste = s.cantidad * 3;
      await call('post', '/movements', {
        type: 'ADJUSTMENT_IN', productId,
        quantity: ajuste,
        warehouseId: deposito.id, locationId: ubicacion.id,
        documentNumber: 'AJUSTE-HIST',
      });
      disp += ajuste;
    }

    const r = await call('post', '/movements', {
      type: 'EXIT', date: s.fecha, productId,
      quantity: s.cantidad,
      pallets: s.paletas || undefined,
      warehouseId: deposito.id, locationId: ubicacion.id,
      carrier: s.transport || undefined,
      driver: s.conductor || undefined,
      destination: s.destino || undefined,
      documentNumber: s.remito || undefined,
    });
    if (r?.id) { salOk++; stockCache.set(productId, disp - s.cantidad); }
    else salFail++;
    if ((salOk + salFail) % 50 === 0) { process.stdout.write(` ${salOk + salFail}`); await sleep(150); }
  }
  console.log();
  log(`Salidas: ${salOk} ok | ${salFail} fallidas`);

  // ─── Resumen ─────────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                   SEED COMPLETADO ✓                     ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Productos mapeados : ${String(productIdMap.size).padEnd(34)}║`);
  console.log(`║  Lotes creados      : ${String(lotesOk).padEnd(34)}║`);
  console.log(`║  Stock inicial      : ${String(stockOk).padEnd(34)}║`);
  console.log(`║  Entradas cargadas  : ${String(entOk).padEnd(34)}║`);
  console.log(`║  Salidas cargadas   : ${String(salOk).padEnd(34)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');
}

main()
  .then(() => process.exit(0))          // cierre limpio de handles (evita crash libuv en Windows)
  .catch(err => { console.error('\n✗ ERROR:', err.message); process.exit(1); });
