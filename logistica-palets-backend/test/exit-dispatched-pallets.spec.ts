import { DataSource } from 'typeorm';
import { MovementsService } from '../src/modules/movements/movements.service';
import { DocumentSequenceService } from '../src/modules/movements/document-sequence.service';
import { PilasService } from '../src/modules/pilas/pilas.service';
import { Lot } from '../src/modules/lots/entities/lot.entity';
import { Pallet } from '../src/modules/pallets/entities/pallet.entity';
import { Stock } from '../src/modules/stocks/entities/stock.entity';
import { MovementDetail } from '../src/modules/movements/entities/movement-detail.entity';
import { RegularizationLog } from '../src/modules/movements/entities/regularization-log.entity';
import type { EventsGateway } from '../src/modules/events/events.gateway';
import type { CacheService } from '../src/modules/cache/cache.service';
import type { UploadsService } from '../src/modules/uploads/uploads.service';
import {
  createTestDataSource,
  resetDb,
  seedBasics,
  TEST_USER_ID,
  type Basics,
  createAccessService,
} from './test-datasource';

const noopEvents = { emitMovementCreated() {}, emitStockUpdated() {} } as unknown as EventsGateway;
const noopCache = { delPattern: async () => {} } as unknown as CacheService;
const noopUploads = { log: async () => {} } as unknown as UploadsService;

let ds: DataSource;
let service: MovementsService;
let base: Basics;

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  service = new MovementsService(
    ds,
    noopEvents,
    noopCache,
    new DocumentSequenceService(),
    noopUploads,
    new PilasService(),
    createAccessService(ds),
  );
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
  base = await seedBasics(ds);
});

/** Entrada que deja `quantities.length` palets del mismo lote, listos para despachar. */
async function stockPallets(quantities: number[], lotCode = 'LOTE-SALIDA') {
  await service.createDocument(
    {
      type: 'ENTRY',
      warehouseId: base.warehouse.id,
      lines: [{
        productId: base.product.id,
        palletItems: quantities.map((quantity) => ({
          lotCode,
          quantity,
          fechaVencimiento: '2027-12-31',
          locationId: base.location.id,
        })),
      }],
    },
    TEST_USER_ID,
  );
  return ds.getRepository(Pallet).find({ order: { code: 'ASC' } });
}

/** Salida por selección explícita de palets, como la arma el formulario. */
async function exitPallets(items: { palletId: string; quantity: number; dispatchedPallets?: number }[]) {
  return service.createDocument(
    { type: 'EXIT', lines: [{ productId: base.product.id, palletItems: items }] },
    TEST_USER_ID,
  );
}

const lotByCode = (lotCode: string) => ds.getRepository(Lot).findOneByOrFail({ lotCode });

const detailsOf = (movementId: string) =>
  ds.getRepository(MovementDetail).find({ where: { movementId }, order: { quantity: 'DESC' } });

const stockTotal = async () =>
  (await ds.getRepository(Stock).find()).reduce((sum, row) => sum + row.currentQuantity, 0);

