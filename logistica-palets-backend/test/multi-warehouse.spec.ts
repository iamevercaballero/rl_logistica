/**
 * Multi-depósito: permisos, aislamiento de stock/FEFO y bloqueo de operaciones
 * cruzadas entre depósitos.
 *
 * Lo que se protege acá es que un depósito no pueda ver ni consumir el
 * inventario de otro, ni siquiera manipulando el request: los tests atacan por
 * `warehouseId`, por `locationId` y por `palletId`, que son las tres vías por
 * las que una operación puede terminar en el depósito equivocado.
 */
import { DataSource } from 'typeorm';
import { ForbiddenException } from '@nestjs/common';
import { MovementsService } from '../src/modules/movements/movements.service';
import { DocumentSequenceService } from '../src/modules/movements/document-sequence.service';
import { PilasService } from '../src/modules/pilas/pilas.service';
import { LotsService } from '../src/modules/lots/lots.service';
import { PalletsService } from '../src/modules/pallets/pallets.service';
import { ReportsService } from '../src/modules/reports/reports.service';
import { WarehouseAccessService } from '../src/modules/warehouses/warehouse-access.service';
import { Warehouse } from '../src/modules/warehouses/entities/warehouse.entity';
import { Location } from '../src/modules/locations/entities/location.entity';
import { Pallet } from '../src/modules/pallets/entities/pallet.entity';
import { Lot } from '../src/modules/lots/entities/lot.entity';
import { Product } from '../src/modules/products/entities/product.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { SapStockSnapshot } from '../src/modules/reports/entities/sap-stock.entity';
import type { EventsGateway } from '../src/modules/events/events.gateway';
import type { CacheService } from '../src/modules/cache/cache.service';
import type { UploadsService } from '../src/modules/uploads/uploads.service';
import {
  createAccessService,
  createTestDataSource,
  grantWarehouse,
  resetDb,
  seedBasics,
  TEST_USER_ID,
  type Basics,
} from './test-datasource';

const noopEvents = { emitMovementCreated() {}, emitStockUpdated() {} } as unknown as EventsGateway;
const noopCache = { delPattern: async () => {}, get: async () => null, set: async () => {} } as unknown as CacheService;
const noopUploads = { log: async () => {} } as unknown as UploadsService;

/** Identidades usadas en los tests: cada una con su propio alcance. */
const ADMIN = { userId: '00000000-0000-0000-0000-0000000000a1', role: 'ADMIN' };
const MANAGER = { userId: '00000000-0000-0000-0000-0000000000b2', role: 'MANAGER' };
const OPERATOR = { userId: TEST_USER_ID, role: 'OPERATOR' };

let ds: DataSource;
let movements: MovementsService;
let lots: LotsService;
let pallets: PalletsService;
let reports: ReportsService;
let access: WarehouseAccessService;
let base: Basics;
/** Segundo depósito, al que el OPERATOR nunca tiene acceso. */
let wh02: { warehouse: Warehouse; location: Location };

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  access = createAccessService(ds);
  movements = new MovementsService(
    ds, noopEvents, noopCache, new DocumentSequenceService(), noopUploads, new PilasService(), access,
  );
  lots = new LotsService(ds.getRepository(Lot), ds.getRepository(Product), ds.getRepository(Pallet));
  pallets = new PalletsService(
    ds, ds.getRepository(Pallet), ds.getRepository(Lot), ds.getRepository(Location), new PilasService(), access,
  );
  reports = new ReportsService(ds, ds.getRepository(SapStockSnapshot), noopCache);
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
  base = await seedBasics(ds); // depósito 01 + OPERATOR ya asignado a él

  const warehouse = await ds.getRepository(Warehouse).save(
    ds.getRepository(Warehouse).create({ name: 'Depósito 02', documentCode: '02', active: true }),
  );
  const location = await ds.getRepository(Location).save(
    ds.getRepository(Location).create({ code: 'B-1', type: 'PISO', warehouse, active: true }),
  );
  wh02 = { warehouse, location };

  await ds.getRepository(User).save([
    ds.getRepository(User).create({
      id: ADMIN.userId, username: 'admin.test', passwordHash: 'x', role: 'ADMIN', active: true,
    }),
    ds.getRepository(User).create({
      id: MANAGER.userId, username: 'manager.test', passwordHash: 'x', role: 'MANAGER', active: true,
    }),
  ]);
});

