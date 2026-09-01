import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { ROLE_PERMISSIONS_SEED } from '../src/modules/permissions/role-permissions.seed';

/**
 * Cobertura del motor de permisos finos sobre los endpoints HTTP (RL-M-10).
 *
 * Es análisis estático del código, no de la base: no necesita PostgreSQL y
 * corre en milisegundos. Cubre las tres formas en que este control se rompe en
 * silencio, las tres encontradas al implementarlo:
 *
 *  1. Un endpoint nuevo nace sin `@RequirePermission` y queda gobernado sólo
 *     por rol, fuera del alcance de los overrides por usuario. Es exactamente
 *     como se acumularon los 51 que había.
 *  2. Un `@RequirePermission` apunta a un módulo o acción que no está en
 *     `ROLE_PERMISSIONS_SEED`. `PermissionGuard` falla cerrado, así que eso no
 *     "protege de más": deja a *todos* afuera con 403, incluido el ADMIN.
 *  3. Un controller usa `@RequirePermission` pero no tiene `PermissionGuard`
 *     en su `@UseGuards`. El decorador queda inerte y el endpoint parece
 *     protegido sin estarlo — la peor de las tres, porque no falla nunca.
 */

const SRC = join(__dirname, '..', 'src');
const METODOS = ['Get', 'Post', 'Put', 'Patch', 'Delete'];
const VERBO = new RegExp(`@(${METODOS.join('|')})\\(([^)]*)\\)`);

/**
 * Endpoints que a propósito no exigen permiso fino, con el motivo.
 *
 * La lista es cerrada: el test falla tanto si aparece un endpoint sin permiso
 * que no está acá, como si sobra una entrada porque el endpoint ya se corrigió
 * o se borró. Agregar una excepción obliga a escribir por qué.
 */
const SIN_PERMISO_A_PROPOSITO: Record<string, string> = {
  'GET /': 'Raíz de la API. Sin autenticación.',
  'GET /health': 'Health check para el monitoreo externo. Sin autenticación.',

  'POST /auth/login': 'Es la puerta de entrada: todavía no hay usuario a quien consultarle permisos.',
  'POST /auth/refresh': 'Renueva el token con el refresh token, no con la sesión.',
  'POST /auth/logout': 'Cerrar la propia sesión no es una capacidad revocable.',
  'GET /auth/me': 'Devuelve el propio usuario y sus permisos. Exigir un permiso para leerlos sería circular.',
  'POST /auth/change-password':
    'Cambiar la propia contraseña. Revocarlo dejaría a alguien sin poder cumplir un mustChangePassword.',

  'GET /users/active':
    'Lista de nombres para los desplegables de encargado/responsable. La necesita un OPERATOR para ' +
    'poder cargar un movimiento, así que no puede exigir users:read (que es ADMIN/MANAGER).',
  'GET /warehouses/allowed':
    'Depósitos que el propio usuario puede elegir. Alimenta el selector global: sin esto el resto de ' +
    'la app no sabe en qué depósito se trabaja. Ya está documentado en el controller.',

  'POST /seed/from-excel':
    'Carga de datos de desarrollo. Tiene dos controles independientes que no dependen de esta tabla: ' +
    'rol ADMIN y la variable ALLOW_SEED, que en producción la bloquea por completo.',
  'POST /seed/reset':
    'Borra datos de desarrollo. Mismos dos controles que /seed/from-excel; en producción está bloqueado.',
};

type Endpoint = {
  archivo: string;
  clave: string;
  permiso: { module: string; action: string } | null;
};

/** Todos los `*.controller.ts` bajo src/, recursivo. */
function controllers(dir: string): string[] {
  return readdirSync(dir).flatMap((entrada) => {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) return controllers(ruta);
    return ruta.endsWith('.controller.ts') ? [ruta] : [];
  });
}

/**
 * Bloques de decoradores de un archivo. Balancea paréntesis porque acá los
 * decoradores multilínea son comunes (`@UseInterceptors(FileInterceptor(...))`).
 */
function bloquesDeDecoradores(fuente: string): string[] {
  const lineas = fuente.split('\n');
  const bloques: string[] = [];
  let i = 0;
  while (i < lineas.length) {
    if (!lineas[i].trim().startsWith('@')) {
      i += 1;
      continue;
    }
    const decoradores: string[] = [];
    while (i < lineas.length && lineas[i].trim().startsWith('@')) {
      let decorador = lineas[i];
      let profundidad = (decorador.match(/\(/g) ?? []).length - (decorador.match(/\)/g) ?? []).length;
      while (profundidad > 0 && i + 1 < lineas.length) {
        i += 1;
        decorador += `\n${lineas[i]}`;
        profundidad += (lineas[i].match(/\(/g) ?? []).length - (lineas[i].match(/\)/g) ?? []).length;
      }
      decoradores.push(decorador);
      i += 1;
    }
    bloques.push(decoradores.join('\n'));
  }
  return bloques;
}

