/**
 * `ReportsService.dailyStock` — el límite de "hoy" tiene que ser medianoche a
 * medianoche en Asunción, no en UTC.
 *
 * Regresión puntual: `dailyStock` tenía su propio cálculo de rango
 * (`parseBusinessDate(...).toISOString()`) en vez de reusar
 * `toStartDate`/`toEndDate` — un `string` con sufijo 'Z' comparado contra la
 * columna `date` (`timestamp` sin zona) se castea recortando la zona, no
 * convirtiéndola, así que el rango quedaba corrido ~3hs y un movimiento de
 * hoy temprano aparecía en el reporte de "ayer".
 */
import { DataSource } from 'typeorm';
import { ReportsService } from '../src/modules/reports/reports.service';
import { SapStockSnapshot } from '../src/modules/reports/entities/sap-stock.entity';
import { Movement } from '../src/modules/movements/entities/movement.entity';
import { businessToday, parseBusinessDate, shiftBusinessDate } from '../src/common/date';
import type { CacheService } from '../src/modules/cache/cache.service';
import {
  createTestDataSource,
  resetDb,
  seedBasics,
  type Basics,
} from './test-datasource';

const noopCache = { get: async () => undefined, set: async () => {}, delPattern: async () => {} } as unknown as CacheService;

let ds: DataSource;
let service: ReportsService;
let base: Basics;

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
  base = await seedBasics(ds);
  service = new ReportsService(ds, ds.getRepository(SapStockSnapshot), noopCache);
});

async function makeMovement(type: 'ENTRY' | 'EXIT', quantity: number, businessDate: string) {
  const repo = ds.getRepository(Movement);
  return repo.save(repo.create({
    type,
    date: parseBusinessDate(businessDate),
    productId: base.product.id,
    quantity,
    warehouseId: base.warehouse.id,
    createdById: base.user.id,
  }));
}

describe('dailyStock — límite del día en Asunción', () => {
  it('un movimiento de hoy aparece en "hoy" y no en "ayer"', async () => {
    const today = businessToday();
    const yesterday = shiftBusinessDate(today, -1);

    await makeMovement('ENTRY', 100, today);
    await makeMovement('EXIT', 30, today);
    await makeMovement('ENTRY', 50, yesterday);

    const todayReport = await service.dailyStock({ dateFrom: today, dateTo: today });
    const todayRow = todayReport.find((r: { material: { id: string } }) => r.material.id === base.product.id);
    expect(todayRow).toMatchObject({ entradas: 100, salidas: 30, stockInicial: 50 });

    const yesterdayReport = await service.dailyStock({ dateFrom: yesterday, dateTo: yesterday });
    const yesterdayRow = yesterdayReport.find((r: { material: { id: string } }) => r.material.id === base.product.id);
    expect(yesterdayRow).toMatchObject({ entradas: 50, salidas: 0, stockInicial: 0 });
  });

  it('un rango de varios días acumula entradas/salidas sin perder ninguna', async () => {
    const today = businessToday();
    const yesterday = shiftBusinessDate(today, -1);

    await makeMovement('ENTRY', 100, today);
    await makeMovement('ENTRY', 50, yesterday);

    const report = await service.dailyStock({ dateFrom: yesterday, dateTo: today });
    const row = report.find((r: { material: { id: string } }) => r.material.id === base.product.id);
    expect(row).toMatchObject({ entradas: 150, salidas: 0, stockInicial: 0 });
  });
});