/** Entrada directa en un depósito, saltando el control de acceso del caller. */
async function seedStock(warehouse: Warehouse, location: Location, lotCode: string, quantity: number) {
  await grantWarehouse(ds, warehouse.id, ADMIN.userId);
  await movements.create({
    type: 'ENTRY',
    productId: base.product.id,
    warehouseId: warehouse.id,
    locationId: location.id,
    palletItems: [{ lotCode, quantity, fechaVencimiento: '2027-12-31', locationId: location.id }],
  }, ADMIN.userId, 'ADMIN');
  return ds.getRepository(Pallet).findOneOrFail({ where: { currentLocationId: location.id } });
}

describe('multi-depósito — permisos por rol', () => {
  it('ADMIN y MANAGER ven todos los depósitos', async () => {
    const forAdmin = await access.getAllowedWarehouses(ADMIN);
    const forManager = await access.getAllowedWarehouses(MANAGER);

    expect(forAdmin.map((w) => w.documentCode).sort()).toEqual(['01', '02']);
    expect(forManager.map((w) => w.documentCode).sort()).toEqual(['01', '02']);
  });

  it('OPERATOR solo ve los depósitos que tiene asignados', async () => {
    const allowed = await access.getAllowedWarehouses(OPERATOR);

    expect(allowed).toHaveLength(1);
    expect(allowed[0].documentCode).toBe('01');
  });

  it('OPERATOR que intenta acceder al depósito 02 recibe 403', async () => {
    await expect(access.assertWarehouseAccess(OPERATOR, wh02.warehouse.id))
      .rejects.toThrow(ForbiddenException);
    await expect(access.assertWarehouseAccess(OPERATOR, wh02.warehouse.id))
      .rejects.toThrow('No tenés acceso a este depósito.');
  });

  it('sumar una asignación amplía el alcance sin tocar el resto', async () => {
    await access.setAssignments(OPERATOR.userId, [base.warehouse.id, wh02.warehouse.id]);

    const allowed = await access.getAllowedWarehouses(OPERATOR);
    expect(allowed.map((w) => w.documentCode).sort()).toEqual(['01', '02']);
    await expect(access.assertWarehouseAccess(OPERATOR, wh02.warehouse.id)).resolves.toBeUndefined();
  });

  it('quitar el acceso lo revoca de inmediato para la siguiente operación', async () => {
    await access.setAssignments(OPERATOR.userId, []);

    await expect(access.assertWarehouseAccess(OPERATOR, base.warehouse.id))
      .rejects.toThrow(ForbiddenException);
  });

  it('un depósito inactivo deja de admitir operaciones nuevas', async () => {
    base.warehouse.active = false;
    await ds.getRepository(Warehouse).save(base.warehouse);

    await expect(access.assertWritableWarehouse(OPERATOR, base.warehouse.id))
      .rejects.toThrow('está inactivo');
  });
});