describe('paletas físicas despachadas en la Salida', () => {
  it('sin informar nada, la salida se comporta exactamente como hasta ahora', async () => {
    const [p1, p2] = await stockPallets([100, 100]);

    const exit = await exitPallets([
      { palletId: p1.id, quantity: 100 },
      { palletId: p2.id, quantity: 40 },
    ]);

    const details = await detailsOf(exit.movementIds[0]);
    expect(details.map((d) => d.dispatchedPallets)).toEqual([null, null]);

    // Descuento de stock, lote y palets: el de siempre.
    expect(await stockTotal()).toBe(60);
    expect((await ds.getRepository(Lot).findOneByOrFail({ lotCode: 'LOTE-SALIDA' })).stockActual).toBe(60);
    expect((await ds.getRepository(Pallet).findOneByOrFail({ id: p1.id })).status).toBe('EXITED');
    const partial = await ds.getRepository(Pallet).findOneByOrFail({ id: p2.id });
    expect(partial.status).toBe('PARTIAL');
    expect(partial.quantity).toBe(60);
  });

  it('informar las paletas resultantes no cambia el descuento de stock, lotes ni palets', async () => {
    const [p1, p2] = await stockPallets([100, 100]);

    const exit = await exitPallets([
      { palletId: p1.id, quantity: 100, dispatchedPallets: 2 },
      { palletId: p2.id, quantity: 40, dispatchedPallets: 1 },
    ]);

    // Mismos números que el caso anterior, con las mismas cantidades.
    expect(await stockTotal()).toBe(60);
    expect((await ds.getRepository(Lot).findOneByOrFail({ lotCode: 'LOTE-SALIDA' })).stockActual).toBe(60);
    expect((await ds.getRepository(Pallet).findOneByOrFail({ id: p1.id })).status).toBe('EXITED');
    const partial = await ds.getRepository(Pallet).findOneByOrFail({ id: p2.id });
    expect(partial.status).toBe('PARTIAL');
    expect(partial.quantity).toBe(60);
    // No se crean ni se tocan palets por informar el dato.
    expect(await ds.getRepository(Pallet).count()).toBe(2);

    const details = await detailsOf(exit.movementIds[0]);
    expect(details.map((d) => [d.quantity, d.dispatchedPallets])).toEqual([[100, 2], [40, 1]]);
  });

  it('acepta 0 para el palet cuyo contenido se consolidó en otro', async () => {
    const [p1, p2] = await stockPallets([50, 50]);

    const exit = await exitPallets([
      { palletId: p1.id, quantity: 50, dispatchedPallets: 1 },
      { palletId: p2.id, quantity: 50, dispatchedPallets: 0 },
    ]);

    const details = await detailsOf(exit.movementIds[0]);
    expect(details.map((d) => d.dispatchedPallets).sort()).toEqual([0, 1]);
    expect(await stockTotal()).toBe(0);
  });

  it('se puede informar solo en algunos palets de la misma salida', async () => {
    const [p1, p2] = await stockPallets([70, 70]);

    const exit = await exitPallets([
      { palletId: p1.id, quantity: 70, dispatchedPallets: 3 },
      { palletId: p2.id, quantity: 70 },
    ]);

    const details = await detailsOf(exit.movementIds[0]);
    expect(details.map((d) => d.dispatchedPallets)).toEqual([3, null]);
  });

  it('el dato viaja a la nota de salida junto al palet de origen', async () => {
    const [p1] = await stockPallets([80]);
    const exit = await exitPallets([{ palletId: p1.id, quantity: 80, dispatchedPallets: 4 }]);

    const print = await service.findDocumentForPrint(exit.documentId);

    expect(print.document.code).toBe('RLNS-01-000001');
    expect(print.details).toHaveLength(1);
    expect(print.details[0]).toMatchObject({ palletId: p1.id, quantity: 80, dispatchedPallets: 4 });
  });

  it('una salida vieja imprime sin el dato, sin romper la nota', async () => {
    const [p1] = await stockPallets([25]);
    const exit = await exitPallets([{ palletId: p1.id, quantity: 25 }]);

    const print = await service.findDocumentForPrint(exit.documentId);
    expect(print.details[0].dispatchedPallets).toBeNull();
  });

  it('en una Entrada el dato se ignora: es un concepto de despacho', async () => {
    const created = await service.createDocument(
      {
        type: 'ENTRY',
        warehouseId: base.warehouse.id,
        lines: [{
          productId: base.product.id,
          palletItems: [{
            lotCode: 'ENTRADA-1',
            quantity: 30,
            fechaVencimiento: '2027-12-31',
            locationId: base.location.id,
            dispatchedPallets: 5,
          }],
        }],
      },
      TEST_USER_ID,
    );

    const details = await detailsOf(created.movementIds[0]);
    expect(details[0].dispatchedPallets).toBeNull();
  });

  it('la salida multi-producto conserva el dato de cada línea por separado', async () => {
    const [p1, p2] = await stockPallets([90, 90]);

    const exit = await service.createDocument(
      {
        type: 'EXIT',
        lines: [
          { productId: base.product.id, palletItems: [{ palletId: p1.id, quantity: 90, dispatchedPallets: 2 }] },
          { productId: base.product.id, palletItems: [{ palletId: p2.id, quantity: 90 }] },
        ],
      },
      TEST_USER_ID,
    );

    const [first, second] = await Promise.all(exit.movementIds.map((id) => detailsOf(id)));
    expect(first[0].dispatchedPallets).toBe(2);
    expect(second[0].dispatchedPallets).toBeNull();
    expect(await stockTotal()).toBe(0);
  });
});

