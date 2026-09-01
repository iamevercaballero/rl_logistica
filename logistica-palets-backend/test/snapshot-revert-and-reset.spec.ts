/**
 * Reversión de la carga inicial y reset de datos (RL-M-15, RL-M-08).
 *
 * `revertStockSnapshot` borra movimientos, palets y lotes con `manager.delete`.
 * Existe por un motivo legítimo —deshacer una carga inicial que salió mal antes
 * de arrancar— pero no dejaba rastro de lo borrado, y nada impedía usarlo cuando
 * el depósito ya estaba operando: el stock actual depende de los movimientos
 * posteriores, así que borrar la carga lo dejaría descuadrado sin forma de
 * reconstruirlo.
 *
 * `resetData` hacía ocho DELETE sueltos, cada uno con `.catch(() => null)`: sin
 * transacción y sin ruido, un fallo a mitad dejaba la base parcialmente vaciada
 * y la respuesta decía "Datos eliminados" igual.
 *
 * Requiere la base de docker-compose.test.yml levantada.
 */
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { MovementsService } from '../src/modules/movements/movements.service';
import { SeedService } from '../src/modules/seed/seed.service';
import { DocumentSequenceService } from '../src/modules/movements/document-sequence.service';
import { PilasService } from '../src/modules/pilas/pilas.service';
import { UploadsService } from '../src/modules/uploads/uploads.service';
import { Movement } from '../src/modules/movements/entities/movement.entity';
import { Attachment } from '../src/modules/uploads/entities/attachment.entity';
import { DocumentEvent } from '../src/modules/uploads/entities/document-event.entity';
import { Product } from '../src/modules/products/entities/product.entity';
import { Stock } from '../src/modules/stocks/entities/stock.entity';
import type { EventsGateway } from '../src/modules/events/events.gateway';
import type { CacheService } from '../src/modules/cache/cache.service';
import {
  createAccessService, createTestDataSource, resetDb, seedBasics, TEST_USER_ID, type Basics,
} from './test-datasource';

const noopEvents = { emitMovementCreated() {}, emitStockUpdated() {} } as unknown as EventsGateway;
const noopCache = { delPattern: async () => {} } as unknown as CacheService;

let ds: DataSource;
let movements: MovementsService;
let seed: SeedService;
let base: Basics;

/**
 * Movimiento de carga inicial con su fila de stock, como los que crea el
 * snapshot real. El stock no es decorativo: `applyDecrease` falla si no lo
 * encuentra —y falla bien, desde RL-A-09— así que sin él la reversión no
 * procede y el test no probaría nada.
 */
async function cargaInicial(cantidad = 10): Promise<Movement> {
  const stockRepo = ds.getRepository(Stock);
  const existente = await stockRepo.findOne({
    where: { productId: base.product.id, warehouseId: base.warehouse.id, locationId: base.location.id },
  });
  if (existente) {
    existente.currentQuantity += cantidad;
    await stockRepo.save(existente);
  } else {
    await stockRepo.save(
      stockRepo.create({
        productId: base.product.id, warehouseId: base.warehouse.id,
        locationId: base.location.id, currentQuantity: cantidad,
      }),
    );
  }
  const repo = ds.getRepository(Movement);
  return repo.save(
    repo.create({
      type: 'ADJUSTMENT_IN', adjustmentCategory: 'CARGA_INICIAL',
      date: new Date(), productId: base.product.id, quantity: cantidad,
      warehouseId: base.warehouse.id, locationId: base.location.id,
      createdById: TEST_USER_ID, status: 'NORMAL', voidStatus: 'NONE',
    }),
  );
}

/** Movimiento operativo normal: `adjustmentCategory` queda en NULL. */
async function entradaNormal(): Promise<Movement> {
  const repo = ds.getRepository(Movement);
  return repo.save(
    repo.create({
      type: 'ENTRY', date: new Date(), productId: base.product.id, quantity: 5,
      warehouseId: base.warehouse.id, locationId: base.location.id,
      createdById: TEST_USER_ID, status: 'NORMAL', voidStatus: 'NONE',
    }),
  );
}

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  const uploads = new UploadsService(ds.getRepository(Attachment), ds.getRepository(DocumentEvent));
  movements = new MovementsService(
    ds, noopEvents, noopCache, new DocumentSequenceService(), uploads,
    new PilasService(), createAccessService(ds),
  );
  seed = new SeedService(ds);
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
  base = await seedBasics(ds);
});

