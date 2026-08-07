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
import { DataSource, In, Not } from 'typeorm';
import { MovementsService } from '../src/modules/movements/movements.service';
import { DocumentSequenceService } from '../src/modules/movements/document-sequence.service';
import { PilasService } from '../src/modules/pilas/pilas.service';
import { PalletsService } from '../src/modules/pallets/pallets.service';
import { ReportsService } from '../src/modules/reports/reports.service';
import { Product } from '../src/modules/products/entities/product.entity';
import { Stock } from '../src/modules/stocks/entities/stock.entity';
import { Lot } from '../src/modules/lots/entities/lot.entity';
import { Pallet } from '../src/modules/pallets/entities/pallet.entity';
import { Location } from '../src/modules/locations/entities/location.entity';
import { Pila } from '../src/modules/pilas/entities/pila.entity';
import { Movement } from '../src/modules/movements/entities/movement.entity';
import { MovementDetail } from '../src/modules/movements/entities/movement-detail.entity';
import { RegularizationLog } from '../src/modules/movements/entities/regularization-log.entity';
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
let palletsService: PalletsService;
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
  service = new MovementsService(ds, noopEvents, noopCache, new DocumentSequenceService(), noopUploads, new PilasService());
  palletsService = new PalletsService(
    ds,
    ds.getRepository(Pallet),
    ds.getRepository(Lot),
    ds.getRepository(Location),
    new PilasService(),
  );
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
    const result = await service.create({
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

    // El motor de colocación asigna pila/nivel al crear el pallet.
    expect(pallets[0].currentLocationId).toBe(base.location.id);
    expect(pallets[0].pilaId).toBeTruthy();
    expect(pallets[0].stackPosition).toBe(1);
    const pila = await ds.getRepository(Pila).findOne({ where: { id: pallets[0].pilaId! } });
    expect(pila!.locationId).toBe(base.location.id);
    expect(pila!.productId).toBe(base.product.id);

    const detail = await ds.getRepository(MovementDetail).findOne({ where: { movementId: result.movementId } });
    expect(detail!.locationId).toBe(base.location.id);
    expect(detail!.pilaId).toBe(pallets[0].pilaId);
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

describe('motor de stock — cantidades decimales', () => {
  it('preserva los decimales de punta a punta: stock, lote y palet', async () => {
    await service.create({
      type: 'ENTRY',
      productId: base.product.id,
      warehouseId: base.warehouse.id,
      locationId: base.location.id,
      palletItems: [{ lotCode: 'L-DEC', quantity: 42.84, fechaVencimiento: '2027-01-01' }],
    }, USER_ID);

    expect((await stockOf(base.product.id))!.currentQuantity).toBe(42.84);
    expect((await lotByCode(base.product.id, 'L-DEC'))!.stockActual).toBe(42.84);
    const pallet = await ds.getRepository(Pallet).findOne({ where: { lotId: (await lotByCode(base.product.id, 'L-DEC'))!.id } });
    expect(pallet!.quantity).toBe(42.84);
  });

  it('permite despachar el saldo decimal exacto sin residuo de coma flotante', async () => {
    // 0.1 + 0.2 === 0.30000000000000004 en coma flotante: sin redondeo, la salida
    // por el total exacto se rechazaría como "stock insuficiente" y el stock final
    // quedaría en un residuo ~1e-17 en vez de 0.
    await service.create({
      type: 'ENTRY',
      productId: base.product.id,
      warehouseId: base.warehouse.id,
      locationId: base.location.id,
      palletItems: [
        { lotCode: 'L-01', quantity: 0.1, fechaVencimiento: '2027-01-01' },
        { lotCode: 'L-02', quantity: 0.2, fechaVencimiento: '2027-02-01' },
      ],
    }, USER_ID);
    expect((await stockOf(base.product.id))!.currentQuantity).toBe(0.3);

    await service.create({
      type: 'EXIT',
      productId: base.product.id,
      warehouseId: base.warehouse.id,
      locationId: base.location.id,
      quantity: 0.3,
    }, USER_ID);

    expect((await stockOf(base.product.id))!.currentQuantity).toBe(0);
    // Sin redondear, el segundo palet queda con un resto de ~2.7e-17: no llega a
    // cero, nunca pasa a EXITED y aparece como disponible con stock fantasma.
    const pallets = await ds.getRepository(Pallet).find();
    expect(pallets.map((p) => p.quantity)).toEqual([0, 0]);
    expect(pallets.every((p) => p.status === 'EXITED')).toBe(true);
  });

  it('dos materiales con el mismo código de lote no colisionan en el código de palet', async () => {
    // Los lotes SAP se numeran por fecha (Z011008201), así que dos materiales
    // recibidos el mismo día comparten código de lote. `pallets.code` es único
    // global: sin el material en el código, el segundo palet rompía la carga.
    const otro = await ds.getRepository(Product).save(
      ds.getRepository(Product).create({ code: 'P-OTRO', description: 'Otro material', active: true }),
    );
    const entrada = (productId: string) => service.create({
      type: 'ENTRY',
      productId,
      warehouseId: base.warehouse.id,
      locationId: base.location.id,
      palletItems: [{ lotCode: 'Z011008201', quantity: 5 }],
    }, USER_ID);

    await entrada(base.product.id);
    await expect(entrada(otro.id)).resolves.toBeDefined();

    const codes = (await ds.getRepository(Pallet).find()).map((p) => p.code);
    expect(new Set(codes).size).toBe(2);
  });
});

describe('motor de stock — colocación en pilas', () => {
  it('la vista previa de un no apilable consume una base por pallet y rechaza el excedente', async () => {
    const tight = await ds.getRepository(Location).save(
      ds.getRepository(Location).create({ code: 'PREVIEW-NS', type: 'PISO', warehouse: base.warehouse, active: true, capacityBases: 2 }),
    );
    await ds.getRepository(Product).update(base.product.id, { stackable: false });

    const plan = await service.previewPlacement({
      productId: base.product.id,
      locationId: tight.id,
      palletCount: 2,
    });
    expect(plan.piles).toHaveLength(2);
    expect(plan.piles.every((p) => p.items[0].stackPosition === 1)).toBe(true);
    expect(plan.basesUsed).toBe(2);
    expect(plan.basesFree).toBe(0);
    expect(await ds.getRepository(Pila).count()).toBe(0); // preview no persiste

    await expect(service.previewPlacement({
      productId: base.product.id,
      locationId: tight.id,
      palletCount: 3,
    })).rejects.toThrow(/bases libres/);
  });

  it('un lote apilable hasta 3 arma 2 pilas para 6 pallets', async () => {
    await ds.getRepository(Product).update(base.product.id, { stackable: true, maxStackLevel: 3 });

    const palletItems = Array.from({ length: 6 }, (_, i) => ({ lotCode: `LP-${i}`, quantity: 10 }));
    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems,
    }, USER_ID);

    const pallets = await ds.getRepository(Pallet).find({ where: { currentLocationId: base.location.id } });
    expect(pallets).toHaveLength(6);
    const pilaIds = new Set(pallets.map((p) => p.pilaId));
    expect(pilaIds.size).toBe(2);

    for (const pilaId of pilaIds) {
      const members = pallets.filter((p) => p.pilaId === pilaId).sort((a, b) => a.stackPosition! - b.stackPosition!);
      expect(members.map((p) => p.stackPosition)).toEqual(members.map((_, i) => i + 1));
      expect(members.length).toBeLessThanOrEqual(3);
    }
  });

  it('un producto no apilable abre una pila por pallet', async () => {
    await ds.getRepository(Product).update(base.product.id, { stackable: false });

    const palletItems = Array.from({ length: 3 }, (_, i) => ({ lotCode: `LNS-${i}`, quantity: 10 }));
    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems,
    }, USER_ID);

    const pallets = await ds.getRepository(Pallet).find({ where: { currentLocationId: base.location.id } });
    expect(pallets).toHaveLength(3);
    expect(new Set(pallets.map((p) => p.pilaId)).size).toBe(3);
    expect(pallets.every((p) => p.stackPosition === 1)).toBe(true);
  });

  it('una segunda entrada del mismo producto consolida en la pila ya abierta', async () => {
    await ds.getRepository(Product).update(base.product.id, { stackable: true, maxStackLevel: 5 });

    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems: [{ lotCode: 'LC-1', quantity: 10 }],
    }, USER_ID);
    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems: [{ lotCode: 'LC-2', quantity: 10 }],
    }, USER_ID);

    const pallets = await ds.getRepository(Pallet).find({ where: { currentLocationId: base.location.id } });
    expect(pallets).toHaveLength(2);
    expect(pallets[0].pilaId).toBe(pallets[1].pilaId);
    expect(new Set(pallets.map((p) => p.stackPosition))).toEqual(new Set([1, 2]));

    const pilaCount = await ds.getRepository(Pila).count({ where: { locationId: base.location.id } });
    expect(pilaCount).toBe(1);
  });

  it('rechaza la entrada si el sector no tiene bases libres', async () => {
    const tight = await ds.getRepository(Location).save(
      ds.getRepository(Location).create({ code: 'TIGHT-1', type: 'PISO', warehouse: base.warehouse, active: true, capacityBases: 1 }),
    );
    await ds.getRepository(Product).update(base.product.id, { stackable: false });

    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: tight.id,
      palletItems: [{ lotCode: 'LT-1', quantity: 10 }],
    }, USER_ID);

    await expect(service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: tight.id,
      palletItems: [{ lotCode: 'LT-2', quantity: 10 }],
    }, USER_ID)).rejects.toThrow(/bases libres/);

    // El rechazo no debe dejar stock/pallet a medio escribir.
    const pallets = await ds.getRepository(Pallet).find({ where: { currentLocationId: tight.id } });
    expect(pallets).toHaveLength(1);
  });

  it('una pila llena (CLOSED) sigue ocupando su base', async () => {
    // Sector de 1 sola base, producto apilable hasta 2: el primer lote llena la
    // pila y la cierra. El siguiente pallet necesitaría una base nueva, que no hay.
    const tight = await ds.getRepository(Location).save(
      ds.getRepository(Location).create({ code: 'TIGHT-2', type: 'PISO', warehouse: base.warehouse, active: true, capacityBases: 1 }),
    );
    await ds.getRepository(Product).update(base.product.id, { stackable: true, maxStackLevel: 2 });

    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: tight.id,
      palletItems: [{ lotCode: 'LF-1', quantity: 10 }, { lotCode: 'LF-2', quantity: 10 }],
    }, USER_ID);

    const pila = await ds.getRepository(Pila).findOne({ where: { locationId: tight.id } });
    expect(pila!.status).toBe('CLOSED');

    await expect(service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: tight.id,
      palletItems: [{ lotCode: 'LF-3', quantity: 10 }],
    }, USER_ID)).rejects.toThrow(/bases libres/);
  });

  it('aplica el menor máximo entre producto y ubicación', async () => {
    const tight = await ds.getRepository(Location).save(
      ds.getRepository(Location).create({
        code: 'MIN-LIMIT', type: 'PISO', warehouse: base.warehouse, active: true,
        capacityBases: 1, defaultMaxStackLevel: 5,
      }),
    );
    await ds.getRepository(Product).update(base.product.id, { stackable: true, maxStackLevel: 2 });

    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: tight.id,
      palletItems: [{ lotCode: 'ML-1', quantity: 10 }, { lotCode: 'ML-2', quantity: 10 }],
    }, USER_ID);

    const pallets = await ds.getRepository(Pallet).find({ where: { currentLocationId: tight.id } });
    expect(pallets.map((p) => p.stackPosition).sort()).toEqual([1, 2]);
    expect((await ds.getRepository(Pila).findOne({ where: { locationId: tight.id } }))!.status).toBe('CLOSED');

    await expect(service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: tight.id,
      palletItems: [{ lotCode: 'ML-3', quantity: 10 }],
    }, USER_ID)).rejects.toThrow(/bases libres/);
  });
});

