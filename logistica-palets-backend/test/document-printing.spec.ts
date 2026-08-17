import { DataSource } from 'typeorm';
import { MovementsService } from '../src/modules/movements/movements.service';
import { DocumentSequenceService } from '../src/modules/movements/document-sequence.service';
import { PilasService } from '../src/modules/pilas/pilas.service';
import { Warehouse } from '../src/modules/warehouses/entities/warehouse.entity';
import { Location } from '../src/modules/locations/entities/location.entity';
import { Pallet } from '../src/modules/pallets/entities/pallet.entity';
import { LogisticsDocument } from '../src/modules/movements/entities/logistics-document.entity';
import { Movement } from '../src/modules/movements/entities/movement.entity';
import { RegularizationLog } from '../src/modules/movements/entities/regularization-log.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { Destination } from '../src/modules/destinations/entities/destination.entity';
import { WarehousesService } from '../src/modules/warehouses/warehouses.service';
import type { EventsGateway } from '../src/modules/events/events.gateway';
import type { CacheService } from '../src/modules/cache/cache.service';
import type { UploadsService } from '../src/modules/uploads/uploads.service';
import {
  createTestDataSource,
  resetDb,
  seedBasics,
  TEST_USER_ID,
  type Basics,
} from './test-datasource';

const noopEvents = { emitMovementCreated() {}, emitStockUpdated() {} } as unknown as EventsGateway;
const noopCache = { delPattern: async () => {} } as unknown as CacheService;
const noopUploads = { log: async () => {} } as unknown as UploadsService;

let ds: DataSource;
let service: MovementsService;
let sequences: DocumentSequenceService;
let base: Basics;

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  sequences = new DocumentSequenceService();
  service = new MovementsService(ds, noopEvents, noopCache, sequences, noopUploads, new PilasService());
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
  base = await seedBasics(ds);
});

async function secondWarehouse() {
  const warehouse = await ds.getRepository(Warehouse).save(
    ds.getRepository(Warehouse).create({ name: 'Depósito 02', documentCode: '02', active: true }),
  );
  const location = await ds.getRepository(Location).save(
    ds.getRepository(Location).create({ code: 'B-1', type: 'PISO', warehouse, active: true }),
  );
  return { warehouse, location };
}

async function createStock(warehouse: Warehouse, location: Location, lotCode: string, quantity = 100) {
  await service.create({
    type: 'ENTRY',
    productId: base.product.id,
    warehouseId: warehouse.id,
    locationId: location.id,
    palletItems: [{
      lotCode,
      quantity,
      fechaVencimiento: '2027-12-31',
      locationId: location.id,
    }],
  }, TEST_USER_ID);
  return ds.getRepository(Pallet).findOneOrFail({ where: { currentLocationId: location.id } });
}