describe('revertir la carga inicial: resguardo', () => {
  it('se niega si ya hay movimientos operativos', async () => {
    // El stock actual depende de ellos: borrar la carga lo dejaría descuadrado.
    await cargaInicial();
    await entradaNormal();

    await expect(movements.revertStockSnapshot(true, TEST_USER_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('detecta los movimientos normales, que tienen adjustmentCategory en NULL', async () => {
    // Es la trampa del resguardo: en SQL `NULL != 'CARGA_INICIAL'` es NULL, no
    // verdadero, así que un `!=` pelado habría contado cero y no habría
    // resguardado nada.
    await cargaInicial();
    await entradaNormal();
    await entradaNormal();

    await expect(movements.revertStockSnapshot(true, TEST_USER_ID)).rejects.toThrow(/2 movimiento/);
  });

  it('no toca nada cuando se niega', async () => {
    const carga = await cargaInicial();
    await entradaNormal();

    await movements.revertStockSnapshot(true, TEST_USER_ID).catch(() => undefined);

    expect(await ds.getRepository(Movement).findOne({ where: { id: carga.id } })).not.toBeNull();
  });

  it('el ensayo (commit=false) no aplica el resguardo: sirve para ver qué habría', async () => {
    await cargaInicial();
    await entradaNormal();

    const r = await movements.revertStockSnapshot(false, TEST_USER_ID);
    expect(r.committed).toBe(false);
    expect(r.totalFound).toBe(1);
    expect(r.totalReverted).toBe(0);
  });
});

describe('revertir la carga inicial: rastro', () => {
  it('deja un evento por cada ajuste eliminado, con lo que se borró', async () => {
    const carga = await cargaInicial(25);

    const r = await movements.revertStockSnapshot(true, TEST_USER_ID);
    expect(r.totalReverted).toBe(1);
    expect(await ds.getRepository(Movement).findOne({ where: { id: carga.id } })).toBeNull();

    const eventos = await ds.getRepository(DocumentEvent).find({
      where: { eventType: 'CARGA_INICIAL_REVERTIDA' },
    });
    expect(eventos).toHaveLength(1);
    expect(eventos[0].entityId).toBe(carga.id);
    expect(eventos[0].userId).toBe(TEST_USER_ID);
    // La cantidad borrada queda en el metadata, que es lo único que sobrevive
    // al movimiento.
    expect(JSON.parse(eventos[0].metadata!)).toMatchObject({ quantity: 25 });
  });

  it('el rastro del borrado tampoco se puede borrar', async () => {
    // `document_events` es append-only por trigger (RL-M-09): es la diferencia
    // entre deshacer y hacer desaparecer.
    await cargaInicial();
    await movements.revertStockSnapshot(true, TEST_USER_ID);

    await expect(
      ds.query(`DELETE FROM "document_events" WHERE "eventType" = 'CARGA_INICIAL_REVERTIDA'`),
    ).rejects.toThrow(/append-only/i);
  });

  it('sin movimientos posteriores, la reversión sí procede y descuenta el stock', async () => {
    await cargaInicial(10);

    await movements.revertStockSnapshot(true, TEST_USER_ID);

    const stock = await ds.getRepository(Stock).findOne({ where: { productId: base.product.id } });
    expect(stock?.currentQuantity ?? 0).toBe(0);
  });
});

describe('reset de datos operativos', () => {
  it('vacía las tablas operativas y dice cuántas filas eliminó', async () => {
    await cargaInicial();
    await entradaNormal();

    const r = await seed.resetData();

    expect(r.filasEliminadas).toBeGreaterThan(0);
    expect(await ds.getRepository(Movement).count()).toBe(0);
    expect(await ds.getRepository(Product).count()).toBe(0);
  });

  it('vacía también las tablas que los DELETE sueltos no alcanzaban', async () => {
    // `locations` y `warehouses` no se podían borrar con movimientos apuntando
    // a ellas: la clave foránea lo impedía y el `.catch` se tragaba el error.
    await cargaInicial();

    await seed.resetData();

    const [{ n }] = (await ds.query(
      `SELECT (SELECT COUNT(*) FROM locations) + (SELECT COUNT(*) FROM warehouses) AS n`,
    )) as Array<{ n: string }>;
    expect(Number(n)).toBe(0);
  });

  it('no toca las bitácoras: un reset de datos no borra quién hizo qué', async () => {
    await cargaInicial();
    await movements.revertStockSnapshot(true, TEST_USER_ID);
    const antes = await ds.getRepository(DocumentEvent).count();
    expect(antes).toBeGreaterThan(0);

    await seed.resetData();

    expect(await ds.getRepository(DocumentEvent).count()).toBe(antes);
  });

  it('no borra usuarios', async () => {
    // El reset es de datos operativos; quedarse sin usuarios dejaría el sistema
    // inaccesible.
    await seed.resetData();
    const [{ n }] = (await ds.query(`SELECT COUNT(*)::int AS n FROM users`)) as Array<{ n: number }>;
    expect(n).toBeGreaterThan(0);
  });
});