describe('transferencias — mismas reglas de colocación en todos los módulos', () => {
  async function entryAt(location: Location, lotCode: string) {
    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: location.id,
      palletItems: [{ lotCode, quantity: 10 }],
    }, USER_ID);
    return ds.getRepository(Pallet).findOneOrFail({
      where: { currentLocationId: location.id, code: `${base.product.code}-${lotCode}-P1` },
    });
  }

  it('Movimientos rechaza transferir un no apilable a un sector sin bases libres', async () => {
    await ds.getRepository(Product).update(base.product.id, { stackable: false });
    const full = await ds.getRepository(Location).save(
      ds.getRepository(Location).create({ code: 'MOV-FULL', type: 'PISO', warehouse: base.warehouse, active: true, capacityBases: 1 }),
    );
    await entryAt(full, 'MOV-DST');
    const moving = await entryAt(base.location, 'MOV-SRC');
    const originPile = moving.pilaId;

    await expect(service.createTransferBatch({
      fromLocationId: base.location.id,
      toLocationId: full.id,
      lines: [{ productId: base.product.id, palletItems: [{ palletId: moving.id, quantity: moving.quantity }] }],
    }, USER_ID)).rejects.toThrow(/bases libres/);

    const unchanged = await ds.getRepository(Pallet).findOneByOrFail({ id: moving.id });
    expect(unchanged.currentLocationId).toBe(base.location.id);
    expect(unchanged.pilaId).toBe(originPile);
    expect(await ds.getRepository(Pallet).count({ where: { currentLocationId: full.id } })).toBe(1);
  });

  it('Movimientos apila hasta el máximo y luego rechaza el siguiente pallet', async () => {
    await ds.getRepository(Product).update(base.product.id, { stackable: true, maxStackLevel: 2 });
    const target = await ds.getRepository(Location).save(
      ds.getRepository(Location).create({
        code: 'MOV-MAX', type: 'PISO', warehouse: base.warehouse, active: true,
        capacityBases: 1, defaultMaxStackLevel: 5,
      }),
    );
    const first = await entryAt(target, 'MOV-MAX-1');
    const second = await entryAt(base.location, 'MOV-MAX-2');
    const third = await entryAt(base.location, 'MOV-MAX-3');
    const originPileId = second.pilaId!;

    await service.createTransferBatch({
      fromLocationId: base.location.id,
      toLocationId: target.id,
      lines: [{ productId: base.product.id, palletItems: [{ palletId: second.id, quantity: second.quantity }] }],
    }, USER_ID);
    const moved = await ds.getRepository(Pallet).findOneByOrFail({ id: second.id });
    expect(moved.pilaId).toBe(first.pilaId);
    expect(moved.stackPosition).toBe(2);
    // La pila de origen estaba CLOSED en 2/2. Al sacar un pallet debe volver a
    // OPEN y compactar el que quedó, para que ocupación y recomendación sean reales.
    expect((await ds.getRepository(Pila).findOneByOrFail({ id: originPileId })).status).toBe('OPEN');
    expect((await ds.getRepository(Pallet).findOneByOrFail({ id: third.id })).stackPosition).toBe(1);

    await expect(service.createTransferBatch({
      fromLocationId: base.location.id,
      toLocationId: target.id,
      lines: [{ productId: base.product.id, palletItems: [{ palletId: third.id, quantity: third.quantity }] }],
    }, USER_ID)).rejects.toThrow(/bases libres/);
    expect((await ds.getRepository(Pallet).findOneByOrFail({ id: third.id })).currentLocationId).toBe(base.location.id);
  });

  it('Pallets/Localizador rechazan un no apilable cuando el destino está lleno', async () => {
    await ds.getRepository(Product).update(base.product.id, { stackable: false });
    const full = await ds.getRepository(Location).save(
      ds.getRepository(Location).create({ code: 'QUICK-FULL', type: 'PISO', warehouse: base.warehouse, active: true, capacityBases: 1 }),
    );
    await entryAt(full, 'QUICK-DST');
    const moving = await entryAt(base.location, 'QUICK-SRC');
    const originPile = moving.pilaId;

    await expect(palletsService.quickTransfer(moving.id, full.id, USER_ID)).rejects.toThrow(/bases libres/);
    const unchanged = await ds.getRepository(Pallet).findOneByOrFail({ id: moving.id });
    expect(unchanged.currentLocationId).toBe(base.location.id);
    expect(unchanged.pilaId).toBe(originPile);
  });

  it('Pallets/Localizador asignan pila destino, liberan origen y respetan el máximo', async () => {
    await ds.getRepository(Product).update(base.product.id, { stackable: true, maxStackLevel: 2 });
    const target = await ds.getRepository(Location).save(
      ds.getRepository(Location).create({
        code: 'QUICK-MAX', type: 'PISO', warehouse: base.warehouse, active: true,
        capacityBases: 1, defaultMaxStackLevel: 4,
      }),
    );
    const sourceSecond = await ds.getRepository(Location).save(
      ds.getRepository(Location).create({
        code: 'QUICK-SOURCE-2', type: 'PISO', warehouse: base.warehouse, active: true,
        capacityBases: 1,
      }),
    );
    const sourceThird = await ds.getRepository(Location).save(
      ds.getRepository(Location).create({
        code: 'QUICK-SOURCE-3', type: 'PISO', warehouse: base.warehouse, active: true,
        capacityBases: 1,
      }),
    );
    const first = await entryAt(target, 'QUICK-MAX-1');
    const second = await entryAt(sourceSecond, 'QUICK-MAX-2');
    const third = await entryAt(sourceThird, 'QUICK-MAX-3');
    const secondOriginPile = second.pilaId!;

    await palletsService.quickTransfer(second.id, target.id, USER_ID);
    const moved = await ds.getRepository(Pallet).findOneByOrFail({ id: second.id });
    expect(moved.pilaId).toBe(first.pilaId);
    expect(moved.stackPosition).toBe(2);
    expect((await ds.getRepository(Pila).findOneByOrFail({ id: secondOriginPile })).status).toBe('EMPTY');

    await expect(palletsService.quickTransfer(third.id, target.id, USER_ID)).rejects.toThrow(/bases libres/);
    expect((await ds.getRepository(Pallet).findOneByOrFail({ id: third.id })).currentLocationId).toBe(sourceThird.id);
  });
});

