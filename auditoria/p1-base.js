/* FASE 1 — Autenticación, roles/usuarios, productos, depósitos, ubicaciones. */
const { GET, POST, PATCH, DEL, db, closeDb, record, save, tokens } = require('./lib');
const fs = require('fs');
const path = require('path');

const S = {};
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const login = (username, password) => POST('/auth/login', { username, password });

(async () => {
  /* ── Logins reales primero (el endpoint permite 5/min por IP) ── */
  let r = await login('admin', 'admin123');
  record({
    id: 'AUTH-01', module: 'Autenticación', caso: 'Login con credenciales válidas (admin)',
    pasos: 'POST /auth/login {admin/admin123}',
    esperado: '200 + access_token + user.role=ADMIN',
    obtenido: `${r.status} token=${!!r.data?.access_token} role=${r.data?.user?.role}`,
    ok: r.status < 300 && !!r.data?.access_token && r.data?.user?.role === 'ADMIN',
    crit: 'CRÍTICA',
  });
  tokens.ADMIN = r.data?.access_token;

  const roles = [
    ['qa_manager', 'Manager123!', 'MANAGER'],
    ['qa_operator', 'Operator123!', 'OPERATOR'],
    ['qa_auditor', 'Auditor123!', 'AUDITOR'],
  ];
  let idx = 0;
  for (const [u, p, role] of roles) {
    idx++;
    const c = await POST('/users', { username: u, password: p, role, fullName: `QA ${role}` }, tokens.ADMIN);
    const lg = await login(u, p);
    tokens[role] = lg.data?.access_token;
    record({
      id: `USR-0${idx}`, module: 'Usuarios y roles', caso: `Crear usuario con rol ${role} y autenticarlo`,
      pasos: `POST /users {${u}, ${role}} → POST /auth/login`,
      esperado: 'Usuario creado (201) y login exitoso devolviendo ese rol',
      obtenido: `create=${c.status} login=${lg.status} role=${lg.data?.user?.role}`,
      ok: c.status === 201 && lg.status < 300 && lg.data?.user?.role === role, crit: 'CRÍTICA',
    });
  }

  /* ── Casos negativos de login: consumen cupo del throttler ── */
  r = await login('admin', 'password-incorrecta');
  record({
    id: 'AUTH-02', module: 'Autenticación', caso: 'Login con contraseña incorrecta',
    pasos: 'POST /auth/login con password inválida',
    esperado: '401 Credenciales inválidas',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)}`,
    ok: r.status === 401, crit: 'CRÍTICA',
  });

  // 6º intento en la ventana → debe cortar el throttler
  const burst = [];
  for (let i = 0; i < 4; i++) burst.push((await login('admin', 'mal')).status);
  record({
    id: 'SEC-01', module: 'Seguridad', caso: 'Anti fuerza bruta: más de 5 intentos de login por minuto',
    pasos: 'POST /auth/login ×9 en menos de 60 s desde la misma IP',
    esperado: '429 Too Many Requests al superar el límite',
    obtenido: `códigos de la ráfaga: ${burst.join(',')}`,
    ok: burst.includes(429), crit: 'ALTA',
  });

  console.log('   … esperando 62 s para que se libere la ventana del throttler …');
  await sleep(62000);

  r = await login('no-existe-xyz', 'algo');
  record({
    id: 'AUTH-03', module: 'Autenticación', caso: 'Login con usuario inexistente',
    pasos: 'POST /auth/login usuario inexistente',
    esperado: '401 con el mismo mensaje que password incorrecta (no enumerar usuarios)',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)}`,
    ok: r.status === 401 && r.data?.message === 'Credenciales inválidas', crit: 'ALTA',
  });

  r = await POST('/auth/login', { username: '', password: '' });
  record({
    id: 'AUTH-04', module: 'Autenticación', caso: 'Login con campos vacíos',
    pasos: 'POST /auth/login {"",""}',
    esperado: '400 validación de campos obligatorios',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)}`,
    ok: r.status === 400, crit: 'MEDIA',
  });

  r = await GET('/products');
  record({
    id: 'AUTH-05', module: 'Autenticación', caso: 'Acceso a endpoint protegido sin token',
    pasos: 'GET /products sin Authorization',
    esperado: '401 Unauthorized',
    obtenido: `${r.status}`, ok: r.status === 401, crit: 'CRÍTICA',
  });

  r = await GET('/products', 'token.falso.invalido');
  record({
    id: 'AUTH-06', module: 'Autenticación', caso: 'Acceso con token malformado',
    pasos: 'GET /products con Bearer basura',
    esperado: '401 Unauthorized',
    obtenido: `${r.status}`, ok: r.status === 401, crit: 'CRÍTICA',
  });

  const jwt = require(path.join(__dirname, '..', 'logistica-palets-backend', 'node_modules', 'jsonwebtoken'));
  const forged = jwt.sign({ sub: '00000000-0000-0000-0000-000000000001', username: 'hacker', role: 'ADMIN' }, 'dev_secret_fallback', { expiresIn: '1h' });
  r = await GET('/users', forged);
  record({
    id: 'AUTH-07', module: 'Autenticación', caso: 'Token ADMIN forjado con el secreto de fallback del código',
    pasos: 'Firmar un JWT con "dev_secret_fallback" (hardcodeado en jwt.strategy.ts) y llamar GET /users',
    esperado: '401 — el secreto real no debe ser adivinable',
    obtenido: `${r.status}`, ok: r.status === 401, crit: 'CRÍTICA',
    nota: 'Pasa porque JWT_SECRET está definido. Si faltara, el fallback permitiría forjar tokens ADMIN.',
  });

  r = await GET('/auth/me', tokens.ADMIN);
  record({
    id: 'AUTH-08', module: 'Autenticación', caso: 'GET /auth/me devuelve la identidad del token',
    pasos: 'GET /auth/me con token admin',
    esperado: 'userId, username y role',
    obtenido: JSON.stringify(r.data),
    ok: r.status === 200 && r.data?.role === 'ADMIN', crit: 'MEDIA',
  });

  r = await POST('/auth/refresh', {});
  record({
    id: 'AUTH-09', module: 'Autenticación', caso: 'Refresh sin cookie de refresh token',
    pasos: 'POST /auth/refresh sin cookie',
    esperado: '401 Refresh token ausente',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)}`,
    ok: r.status === 401, crit: 'MEDIA',
  });

  /* ══════════════ USUARIOS Y ROLES ══════════════ */
  r = await POST('/users', { username: 'qa_manager', password: 'Otro123!', role: 'OPERATOR' }, tokens.ADMIN);
  record({
    id: 'USR-04', module: 'Usuarios y roles', caso: 'Crear usuario con username duplicado',
    pasos: 'POST /users con username ya existente',
    esperado: '400 Username ya existe',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)}`,
    ok: r.status === 400, crit: 'ALTA',
  });

  r = await POST('/users', { username: 'qa_short', password: '123', role: 'OPERATOR' }, tokens.ADMIN);
  record({
    id: 'USR-05', module: 'Usuarios y roles', caso: 'Crear usuario con contraseña de 3 caracteres',
    pasos: 'POST /users password="123"',
    esperado: '400 mínimo 6 caracteres',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)}`,
    ok: r.status === 400, crit: 'ALTA',
  });

  r = await POST('/users', { username: 'qa_role', password: 'Password123', role: 'SUPERADMIN' }, tokens.ADMIN);
  record({
    id: 'USR-06', module: 'Usuarios y roles', caso: 'Crear usuario con rol fuera del enum',
    pasos: 'POST /users role="SUPERADMIN"',
    esperado: '400 rol no permitido',
    obtenido: `${r.status}`, ok: r.status === 400, crit: 'MEDIA',
  });

  r = await GET('/users', tokens.OPERATOR);
  record({
    id: 'USR-07', module: 'Usuarios y roles', caso: 'OPERATOR intenta listar usuarios (endpoint solo ADMIN)',
    pasos: 'GET /users con token OPERATOR',
    esperado: '403 Forbidden',
    obtenido: `${r.status}`, ok: r.status === 403, crit: 'ALTA',
  });

  r = await POST('/users', { username: 'hack', password: 'Password123', role: 'ADMIN' }, tokens.MANAGER);
  record({
    id: 'USR-08', module: 'Usuarios y roles', caso: 'MANAGER intenta crear un usuario ADMIN (escalada de privilegios)',
    pasos: 'POST /users role=ADMIN con token MANAGER',
    esperado: '403 Forbidden',
    obtenido: `${r.status}`, ok: r.status === 403, crit: 'CRÍTICA',
  });

  // Usuario desactivado → ¿el token previo sigue valiendo?
  const tmp = await POST('/users', { username: 'qa_temp', password: 'Temp1234!', role: 'OPERATOR' }, tokens.ADMIN);
  const tmpLogin = await login('qa_temp', 'Temp1234!');
  const tmpToken = tmpLogin.data?.access_token;
  const beforeDeactivate = await GET('/products', tmpToken);
  await PATCH(`/users/${tmp.data?.id}`, { active: false }, tokens.ADMIN);
  const afterDeactivate = await GET('/products', tmpToken);
  const reLogin = await login('qa_temp', 'Temp1234!');
  record({
    id: 'USR-09', module: 'Usuarios y roles', caso: 'Desactivar usuario: ¿se corta la sesión ya emitida?',
    pasos: 'Crear usuario → login (token OK) → PATCH active=false → reusar el mismo token',
    esperado: '401 con el token viejo (la sesión debe cortarse al desactivar)',
    obtenido: `antes=${beforeDeactivate.status} después=${afterDeactivate.status}; re-login=${reLogin.status}`,
    ok: beforeDeactivate.status === 200 && afterDeactivate.status === 401, crit: 'ALTA',
    nota: 'JwtStrategy.validate() no consulta la base: el access token sigue vivo hasta expirar (JWT_EXPIRES_IN=8h). El re-login sí queda bloqueado.',
  });

  // Cambio de rol → ¿aplica sin re-login?
  const tmp2 = await POST('/users', { username: 'qa_temp2', password: 'Temp1234!', role: 'OPERATOR' }, tokens.ADMIN);
  const t2 = (await login('qa_temp2', 'Temp1234!')).data?.access_token;
  await PATCH(`/users/${tmp2.data?.id}`, { role: 'AUDITOR' }, tokens.ADMIN);
  const afterRole = await POST('/warehouses', { name: 'X-no-deberia-crearse' }, t2);
  record({
    id: 'USR-10', module: 'Usuarios y roles', caso: 'Degradar rol OPERATOR→AUDITOR con token vigente',
    pasos: 'login OPERATOR → PATCH role=AUDITOR → POST /warehouses con el token anterior',
    esperado: '403 (el rol nuevo debe aplicarse de inmediato)',
    obtenido: `${afterRole.status}${afterRole.status === 201 ? ' — creó el depósito igual' : ''}`,
    ok: afterRole.status === 403, crit: 'ALTA',
    nota: 'El rol viaja dentro del JWT y no se revalida contra la base.',
  });

  /* ══════════════ PRODUCTOS ══════════════ */
  const productos = [
    ['40004808', 'ROLHA MET BRAHMA 940CC', 'UN', 5000, true],
    ['40015054', 'COLLARIIN BRAHMA 340CC MUSICAL', 'TS', 2000, true],
    ['40007857', 'ROTULO NECK PILSEN NVBI 340CC', 'UN', 10000, true],
    ['50858280', 'SOLVENTE P/TINTA NEGRA V7206-L 1LT', 'PC', 50, false],
    ['40021100', 'TAMPA PILSEN 600CC', 'UN', null, true],
    ['60030055', 'TINTA BLANCA BASE X 25KG', 'KG', 100, false],
    ['40009912', 'ROTULO BRAHMA CHOPP 269CC', 'MIL', 3000, true],
    ['50112233', 'ADHESIVO HOT MELT X 20KG', 'KG', 80, false],
    ['40044556', 'PRECINTO SEGURIDAD AZUL', 'UN', 1000, true],
    ['70088990', 'FILM STRETCH 23 500MM', 'UN', null, false],
  ];
  S.products = {};
  let created = 0;
  const errores = [];
  for (const [code, description, unitOfMeasure, stockMinimo, stackable] of productos) {
    const body = { code, description, unitOfMeasure, stackable };
    if (stockMinimo !== null) body.stockMinimo = stockMinimo;
    const c = await POST('/products', body, tokens.OPERATOR);
    if (c.status === 201) { created++; S.products[code] = c.data.id; }
    else errores.push(`${code}:${c.status}`);
  }
  record({
    id: 'PRD-01', module: 'Productos', caso: 'Alta de 10 materiales con distintas unidades (UN/TS/PC/KG/MIL)',
    pasos: 'POST /products ×10 con token OPERATOR',
    esperado: '10 productos creados',
    obtenido: `${created}/10 creados ${errores.length ? '· fallos: ' + errores.join(' ') : ''}`,
    ok: created === 10, crit: 'CRÍTICA',
  });

  r = await POST('/products', { code: '40004808', description: 'DUPLICADO' }, tokens.ADMIN);
  record({
    id: 'PRD-02', module: 'Productos', caso: 'Alta de producto con código duplicado',
    pasos: 'POST /products code=40004808 (ya existe)',
    esperado: '400/409 código duplicado',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)}`,
    ok: r.status === 400 || r.status === 409, crit: 'ALTA',
  });

  r = await POST('/products', { code: '', description: '' }, tokens.ADMIN);
  record({
    id: 'PRD-03', module: 'Productos', caso: 'Alta con código y descripción vacíos',
    pasos: 'POST /products {code:"",description:""}',
    esperado: '400 validación',
    obtenido: `${r.status}`, ok: r.status === 400, crit: 'MEDIA',
  });

  r = await POST('/products', { code: 'NEG-01', description: 'Stock mínimo negativo', stockMinimo: -100 }, tokens.ADMIN);
  record({
    id: 'PRD-04', module: 'Productos', caso: 'Alta con stockMinimo negativo',
    pasos: 'POST /products stockMinimo=-100',
    esperado: '400 validación (@Min(0))',
    obtenido: `${r.status}`, ok: r.status === 400, crit: 'MEDIA',
  });

  r = await POST('/products', { code: 'EXTRA-01', description: 'Campo no declarado', campoInventado: 'x' }, tokens.ADMIN);
  record({
    id: 'PRD-05', module: 'Productos', caso: 'Alta con campo no declarado en el DTO',
    pasos: 'POST /products con propiedad extra "campoInventado"',
    esperado: '400 (forbidNonWhitelisted)',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)}`,
    ok: r.status === 400, crit: 'MEDIA',
  });

  r = await PATCH(`/products/${S.products['40021100']}`, { stockMinimo: 500 }, tokens.MANAGER);
  const chk = await GET(`/products/${S.products['40021100']}`, tokens.ADMIN);
  record({
    id: 'PRD-06', module: 'Productos', caso: 'Editar stock mínimo y verificar persistencia',
    pasos: 'PATCH /products/:id {stockMinimo:500} → GET /products/:id',
    esperado: '200 y stockMinimo=500 persistido en PostgreSQL',
    obtenido: `patch=${r.status} getStockMinimo=${chk.data?.stockMinimo}`,
    ok: r.status === 200 && Number(chk.data?.stockMinimo) === 500, crit: 'MEDIA',
  });

  r = await GET('/products/00000000-0000-0000-0000-000000000000', tokens.ADMIN);
  record({
    id: 'PRD-07', module: 'Productos', caso: 'Consultar producto inexistente',
    pasos: 'GET /products/<uuid inexistente>',
    esperado: '404 Not Found',
    obtenido: `${r.status}`, ok: r.status === 404, crit: 'BAJA',
  });

  r = await GET('/products/no-es-un-uuid', tokens.ADMIN);
  record({
    id: 'PRD-08', module: 'Productos', caso: 'Consultar producto con id que no es UUID',
    pasos: 'GET /products/no-es-un-uuid',
    esperado: '400/404 controlado',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 120)}`,
    ok: r.status === 400 || r.status === 404, crit: 'MEDIA',
    nota: 'Sin ParseUUIDPipe el error 22P02 de Postgres sale como 500.',
  });

  r = await POST('/products', { code: 'AUD-DENY', description: 'Auditor no debe poder' }, tokens.AUDITOR);
  record({
    id: 'PRD-09', module: 'Productos', caso: 'AUDITOR intenta crear producto (rol de solo lectura)',
    pasos: 'POST /products con token AUDITOR',
    esperado: '403 Forbidden',
    obtenido: `${r.status}`, ok: r.status === 403, crit: 'ALTA',
  });

  r = await GET('/products', tokens.AUDITOR);
  const plist = Array.isArray(r.data) ? r.data : r.data?.data ?? [];
  record({
    id: 'PRD-10', module: 'Productos', caso: 'AUDITOR puede listar productos (lectura permitida)',
    pasos: 'GET /products con token AUDITOR',
    esperado: '200 con la lista',
    obtenido: `${r.status} items=${plist.length}`,
    ok: r.status === 200, crit: 'MEDIA',
  });

  r = await DEL(`/products/${S.products['70088990']}`, tokens.OPERATOR);
  const afterDel = await GET(`/products/${S.products['70088990']}`, tokens.ADMIN);
  record({
    id: 'PRD-11', module: 'Productos', caso: 'OPERATOR puede eliminar productos',
    pasos: 'DELETE /products/:id con token OPERATOR',
    esperado: 'Solo ADMIN/MANAGER deberían borrar catálogo maestro',
    obtenido: `delete=${r.status}, producto luego=${afterDel.status === 404 ? 'borrado' : `activo=${afterDel.data?.active}`}`,
    ok: r.status === 403, crit: 'MEDIA',
    nota: 'Ver si el borrado es lógico (active=false) o físico; el físico rompería el histórico de movimientos.',
  });
  // recrear el producto si el borrado fue físico
  if (afterDel.status === 404) {
    const re = await POST('/products', { code: '70088990', description: 'FILM STRETCH 23 500MM', unitOfMeasure: 'UN', stackable: false }, tokens.ADMIN);
    S.products['70088990'] = re.data?.id;
  } else if (afterDel.data?.active === false) {
    await PATCH(`/products/${S.products['70088990']}`, { active: true }, tokens.ADMIN);
  }

  /* ══════════════ DEPÓSITOS ══════════════ */
  r = await POST('/warehouses', { name: 'DEPOSITO CENTRAL', address: 'Ruta 1 km 20' }, tokens.MANAGER);
  S.wh1 = r.data?.id;
  record({
    id: 'DEP-01', module: 'Depósitos', caso: 'Alta de depósito',
    pasos: 'POST /warehouses {name, address}',
    esperado: '201 con id',
    obtenido: `${r.status} id=${S.wh1}`, ok: !!S.wh1 && r.status === 201, crit: 'CRÍTICA',
  });

  r = await POST('/warehouses', { name: 'DEPOSITO SECUNDARIO' }, tokens.MANAGER);
  S.wh2 = r.data?.id;
  record({
    id: 'DEP-02', module: 'Depósitos', caso: 'Alta de segundo depósito (para movimientos entre depósitos)',
    pasos: 'POST /warehouses',
    esperado: '201 con id',
    obtenido: `${r.status} id=${S.wh2}`, ok: !!S.wh2, crit: 'ALTA',
  });

  r = await POST('/warehouses', { name: '' }, tokens.ADMIN);
  record({
    id: 'DEP-03', module: 'Depósitos', caso: 'Alta de depósito con nombre vacío',
    pasos: 'POST /warehouses {name:""}',
    esperado: '400 validación de nombre obligatorio',
    obtenido: `${r.status}${r.status === 201 ? ' — depósito sin nombre creado' : ''}`,
    ok: r.status === 400, crit: 'MEDIA',
    nota: 'CreateWarehouseDto usa @IsString() sin @IsNotEmpty()/@Length.',
  });

  r = await POST('/warehouses', { name: 'DEPOSITO CENTRAL' }, tokens.ADMIN);
  record({
    id: 'DEP-04', module: 'Depósitos', caso: 'Alta de depósito con nombre duplicado',
    pasos: 'POST /warehouses con nombre ya existente',
    esperado: '400/409 o regla explícita de unicidad',
    obtenido: `${r.status}${r.status === 201 ? ' — segundo depósito homónimo creado' : ''}`,
    ok: r.status === 400 || r.status === 409, crit: 'BAJA',
    nota: 'Dos depósitos homónimos son indistinguibles en los selects del frontend.',
  });

  r = await GET(`/warehouses/${S.wh1}`, tokens.OPERATOR);
  record({
    id: 'DEP-05', module: 'Depósitos', caso: 'Consultar depósito por id',
    pasos: 'GET /warehouses/:id',
    esperado: '200 con el nombre correcto',
    obtenido: `${r.status} name=${r.data?.name}`,
    ok: r.status === 200 && r.data?.name === 'DEPOSITO CENTRAL', crit: 'MEDIA',
  });

  r = await GET('/warehouses/00000000-0000-0000-0000-000000000000', tokens.ADMIN);
  record({
    id: 'DEP-06', module: 'Depósitos', caso: 'Consultar depósito inexistente',
    pasos: 'GET /warehouses/<uuid inexistente>',
    esperado: '404 Not Found',
    obtenido: `${r.status}`, ok: r.status === 404, crit: 'BAJA',
  });

  /* ══════════════ UBICACIONES ══════════════ */
  r = await POST('/locations/generate', {
    warehouseId: S.wh1, zone: 'ALMACENAMIENTO', aisles: ['A', 'B'], racks: 2, levels: 3, positions: 4, capacityPallets: 4,
  }, tokens.MANAGER);
  const gen1 = r.data?.created ?? r.data?.nuevas ?? r.data?.length;
  record({
    id: 'UBI-01', module: 'Ubicaciones', caso: 'Generación masiva (2 pasillos × 2 racks × 3 niveles × 4 posiciones)',
    pasos: 'POST /locations/generate',
    esperado: '48 ubicaciones nuevas',
    obtenido: `${r.status} ${JSON.stringify(r.data)?.slice(0, 160)}`,
    ok: r.status === 201 && gen1 === 48, crit: 'ALTA',
  });

  r = await POST('/locations/generate', {
    warehouseId: S.wh1, zone: 'ALMACENAMIENTO', aisles: ['A', 'B'], racks: 2, levels: 3, positions: 4, capacityPallets: 4,
  }, tokens.MANAGER);
  const gen2 = r.data?.created ?? r.data?.nuevas;
  record({
    id: 'UBI-02', module: 'Ubicaciones', caso: 'Re-ejecutar la generación idéntica (idempotencia)',
    pasos: 'POST /locations/generate con los mismos parámetros',
    esperado: '0 nuevas / 48 ya existentes — sin duplicar',
    obtenido: `${r.status} ${JSON.stringify(r.data)?.slice(0, 160)}`,
    ok: r.status === 201 && gen2 === 0, crit: 'ALTA',
  });

  r = await POST('/locations/generate', { warehouseId: S.wh1, zone: 'RECEPCION', codePrefix: 'REC', positions: 6 }, tokens.MANAGER);
  record({
    id: 'UBI-03', module: 'Ubicaciones', caso: 'Generar zona plana de recepción (REC-P1..P6)',
    pasos: 'POST /locations/generate {zone:RECEPCION, prefix:REC, positions:6}',
    esperado: '6 ubicaciones',
    obtenido: `${r.status} ${JSON.stringify(r.data)?.slice(0, 120)}`,
    ok: r.status === 201 && (r.data?.created ?? r.data?.nuevas) === 6, crit: 'MEDIA',
  });

  r = await POST('/locations/generate', { warehouseId: S.wh2, zone: 'ALMACENAMIENTO', aisles: ['Z'], racks: 1, levels: 1, positions: 3 }, tokens.MANAGER);
  record({
    id: 'UBI-04', module: 'Ubicaciones', caso: 'Generar estructura en el segundo depósito',
    pasos: 'POST /locations/generate en depósito 2',
    esperado: '3 ubicaciones',
    obtenido: `${r.status} ${JSON.stringify(r.data)?.slice(0, 120)}`,
    ok: r.status === 201 && (r.data?.created ?? r.data?.nuevas) === 3, crit: 'MEDIA',
  });

  r = await POST('/locations/generate', { warehouseId: S.wh1, zone: 'ZONA_INVENTADA', positions: 2 }, tokens.ADMIN);
  record({
    id: 'UBI-05', module: 'Ubicaciones', caso: 'Generar con zona fuera del enum',
    pasos: 'POST /locations/generate zone="ZONA_INVENTADA"',
    esperado: '400 validación',
    obtenido: `${r.status}`, ok: r.status === 400, crit: 'MEDIA',
  });

  r = await POST('/locations/generate', { warehouseId: '00000000-0000-0000-0000-000000000000', zone: 'PICKING', positions: 2 }, tokens.ADMIN);
  record({
    id: 'UBI-06', module: 'Ubicaciones', caso: 'Generar en depósito inexistente',
    pasos: 'POST /locations/generate con warehouseId inexistente',
    esperado: '404 depósito inexistente',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 100)}`,
    ok: r.status === 404, crit: 'ALTA',
  });

  const locs = await GET(`/locations?warehouseId=${S.wh1}`, tokens.OPERATOR);
  const list = Array.isArray(locs.data) ? locs.data : locs.data?.data ?? [];
  S.locs = {};
  for (const l of list) S.locs[l.code] = l.id;
  record({
    id: 'UBI-07', module: 'Ubicaciones', caso: 'Listar ubicaciones del depósito y verificar los códigos generados',
    pasos: 'GET /locations?warehouseId=',
    esperado: '54 ubicaciones (48 almacenamiento + 6 recepción)',
    obtenido: `${locs.status} total=${list.length} muestra=${list.slice(0, 3).map((l) => l.code).join(', ')}`,
    ok: list.length === 54, crit: 'ALTA',
  });

  const someCode = Object.keys(S.locs)[0];
  r = await POST('/locations', { code: someCode, warehouseId: S.wh1, type: 'RACK' }, tokens.ADMIN);
  record({
    id: 'UBI-08', module: 'Ubicaciones', caso: 'Alta manual con código duplicado en el mismo depósito',
    pasos: `POST /locations code=${someCode}`,
    esperado: '400/409 código duplicado',
    obtenido: `${r.status} ${JSON.stringify(r.data?.message)?.slice(0, 120)}`,
    ok: r.status === 400 || r.status === 409, crit: 'ALTA',
  });

  r = await POST('/locations', { code: 'MANUAL-01', warehouseId: S.wh1, type: 'PISO', capacityPallets: 10 }, tokens.OPERATOR);
  S.locManual = r.data?.id;
  record({
    id: 'UBI-09', module: 'Ubicaciones', caso: 'Alta manual de ubicación tipo PISO',
    pasos: 'POST /locations {code:MANUAL-01, type:PISO}',
    esperado: '201 con id',
    obtenido: `${r.status} id=${S.locManual}`, ok: !!S.locManual, crit: 'MEDIA',
  });

  r = await POST('/locations', { code: 'HUERFANA', warehouseId: '00000000-0000-0000-0000-000000000000' }, tokens.ADMIN);
  record({
    id: 'UBI-10', module: 'Ubicaciones', caso: 'Alta de ubicación en depósito inexistente',
    pasos: 'POST /locations con warehouseId inexistente',
    esperado: '404/400 — no debe crearse una ubicación huérfana',
    obtenido: `${r.status}`, ok: r.status === 404 || r.status === 400, crit: 'ALTA',
  });

  fs.writeFileSync(path.join(__dirname, 'state.json'), JSON.stringify({ ...S, tokens }, null, 2));
  save('res-p1.json');
  await closeDb();
})();