describe('numeración documental por depósito', () => {
  it('emite RLNE y RLNS independientes para depósitos 01 y 02', async () => {
    const second = await secondWarehouse();

    const entry01 = await service.createDocument({
      type: 'ENTRY',
      warehouseId: base.warehouse.id,
      lines: [{
        productId: base.product.id,
        palletItems: [{ lotCode: 'E-01', quantity: 50, fechaVencimiento: '2027-10-01', locationId: base.location.id }],
      }],
    }, TEST_USER_ID);
    const entry02 = await service.createDocument({
      type: 'ENTRY',
      warehouseId: second.warehouse.id,
      lines: [{
        productId: base.product.id,
        palletItems: [{ lotCode: 'E-02', quantity: 60, fechaVencimiento: '2027-10-02', locationId: second.location.id }],
      }],
    }, TEST_USER_ID);

    expect(entry01.code).toBe('RLNE-01-000001');
    expect(entry02.code).toBe('RLNE-02-000001');

    const pallet01 = await ds.getRepository(Pallet).findOneOrFail({ where: { currentLocationId: base.location.id } });
    const pallet02 = await ds.getRepository(Pallet).findOneOrFail({ where: { currentLocationId: second.location.id } });
    const exit01 = await service.createDocument({
      type: 'EXIT',
      lines: [{ productId: base.product.id, palletItems: [{ palletId: pallet01.id, quantity: 10 }] }],
    }, TEST_USER_ID);
    const exit02 = await service.createDocument({
      type: 'EXIT',
      lines: [{ productId: base.product.id, palletItems: [{ palletId: pallet02.id, quantity: 10 }] }],
    }, TEST_USER_ID);

    expect(exit01.code).toBe('RLNS-01-000001');
    expect(exit02.code).toBe('RLNS-02-000001');
  });

  it('serializa emisiones concurrentes sin códigos duplicados', async () => {
    const scope = { warehouseId: base.warehouse.id, documentCode: '01' };
    const codes = await Promise.all(Array.from({ length: 12 }, () =>
      ds.transaction((manager) => sequences.nextCode(manager, 'ENTRY', new Date('2026-08-17T12:00:00Z'), scope)),
    ));

    expect(new Set(codes).size).toBe(12);
    expect([...codes].sort()).toEqual(
      Array.from({ length: 12 }, (_, index) => `RLNE-01-${String(index + 1).padStart(6, '0')}`),
    );
  });

  it('no reinicia RLNE al cambiar de año porque el alcance es tipo + depósito', async () => {
    const scope = { warehouseId: base.warehouse.id, documentCode: '01' };
    const first = await ds.transaction((manager) =>
      sequences.nextCode(manager, 'ENTRY', new Date('2026-12-31T23:00:00-03:00'), scope));
    const second = await ds.transaction((manager) =>
      sequences.nextCode(manager, 'ENTRY', new Date('2027-01-01T01:00:00-03:00'), scope));

    expect(first).toBe('RLNE-01-000001');
    expect(second).toBe('RLNE-01-000002');
  });

  it('documentCode es único y no puede cambiar una vez configurado', async () => {
    const warehouses = new WarehousesService(ds.getRepository(Warehouse), ds);
    await expect(warehouses.create({ name: 'Código repetido', documentCode: '01' }))
      .rejects.toThrow('ya pertenece a otro depósito');
    await expect(warehouses.update(base.warehouse.id, { documentCode: '02' }))
      .rejects.toThrow('es estable y no puede modificarse');
  });
});

