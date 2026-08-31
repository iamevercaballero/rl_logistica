/**
 * Baja de lotes (RL-C-04) contra un PostgreSQL real.
 *
 * Requiere la base de docker-compose.test.yml levantada.
 *
 * El `remove()` original borraba el lote sin mirar nada. Como `movements.lotId`,
 * `pallets.lotId` y `movement_details.lotId` no tienen clave foránea, la base
 * tampoco lo impedía: el material despachado quedaba sin el lote que lo originó.
 * Estas pruebas fijan las tres salidas posibles —rechazo, archivo y borrado
 * real— y, sobre todo, que archivar no corte ningún vínculo del histórico.
 */
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { MovementsService } from '../src/modules/movements/movements.service';
import { DocumentSequenceService } from '../src/modules/movements/document-sequence.service';
import { PilasService } from '../src/modules/pilas/pilas.service';
import { LotsService } from '../src/modules/lots/lots.service';
import { Product } from '../src/modules/products/entities/product.entity';
import { Lot, LOT_STATUS_ARCHIVED } from '../src/modules/lots/entities/lot.entity';
import { Pallet } from '../src/modules/pallets/entities/pallet.entity';
import { Movement } from '../src/modules/movements/entities/movement.entity';
import { MovementDetail } from '../src/modules/movements/entities/movement-detail.entity';
import type { EventsGateway } from '../src/modules/events/events.gateway';
import type { CacheService } from '../src/modules/cache/cache.service';
import type { UploadsService } from '../src/modules/uploads/uploads.service';
import { createAccessService, createTestDataSource, resetDb, seedBasics, type Basics } from './test-datasource';
import type { WarehouseAccessService } from '../src/modules/warehouses/warehouse-access.service';

const USER_ID = '00000000-0000-0000-0000-0000000000aa';

const noopEvents = { emitMovementCreated() {}, emitStockUpdated() {} } as unknown as EventsGateway;
const noopCache = { delPattern: async () => {} } as unknown as CacheService;
const noopUploads = { log: async () => {} } as unknown as UploadsService;

let ds: DataSource;
let movements: MovementsService;
let lots: LotsService;
let access: WarehouseAccessService;
let base: Basics;

const lotByCode = (lotCode: string) =>
  ds.getRepository(Lot).findOne({ where: { productId: base.product.id, lotCode } });

/** Entrada de `quantity` en un lote nuevo. Deja lote + palet + stock creados. */
async function entrada(lotCode: string, quantity: number) {
  await movements.create(
    {
      type: 'ENTRY',
      productId: base.product.id,
      warehouseId: base.warehouse.id,
      locationId: base.location.id,
      palletItems: [{ lotCode, quantity, fechaVencimiento: '2027-06-01' }],
    },
    USER_ID,
  );
  return (await lotByCode(lotCode))!;
}

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  access = createAccessService(ds);
  movements = new MovementsService(
    ds, noopEvents, noopCache, new DocumentSequenceService(), noopUploads, new PilasService(), access,
  );
  lots = new LotsService(ds.getRepository(Lot), ds.getRepository(Product), ds.getRepository(Pallet));
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
  base = await seedBasics(ds);
});

describe('baja de lote — lote sin usar', () => {
  it('un lote recién creado y sin movimientos se elimina de verdad', async () => {
    const creado = await lots.create({ productId: base.product.id, lotCode: 'L-SIN-USO' });

    const res = await lots.remove(creado.id);

    expect(res).toMatchObject({ deleted: true, deactivated: false });
    expect(await lotByCode('L-SIN-USO')).toBeNull();
  });
});