function relevar(): { endpoints: Endpoint[]; controllersConPermiso: { archivo: string; guards: string }[] } {
  const endpoints: Endpoint[] = [];
  const controllersConPermiso: { archivo: string; guards: string }[] = [];

  for (const ruta of controllers(SRC)) {
    const fuente = readFileSync(ruta, 'utf8');
    const archivo = ruta.slice(SRC.length + 1).replace(/\\/g, '/');
    const controlador = fuente.match(/@Controller\(([^)]*)\)/);
    const base = controlador ? controlador[1].trim().replace(/['"]/g, '') : '';
    const cabecera = controlador ? fuente.slice(0, controlador.index) : fuente;

    if (fuente.includes('@RequirePermission(')) {
      const guards = fuente.match(/@UseGuards\(([^)]*)\)/);
      controllersConPermiso.push({ archivo, guards: guards ? guards[1].replace(/\s+/g, ' ') : '' });
    }

    for (const bloque of bloquesDeDecoradores(fuente)) {
      const verbo = bloque.match(VERBO);
      if (!verbo) continue;

      const sufijo = verbo[2].trim().replace(/['"]/g, '');
      const clave = `${verbo[1].toUpperCase()} ${`/${base}/${sufijo}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1')}`;

      const permiso = bloque.match(/@RequirePermission\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/)
        ?? cabecera.match(/@RequirePermission\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/);
      endpoints.push({
        archivo,
        clave,
        permiso: permiso ? { module: permiso[1], action: permiso[2] } : null,
      });
    }
  }
  return { endpoints, controllersConPermiso };
}

const { endpoints, controllersConPermiso } = relevar();

describe('cobertura de permisos finos sobre los endpoints', () => {
  it('releva todos los controllers, no un subconjunto', () => {
    // Si el parser deja de encontrar handlers —por un cambio de estilo, por
    // ejemplo— el resto de los tests pasaría por vacuidad.
    expect(endpoints.length).toBeGreaterThan(120);
  });

  it('todo endpoint exige permiso fino, salvo los declarados con su motivo', () => {
    const sinPermiso = endpoints.filter((e) => !e.permiso).map((e) => e.clave).sort();
    expect(sinPermiso).toEqual(Object.keys(SIN_PERMISO_A_PROPOSITO).sort());
  });

  it('no quedan excepciones declaradas para endpoints que ya no existen', () => {
    const existentes = new Set(endpoints.map((e) => e.clave));
    const muertas = Object.keys(SIN_PERMISO_A_PROPOSITO).filter((clave) => !existentes.has(clave));
    expect(muertas).toEqual([]);
  });
});

describe('los permisos exigidos existen en la plantilla de roles', () => {
  const enElSeed = new Set(ROLE_PERMISSIONS_SEED.map((row) => `${row.module}:${row.action}`));

  it('ningún @RequirePermission apunta a una combinación que el seed no tiene', () => {
    // Sin fila en `role_permissions`, `PermissionGuard` responde 403 a todo el
    // mundo: el endpoint queda inaccesible, no "más protegido".
    const huerfanos = endpoints
      .filter((e) => e.permiso && !enElSeed.has(`${e.permiso.module}:${e.permiso.action}`))
      .map((e) => `${e.clave} → ${e.permiso!.module}:${e.permiso!.action}`);
    expect(huerfanos).toEqual([]);
  });

  it('la plantilla no declara módulos que ningún endpoint usa', () => {
    // Un módulo que sólo existe en la tabla es un interruptor que no apaga
    // nada — justo lo que pasaba con `billing` antes de este cambio.
    const usados = new Set(endpoints.filter((e) => e.permiso).map((e) => e.permiso!.module));
    const declarados = new Set(ROLE_PERMISSIONS_SEED.map((row) => row.module));
    const sinUso = [...declarados].filter((m) => !usados.has(m));
    // `dashboard` es la excepción legítima: gobierna una pantalla del frontend
    // que no tiene endpoint propio.
    expect(sinUso).toEqual(['dashboard']);
  });
});

describe('los decoradores no quedan inertes', () => {
  it('todo controller que usa @RequirePermission tiene PermissionGuard en @UseGuards', () => {
    // Esta es la falla que no avisa: el decorador está, se lee como protegido,
    // y sin el guard en la cadena nunca se evalúa.
    const inertes = controllersConPermiso
      .filter((c) => !c.guards.includes('PermissionGuard'))
      .map((c) => `${c.archivo} → @UseGuards(${c.guards})`);
    expect(inertes).toEqual([]);
  });

  it('PermissionGuard va después de JwtAuthGuard, que es quien pone req.user', () => {
    const malOrden = controllersConPermiso
      .filter((c) => c.guards.includes('PermissionGuard') && c.guards.includes('JwtAuthGuard'))
      .filter((c) => c.guards.indexOf('PermissionGuard') < c.guards.indexOf('JwtAuthGuard'))
      .map((c) => c.archivo);
    expect(malOrden).toEqual([]);
  });
});
