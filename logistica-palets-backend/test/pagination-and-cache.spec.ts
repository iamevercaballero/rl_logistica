/**
 * Paginación de listados y caché de permisos (RL-M-16, RL-M-17).
 *
 * RL-M-16: `findDocuments` traía los 200 más recientes y devolvía el array
 * pelado. El corte era invisible — un remito de hace ocho meses no aparecía y
 * nada lo decía. `trace` era peor: devolvía el historial COMPLETO de un
 * material, sin límite alguno.
 *
 * RL-M-17: cada petición autenticada hacía tres consultas. La revalidación del
 * usuario es una decisión de seguridad correcta y no se toca; las dos de
 * permisos son configuración y sí se cachean.
 *
 * Requiere la base de docker-compose.test.yml levantada.
 */
import { DataSource } from 'typeorm';
import { MovementsService } from '../src/modules/movements/movements.service';
import { PermissionsService } from '../src/modules/permissions/permissions.service';
import { DocumentSequenceService } from '../src/modules/movements/document-sequence.service';
import { PilasService } from '../src/modules/pilas/pilas.service';
import { LogisticsDocument } from '../src/modules/movements/entities/logistics-document.entity';
import { UserPermission } from '../src/modules/permissions/entities/user-permission.entity';
import { User } from '../src/modules/users/entities/user.entity';
import type { EventsGateway } from '../src/modules/events/events.gateway';
import type { CacheService } from '../src/modules/cache/cache.service';
import type { UploadsService } from '../src/modules/uploads/uploads.service';
import {
  createAccessService, createMemoryCache, createPermissionsService, createTestDataSource,
  resetDb, seedBasics, seedRolePermissions, TEST_USER_ID, type Basics,
} from './test-datasource';

const noopEvents = { emitMovementCreated() {}, emitStockUpdated() {} } as unknown as EventsGateway;
const noopCache = { delPattern: async () => {} } as unknown as CacheService;
const noopUploads = { log: async () => {} } as unknown as UploadsService;

let ds: DataSource;
let movements: MovementsService;
let base: Basics;

async function crearRemitos(cantidad: number): Promise<void> {
  const repo = ds.getRepository(LogisticsDocument);
  const filas = Array.from({ length: cantidad }, (_, i) =>
    repo.create({
      code: `RLNE-2026-${String(i + 1).padStart(6, '0')}`,
      type: 'ENTRY', status: 'APROBADO', date: new Date(2026, 0, 1 + (i % 300)),
      warehouseId: base.warehouse.id, createdById: TEST_USER_ID,
      totalLines: 1, totalQuantity: 1,
    }),
  );
  await repo.save(filas);
}

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  movements = new MovementsService(
    ds, noopEvents, noopCache, new DocumentSequenceService(), noopUploads,
    new PilasService(), createAccessService(ds),
  );
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
  base = await seedBasics(ds);
});

describe('remitos: el corte deja de ser invisible', () => {
  it('devuelve el total real, no el largo de la página', async () => {
    // Es el punto del hallazgo: con 250 remitos, antes llegaban 200 y nada
    // decía que faltaban 50.
    await crearRemitos(250);

    const r = await movements.findDocuments({ limit: 50 }, null);

    expect(r.data).toHaveLength(50);
    expect(r.meta.total).toBe(250);
    expect(r.meta.totalPages).toBe(5);
  });

  it('la paginación no repite ni pierde remitos', async () => {
    await crearRemitos(25);

    const p1 = await movements.findDocuments({ page: 1, limit: 10 }, null);
    const p2 = await movements.findDocuments({ page: 2, limit: 10 }, null);
    const p3 = await movements.findDocuments({ page: 3, limit: 10 }, null);

    const ids = [...p1.data, ...p2.data, ...p3.data].map((d) => d.id);
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
  });

  it('acota el tamaño de página aunque se pida uno absurdo', async () => {
    await crearRemitos(30);
    const r = await movements.findDocuments({ limit: 100000 }, null);
    expect(r.meta.limit).toBeLessThanOrEqual(200);
  });

  it('sin remitos devuelve la misma forma, con total en cero', async () => {
    const r = await movements.findDocuments({}, null);
    expect(r.data).toEqual([]);
    expect(r.meta.total).toBe(0);
  });

  it('el total respeta los filtros', async () => {
    await crearRemitos(10);
    const r = await movements.findDocuments({ search: 'RLNE-2026-000003' }, null);
    expect(r.meta.total).toBe(1);
  });
});