describe('baja de lote — con stock vivo se rechaza', () => {
  it('rechaza un lote con mercadería y no lo toca', async () => {
    const lote = await entrada('L-CON-STOCK', 100);

    await expect(lots.remove(lote.id)).rejects.toBeInstanceOf(BadRequestException);

    const despues = await lotByCode('L-CON-STOCK');
    expect(despues).not.toBeNull();
    expect(despues!.status).toBe('NORMAL');
    expect(despues!.stockActual).toBe(100);
  });

  it('el mensaje dice cuánto hay y en cuántos palets, para que se pueda actuar', async () => {
    const lote = await entrada('L-MENSAJE', 250.5);

    await expect(lots.remove(lote.id)).rejects.toThrow(/250,5/);
    await expect(lots.remove(lote.id)).rejects.toThrow(/palet/i);
  });

  it('rechaza aunque stockActual haya quedado en 0 pero los palets tengan mercadería', async () => {
    // La divergencia entre el contador del lote y sus palets es justo lo que
    // `reconcileStock` existe para arreglar (ver RL-A-09). Mientras exista, el
    // borrado tiene que mirar las dos vías y no fiarse sólo del contador.
    const lote = await entrada('L-DIVERGENTE', 80);
    await ds.getRepository(Lot).update(lote.id, { stockActual: 0 });

    await expect(lots.remove(lote.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(await lotByCode('L-DIVERGENTE')).not.toBeNull();
  });
});

describe('baja de lote — con historia se archiva', () => {
  /** Entra y despacha todo: el lote queda en cero pero con historia. */
  async function loteDespachado(lotCode: string, quantity: number) {
    const lote = await entrada(lotCode, quantity);
    const pallet = (await ds.getRepository(Pallet).findOne({ where: { lotId: lote.id } }))!;
    await movements.create(
      {
        type: 'EXIT',
        productId: base.product.id,
        warehouseId: base.warehouse.id,
        locationId: base.location.id,
        palletItems: [{ palletId: pallet.id, quantity }],
      },
      USER_ID,
    );
    return (await lotByCode(lotCode))!;
  }

  it('archiva en lugar de borrar y explica por qué', async () => {
    const lote = await loteDespachado('L-DESPACHADO', 100);

    const res = await lots.remove(lote.id);

    expect(res).toMatchObject({ deleted: true, deactivated: true, id: lote.id });
    expect(res.reason).toMatch(/trazabilidad/i);
  });

  it('el lote sigue existiendo, marcado como ARCHIVED', async () => {
    const lote = await loteDespachado('L-ARCHIVA', 100);

    await lots.remove(lote.id);

    const despues = await lotByCode('L-ARCHIVA');
    expect(despues).not.toBeNull();
    expect(despues!.status).toBe(LOT_STATUS_ARCHIVED);
  });

  it('no corta ningún vínculo del histórico — el punto de todo esto', async () => {
    const lote = await loteDespachado('L-VINCULOS', 100);

    await lots.remove(lote.id);

    // Sin FK, si el lote se borrara estas filas quedarían apuntando al vacío.
    const [movs, dets, pals] = await Promise.all([
      ds.getRepository(Movement).count({ where: { lotId: lote.id } }),
      ds.getRepository(MovementDetail).count({ where: { lotId: lote.id } }),
      ds.getRepository(Pallet).count({ where: { lotId: lote.id } }),
    ]);
    expect(pals).toBeGreaterThan(0);
    expect(movs + dets).toBeGreaterThan(0);

    // Y cada una sigue resolviendo contra un lote que existe.
    const huerfanos = await ds.query(
      `SELECT COUNT(*)::int AS n FROM pallets p
        WHERE p."lotId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM lots l WHERE l.id = p."lotId")`,
    );
    expect(huerfanos[0].n).toBe(0);
  });

  it('un lote archivado no vuelve por FEFO', async () => {
    // Ojo con el mecanismo: FEFO no filtra por estado sino por stock
    // (`lot.stockActual > 0`), y archivar exige stock cero. O sea que el lote
    // queda fuera por construcción, no porque se lo excluya por ARCHIVED. Vale
    // igual como guarda de regresión: fija el comportamiento observable por si
    // alguien cambia el criterio de FEFO o el de archivado.
    const lote = await loteDespachado('L-FEFO-VIEJO', 100);
    await lots.remove(lote.id);
    await entrada('L-FEFO-NUEVO', 50);

    const fefo = await lots.findFefo(base.product.id);

    expect(fefo.map((l) => l.lotCode)).toEqual(['L-FEFO-NUEVO']);
  });
});
