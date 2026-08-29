import { DataSource } from 'typeorm';
import { PlaceUnlocatedStockInReception1784500000000 } from '../src/migrations/1784500000000-PlaceUnlocatedStockInReception';
import { Warehouse } from '../src/modules/warehouses/entities/warehouse.entity';
import { Location } from '../src/modules/locations/entities/location.entity';
import { Product } from '../src/modules/products/entities/product.entity';
import { Lot } from '../src/modules/lots/entities/lot.entity';
import { Pallet } from '../src/modules/pallets/entities/pallet.entity';
import { Stock } from '../src/modules/stocks/entities/stock.entity';
import { Movement } from '../src/modules/movements/entities/movement.entity';
import { MovementDetail } from '../src/modules/movements/entities/movement-detail.entity';
import { createTestDataSource, resetDb, TEST_USER_ID } from './test-datasource';

/**
 * Migración `1784500000000-PlaceUnlocatedStockInReception`: mueve a una zona
 * `RECEPCION` por depósito los pallets vivos y las filas de `stocks` que
 * quedaron con `locationId = NULL` (Entradas viejas sin sector asignado).
 */
let ds: DataSource;

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
});

/** Siembra una Entrada "vieja" sin ubicación: pallet + stock + movimiento, todo en NULL. */
async function seedUnlocatedEntry(opts: { lotCode: string; qty: number; docCode: string }) {
  const warehouse = await ds.getRepository(Warehouse).save(
    ds.getRepository(Warehouse).create({ name: 'Dep 01', documentCode: opts.docCode, active: true }),
  );
  const product = await ds.getRepository(Product).save(
    ds.getRepository(Product).create({ code: `P-${opts.lotCode}`, description: 'x', active: true }),
  );
  const lot = await ds.getRepository(Lot).save(
    ds.getRepository(Lot).create({ lotCode: opts.lotCode, productId: product.id, stockActual: opts.qty }),
  );
  const pallet = await ds.getRepository(Pallet).save(
    ds.getRepository(Pallet).create({
      code: `${product.code}-${opts.lotCode}-P1`, lotId: lot.id,
      quantity: opts.qty, currentLocationId: null, status: 'AVAILABLE',
    }),
  );
  await ds.getRepository(Stock).save(
    ds.getRepository(Stock).create({
      productId: product.id, warehouseId: warehouse.id, locationId: null, currentQuantity: opts.qty,
    }),
  );
  const movement = await ds.getRepository(Movement).save(
    ds.getRepository(Movement).create({
      type: 'ENTRY', productId: product.id, quantity: opts.qty,
      warehouseId: warehouse.id, status: 'NORMAL', createdById: TEST_USER_ID,
    }),
  );
  await ds.getRepository(MovementDetail).save(
    ds.getRepository(MovementDetail).create({
      movementId: movement.id, palletId: pallet.id, lotId: lot.id, quantity: opts.qty, locationId: null,
    }),
  );
  return { warehouse, product, lot, pallet };
}

async function runMigration() {
  const qr = ds.createQueryRunner();
  try {
    await new PlaceUnlocatedStockInReception1784500000000().up(qr);
  } finally {
    await qr.release();
  }
}

it('crea RECEPCIÓN y mueve el pallet + el stock que estaban sin ubicación', async () => {
  const { warehouse, product, pallet } = await seedUnlocatedEntry({ lotCode: 'L-VIEJO', qty: 100, docCode: '01' });

  await runMigration();

  const recepcion = await ds.getRepository(Location).findOneOrFail({
    where: { code: 'RECEPCION', warehouse: { id: warehouse.id } },
  });
  expect(recepcion.type).toBe('TEMPORAL');
  expect(recepcion.zone).toBe('RECEPCION');

  expect((await ds.getRepository(Pallet).findOneByOrFail({ id: pallet.id })).currentLocationId).toBe(recepcion.id);

  const stocks = await ds.getRepository(Stock).find({ where: { productId: product.id } });
  expect(stocks).toHaveLength(1);
  expect(stocks[0].locationId).toBe(recepcion.id);
  expect(stocks[0].currentQuantity).toBe(100);

  // Invariante: stock == pallets vivos
  const palletSum = (await ds.getRepository(Pallet).find({ where: { lotId: pallet.lotId } }))
    .filter((p) => p.status !== 'EXITED')
    .reduce((s, p) => s + p.quantity, 0);
  expect(palletSum).toBe(stocks[0].currentQuantity);
});

it('es idempotente y no rompe si ya existe la RECEPCIÓN con stock (merge)', async () => {
  const { warehouse, product } = await seedUnlocatedEntry({ lotCode: 'L-MERGE', qty: 40, docCode: '02' });
  // Ya hay una RECEPCIÓN con 10 del mismo producto.
  const recepcion = await ds.getRepository(Location).save(
    ds.getRepository(Location).create({ code: 'RECEPCION', type: 'TEMPORAL', zone: 'RECEPCION', warehouse }),
  );
  await ds.getRepository(Stock).save(
    ds.getRepository(Stock).create({
      productId: product.id, warehouseId: warehouse.id, locationId: recepcion.id, currentQuantity: 10,
    }),
  );

  await runMigration();

  const stocks = await ds.getRepository(Stock).find({ where: { productId: product.id } });
  expect(stocks).toHaveLength(1);
  expect(stocks[0].locationId).toBe(recepcion.id);
  expect(stocks[0].currentQuantity).toBe(50); // 10 + 40

  // Correrla de nuevo no cambia nada (no hay más NULLs).
  await runMigration();
  const again = await ds.getRepository(Stock).find({ where: { productId: product.id } });
  expect(again).toHaveLength(1);
  expect(again[0].currentQuantity).toBe(50);
});

it('no toca los pallets que ya tienen ubicación', async () => {
  const warehouse = await ds.getRepository(Warehouse).save(
    ds.getRepository(Warehouse).create({ name: 'Dep', documentCode: '03', active: true }),
  );
  const sector = await ds.getRepository(Location).save(
    ds.getRepository(Location).create({ code: 'A-A1', type: 'PISO', warehouse, active: true }),
  );
  const product = await ds.getRepository(Product).save(
    ds.getRepository(Product).create({ code: 'P-OK', description: 'x', active: true }),
  );
  const lot = await ds.getRepository(Lot).save(
    ds.getRepository(Lot).create({ lotCode: 'L-OK', productId: product.id, stockActual: 5 }),
  );
  const pallet = await ds.getRepository(Pallet).save(
    ds.getRepository(Pallet).create({ code: 'P-OK-P1', lotId: lot.id, quantity: 5, currentLocationId: sector.id, status: 'AVAILABLE' }),
  );
  await ds.getRepository(Stock).save(
    ds.getRepository(Stock).create({ productId: product.id, warehouseId: warehouse.id, locationId: sector.id, currentQuantity: 5 }),
  );

  await runMigration();

  expect((await ds.getRepository(Pallet).findOneByOrFail({ id: pallet.id })).currentLocationId).toBe(sector.id);
  expect(await ds.getRepository(Location).findOne({ where: { code: 'RECEPCION' } })).toBeNull();
});