describe('multi-depósito — aislamiento de stock', () => {
  it('el stock de un producto se informa por depósito, nunca sumado', async () => {
    await seedStock(base.warehouse, base.location, 'W1-100', 100);
    await seedStock(wh02.warehouse, wh02.location, 'W2-200', 200);

    const stock01 = await reports.stock({}, [base.warehouse.id]);
    const stock02 = await reports.stock({}, [wh02.warehouse.id]);
    const global = await reports.stock({}, null);

    expect(stock01.totalQuantity).toBe(100);
    expect(stock02.totalQuantity).toBe(200);
    // El total global sigue existiendo para vistas administrativas...
    expect(global.totalQuantity).toBe(300);
    // ...pero ninguna vista acotada muestra 300.
    expect(stock01.totalQuantity).not.toBe(300);
    expect(stock02.totalQuantity).not.toBe(300);
  });

  it('los KPIs cambian por completo al cambiar de depósito', async () => {
    await seedStock(base.warehouse, base.location, 'K1', 100);
    await seedStock(wh02.warehouse, wh02.location, 'K2', 200);

    const kpis01 = await reports.kpis({ range: 'month' }, [base.warehouse.id]);
    const kpis02 = await reports.kpis({ range: 'month' }, [wh02.warehouse.id]);

    expect(kpis01.totalQuantity).toBe(100);
    expect(kpis02.totalQuantity).toBe(200);
    expect(kpis01.stockByWarehouse).toHaveLength(1);
    expect(kpis02.stockByWarehouse).toHaveLength(1);
  });

  it('los pallets listados son solo los del depósito activo', async () => {
    await seedStock(base.warehouse, base.location, 'P1', 100);
    await seedStock(wh02.warehouse, wh02.location, 'P2', 200);

    const only01 = await pallets.findAll({}, [base.warehouse.id]);
    const only02 = await pallets.findAll({}, [wh02.warehouse.id]);

    expect(only01.every((p) => p.warehouseId === base.warehouse.id)).toBe(true);
    expect(only02.every((p) => p.warehouseId === wh02.warehouse.id)).toBe(true);
    expect(only01).toHaveLength(1);
    expect(only02).toHaveLength(1);
  });

  it('un lote presente en dos depósitos informa la disponibilidad del activo', async () => {
    // Mismo código de lote en ambos depósitos: la identidad del lote es global,
    // lo que cambia es cuánto hay de él en cada lugar.
    await seedStock(base.warehouse, base.location, 'COMPARTIDO', 100);
    await seedStock(wh02.warehouse, wh02.location, 'COMPARTIDO-02', 200);

    const in01 = await lots.findAll(undefined, undefined, false, [base.warehouse.id]);
    const in02 = await lots.findAll(undefined, undefined, false, [wh02.warehouse.id]);

    expect(in01.map((l) => l.lotCode)).toEqual(['COMPARTIDO']);
    expect(in01[0].stockActual).toBe(100);
    expect(in02.map((l) => l.lotCode)).toEqual(['COMPARTIDO-02']);
    expect(in02[0].stockActual).toBe(200);
  });
});

describe('multi-depósito — FEFO y salidas', () => {
  it('FEFO solo ofrece pallets del depósito activo', async () => {
    await seedStock(base.warehouse, base.location, 'F-01', 5000);
    await seedStock(wh02.warehouse, wh02.location, 'F-02', 10000);

    const fefo01 = await lots.findFefo(base.product.id, undefined, undefined, [base.warehouse.id]);
    const disponible01 = fefo01.reduce((sum, lot) => sum + lot.stockActual, 0);

    expect(disponible01).toBe(5000);
    expect(fefo01.map((l) => l.lotCode)).toEqual(['F-01']);
  });

  it('una salida mayor al stock del depósito falla aunque exista stock global', async () => {
    await seedStock(base.warehouse, base.location, 'F-01', 5000);
    await seedStock(wh02.warehouse, wh02.location, 'F-02', 10000);

    // 7.000 > 5.000 del depósito 01, aunque globalmente haya 15.000.
    await expect(movements.create({
      type: 'EXIT',
      productId: base.product.id,
      warehouseId: base.warehouse.id,
      quantity: 7000,
    }, ADMIN.userId, 'ADMIN')).rejects.toThrow('Stock insuficiente');

    // El stock del otro depósito quedó intacto.
    const stock02 = await reports.stock({}, [wh02.warehouse.id]);
    expect(stock02.totalQuantity).toBe(10000);
  });

  it('una salida sin depósito se rechaza en vez de resolverse contra el stock global', async () => {
    await seedStock(base.warehouse, base.location, 'F-01', 5000);

    await expect(movements.create({
      type: 'EXIT',
      productId: base.product.id,
      quantity: 10,
    }, ADMIN.userId, 'ADMIN')).rejects.toThrow('requiere un depósito');
  });
});