describe('corregir movimiento — peso por pallet y sin cambios', () => {
  /** Entrada de 1 pallet, devuelve el movimiento y su lote/pallet. */
  async function entradaSimple(weightKg?: number) {
    const res = await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems: [{ lotCode: 'LP-1', quantity: 10, weightKg }],
    }, USER_ID);
    const lot = await lotByCode(base.product.id, 'LP-1');
    const [pallet] = await ds.getRepository(Pallet).find({ where: { lotId: lot!.id } });
    return { movementId: res.movementId, lotId: lot!.id, pallet };
  }

  it('cambiar solo el peso lo aplica directo, sin generar solicitud de ajuste', async () => {
    const { movementId, lotId, pallet } = await entradaSimple(800);

    const res = await service.requestQuantityEdit(movementId, {
      reason: 'Se repesó el pallet en balanza',
      lots: [{ lotId, palletEdits: [{ palletId: pallet.id, newQuantity: 10, weightKg: 845.5 }] }],
    }, USER_ID);

    // El peso no mueve stock: no hay nada que aprobar.
    expect(res.requests).toHaveLength(0);

    const actualizado = await ds.getRepository(Pallet).findOne({ where: { id: pallet.id } });
    expect(actualizado!.weightKg).toBe(845.5);
    expect(actualizado!.quantity).toBe(10); // la cantidad no se tocó
  });

  it('el cambio de peso queda auditado con valor anterior y nuevo', async () => {
    const { movementId, lotId, pallet } = await entradaSimple(800);

    await service.requestQuantityEdit(movementId, {
      reason: 'Se repesó el pallet en balanza',
      lots: [{ lotId, palletEdits: [{ palletId: pallet.id, newQuantity: 10, weightKg: 845.5 }] }],
    }, USER_ID);

    const logs = await ds.getRepository(RegularizationLog).find({ where: { movementId } });
    const pesoLog = logs.find((l) => l.field.endsWith('.weightKg'));
    expect(pesoLog).toBeDefined();
    expect(pesoLog!.oldValue).toBe('800');
    expect(pesoLog!.newValue).toBe('845.5');
    expect(pesoLog!.reason).toContain('repesó');
  });

  it('sin ningún cambio real, rechaza con "No hay cambios"', async () => {
    const { movementId, lotId, pallet } = await entradaSimple(800);

    await expect(service.requestQuantityEdit(movementId, {
      reason: 'Reviso pero no cambio nada',
      // Misma cantidad y mismo peso que ya tiene.
      lots: [{ lotId, palletEdits: [{ palletId: pallet.id, newQuantity: 10, weightKg: 800 }] }],
    }, USER_ID)).rejects.toThrow(/No hay cambios/i);

    // Y no dejó rastro: ni auditoría ni solicitudes.
    expect(await ds.getRepository(RegularizationLog).count({ where: { movementId } })).toBe(0);
    expect(await ds.getRepository(AdjustmentRequest).count()).toBe(0);
  });
});

