/**
 * Tests de integración del motor de stock contra un PostgreSQL real.
 *
 * Requiere la base de docker-compose.test.yml levantada:
 *   docker compose -f docker-compose.test.yml --env-file .env.test up -d db-test
 *   npm test
 *
 * Cubren: entrada, salida FEFO, ajuste, anulación, el invariante de inventario
 * y — lo más importante — el caso de carrera concurrente que valida los locks
 * pesimistas (dos salidas simultáneas no deben sobre-vender).
 */
import { DataSource } from 'typeorm';
import { MovementsService } from '../src/modules/movements/movements.service';
import { DocumentSequenceService } from '../src/modules/movements/document-sequence.service';
import { ReportsService } from '../src/modules/reports/reports.service';
import { Stock } from '../src/modules/stocks/entities/stock.entity';
import { Lot } from '../src/modules/lots/entities/lot.entity';
import { Pallet } from '../src/modules/pallets/entities/pallet.entity';
import { Movement } from '../src/modules/movements/entities/movement.entity';
import { AdjustmentRequest } from '../src/modules/adjustments/entities/adjustment-request.entity';
import { SapStockSnapshot } from '../src/modules/reports/entities/sap-stock.entity';
import type { EventsGateway } from '../src/modules/events/events.gateway';
import type { CacheService } from '../src/modules/cache/cache.service';
import type { UploadsService } from '../src/modules/uploads/uploads.service';
import { createTestDataSource, resetDb, seedBasics, type Basics } from './test-datasource';

const USER_ID = '00000000-0000-0000-0000-0000000000aa';

// Dobles no-op para las dependencias de side-effect (websocket, caché, bitácora).
const noopEvents = { emitMovementCreated() {}, emitStockUpdated() {} } as unknown as EventsGateway;
const noopCache = { delPattern: async () => {} } as unknown as CacheService;
const noopUploads = { log: async () => {} } as unknown as UploadsService;

let ds: DataSource;
let service: MovementsService;
let reports: ReportsService;
let base: Basics;

const stockOf = (productId: string) =>
  ds.getRepository(Stock).findOne({ where: { productId } });
