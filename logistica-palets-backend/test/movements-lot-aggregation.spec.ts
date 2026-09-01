/**
 * Agregación de lotes en el listado de movimientos (RL-A-07).
 *
 * `findAll` dejó de resolver los lotes con un LEFT JOIN contra un agregado
 * agrupado de `movement_details` y pasó a hacerlo con subconsultas
 * correlacionadas. El motivo es de rendimiento —el agregado obligaba a agrupar
 * la tabla de detalles entera para devolver 20 filas; medido, 2.772 ms contra
 * 0,9 ms sobre un millón de movimientos— pero el riesgo es de semántica: si la
 * reescritura cambia lo que se muestra, el número no sirve de nada.
 *
 * Estos casos fijan exactamente lo que la consulta tiene que seguir devolviendo.
 * El más delicado es el del lote propio sin detalles: `COUNT` sobre cero filas
 * devuelve 0 y no NULL, así que sin el `NULLIF` ese movimiento pasaría a
 * reportar 0 lotes en vez de 1, en silencio y sólo en el listado.
 *
 * Requiere la base de docker-compose.test.yml levantada.
 */
import { DataSource } from 'typeorm';
import { MovementsService } from '../src/modules/movements/movements.service';
import { DocumentSequenceService } from '../src/modules/movements/document-sequence.service';
import { PilasService } from '../src/modules/pilas/pilas.service';
import { Movement } from '../src/modules/movements/entities/movement.entity';
import { MovementDetail } from '../src/modules/movements/entities/movement-detail.entity';
import { Lot } from '../src/modules/lots/entities/lot.entity';
import type { EventsGateway } from '../src/modules/events/events.gateway';
import type { CacheService } from '../src/modules/cache/cache.service';
import type { UploadsService } from '../src/modules/uploads/uploads.service';
import {
  createAccessService,
  createTestDataSource,
  resetDb,
  seedBasics,
  TEST_USER_ID,
  type Basics,
} from './test-datasource';

const noopEvents = { emitMovementCreated() {}, emitStockUpdated() {} } as unknown as EventsGateway;
const noopCache = { delPattern: async () => {} } as unknown as CacheService;
const noopUploads = { log: async () => {} } as unknown as UploadsService;

let ds: DataSource;
let service: MovementsService;
let base: Basics;

/** Crea un lote del producto de prueba. */
async function crearLote(lotCode: string, sapLot?: string): Promise<Lot> {
  const repo = ds.getRepository(Lot);
  return repo.save(repo.create({ productId: base.product.id, lotCode, sapLot: sapLot ?? undefined, stockActual: 0 }));
}

/** Inserta un movimiento directo por repositorio, para controlar exactamente el caso. */
async function crearMovimiento(opts: { lotId?: string | null; date?: Date }): Promise<Movement> {
  const repo = ds.getRepository(Movement);
  return repo.save(
    repo.create({
      type: 'ENTRY',
      date: opts.date ?? new Date(),
      productId: base.product.id,
      quantity: 10,
      warehouseId: base.warehouse.id,
      locationId: base.location.id,
      createdById: TEST_USER_ID,
      lotId: opts.lotId ?? undefined,
      status: 'NORMAL',
      voidStatus: 'NONE',
    }),
  );
}

async function agregarDetalle(movementId: string, lotId: string): Promise<void> {
  const repo = ds.getRepository(MovementDetail);
  await repo.save(repo.create({ movementId, lotId, quantity: 5, role: 'SOURCE' }));
}

/** Fila del listado correspondiente a ese movimiento. */
async function filaDe(movementId: string) {
  const { data } = await service.findAll({}, null);
  const fila = data.find((r) => String(r.id) === movementId);
  expect(fila).toBeDefined();
  return fila as unknown as { id: string; lotCode: string | null; sapLot: string | null; lotCount: number };
}

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  service = new MovementsService(
    ds, noopEvents, noopCache, new DocumentSequenceService(), noopUploads,
    new PilasService(), createAccessService(ds),
  );
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
  base = await seedBasics(ds);
});