describe('movimientos — encargado desde el JWT', () => {
  const OTRO_USER = '00000000-0000-0000-0000-0000000000bb';

  const entrada = (encargadoRecepcionId: string | undefined, role?: string) =>
    service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      encargadoRecepcionId,
      palletItems: [{ lotCode: `LE-${Math.random().toString(36).slice(2, 7)}`, quantity: 10 }],
    }, USER_ID, role);

  it('sin encargado explícito, queda el usuario logueado', async () => {
    const res = await entrada(undefined, 'OPERATOR');
    const mov = await ds.getRepository(Movement).findOne({ where: { id: res.movementId } });
    expect(mov!.encargadoRecepcionId).toBe(USER_ID);
  });

  it('un OPERATOR no puede registrar el remito a nombre de otro', async () => {
    await expect(entrada(OTRO_USER, 'OPERATOR')).rejects.toThrow(/ADMIN o MANAGER/i);
  });

  it('un OPERATOR sí puede indicarse a sí mismo', async () => {
    const res = await entrada(USER_ID, 'OPERATOR');
    const mov = await ds.getRepository(Movement).findOne({ where: { id: res.movementId } });
    expect(mov!.encargadoRecepcionId).toBe(USER_ID);
  });

  it('un MANAGER puede reasignar el encargado', async () => {
    const res = await entrada(OTRO_USER, 'MANAGER');
    const mov = await ds.getRepository(Movement).findOne({ where: { id: res.movementId } });
    expect(mov!.encargadoRecepcionId).toBe(OTRO_USER);
  });

  it('un ADMIN puede reasignar el encargado', async () => {
    const res = await entrada(OTRO_USER, 'ADMIN');
    const mov = await ds.getRepository(Movement).findOne({ where: { id: res.movementId } });
    expect(mov!.encargadoRecepcionId).toBe(OTRO_USER);
  });
});