describe('permisos efectivos: caché con invalidación', () => {
  let permissions: PermissionsService;
  let cache: CacheService;
  let user: User;

  beforeEach(async () => {
    await seedRolePermissions(ds);
    cache = createMemoryCache();
    permissions = createPermissionsService(ds, cache);
    user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        username: 'operador.cache', fullName: 'x', passwordHash: 'x',
        role: 'OPERATOR', active: true,
      }),
    );
  });

  it('la segunda llamada no vuelve a consultar la base', async () => {
    const espia = jest.spyOn(ds.getRepository(UserPermission), 'find');
    // El servicio usa su propio repositorio; se mide sobre el mismo DataSource.
    const primera = await permissions.getEffectivePermissions(user.id, 'OPERATOR');
    const consultasTrasPrimera = espia.mock.calls.length;

    const segunda = await permissions.getEffectivePermissions(user.id, 'OPERATOR');

    expect(segunda).toEqual(primera);
    expect(espia.mock.calls.length).toBe(consultasTrasPrimera);
    espia.mockRestore();
  });

  it('un cambio de permisos se ve de inmediato, sin esperar al TTL', async () => {
    // Es lo que hace que la caché sea aceptable: la invalidación es explícita.
    expect(await permissions.hasPermission(user.id, 'OPERATOR', 'movements', 'create')).toBe(true);

    await permissions.setUserPermission(user.id, 'movements', 'create', 'DENY');

    expect(await permissions.hasPermission(user.id, 'OPERATOR', 'movements', 'create')).toBe(false);
  });

  it('quitar un override también invalida', async () => {
    await permissions.setUserPermission(user.id, 'movements', 'create', 'DENY');
    expect(await permissions.hasPermission(user.id, 'OPERATOR', 'movements', 'create')).toBe(false);

    await permissions.removeUserPermission(user.id, 'movements', 'create');

    expect(await permissions.hasPermission(user.id, 'OPERATOR', 'movements', 'create')).toBe(true);
  });

  it('restaurar los permisos del rol también invalida', async () => {
    await permissions.setUserPermission(user.id, 'movements', 'create', 'DENY');
    await permissions.getEffectivePermissions(user.id, 'OPERATOR');

    await permissions.restoreRoleDefaults(user.id);

    expect(await permissions.hasPermission(user.id, 'OPERATOR', 'movements', 'create')).toBe(true);
  });

  it('cambiar de rol no reusa la entrada del rol anterior', async () => {
    // La clave incluye el rol, así que un ascenso o una degradación no puede
    // quedar servida desde la caché del rol viejo.
    expect(await permissions.hasPermission(user.id, 'OPERATOR', 'users', 'create')).toBe(false);
    expect(await permissions.hasPermission(user.id, 'ADMIN', 'users', 'create')).toBe(true);
  });

  it('la caché de un usuario no contamina la de otro', async () => {
    const otro = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        username: 'operador.otro', fullName: 'x', passwordHash: 'x', role: 'OPERATOR', active: true,
      }),
    );
    await permissions.setUserPermission(user.id, 'movements', 'create', 'DENY');

    expect(await permissions.hasPermission(user.id, 'OPERATOR', 'movements', 'create')).toBe(false);
    expect(await permissions.hasPermission(otro.id, 'OPERATOR', 'movements', 'create')).toBe(true);
  });

  it('si la caché está caída, sigue respondiendo desde la base', async () => {
    // `CacheService` es best-effort: devuelve null cuando Redis no está. El
    // permiso no puede depender de que la caché ande.
    const caida = { get: async () => null, set: async () => {}, del: async () => {}, delPattern: async () => {} } as unknown as CacheService;
    const sinCache = createPermissionsService(ds, caida);

    expect(await sinCache.hasPermission(user.id, 'OPERATOR', 'movements', 'create')).toBe(true);
  });
});
