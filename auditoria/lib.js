/* Arnés de auditoría funcional — RL Logística
 * Helpers HTTP + registro de casos (caso, pasos, esperado, obtenido, estado, criticidad).
 */
const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(__dirname, '..', 'logistica-palets-backend', 'node_modules', 'pg'));

const BASE = process.env.AUDIT_BASE || 'http://localhost:3001/api';
const DB = {
  host: process.env.AUDIT_DB_HOST || 'localhost',
  port: Number(process.env.AUDIT_DB_PORT) || 5434,
  user: process.env.AUDIT_DB_USER || 'rl_test',
  password: process.env.AUDIT_DB_PASSWORD,
  database: process.env.AUDIT_DB_NAME || 'audit_db',
};

const results = [];
const tokens = {};

async function api(method, url, { body, token, raw } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data, raw: raw ? text : undefined };
}

const GET = (u, t) => api('GET', u, { token: t });
const POST = (u, b, t) => api('POST', u, { body: b, token: t });
const PATCH = (u, b, t) => api('PATCH', u, { body: b, token: t });
const DEL = (u, t) => api('DELETE', u, { token: t });

let pg;
async function db(sql, params) {
  if (!pg) {
    pg = new Client(DB);
    await pg.connect();
  }
  const r = await pg.query(sql, params);
  return r.rows;
}
async function closeDb() {
  if (pg) await pg.end();
  pg = null;
}

/** Registra un caso de prueba. */
function record({ id, module: mod, caso, pasos, esperado, obtenido, ok, crit, nota }) {
  const estado = ok === true ? 'PASA' : ok === false ? 'FALLA' : 'PARCIAL';
  results.push({
    id,
    module: mod,
    caso,
    pasos,
    esperado,
    obtenido,
    estado,
    criticidad: crit || 'MEDIA',
    nota: nota || null,
  });
  const mark = estado === 'PASA' ? 'OK  ' : estado === 'FALLA' ? 'FAIL' : 'WARN';
  console.log(`[${mark}] ${id}  ${caso}`);
  if (estado !== 'PASA') console.log(`        esperado: ${esperado}\n        obtenido: ${obtenido}`);
  return estado === 'PASA';
}

/** Ejecuta fn con captura de excepción → caso ERROR. */
async function safe(id, mod, caso, crit, fn) {
  try {
    return await fn();
  } catch (e) {
    record({
      id,
      module: mod,
      caso,
      pasos: '(ver caso)',
      esperado: 'Ejecución sin excepción del arnés',
      obtenido: `Excepción: ${e.message}`,
      ok: false,
      crit,
    });
    return null;
  }
}

function save(file) {
  const out = path.join(__dirname, file);
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  const tot = results.length;
  const pass = results.filter((r) => r.estado === 'PASA').length;
  const fail = results.filter((r) => r.estado === 'FALLA').length;
  const warn = results.filter((r) => r.estado === 'PARCIAL').length;
  console.log(`\n=== ${file}: ${tot} casos — ${pass} PASA / ${fail} FALLA / ${warn} PARCIAL ===`);
  return { tot, pass, fail, warn };
}

/** Invariante de las tres contabilidades para un producto. */
async function tripleCheck(productId) {
  const [row] = await db(
    `SELECT
       COALESCE((SELECT SUM("currentQuantity") FROM stocks WHERE "productId"=$1),0)::int AS stock,
       COALESCE((SELECT SUM("stockActual") FROM lots WHERE "productId"=$1),0)::int AS lote,
       COALESCE((SELECT SUM(p.quantity) FROM pallets p JOIN lots l ON l.id=p."lotId"
                 WHERE l."productId"=$1 AND p.status <> 'EXITED'),0)::int AS pallet`,
    [productId],
  );
  return row;
}

module.exports = { api, GET, POST, PATCH, DEL, db, closeDb, record, safe, save, tokens, tripleCheck, BASE };