describe('motor de stock — ubicación y peso por pallet', () => {
  it('reparte un lote entre dos sectores y el stock queda por sector', async () => {
    const otro = await ds.getRepository(Location).save(
      ds.getRepository(Location).create({ code: 'SPLIT-2', type: 'PISO', warehouse: base.warehouse, active: true, capacityBases: 10 }),
    );
    await ds.getRepository(Product).update(base.product.id, { stackable: false });

    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems: [
        { lotCode: 'LS-1', quantity: 10 },                          // hereda la ubicación de la línea
        { lotCode: 'LS-2', quantity: 25, locationId: otro.id },     // sector propio
      ],
    }, USER_ID);

    const stocks = await ds.getRepository(Stock).find({ where: { productId: base.product.id } });
    const byLoc = new Map(stocks.map((s) => [s.locationId, s.currentQuantity]));
    expect(byLoc.get(base.location.id)).toBe(10);
    expect(byLoc.get(otro.id)).toBe(25);

    // Invariante: el stock total sigue siendo la suma de los pallets.
    const pallets = await ds.getRepository(Pallet).find();
    const totalPallets = pallets.reduce((s, p) => s + p.quantity, 0);
    const totalStock = stocks.reduce((s, x) => s + x.currentQuantity, 0);
    expect(totalStock).toBe(totalPallets);
    expect(totalStock).toBe(35);
  });

  it('cada pallet queda físicamente en su propio sector, con su pila', async () => {
    const otro = await ds.getRepository(Location).save(
      ds.getRepository(Location).create({ code: 'SPLIT-3', type: 'PISO', warehouse: base.warehouse, active: true, capacityBases: 10 }),
    );

    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems: [
        { lotCode: 'LT-A', quantity: 10 },
        { lotCode: 'LT-B', quantity: 10, locationId: otro.id },
      ],
    }, USER_ID);

    const aqui = await ds.getRepository(Pallet).find({ where: { currentLocationId: base.location.id } });
    const alla = await ds.getRepository(Pallet).find({ where: { currentLocationId: otro.id } });
    expect(aqui).toHaveLength(1);
    expect(alla).toHaveLength(1);

    // Cada uno con pila propia en su sector (no comparten base).
    expect(aqui[0].pilaId).toBeTruthy();
    expect(alla[0].pilaId).toBeTruthy();
    expect(aqui[0].pilaId).not.toBe(alla[0].pilaId);

    const pilaAlla = await ds.getRepository(Pila).findOne({ where: { id: alla[0].pilaId! } });
    expect(pilaAlla!.locationId).toBe(otro.id);
  });

  it('guarda el peso individual de cada pallet', async () => {
    await ds.getRepository(Product).update(base.product.id, { stackable: false });

    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems: [
        { lotCode: 'LW-1', quantity: 10, weightKg: 812.5 },
        { lotCode: 'LW-2', quantity: 10, weightKg: 934.25 },
        { lotCode: 'LW-3', quantity: 10 }, // sin peso declarado
      ],
    }, USER_ID);

    const pallets = await ds.getRepository(Pallet).find({ order: { code: 'ASC' } });
    const pesos = pallets.map((p) => p.weightKg).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(pesos).toEqual([null, 812.5, 934.25]);
  });

  it('rechaza una ubicación por pallet inexistente sin escribir nada', async () => {
    const inexistente = '00000000-0000-0000-0000-0000000000ff';

    await expect(service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems: [
        { lotCode: 'LX-1', quantity: 10 },
        { lotCode: 'LX-2', quantity: 10, locationId: inexistente },
      ],
    }, USER_ID)).rejects.toThrow();

    expect(await ds.getRepository(Pallet).count()).toBe(0);
    expect(await ds.getRepository(Stock).count()).toBe(0);
  });
});

