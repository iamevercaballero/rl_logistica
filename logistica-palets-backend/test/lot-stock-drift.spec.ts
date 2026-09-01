/**
 * El contador del lote no se recorta en silencio (RL-A-09).
 *
 * `updateLotStock` hacía `Math.max(0, lot.stockActual + delta)`: si una resta
 * dejaba el lote en negativo, el valor se recortaba a cero y la operación seguía
 * como si nada. Eso enterraba justamente el dato que hacía falta — que el
 * contador y los pallets ya no coinciden— y la divergencia reaparecía mucho
 * después como una diferencia de inventario sin explicación.
 *
 * Es lo contrario de lo que hace `applyDecrease` con el stock de la celda, que
 * corta con «Stock insuficiente». Ahora los dos se comportan igual.
 */
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { MovementsService } from '../src/modules/movements/movements.service';
import { DocumentSequenceService } from '../src/modules/movements/document-sequence.service';
import { PilasService } from '../src/modules/pilas/pilas.service';
import { LotsService } from '../src/modules/lots/lots.service';
import { Product } from '../src/modules/products/entities/product.entity';
import { Lot } from '../src/modules/lots/entities/lot.entity';
import { Pallet } from '../src/modules/pallets/entities/pallet.entity';
import { Movement } from '../src/modules/movements/entities/movement.entity';
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

/** Despacha `quantity` del pallet indicado. */
function salida(pallet: Pallet, quantity: number) {
  return movements.create(
    {
      type: 'EXIT',
      productId: base.product.id,
      warehouseId: base.warehouse.id,
      locationId: base.location.id,
      palletItems: [{ palletId: pallet.id, quantity }],
    },
    USER_ID,
  );
}

const palletDe = (lote: Lot) =>
  ds.getRepository(Pallet).findOneOrFail({ where: { lotId: lote.id } });

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

describe('operación normal', () => {
  it('una salida descuenta el lote sin problema', async () => {
    const lote = await entrada('L-OK', 100);
    await salida(await palletDe(lote), 40);

    expect((await lotByCode('L-OK'))!.stockActual).toBe(60);
  });

  it('vaciar el lote exacto lo deja en cero, no falla', async () => {
    const lote = await entrada('L-EXACTO', 100);
    await salida(await palletDe(lote), 100);

    expect((await lotByCode('L-EXACTO'))!.stockActual).toBe(0);
  });

  it('funciona con decimales sin arrastrar residuo', async () => {
    const lote = await entrada('L-DEC', 275.65);
    await salida(await palletDe(lote), 75.65);

    expect((await lotByCode('L-DEC'))!.stockActual).toBe(200);
  });
});

describe('contador desfasado: corta en vez de recortar a cero', () => {
  /** Reproduce el desvío que el recorte silencioso venía escondiendo. */
  async function conDesvio(lotCode: string, real: number, contador: number) {
    const lote = await entrada(lotCode, real);
    await ds.getRepository(Lot).update(lote.id, { stockActual: contador });
    return lote;
  }

  it('rechaza la salida en vez de dejar el lote en cero', async () => {
    const lote = await conDesvio('L-DESFASADO', 100, 10);

    await expect(salida(await palletDe(lote), 100)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el mensaje nombra el lote y cuánto hay, para poder actuar', async () => {
    const lote = await conDesvio('L-MENSAJE', 100, 10);
    const pallet = await palletDe(lote);

    await expect(salida(pallet, 100)).rejects.toThrow(/L-MENSAJE/);
    await expect(salida(pallet, 100)).rejects.toThrow(/reconcil/i);
  });

  it('revierte la transacción entera: no queda movimiento ni pallet tocado', async () => {
    const lote = await conDesvio('L-REVIERTE', 100, 10);
    const pallet = await palletDe(lote);

    await expect(salida(pallet, 100)).rejects.toThrow();

    // El lote sigue con el contador desfasado — no se recortó a cero.
    expect((await lotByCode('L-REVIERTE'))!.stockActual).toBe(10);
    // Y el pallet conserva su mercadería: la salida no ocurrió a medias.
    expect((await palletDe(lote)).quantity).toBe(100);
    expect(await ds.getRepository(Movement).count({ where: { type: 'EXIT' } })).toBe(0);
  });

  it('tras reconciliar, la misma salida pasa', async () => {
    const lote = await conDesvio('L-RECONCILIA', 100, 10);

    const r = await lots.reconcileStock(lote.id);
    expect(r.previous).toBe(10);
    expect(r.reconciled).toBe(100);

    await salida(await palletDe(lote), 100);
    expect((await lotByCode('L-RECONCILIA'))!.stockActual).toBe(0);
  });
});

describe('reconciliación: no inventa correcciones por residuo de coma flotante', () => {
  it('un lote alineado no se reporta como corregido', async () => {
    const lote = await entrada('L-ALINEADO', 275.65);

    const r = await lots.reconcileStock(lote.id);

    expect(r.delta).toBe(0);
    expect(r.previous).toBe(r.reconciled);
  });

  it('reconcile-all no lista lotes sin diferencia real', async () => {
    await entrada('L-A', 100);
    await entrada('L-B', 238.45);

    const r = await lots.reconcileAllStocks();

    expect(r.corrected).toBe(0);
    expect(r.corrections).toEqual([]);
  });

  it('sí lista y corrige un desvío real', async () => {
    const lote = await entrada('L-REAL', 100);
    await ds.getRepository(Lot).update(lote.id, { stockActual: 40 });

    const r = await lots.reconcileAllStocks();

    expect(r.corrected).toBe(1);
    expect(r.corrections[0]).toMatchObject({ lotCode: 'L-REAL', previous: 40, reconciled: 100, delta: 60 });
  });
});
