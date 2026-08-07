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

  it('un producto no apilable no consolida en una pila OPEN ni se recomienda en un sector lleno', async () => {
    const product = await mkProduct({ stackable: false });
    const full = await mkLocation({ code: 'NO-STACK-FULL', capacityBases: 1 });
    const free = await mkLocation({ code: 'NO-STACK-FREE', capacityBases: 2 });
    // Simula también datos históricos cuya pila quedó OPEN: la regla debe salir
    // del producto, no confiar ciegamente en el status persistido.
    await mkOccupiedBase(full, product.id);

    const res = await service.recommend(product.id);
    const ids = res.recommendations.map((r) => r.id);
    expect(ids).toContain(free.id);
    expect(ids).not.toContain(full.id);
  });

  it('calcula la recomendación con la cantidad de pallets y el máximo de nivel efectivo', async () => {
    const product = await mkProduct({ stackable: true, maxStackLevel: 2 });
    const loc = await mkLocation({ code: 'MAX-LEVEL-REC', capacityBases: 1, defaultMaxStackLevel: 5 });
    await mkOccupiedBase(loc, product.id); // nivel 1; queda un solo nivel por el tope del producto

    const oneMore = await service.recommend(product.id, 1);
    expect(oneMore.recommendations.map((r) => r.id)).toContain(loc.id);

    const twoMore = await service.recommend(product.id, 2);
    expect(twoMore.recommendations.map((r) => r.id)).not.toContain(loc.id);
  });

  it('devuelve mensaje cuando no hay ubicación factible', async () => {
    const product = await mkProduct({ temperatureZone: 'FROZEN' });
    await mkLocation({ code: 'AMB-2', temperatureZone: 'AMBIENT' });

    const res = await service.recommend(product.id);
    expect(res.recommendations).toHaveLength(0);
    expect(res.message).toBeTruthy();
  });
});

describe('estructura — Sector-Subsector único', () => {
  it('rechaza crear dos ubicaciones con el mismo Sector-Subsector', async () => {
    await service.create({
      warehouseId: warehouse.id, code: 'B-B2', aisle: 'B', rack: 'B2', capacityBases: 10,
    });

    // Código distinto, pero mismo subsector → serían dos celdas "B2" idénticas.
    await expect(service.create({
      warehouseId: warehouse.id, code: 'B-B22', aisle: 'B', rack: 'B2', capacityBases: 13,
    })).rejects.toThrow(/subsector B-B2 ya existe/i);
  });

  it('normaliza a mayúsculas: "b2" choca con "B2"', async () => {
    await service.create({ warehouseId: warehouse.id, code: 'C-C1', aisle: 'C', rack: 'C1' });
    await expect(service.create({
      warehouseId: warehouse.id, code: 'C-OTRO', aisle: 'c', rack: 'c1',
    })).rejects.toThrow(/ya existe/i);
  });

  it('permite el mismo subsector en sectores distintos', async () => {
    await service.create({ warehouseId: warehouse.id, code: 'D-1', aisle: 'D', rack: '1' });
    await expect(
      service.create({ warehouseId: warehouse.id, code: 'E-1', aisle: 'E', rack: '1' }),
    ).resolves.toBeDefined();
  });

  it('editar una ubicación no choca consigo misma', async () => {
    const loc = await service.create({
      warehouseId: warehouse.id, code: 'F-F1', aisle: 'F', rack: 'F1', capacityBases: 5,
    });
    await expect(
      service.update(loc.id, { aisle: 'F', rack: 'F1', capacityBases: 20 }),
    ).resolves.toBeDefined();
  });

  it('editar hacia un subsector ya tomado se rechaza', async () => {
    await service.create({ warehouseId: warehouse.id, code: 'G-G1', aisle: 'G', rack: 'G1' });
    const otra = await service.create({ warehouseId: warehouse.id, code: 'G-G2', aisle: 'G', rack: 'G2' });

    await expect(service.update(otra.id, { rack: 'G1' })).rejects.toThrow(/ya existe/i);
  });
});
