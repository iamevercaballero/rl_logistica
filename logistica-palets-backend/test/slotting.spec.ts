/**
 * Tests de integración del motor de slotting (LocationsService.recommend).
 * Valida factibilidad (temperatura, capacidad) y puntaje (consolidación).
 */
import { DataSource } from 'typeorm';
import { LocationsService } from '../src/modules/locations/locations.service';
import { Product } from '../src/modules/products/entities/product.entity';
import { Warehouse } from '../src/modules/warehouses/entities/warehouse.entity';
import { Location } from '../src/modules/locations/entities/location.entity';
import { Lot } from '../src/modules/lots/entities/lot.entity';
import { Pallet } from '../src/modules/pallets/entities/pallet.entity';
import { createTestDataSource, resetDb } from './test-datasource';

let ds: DataSource;
let service: LocationsService;
let warehouse: Warehouse;

const mkProduct = (over: Partial<Product>) =>
  ds.getRepository(Product).save(
    ds.getRepository(Product).create({
      code: `P-${Math.random().toString(36).slice(2, 7)}`,
      description: 'Test',
      active: true,
      stackable: true,
      canReceiveWeightOnTop: true,
      fragile: false,
      temperatureZone: 'AMBIENT',
      rotationPolicy: 'FEFO',
      ...over,
    }),
  );

const mkLocation = (over: Partial<Location>) =>
  ds.getRepository(Location).save(
    ds.getRepository(Location).create({
      code: `L-${Math.random().toString(36).slice(2, 7)}`,
      type: 'RACK',
      active: true,
      temperatureZone: 'AMBIENT',
      allowsStacking: true,
      warehouse,
      ...over,
    }),
  );

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  service = new LocationsService(
    ds.getRepository(Location),
    ds.getRepository(Warehouse),
    ds.getRepository(Pallet),
    ds.getRepository(Product),
    ds,
  );
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
  warehouse = await ds.getRepository(Warehouse).save(
    ds.getRepository(Warehouse).create({ name: 'Dep Test', active: true }),
  );
});

describe('slotting — recommend', () => {
  it('filtra por temperatura: un producto CHILLED no va a una ubicación AMBIENT', async () => {
    const product = await mkProduct({ temperatureZone: 'CHILLED' });
    await mkLocation({ code: 'AMB-1', temperatureZone: 'AMBIENT' });
    const chilled = await mkLocation({ code: 'CHI-1', temperatureZone: 'CHILLED' });

    const res = await service.recommend(product.id);

    expect(res.recommendations).toHaveLength(1);
    expect(res.recommendations[0].id).toBe(chilled.id);
  });

  it('excluye ubicaciones llenas (ocupación >= capacidad)', async () => {
    const product = await mkProduct({});
    const full = await mkLocation({ code: 'FULL-1', capacityPallets: 1 });
    const free = await mkLocation({ code: 'FREE-1', capacityPallets: 5 });

    // Llenar `full` con un pallet vigente de otro lote/producto cualquiera.
    const lot = await ds.getRepository(Lot).save(
      ds.getRepository(Lot).create({ productId: product.id, lotCode: 'L1', stockActual: 1, status: 'NORMAL' }),
    );
    await ds.getRepository(Pallet).save(
      ds.getRepository(Pallet).create({ code: 'PAL-1', lotId: lot.id, quantity: 1, currentLocationId: full.id, status: 'AVAILABLE' }),
    );

    const res = await service.recommend(product.id);
    const ids = res.recommendations.map((r) => r.id);
    expect(ids).toContain(free.id);
    expect(ids).not.toContain(full.id);
  });

  it('prioriza consolidar con el mismo producto ya almacenado', async () => {
    const product = await mkProduct({});
    const withProduct = await mkLocation({ code: 'CONS-1', capacityPallets: 5, zone: 'ALMACENAMIENTO' });
    await mkLocation({ code: 'EMPTY-1', capacityPallets: 5, zone: 'ALMACENAMIENTO' });

    const lot = await ds.getRepository(Lot).save(
      ds.getRepository(Lot).create({ productId: product.id, lotCode: 'L2', stockActual: 10, status: 'NORMAL' }),
    );
    await ds.getRepository(Pallet).save(
      ds.getRepository(Pallet).create({ code: 'PAL-2', lotId: lot.id, quantity: 10, currentLocationId: withProduct.id, status: 'AVAILABLE' }),
    );

    const res = await service.recommend(product.id);
    expect(res.recommendations[0].id).toBe(withProduct.id);
    expect(res.recommendations[0].reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('mismo producto')]),
    );
  });

  it('devuelve mensaje cuando no hay ubicación factible', async () => {
    const product = await mkProduct({ temperatureZone: 'FROZEN' });
    await mkLocation({ code: 'AMB-2', temperatureZone: 'AMBIENT' });

    const res = await service.recommend(product.id);
    expect(res.recommendations).toHaveLength(0);
    expect(res.message).toBeTruthy();
  });
});
