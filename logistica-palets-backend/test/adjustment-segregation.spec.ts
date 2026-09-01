/**
 * Segregación de funciones en los ajustes de inventario (RL-A-12).
 *
 * El ajuste es la única operación que corrige stock sin un documento físico
 * detrás, así que es justo donde el control cruzado sirve. Hasta acá `approve()`
 * nunca comparaba el creador con el aprobador: un ADMIN o MANAGER cerraba el
 * circuito solo.
 *
 * La excepción —único aprobador habilitado— es deliberada y automática. Estos
 * tests fijan las dos mitades: que el bloqueo aplica cuando hay con quién
 * cruzar, y que no aplica —dejando rastro— cuando no lo hay.
 *
 * Requiere la base de docker-compose.test.yml levantada.
 */
import { DataSource } from 'typeorm';
import { ForbiddenException } from '@nestjs/common';
import { AdjustmentsService, APPROVER_ROLES } from '../src/modules/adjustments/adjustments.service';
import { MovementsService } from '../src/modules/movements/movements.service';
import { DocumentSequenceService } from '../src/modules/movements/document-sequence.service';
import { PilasService } from '../src/modules/pilas/pilas.service';
import { UploadsService } from '../src/modules/uploads/uploads.service';
import { PermissionsService } from '../src/modules/permissions/permissions.service';
import { Attachment } from '../src/modules/uploads/entities/attachment.entity';
import { DocumentEvent } from '../src/modules/uploads/entities/document-event.entity';
import { UserPermission } from '../src/modules/permissions/entities/user-permission.entity';
import { AdjustmentRequest } from '../src/modules/adjustments/entities/adjustment-request.entity';
import { User, type UserRole } from '../src/modules/users/entities/user.entity';
import { Warehouse } from '../src/modules/warehouses/entities/warehouse.entity';
import { Stock } from '../src/modules/stocks/entities/stock.entity';
import type { EventsGateway } from '../src/modules/events/events.gateway';
import type { CacheService } from '../src/modules/cache/cache.service';
import type { WarehouseAccessService } from '../src/modules/warehouses/warehouse-access.service';
import {
  createAccessService,
  createPermissionsService,
  createTestDataSource,
  grantWarehouse,
  resetDb,
  seedBasics,
  seedRolePermissions,
  type Basics,
} from './test-datasource';

const noopEvents = { emitMovementCreated() {}, emitStockUpdated() {} } as unknown as EventsGateway;
const noopCache = { delPattern: async () => {} } as unknown as CacheService;

let ds: DataSource;
let service: AdjustmentsService;
let movements: MovementsService;
let uploads: UploadsService;
let access: WarehouseAccessService;
let permissions: PermissionsService;
let base: Basics;

/** Crea un usuario con rol, opcionalmente inactivo. */
async function crearUsuario(username: string, role: UserRole, active = true): Promise<User> {
  return ds.getRepository(User).save(
    ds.getRepository(User).create({
      username, fullName: username, passwordHash: 'not-used-in-tests', role, active,
    }),
  );
}

/**
 * Deja una solicitud lista para aprobar, creada por `user`.
 * Es un ADJUSTMENT_IN para que aprobar tenga un efecto observable en el stock.
 */
async function solicitudPendiente(user: { id: string; role: UserRole }, cantidad = 10) {
  const { requestId } = await service.createDraft(
    {
      type: 'ADJUSTMENT_IN',
      reason: 'DIFERENCIA_INVENTARIO',
      warehouseId: base.warehouse.id,
      locationId: base.location.id,
      lines: [{
        productId: base.product.id,
        palletItems: [{ lotCode: `L-${Math.random().toString(36).slice(2, 8)}`, quantity: cantidad }],
      }],
    },
    user.id,
    user.role,
  );
  await service.submitForApproval(requestId, user.id, user.role);
  return requestId;
}