describe('lotes de un movimiento en el listado', () => {
  it('movimiento con lote propio y sin detalles: cuenta 1, no 0', async () => {
    // El caso que rompe si falta el NULLIF.
    const lote = await crearLote('L-PROPIO', 'SAP-1');
    const mov = await crearMovimiento({ lotId: lote.id });

    const fila = await filaDe(mov.id);
    expect(fila.lotCode).toBe('L-PROPIO');
    expect(fila.sapLot).toBe('SAP-1');
    expect(fila.lotCount).toBe(1);
  });

  it('movimiento sin lote propio y con varios detalles: concatena y cuenta los distintos', async () => {
    const mov = await crearMovimiento({ lotId: null });
    const a = await crearLote('L-BBB', 'SAP-B');
    const b = await crearLote('L-AAA', 'SAP-A');
    await agregarDetalle(mov.id, a.id);
    await agregarDetalle(mov.id, b.id);

    const fila = await filaDe(mov.id);
    // Orden alfabético, igual que hacía el agregado agrupado.
    expect(fila.lotCode).toBe('L-AAA, L-BBB');
    expect(fila.sapLot).toBe('SAP-A, SAP-B');
    expect(fila.lotCount).toBe(2);
  });

  it('dos detalles del mismo lote cuentan como uno solo', async () => {
    const mov = await crearMovimiento({ lotId: null });
    const lote = await crearLote('L-UNICO');
    await agregarDetalle(mov.id, lote.id);
    await agregarDetalle(mov.id, lote.id);

    const fila = await filaDe(mov.id);
    expect(fila.lotCode).toBe('L-UNICO');
    expect(fila.lotCount).toBe(1);
  });

  it('movimiento sin lote y sin detalles: sin código y cuenta 0', async () => {
    const mov = await crearMovimiento({ lotId: null });

    const fila = await filaDe(mov.id);
    expect(fila.lotCode).toBeNull();
    expect(fila.sapLot).toBeNull();
    expect(fila.lotCount).toBe(0);
  });

  it('con lote propio y detalles a la vez, manda el lote propio', async () => {
    // Es el orden del COALESCE y no debe invertirse: el lote del movimiento es
    // el dato explícito, los detalles son la reconstrucción.
    const propio = await crearLote('L-PROPIO');
    const otro = await crearLote('L-DETALLE');
    const mov = await crearMovimiento({ lotId: propio.id });
    await agregarDetalle(mov.id, otro.id);

    const fila = await filaDe(mov.id);
    expect(fila.lotCode).toBe('L-PROPIO');
    // El conteo sí sale de los detalles cuando los hay.
    expect(fila.lotCount).toBe(1);
  });
});

describe('búsqueda por código de lote', () => {
  it('encuentra un movimiento por un lote que sólo está en sus detalles', async () => {
    const mov = await crearMovimiento({ lotId: null });
    const lote = await crearLote('L-BUSCADO');
    await agregarDetalle(mov.id, lote.id);
    await crearMovimiento({ lotId: null }); // ruido

    const { data } = await service.findAll({ search: 'l-buscado' }, null);
    expect(data.map((r) => String(r.id))).toEqual([mov.id]);
  });

  it('no devuelve movimientos cuyo lote no coincide', async () => {
    const mov = await crearMovimiento({ lotId: null });
    await agregarDetalle(mov.id, (await crearLote('L-OTRO')).id);

    const { data } = await service.findAll({ search: 'l-buscado' }, null);
    expect(data).toEqual([]);
  });

  it('sigue encontrando por el lote propio del movimiento', async () => {
    const lote = await crearLote('L-PROPIO');
    const mov = await crearMovimiento({ lotId: lote.id });

    const { data } = await service.findAll({ search: 'l-propio' }, null);
    expect(data.map((r) => String(r.id))).toEqual([mov.id]);
  });
});

describe('orden y paginación, que son lo que el índice sostiene', () => {
  it('ordena por fecha descendente', async () => {
    const viejo = await crearMovimiento({ lotId: null, date: new Date('2026-01-10T12:00:00Z') });
    const nuevo = await crearMovimiento({ lotId: null, date: new Date('2026-03-20T12:00:00Z') });
    const medio = await crearMovimiento({ lotId: null, date: new Date('2026-02-15T12:00:00Z') });

    const { data } = await service.findAll({}, null);
    expect(data.map((r) => String(r.id))).toEqual([nuevo.id, medio.id, viejo.id]);
  });

  it('el filtro por rango de fechas deja fuera lo que está fuera del rango', async () => {
    await crearMovimiento({ lotId: null, date: new Date('2026-01-10T12:00:00Z') });
    const dentro = await crearMovimiento({ lotId: null, date: new Date('2026-02-15T12:00:00Z') });
    await crearMovimiento({ lotId: null, date: new Date('2026-03-20T12:00:00Z') });

    const { data } = await service.findAll({ dateFrom: '2026-02-01', dateTo: '2026-02-28' }, null);
    expect(data.map((r) => String(r.id))).toEqual([dentro.id]);
  });

  it('la paginación no repite ni pierde filas', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const m = await crearMovimiento({ lotId: null, date: new Date(`2026-02-0${i + 1}T12:00:00Z`) });
      ids.unshift(m.id); // el más nuevo primero, como devuelve el listado
    }

    const p1 = await service.findAll({ page: 1, limit: 2 }, null);
    const p2 = await service.findAll({ page: 2, limit: 2 }, null);
    const p3 = await service.findAll({ page: 3, limit: 2 }, null);

    expect([...p1.data, ...p2.data, ...p3.data].map((r) => String(r.id))).toEqual(ids);
    expect(p1.meta.total).toBe(5);
    expect(p1.meta.totalPages).toBe(3);
  });
});