describe('multi-depósito — seguridad contra manipulación del request', () => {
  it('manipular warehouseId no permite operar en otro depósito', async () => {
    await expect(movements.create({
      type: 'ENTRY',
      productId: base.product.id,
      warehouseId: wh02.warehouse.id,
      palletItems: [{ lotCode: 'HACK-1', quantity: 10, fechaVencimiento: '2027-12-31' }],
    }, OPERATOR.userId, 'OPERATOR')).rejects.toThrow(ForbiddenException);
  });

  it('manipular locationId tampoco: el depósito se deriva de la ubicación real', async () => {
    await expect(movements.create({
      type: 'ENTRY',
      productId: base.product.id,
      // Sin warehouseId: el depósito sale de la ubicación, que es del 02.
      locationId: wh02.location.id,
      palletItems: [{ lotCode: 'HACK-2', quantity: 10, fechaVencimiento: '2027-12-31', locationId: wh02.location.id }],
    }, OPERATOR.userId, 'OPERATOR')).rejects.toThrow(ForbiddenException);
  });

  it('mentir el warehouseId de una entrada cuya ubicación es de otro depósito se rechaza', async () => {
    await expect(movements.createDocument({
      type: 'ENTRY',
      warehouseId: base.warehouse.id, // dice 01...
      lines: [{
        productId: base.product.id,
        // ...pero la ubicación es del 02.
        palletItems: [{ lotCode: 'HACK-3', quantity: 10, fechaVencimiento: '2027-12-31', locationId: wh02.location.id }],
      }],
    }, ADMIN.userId, 'ADMIN')).rejects.toThrow('deben pertenecer al depósito indicado');
  });

  it('manipular palletId no deja despachar un pallet de otro depósito', async () => {
    const palletOtroDeposito = await seedStock(wh02.warehouse, wh02.location, 'HACK-4', 100);

    await expect(movements.createDocument({
      type: 'EXIT',
      lines: [{ productId: base.product.id, palletItems: [{ palletId: palletOtroDeposito.id, quantity: 10 }] }],
    }, OPERATOR.userId, 'OPERATOR')).rejects.toThrow(ForbiddenException);
  });

  it('una transferencia entre depósitos distintos se rechaza', async () => {
    await seedStock(base.warehouse, base.location, 'T-01', 100);
    await grantWarehouse(ds, wh02.warehouse.id, MANAGER.userId);

    await expect(movements.createTransferBatch({
      fromLocationId: base.location.id,
      toLocationId: wh02.location.id,
      lines: [],
    }, MANAGER.userId, 'MANAGER')).rejects.toThrow('depósitos distintos');
  });

  it('un OPERATOR no puede corregir un movimiento de otro depósito', async () => {
    await seedStock(wh02.warehouse, wh02.location, 'X-02', 100);
    const movement = await ds.getRepository(Warehouse).manager.query(
      `SELECT id FROM movements WHERE "warehouseId" = $1 LIMIT 1`,
      [wh02.warehouse.id],
    );

    await expect(movements.editMetadata(
      movement[0].id,
      { reason: 'intento de edición cruzada' },
      OPERATOR.userId,
      'OPERATOR',
    )).rejects.toThrow(ForbiddenException);
  });

  it('un OPERATOR sin depósitos asignados no puede consultar nada operativo', async () => {
    await access.setAssignments(OPERATOR.userId, []);

    await expect(access.resolveQueryScope(OPERATOR))
      .rejects.toThrow('No tenés ningún depósito asignado');
  });
});

describe('multi-depósito — resolución del depósito real de cada entidad', () => {
  it('deriva el depósito desde la ubicación, el pallet y el movimiento', async () => {
    const pallet = await seedStock(base.warehouse, base.location, 'RES-1', 50);
    const [movement] = await ds.query(
      `SELECT id FROM movements WHERE "warehouseId" = $1 LIMIT 1`, [base.warehouse.id],
    );

    expect(await access.resolveEntityWarehouseId('location', base.location.id)).toBe(base.warehouse.id);
    expect(await access.resolveEntityWarehouseId('pallet', pallet.id)).toBe(base.warehouse.id);
    expect(await access.resolveEntityWarehouseId('movement', movement.id)).toBe(base.warehouse.id);
  });

  it('un pallet movido a otro depósito resuelve contra su ubicación actual, no la vieja', async () => {
    const pallet = await seedStock(base.warehouse, base.location, 'RES-2', 50);

    // Movimiento concurrente: el pallet termina físicamente en el depósito 02.
    await ds.getRepository(Pallet).update(pallet.id, { currentLocationId: wh02.location.id });

    expect(await access.resolveEntityWarehouseId('pallet', pallet.id)).toBe(wh02.warehouse.id);
    await expect(access.assertEntityAccess(OPERATOR, 'pallet', pallet.id))
      .rejects.toThrow(ForbiddenException);
  });
});