const eventosDe = (requestId: string) =>
  ds.getRepository(DocumentEvent).find({ where: { entityType: 'ADJUSTMENT', entityId: requestId } });

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  access = createAccessService(ds);
  permissions = createPermissionsService(ds);
  uploads = new UploadsService(ds.getRepository(Attachment), ds.getRepository(DocumentEvent));
  const sequences = new DocumentSequenceService();
  movements = new MovementsService(ds, noopEvents, noopCache, sequences, uploads, new PilasService(), access);
  service = new AdjustmentsService(
    ds, movements, sequences, uploads, noopCache, noopEvents, access, permissions,
  );
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
  base = await seedBasics(ds);
  await seedRolePermissions(ds);
});

describe('bloqueo: el creador no aprueba lo que creó', () => {
  it('rechaza que un MANAGER apruebe su propia solicitud cuando hay otro aprobador', async () => {
    const manager = await crearUsuario('manager.uno', 'MANAGER');
    await grantWarehouse(ds, base.warehouse.id, manager.id);
    await crearUsuario('admin.uno', 'ADMIN'); // alcance global: es la segunda firma

    const requestId = await solicitudPendiente(manager);

    await expect(service.approve(requestId, manager.id, 'MANAGER')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('nombra en el error a quién sí puede aprobarla', async () => {
    const manager = await crearUsuario('manager.uno', 'MANAGER');
    await grantWarehouse(ds, base.warehouse.id, manager.id);
    await crearUsuario('admin.uno', 'ADMIN');

    const requestId = await solicitudPendiente(manager);

    // El operador no tiene que adivinar por qué no puede: el mensaje dice a
    // quién pedírselo.
    await expect(service.approve(requestId, manager.id, 'MANAGER')).rejects.toThrow(/admin\.uno/);
  });

  it('bloquea también a un ADMIN: el rol no exime del control cruzado', async () => {
    const admin = await crearUsuario('admin.uno', 'ADMIN');
    await crearUsuario('manager.uno', 'MANAGER').then((m) => grantWarehouse(ds, base.warehouse.id, m.id));

    const requestId = await solicitudPendiente(admin);

    await expect(service.approve(requestId, admin.id, 'ADMIN')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('no deja rastro de aprobación ni toca el stock cuando bloquea', async () => {
    const manager = await crearUsuario('manager.uno', 'MANAGER');
    await grantWarehouse(ds, base.warehouse.id, manager.id);
    await crearUsuario('admin.uno', 'ADMIN');

    const requestId = await solicitudPendiente(manager);
    await expect(service.approve(requestId, manager.id, 'MANAGER')).rejects.toBeInstanceOf(ForbiddenException);

    const req = await ds.getRepository(AdjustmentRequest).findOne({ where: { id: requestId } });
    expect(req!.status).toBe('PENDIENTE_APROBACION');
    expect(req!.approvedById).toBeNull();
    expect(await ds.getRepository(Stock).count()).toBe(0);
    expect((await eventosDe(requestId)).map((e) => e.eventType)).not.toContain('APROBADO');
  });

  it('otro aprobador sí puede aprobarla, y el stock se postea', async () => {
    const manager = await crearUsuario('manager.uno', 'MANAGER');
    await grantWarehouse(ds, base.warehouse.id, manager.id);
    const admin = await crearUsuario('admin.uno', 'ADMIN');

    const requestId = await solicitudPendiente(manager, 25);
    await service.approve(requestId, admin.id, 'ADMIN');

    const req = await ds.getRepository(AdjustmentRequest).findOne({ where: { id: requestId } });
    expect(req!.status).toBe('APROBADO');
    expect(req!.approvedById).toBe(admin.id);

    const stock = await ds.getRepository(Stock).findOne({ where: { productId: base.product.id } });
    expect(stock!.currentQuantity).toBe(25);
    expect((await eventosDe(requestId)).map((e) => e.eventType)).not.toContain('AUTOAPROBADO');
  });
});

describe('excepción: sin otro aprobador habilitado', () => {
  it('deja aprobar al creador y lo registra como AUTOAPROBADO', async () => {
    // Único ADMIN/MANAGER del sistema. Bloquear acá no agregaría control —no hay
    // segunda firma posible— y dejaría el depósito sin poder ajustar nada.
    const admin = await crearUsuario('admin.unico', 'ADMIN');

    const requestId = await solicitudPendiente(admin, 7);
    await service.approve(requestId, admin.id, 'ADMIN');

    const req = await ds.getRepository(AdjustmentRequest).findOne({ where: { id: requestId } });
    expect(req!.status).toBe('APROBADO');

    const tipos = (await eventosDe(requestId)).map((e) => e.eventType);
    expect(tipos).toContain('APROBADO');
    expect(tipos).toContain('AUTOAPROBADO');
  });

  it('no cuenta a un aprobador inactivo como segunda firma', async () => {
    const admin = await crearUsuario('admin.unico', 'ADMIN');
    await crearUsuario('manager.baja', 'MANAGER', false).then((m) => grantWarehouse(ds, base.warehouse.id, m.id));

    const requestId = await solicitudPendiente(admin);
    await service.approve(requestId, admin.id, 'ADMIN');

    expect((await eventosDe(requestId)).map((e) => e.eventType)).toContain('AUTOAPROBADO');
  });

  it('sí cuenta a un MANAGER asignado a otro depósito, porque MANAGER tiene alcance global', async () => {
    // Documenta la política vigente, que es contraintuitiva: la asignación a
    // `user_warehouses` no acota a un MANAGER — `GLOBAL_SCOPE_ROLES` le da acceso
    // a todos los depósitos. Así que sí es una segunda firma disponible y la
    // excepción no aplica.
    const admin = await crearUsuario('admin.unico', 'ADMIN');
    const otro = await ds.getRepository(Warehouse).save(
      ds.getRepository(Warehouse).create({ name: 'Depósito 02', documentCode: '02', active: true }),
    );
    await crearUsuario('manager.otro', 'MANAGER').then((m) => grantWarehouse(ds, otro.id, m.id));

    await expect(service.approve(await solicitudPendiente(admin), admin.id, 'ADMIN'))
      .rejects.toThrow(/manager\.otro/);
  });

  it('fija el supuesto: todos los roles que aprueban tienen alcance global', () => {
    // `otherEligibleApprovers` filtra por acceso al depósito, pero esa rama sólo
    // se ejecuta si algún rol aprobador deja de ser global. Si este test se cae,
    // esa rama pasó a estar viva y hay que cubrirla con un caso real en vez de
    // asumir que el depósito nunca acota el conjunto de aprobadores.
    for (const role of APPROVER_ROLES) {
      expect(access.hasGlobalScope(role)).toBe(true);
    }
  });

  it('no cuenta a quien tiene el permiso adjustments.approve denegado por override', async () => {
    // El rol solo no alcanza: el permiso fino se puede revocar por usuario, y
    // entonces esa persona tampoco es una segunda firma real.
    const admin = await crearUsuario('admin.unico', 'ADMIN');
    const sinPermiso = await crearUsuario('manager.sin.permiso', 'MANAGER');
    await grantWarehouse(ds, base.warehouse.id, sinPermiso.id);
    await ds.getRepository(UserPermission).save(
      ds.getRepository(UserPermission).create({
        userId: sinPermiso.id, module: 'adjustments', action: 'approve', effect: 'DENY',
      }),
    );

    const requestId = await solicitudPendiente(admin);
    await service.approve(requestId, admin.id, 'ADMIN');

    expect((await eventosDe(requestId)).map((e) => e.eventType)).toContain('AUTOAPROBADO');
  });

  it('vuelve a bloquear en cuanto aparece un segundo aprobador, sin tocar configuración', async () => {
    const admin = await crearUsuario('admin.unico', 'ADMIN');

    // Primera solicitud: único aprobador, pasa.
    await service.approve(await solicitudPendiente(admin), admin.id, 'ADMIN');

    // Alta de un segundo aprobador → el control se reactiva solo.
    const segundo = await crearUsuario('manager.nuevo', 'MANAGER');
    await grantWarehouse(ds, base.warehouse.id, segundo.id);

    await expect(service.approve(await solicitudPendiente(admin), admin.id, 'ADMIN'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('anulación de movimientos: mismo control', () => {
  it('quien pide la anulación de un movimiento no puede aprobarla', async () => {
    // `requestVoid` crea la solicitud ya en PENDIENTE_APROBACION con
    // createdById = quien la pidió, así que entra por el mismo camino.
    const manager = await crearUsuario('manager.uno', 'MANAGER');
    await grantWarehouse(ds, base.warehouse.id, manager.id);
    await crearUsuario('admin.uno', 'ADMIN');

    const entrada = await movements.create(
      {
        type: 'ENTRY',
        productId: base.product.id,
        warehouseId: base.warehouse.id,
        locationId: base.location.id,
        palletItems: [{ lotCode: 'L-ANULAR', quantity: 12, fechaVencimiento: '2027-01-31' }],
      },
      manager.id,
      'MANAGER',
    );

    const { requestId } = await movements.requestVoid(entrada.movementId, manager.id, 'MANAGER');

    await expect(service.approve(requestId, manager.id, 'MANAGER')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('lo que el control NO bloquea', () => {
  it('el creador sí puede rechazar su propia solicitud: devuelve a borrador, no mueve stock', async () => {
    const manager = await crearUsuario('manager.uno', 'MANAGER');
    await grantWarehouse(ds, base.warehouse.id, manager.id);
    await crearUsuario('admin.uno', 'ADMIN');

    const requestId = await solicitudPendiente(manager);
    await service.reject(requestId, { rejectReason: 'me equivoqué de material' }, manager.id, 'MANAGER');

    const req = await ds.getRepository(AdjustmentRequest).findOne({ where: { id: requestId } });
    expect(req!.status).toBe('BORRADOR');
    expect(await ds.getRepository(Stock).count()).toBe(0);
  });

  it('aprobar una solicitud ajena sigue funcionando aunque el aprobador haya creado otras', async () => {
    const admin = await crearUsuario('admin.uno', 'ADMIN');
    const manager = await crearUsuario('manager.uno', 'MANAGER');
    await grantWarehouse(ds, base.warehouse.id, manager.id);

    await solicitudPendiente(admin); // propia, quedará pendiente
    const ajena = await solicitudPendiente(manager, 5);

    await service.approve(ajena, admin.id, 'ADMIN');

    const req = await ds.getRepository(AdjustmentRequest).findOne({ where: { id: ajena } });
    expect(req!.status).toBe('APROBADO');
  });
});

describe('findAll — el motivo llega al frontend en vez de un 403 sorpresa', () => {
  it('marca con motivo la solicitud pendiente que creó quien consulta', async () => {
    const manager = await crearUsuario('manager.uno', 'MANAGER');
    await grantWarehouse(ds, base.warehouse.id, manager.id);
    await crearUsuario('admin.uno', 'ADMIN');

    const requestId = await solicitudPendiente(manager);

    const { data } = await service.findAll({}, null, { userId: manager.id, role: 'MANAGER' });
    const fila = data.find((r) => r.id === requestId)!;
    expect(fila.approvalBlockedReason).toMatch(/admin\.uno/);
  });

  it('no marca nada cuando el creador es el único aprobador: el botón tiene que funcionar', async () => {
    const admin = await crearUsuario('admin.unico', 'ADMIN');
    const requestId = await solicitudPendiente(admin);

    const { data } = await service.findAll({}, null, { userId: admin.id, role: 'ADMIN' });
    expect(data.find((r) => r.id === requestId)!.approvalBlockedReason).toBeNull();
  });

  it('no marca las solicitudes de otros', async () => {
    const manager = await crearUsuario('manager.uno', 'MANAGER');
    await grantWarehouse(ds, base.warehouse.id, manager.id);
    const admin = await crearUsuario('admin.uno', 'ADMIN');

    const requestId = await solicitudPendiente(manager);

    const { data } = await service.findAll({}, null, { userId: admin.id, role: 'ADMIN' });
    expect(data.find((r) => r.id === requestId)!.approvalBlockedReason).toBeNull();
  });
});
