/**
 * Tests de integración del motor de slotting (LocationsService.recommend).
 * Valida factibilidad (temperatura, capacidad en bases) y puntaje (consolidación).
 *
 * La ocupación ahora se mide en bases (pilas), no en pallets sueltos — un
 * pallet sin una fila en `pilas` no cuenta como ocupación para `recommend()`.
 */
import { DataSource } from 'typeorm';
import { LocationsService } from '../src/modules/locations/locations.service';
import { PilasService } from '../src/modules/pilas/pilas.service';
import { Product } from '../src/modules/products/entities/product.entity';
import { Warehouse } from '../src/modules/warehouses/entities/warehouse.entity';
import { Location } from '../src/modules/locations/entities/location.entity';
import { Lot } from '../src/modules/lots/entities/lot.entity';
import { Pallet } from '../src/modules/pallets/entities/pallet.entity';
import { Pila } from '../src/modules/pilas/entities/pila.entity';
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
      type: 'PISO',
      active: true,
      temperatureZone: 'AMBIENT',
      allowsStacking: true,
      warehouse,
      ...over,
    }),
  );

/** Ocupa una base: una pila real (no solo un pallet suelto — `recommend()` cuenta pilas). */
const mkOccupiedBase = async (location: Location, productId: string, opts?: { sequence?: number }) => {
  const pila = await ds.getRepository(Pila).save(
    ds.getRepository(Pila).create({
      locationId: location.id, sequence: opts?.sequence ?? 1, status: 'OPEN', productId,
    }),
  );
  const lot = await ds.getRepository(Lot).save(
    ds.getRepository(Lot).create({ productId, lotCode: `L-${pila.id.slice(0, 8)}`, stockActual: 1, status: 'NORMAL' }),
  );
  await ds.getRepository(Pallet).save(
    ds.getRepository(Pallet).create({
      code: `PAL-${pila.id.slice(0, 8)}`, lotId: lot.id, quantity: 1,
      currentLocationId: location.id, pilaId: pila.id, stackPosition: 1, status: 'AVAILABLE',
    }),
  );
  return pila;
};

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  service = new LocationsService(
    ds.getRepository(Location),
    ds.getRepository(Warehouse),
    ds.getRepository(Pallet),
    ds.getRepository(Product),
    ds.getRepository(Pila),
    new PilasService(),
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

  it('excluye sectores sin bases libres (ocupación >= capacidad)', async () => {
    const product = await mkProduct({});
    const other = await mkProduct({}); // pila existente es de OTRO producto → no consolida, ocupa la única base
    const full = await mkLocation({ code: 'FULL-1', capacityBases: 1 });
    const free = await mkLocation({ code: 'FREE-1', capacityBases: 5 });

    await mkOccupiedBase(full, other.id);

    const res = await service.recommend(product.id);
    const ids = res.recommendations.map((r) => r.id);
    expect(ids).toContain(free.id);
    expect(ids).not.toContain(full.id);
  });

  it('prioriza consolidar con el mismo producto ya almacenado (pila abierta)', async () => {
    const product = await mkProduct({});
    const withProduct = await mkLocation({ code: 'CONS-1', capacityBases: 5, zone: 'ALMACENAMIENTO' });
    await mkLocation({ code: 'EMPTY-1', capacityBases: 5, zone: 'ALMACENAMIENTO' });

    await mkOccupiedBase(withProduct, product.id);

    const res = await service.recommend(product.id);
    expect(res.recommendations[0].id).toBe(withProduct.id);
    expect(res.recommendations[0].reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('mismo producto')]),
    );
  });

  it('un sector lleno de OTRO producto sigue siendo factible si el propio ya consolida ahí', async () => {
    // Caso real: la pila abierta es del MISMO producto y la base "llena" es
    // justamente esa — no hace falta una base nueva, así que sigue factible
    // aunque capacityBases ya esté en el tope.
    const product = await mkProduct({});
    const loc = await mkLocation({ code: 'CONS-2', capacityBases: 1 });
    await mkOccupiedBase(loc, product.id);

    const res = await service.recommend(product.id);
    expect(res.recommendations.map((r) => r.id)).toContain(loc.id);
  });

  it('devuelve mensaje cuando no hay ubicación factible', async () => {
    const product = await mkProduct({ temperatureZone: 'FROZEN' });
    await mkLocation({ code: 'AMB-2', temperatureZone: 'AMBIENT' });

    const res = await service.recommend(product.id);
    expect(res.recommendations).toHaveLength(0);
    expect(res.message).toBeTruthy();
  });
});