describe('corregir las paletas físicas despachadas', () => {
  const logsOf = (movementId: string) =>
    ds.getRepository(RegularizationLog).find({ where: { movementId } });

  it('corrige el valor sin tocar stock, lote ni palet', async () => {
    const [p1] = await stockPallets([100]);
    const exit = await exitPallets([{ palletId: p1.id, quantity: 40, dispatchedPallets: 2 }]);
    const movementId = exit.movementIds[0];
    const lot = await ds.getRepository(Lot).findOneByOrFail({ lotCode: 'LOTE-SALIDA' });

    const result = await service.requestQuantityEdit(
      movementId,
      {
        reason: 'La carga se armó en 3 paletas, no en 2',
        lots: [{ lotId: lot.id, palletEdits: [{ palletId: p1.id, newQuantity: 40, dispatchedPallets: 3 }] }],
      },
      TEST_USER_ID,
    );

    expect(result.dispatchedChanges).toBe(1);
    // Se aplica directo: no genera solicitud de aprobación.
    expect(result.requests).toEqual([]);
    expect((await detailsOf(movementId))[0].dispatchedPallets).toBe(3);

    // Nada del inventario se movió por corregir un dato descriptivo.
    expect(await stockTotal()).toBe(60);
    expect((await ds.getRepository(Lot).findOneByOrFail({ id: lot.id })).stockActual).toBe(60);
    expect((await ds.getRepository(Pallet).findOneByOrFail({ id: p1.id })).quantity).toBe(60);

    const [log] = await logsOf(movementId);
    expect(log).toMatchObject({
      field: `pallet.${p1.code}.dispatchedPallets`,
      oldValue: '2',
      newValue: '3',
      reason: 'La carga se armó en 3 paletas, no en 2',
    });
  });

  it('permite borrar el dato informado por error', async () => {
    const [p1] = await stockPallets([100]);
    const exit = await exitPallets([{ palletId: p1.id, quantity: 100, dispatchedPallets: 5 }]);
    const movementId = exit.movementIds[0];
    const lot = await ds.getRepository(Lot).findOneByOrFail({ lotCode: 'LOTE-SALIDA' });

    const result = await service.requestQuantityEdit(
      movementId,
      {
        reason: 'Se había cargado por error',
        lots: [{ lotId: lot.id, palletEdits: [{ palletId: p1.id, newQuantity: 100, dispatchedPallets: null }] }],
      },
      TEST_USER_ID,
    );

    expect(result.dispatchedChanges).toBe(1);
    expect((await detailsOf(movementId))[0].dispatchedPallets).toBeNull();
    expect((await logsOf(movementId))[0]).toMatchObject({ oldValue: '5', newValue: null });
  });

  it('carga el dato en una salida que no lo tenía', async () => {
    const [p1] = await stockPallets([100]);
    const exit = await exitPallets([{ palletId: p1.id, quantity: 100 }]);
    const movementId = exit.movementIds[0];
    const lot = await ds.getRepository(Lot).findOneByOrFail({ lotCode: 'LOTE-SALIDA' });

    await service.requestQuantityEdit(
      movementId,
      {
        reason: 'Registro de cómo salió la carga',
        lots: [{ lotId: lot.id, palletEdits: [{ palletId: p1.id, newQuantity: 100, dispatchedPallets: 4 }] }],
      },
      TEST_USER_ID,
    );

    expect((await detailsOf(movementId))[0].dispatchedPallets).toBe(4);
    expect((await logsOf(movementId))[0]).toMatchObject({ oldValue: null, newValue: '4' });
  });

  it('corregir la cantidad sin tocar el campo no pisa el valor informado', async () => {
    const [p1] = await stockPallets([100]);
    const exit = await exitPallets([{ palletId: p1.id, quantity: 40, dispatchedPallets: 2 }]);
    const movementId = exit.movementIds[0];
    const lot = await ds.getRepository(Lot).findOneByOrFail({ lotCode: 'LOTE-SALIDA' });

    const result = await service.requestQuantityEdit(
      movementId,
      { reason: 'Salieron 30, no 40', lots: [{ lotId: lot.id, palletEdits: [{ palletId: p1.id, newQuantity: 30 }] }] },
      TEST_USER_ID,
    );

    expect(result.dispatchedChanges).toBe(0);
    // La diferencia de cantidad sí va a aprobación, como siempre.
    expect(result.requests).toHaveLength(1);
    expect((await detailsOf(movementId))[0].dispatchedPallets).toBe(2);
  });

  it('el breakdown del editor devuelve el valor actual para precargarlo', async () => {
    const [p1, p2] = await stockPallets([60, 60]);
    const exit = await exitPallets([
      { palletId: p1.id, quantity: 60, dispatchedPallets: 2 },
      { palletId: p2.id, quantity: 60 },
    ]);

    const breakdown = await service.getLotsBreakdown(exit.movementIds[0]);
    const byId = new Map(breakdown.lots[0].pallets.map((p) => [p.id, p.dispatchedPallets]));

    expect(byId.get(p1.id)).toBe(2);
    expect(byId.get(p2.id)).toBeNull();
  });

  it('en una Entrada avisa e ignora el campo, sin cortar la corrección', async () => {
    const created = await service.createDocument(
      {
        type: 'ENTRY',
        warehouseId: base.warehouse.id,
        lines: [{
          productId: base.product.id,
          palletItems: [{ lotCode: 'ENT-CORR', quantity: 50, fechaVencimiento: '2027-12-31', locationId: base.location.id }],
        }],
      },
      TEST_USER_ID,
    );
    const movementId = created.movementIds[0];
    const lot = await lotByCode('ENT-CORR');
    const pallet = await ds.getRepository(Pallet).findOneByOrFail({ lotId: lot.id });

    const result = await service.requestQuantityEdit(
      movementId,
      {
        reason: 'Corrección de cantidad',
        lots: [{ lotId: lot.id, palletEdits: [{ palletId: pallet.id, newQuantity: 40, dispatchedPallets: 3 }] }],
      },
      TEST_USER_ID,
    );

    expect(result.dispatchedChanges).toBe(0);
    expect(result.warnings).toEqual([
      `El palet ${pallet.code} no es de una salida: las paletas físicas despachadas no se modificaron.`,
    ]);
    // La corrección de cantidad sí siguió su curso.
    expect(result.requests).toHaveLength(1);
    expect((await detailsOf(movementId))[0].dispatchedPallets).toBeNull();
  });
});