describe('motor de stock — liberación de bases', () => {
  it('sacar un pallet de una pila de tres NO libera la base', async () => {
    await ds.getRepository(Product).update(base.product.id, { stackable: true, maxStackLevel: 3 });

    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems: [
        { lotCode: 'LR-1', quantity: 10 },
        { lotCode: 'LR-2', quantity: 10 },
        { lotCode: 'LR-3', quantity: 10 },
      ],
    }, USER_ID);

    const pallets = await ds.getRepository(Pallet).find({ where: { currentLocationId: base.location.id } });
    expect(new Set(pallets.map((p) => p.pilaId)).size).toBe(1);
    const pilaId = pallets[0].pilaId!;

    // Despachar UN pallet completo de los tres.
    await service.create({
      type: 'EXIT', productId: base.product.id,
      palletItems: [{ palletId: pallets[0].id, quantity: 10 }],
    }, USER_ID);

    const pila = await ds.getRepository(Pila).findOne({ where: { id: pilaId } });
    expect(pila!.status).not.toBe('EMPTY');

    const live = await ds.getRepository(Pallet).count({
      where: { pilaId, status: Not(In(['EXITED', 'EMPTY'])) },
    });
    expect(live).toBe(2);
  });

  it('la base se libera recién cuando sale el último pallet de la pila', async () => {
    await ds.getRepository(Product).update(base.product.id, { stackable: true, maxStackLevel: 3 });

    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id,
      palletItems: [{ lotCode: 'LU-1', quantity: 10 }, { lotCode: 'LU-2', quantity: 10 }],
    }, USER_ID);

    const pallets = await ds.getRepository(Pallet).find({ where: { currentLocationId: base.location.id } });
    const pilaId = pallets[0].pilaId!;

    await service.create({
      type: 'EXIT', productId: base.product.id,
      palletItems: [{ palletId: pallets[0].id, quantity: 10 }],
    }, USER_ID);
    expect((await ds.getRepository(Pila).findOne({ where: { id: pilaId } }))!.status).not.toBe('EMPTY');

    // Sale el último → la base queda libre.
    await service.create({
      type: 'EXIT', productId: base.product.id,
      palletItems: [{ palletId: pallets[1].id, quantity: 10 }],
    }, USER_ID);

    const pila = await ds.getRepository(Pila).findOne({ where: { id: pilaId } });
    expect(pila!.status).toBe('EMPTY');
    expect(pila!.closedAt).toBeTruthy();
  });

  it('una base liberada vuelve a estar disponible para una entrada nueva', async () => {
    // Sector de 1 base: se llena, se vacía y se debe poder volver a cargar.
    const tight = await ds.getRepository(Location).save(
      ds.getRepository(Location).create({ code: 'REUSE-1', type: 'PISO', warehouse: base.warehouse, active: true, capacityBases: 1 }),
    );
    await ds.getRepository(Product).update(base.product.id, { stackable: false });

    await service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: tight.id,
      palletItems: [{ lotCode: 'LV-1', quantity: 10 }],
    }, USER_ID);

    const [pallet] = await ds.getRepository(Pallet).find({ where: { currentLocationId: tight.id } });
    await service.create({
      type: 'EXIT', productId: base.product.id,
      palletItems: [{ palletId: pallet.id, quantity: 10 }],
    }, USER_ID);

    // Con la base liberada, la entrada nueva entra sin error de capacidad.
    await expect(service.create({
      type: 'ENTRY', productId: base.product.id, warehouseId: base.warehouse.id, locationId: tight.id,
      palletItems: [{ lotCode: 'LV-2', quantity: 10 }],
    }, USER_ID)).resolves.toBeDefined();
  });
});