describe('depósito único y snapshots de impresión', () => {
  it('rechaza una RLNS que mezcle pallets de dos depósitos', async () => {
    const second = await secondWarehouse();
    const pallet01 = await createStock(base.warehouse, base.location, 'MIX-01');
    const pallet02 = await createStock(second.warehouse, second.location, 'MIX-02');

    await expect(service.createDocument({
      type: 'EXIT',
      lines: [{
        productId: base.product.id,
        palletItems: [
          { palletId: pallet01.id, quantity: 10 },
          { palletId: pallet02.id, quantity: 10 },
        ],
      }],
    }, TEST_USER_ID)).rejects.toThrow('depósitos distintos');

    expect(await ds.getRepository(LogisticsDocument).count({ where: { type: 'EXIT' } })).toBe(0);
  });

  it('entrada imprime depósito, transportista y usuario creador desde snapshots históricos', async () => {
    const created = await service.createDocument({
      type: 'ENTRY',
      warehouseId: base.warehouse.id,
      carrier: 'TRANSPORTADORA SNAPSHOT S.A.',
      driver: 'Chofer Original',
      driverDocument: '1234567',
      vehiclePlate: 'ABC 123',
      lines: [{
        productId: base.product.id,
        palletItems: [{ lotCode: 'SNAP-E', quantity: 40, fechaVencimiento: '2027-11-20', locationId: base.location.id }],
      }],
    }, TEST_USER_ID);

    base.warehouse.name = 'Depósito renombrado después';
    await ds.getRepository(Warehouse).save(base.warehouse);
    base.user.fullName = 'Nombre cambiado después';
    await ds.getRepository(User).save(base.user);

    const print = await service.findDocumentForPrint(created.documentId);
    expect(print.document.code).toBe('RLNE-01-000001');
    expect(print.document.warehouseId).toBe(base.warehouse.id);
    expect(print.warehouse).toEqual({
      id: base.warehouse.id,
      name: 'Depósito de prueba',
      documentCode: '01',
    });
    expect(print.createdBy).toEqual({
      id: TEST_USER_ID,
      username: 'operador.test',
      fullName: 'Operador de Prueba',
    });
    expect(print.encargado).toEqual(print.createdBy);
    expect(print.logistics).toEqual({
      carrier: 'TRANSPORTADORA SNAPSHOT S.A.',
      driver: 'Chofer Original',
      driverDocument: '1234567',
      vehiclePlate: 'ABC 123',
    });
  });

  it('salida persiste origen y destino como snapshots históricos', async () => {
    const pallet = await createStock(base.warehouse, base.location, 'ORIGEN-01');
    const catalogDestination = await ds.getRepository(Destination).save(
      ds.getRepository(Destination).create({ name: 'Cliente Original', active: true }),
    );
    const created = await service.createDocument({
      type: 'EXIT',
      carrier: 'FLETE DE SALIDA',
      destination: catalogDestination.name,
      documentNumber: 'NO-DEBE-GUARDARSE',
      lines: [{ productId: base.product.id, palletItems: [{ palletId: pallet.id, quantity: 25 }] }],
    }, TEST_USER_ID);

    catalogDestination.name = 'Cliente Renombrado';
    await ds.getRepository(Destination).save(catalogDestination);

    const print = await service.findDocumentForPrint(created.documentId);
    expect(created.code).toBe('RLNS-01-000001');
    expect(print.document.warehouseId).toBe(base.warehouse.id);
    expect(print.warehouse?.name).toBe('Depósito de prueba');
    expect(print.createdBy.fullName).toBe('Operador de Prueba');
    expect(print.logistics.carrier).toBe('FLETE DE SALIDA');
    expect(print.document.destination).toBe('Cliente Original');
    expect(print.document.documentNumber).toBeNull();
  });

  it('Documento Material se guarda, filtra y corrige sin auditorías redundantes', async () => {
    const completedPallet = await createStock(base.warehouse, base.location, 'DOC-MAT-01');
    const completed = await service.createDocument({
      type: 'EXIT',
      documentoMaterial: '  4900123456  ',
      lines: [{
        productId: base.product.id,
        palletItems: [{ palletId: completedPallet.id, quantity: 10 }],
      }],
    }, TEST_USER_ID);

    const movementId = completed.movementIds[0];
    expect((await ds.getRepository(LogisticsDocument).findOneByOrFail({ id: completed.documentId })).documentoMaterial)
      .toBe('4900123456');
    expect((await ds.getRepository(Movement).findOneByOrFail({ id: movementId })).documentoMaterial)
      .toBe('4900123456');

    const unchanged = await service.editMetadata(movementId, {
      reason: 'Verificación del documento SAP',
      documentoMaterial: ' 4900123456 ',
    }, TEST_USER_ID);
    expect(unchanged.changes).toBe(0);
    expect(await ds.getRepository(RegularizationLog).count()).toBe(0);

    const changed = await service.editMetadata(movementId, {
      reason: 'Corrección del documento SAP',
      documentoMaterial: '4900999999',
    }, TEST_USER_ID);
    expect(changed.changes).toBe(1);
    expect((await ds.getRepository(LogisticsDocument).findOneByOrFail({ id: completed.documentId })).documentoMaterial)
      .toBe('4900999999');
    expect((await ds.getRepository(Movement).findOneByOrFail({ id: movementId })).documentoMaterial)
      .toBe('4900999999');
    expect(await ds.getRepository(RegularizationLog).findOneByOrFail({ movementId })).toMatchObject({
      field: 'documentoMaterial',
      oldValue: '4900123456',
      newValue: '4900999999',
    });

    const pendingPallet = await createStock(base.warehouse, base.location, 'DOC-MAT-02');
    const pending = await service.createDocument({
      type: 'EXIT',
      lines: [{
        productId: base.product.id,
        palletItems: [{ palletId: pendingPallet.id, quantity: 10 }],
      }],
    }, TEST_USER_ID);

    const pendingRows = await service.findAll({ type: ['EXIT'], documentoMaterialStatus: 'PENDING' });
    const completedRows = await service.findAll({ type: ['EXIT'], documentoMaterialStatus: 'COMPLETED' });
    expect(pendingRows.data.map((row) => row.id)).toEqual(pending.movementIds);
    expect(completedRows.data.map((row) => row.id)).toEqual(completed.movementIds);
  });

  it('rechaza Documento Material fuera del flujo de Salida', async () => {
    await expect(service.createDocument({
      type: 'ENTRY',
      warehouseId: base.warehouse.id,
      documentoMaterial: '4900123456',
      lines: [{
        productId: base.product.id,
        palletItems: [{ lotCode: 'NO-EXIT', quantity: 10, fechaVencimiento: '2027-12-31', locationId: base.location.id }],
      }],
    }, TEST_USER_ID)).rejects.toThrow('solo corresponde a una Salida');
  });
});