const lotByCode = (productId: string, lotCode: string) =>
  ds.getRepository(Lot).findOne({ where: { productId, lotCode } });

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  // Replica el índice único de la migración 700 (synchronize no crea índices de
  // expresión). Necesario para el test de "no duplicar filas de stock".
  const NIL = `'00000000-0000-0000-0000-000000000000'::uuid`;
  await ds.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS "uq_stock_cell" ON stocks ` +
    `("productId", COALESCE("warehouseId", ${NIL}), COALESCE("locationId", ${NIL}))`,
  );
  service = new MovementsService(ds, noopEvents, noopCache, new DocumentSequenceService(), noopUploads);
  reports = new ReportsService(ds, ds.getRepository(SapStockSnapshot), noopCache);
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
  base = await seedBasics(ds);
});

describe('motor de stock — flujo básico', () => {
  it('una ENTRADA crea stock, lote y palet con la cantidad correcta', async () => {
    await service.create({
      type: 'ENTRY',
      productId: base.product.id,
      warehouseId: base.warehouse.id,
      locationId: base.location.id,
      palletItems: [{ lotCode: 'L-A', quantity: 100, fechaVencimiento: '2026-06-01' }],
    }, USER_ID);

    const stock = await stockOf(base.product.id);
    const lot = await lotByCode(base.product.id, 'L-A');
    const pallets = await ds.getRepository(Pallet).find({ where: { lotId: lot!.id } });

    expect(stock!.currentQuantity).toBe(100);
    expect(lot!.stockActual).toBe(100);
    expect(pallets).toHaveLength(1);
    expect(pallets[0].quantity).toBe(100);
  });

  it('una SALIDA bulk consume primero el lote de menor vencimiento (FEFO)', async () => {
    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems: [{ lotCode: 'L-EARLY', quantity: 50, fechaVencimiento: '2026-06-01' }],
    }, USER_ID);
    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems: [{ lotCode: 'L-LATE', quantity: 50, fechaVencimiento: '2026-12-01' }],
    }, USER_ID);

    await service.create({ type: 'EXIT', productId: base.product.id, quantity: 30 }, USER_ID);

    const early = await lotByCode(base.product.id, 'L-EARLY');
    const late = await lotByCode(base.product.id, 'L-LATE');
    expect(early!.stockActual).toBe(20); // 50 - 30
    expect(late!.stockActual).toBe(50);  // intacto
  });

  it('un AJUSTE de entrada (con lote) incrementa los tres contadores', async () => {
    await service.create({
      type: 'ADJUSTMENT_IN',
      productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      adjustmentReason: 'CONTEO_FISICO',
      palletItems: [{ lotCode: 'L-ADJ', quantity: 40, fechaVencimiento: '2026-06-01' }],
    }, USER_ID);

    const stock = await stockOf(base.product.id);
    const lot = await lotByCode(base.product.id, 'L-ADJ');
    const pallets = await ds.getRepository(Pallet).find({ where: { lotId: lot!.id } });
    expect(stock!.currentQuantity).toBe(40);
    expect(lot!.stockActual).toBe(40);
    expect(pallets.reduce((s, p) => s + p.quantity, 0)).toBe(40);
  });

  it('solicitar ANULACIÓN de una entrada genera un ajuste pendiente y marca VOID_PENDING', async () => {
    const entry = await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems: [{ lotCode: 'L-VOID', quantity: 100, fechaVencimiento: '2026-06-01' }],
    }, USER_ID);

    const res = await service.requestVoid(entry.movementId, USER_ID);

    expect(res.code).toMatch(/^RLAO-/); // ENTRADA → ajuste de salida compensatorio
    const movement = await ds.getRepository(Movement).findOne({ where: { id: entry.movementId } });
    expect(movement!.voidStatus).toBe('VOID_PENDING');
    const req = await ds.getRepository(AdjustmentRequest).findOne({ where: { id: res.requestId } });
    expect(req!.status).toBe('PENDIENTE_APROBACION');

    // El stock NO cambia hasta aprobar.
    const stock = await stockOf(base.product.id);
    expect(stock!.currentQuantity).toBe(100);
  });

  it('el invariante Stock = Lote = Pallet se mantiene tras entrada + salida', async () => {
    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems: [{ lotCode: 'L-INV', quantity: 100, fechaVencimiento: '2026-06-01' }],
    }, USER_ID);
    await service.create({ type: 'EXIT', productId: base.product.id, quantity: 30 }, USER_ID);

    const health = await reports.inventoryHealth();
    expect(health.ok).toBe(true);
    expect(health.divergentCount).toBe(0);
  });
});

describe('motor de stock — concurrencia', () => {
  it('dos SALIDAS simultáneas no sobre-venden (locks pesimistas)', async () => {
    // Stock 100 en un único palet.
    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems: [{ lotCode: 'L-RACE', quantity: 100, fechaVencimiento: '2026-06-01' }],
    }, USER_ID);

    // Dos salidas de 60 en paralelo (120 > 100). El lock pesimista las serializa.
    // EXIT es todo-o-nada: una orden despacha 60 completos; la otra NO puede
    // cumplir 60 con los 40 restantes y se RECHAZA entera (rollback). Nunca se
    // sobre-vende: total despachado = 60, quedan 40.
    const results = await Promise.allSettled([
      service.create({ type: 'EXIT', productId: base.product.id, quantity: 60 }, USER_ID),
      service.create({ type: 'EXIT', productId: base.product.id, quantity: 60 }, USER_ID),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected').length;
    const stock = await stockOf(base.product.id);
    const pallet = await ds.getRepository(Pallet).findOne({
      where: { lotId: (await lotByCode(base.product.id, 'L-RACE'))!.id },
    });

    // Invariante de seguridad: nunca negativo, nunca sobre-vendido.
    expect(stock!.currentQuantity).toBeGreaterThanOrEqual(0);
    // Exactamente una orden se cumple y la otra se rechaza.
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);
    // Se despacharon 60 (la orden cumplida); la rechazada no tocó el stock.
    expect(stock!.currentQuantity).toBe(40);
    expect(pallet!.quantity).toBe(40);
  });

  it('auto-FEFO despacha desde pallets PARTIAL (ya abiertos)', async () => {
    // Entrada de 100 en un pallet; una salida parcial lo deja PARTIAL.
    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems: [{ lotCode: 'L-PART', quantity: 100, fechaVencimiento: '2026-06-01' }],
    }, USER_ID);

    await service.create({ type: 'EXIT', productId: base.product.id, quantity: 30 }, USER_ID); // pallet → PARTIAL 70
    // La 2ª salida auto-FEFO debe consumir del pallet ya abierto (no fallar).
    await service.create({ type: 'EXIT', productId: base.product.id, quantity: 50 }, USER_ID); // PARTIAL 70 → 20

    const stock = await stockOf(base.product.id);
    expect(stock!.currentQuantity).toBe(20);
  });

  it('no crea filas de stock duplicadas para la misma celda bajo concurrencia', async () => {
    // Dos entradas simultáneas del mismo producto/celda (celda nueva).
    await Promise.allSettled([
      service.create({
        type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
        palletItems: [{ lotCode: 'L-D1', quantity: 10, fechaVencimiento: '2026-06-01' }],
      }, USER_ID),
      service.create({
        type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
        palletItems: [{ lotCode: 'L-D2', quantity: 10, fechaVencimiento: '2026-06-01' }],
      }, USER_ID),
    ]);

    const rows = await ds.getRepository(Stock).find({
      where: { productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id },
    });
    // Una sola fila de stock para la celda (sin el índice único podría haber 2).
    expect(rows.length).toBeLessThanOrEqual(1);
  });
});

describe('motor de stock — corrección de salidas (Corregir Movimiento)', () => {
  it('un ADJUSTMENT_IN a un pallet ya EXITED le restaura la cantidad y lo vuelve PARTIAL', async () => {
    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems: [{ lotCode: 'L-RESTORE', quantity: 100, fechaVencimiento: '2026-06-01' }],
    }, USER_ID);
    const lot = await lotByCode(base.product.id, 'L-RESTORE');
    const pallet = await ds.getRepository(Pallet).findOne({ where: { lotId: lot!.id } });

    // Salida completa del pallet → queda EXITED, cantidad 0.
    await service.create({
      type: 'EXIT', productId: base.product.id,
      palletItems: [{ palletId: pallet!.id, quantity: 100 }],
    }, USER_ID);

    let refreshed = await ds.getRepository(Pallet).findOne({ where: { id: pallet!.id } });
    expect(refreshed!.status).toBe('EXITED');
    expect(refreshed!.quantity).toBe(0);

    // Corrección: en realidad solo salieron 60 → devolver 40 al pallet ya despachado.
    await service.create({
      type: 'ADJUSTMENT_IN', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      adjustmentReason: 'DIFERENCIA_INVENTARIO',
      palletItems: [{ palletId: pallet!.id, quantity: 40 }],
    }, USER_ID);

    refreshed = await ds.getRepository(Pallet).findOne({ where: { id: pallet!.id } });
    const stock = await stockOf(base.product.id);
    expect(refreshed!.status).toBe('PARTIAL');
    expect(refreshed!.quantity).toBe(40);
    expect(stock!.currentQuantity).toBe(40); // 100 entrada − 100 salida + 40 restaurado
  });

  it('requestQuantityEdit sobre una SALIDA: reducir lo despachado genera un RLAI pendiente sin tocar stock', async () => {
    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems: [{ lotCode: 'L-EDITEXIT1', quantity: 100, fechaVencimiento: '2026-06-01' }],
    }, USER_ID);
    const lot = await lotByCode(base.product.id, 'L-EDITEXIT1');
    const pallet = await ds.getRepository(Pallet).findOne({ where: { lotId: lot!.id } });

    const exit = await service.create({
      type: 'EXIT', productId: base.product.id,
      palletItems: [{ palletId: pallet!.id, quantity: 100 }],
    }, USER_ID);

    const res = await service.requestQuantityEdit(exit.movementId, {
      reason: 'Se despachó menos de lo registrado',
      lots: [{ lotId: lot!.id, palletEdits: [{ palletId: pallet!.id, newQuantity: 60 }] }],
    }, USER_ID);

    expect(res.requests).toHaveLength(1);
    expect(res.requests[0].code).toMatch(/^RLAI-/);
    expect(res.requests[0].totalQuantity).toBe(40);
    const req = await ds.getRepository(AdjustmentRequest).findOne({ where: { id: res.requests[0].requestId } });
    expect(req!.status).toBe('PENDIENTE_APROBACION');

    // El stock NO cambia hasta aprobar (sigue en 0: 100 entrada − 100 salida).
    const stock = await stockOf(base.product.id);
    expect(stock!.currentQuantity).toBe(0);
  });

  it('requestQuantityEdit sobre una SALIDA: aumentar lo despachado genera un RLAO pendiente', async () => {
    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems: [{ lotCode: 'L-EDITEXIT2', quantity: 100, fechaVencimiento: '2026-06-01' }],
    }, USER_ID);
    const lot = await lotByCode(base.product.id, 'L-EDITEXIT2');
    const pallet = await ds.getRepository(Pallet).findOne({ where: { lotId: lot!.id } });

    const exit = await service.create({
      type: 'EXIT', productId: base.product.id,
      palletItems: [{ palletId: pallet!.id, quantity: 60 }],
    }, USER_ID);

    const res = await service.requestQuantityEdit(exit.movementId, {
      reason: 'Se despachó más de lo registrado',
      lots: [{ lotId: lot!.id, palletEdits: [{ palletId: pallet!.id, newQuantity: 90 }] }],
    }, USER_ID);

    expect(res.requests).toHaveLength(1);
    expect(res.requests[0].code).toMatch(/^RLAO-/);
    expect(res.requests[0].totalQuantity).toBe(30);

    // El stock NO cambia hasta aprobar (sigue en 40: 100 entrada − 60 salida).
    const stock = await stockOf(base.product.id);
    expect(stock!.currentQuantity).toBe(40);
  });

  it('requestQuantityEdit rechaza "agregar pallets nuevos" en una salida', async () => {
    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems: [{ lotCode: 'L-EDITEXIT3', quantity: 100, fechaVencimiento: '2026-06-01' }],
    }, USER_ID);
    const lot = await lotByCode(base.product.id, 'L-EDITEXIT3');
    const pallet = await ds.getRepository(Pallet).findOne({ where: { lotId: lot!.id } });

    const exit = await service.create({
      type: 'EXIT', productId: base.product.id,
      palletItems: [{ palletId: pallet!.id, quantity: 60 }],
    }, USER_ID);

    await expect(
      service.requestQuantityEdit(exit.movementId, {
        reason: 'Intento inválido de agregar pallets nuevos',
        lots: [{ lotId: lot!.id, addQuantity: 10 }],
      }, USER_ID),
    ).rejects.toThrow();
  });
});
