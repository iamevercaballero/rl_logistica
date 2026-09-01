import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { StockQueryDto } from './dto/stock-query.dto';
import { ReportsMovementsQueryDto } from './dto/movements-query.dto';
import { KpisQueryDto } from './dto/kpis-query.dto';
import { DailyStockQueryDto } from './dto/daily-stock-query.dto';
import { DifferencesSapQueryDto } from './dto/differences-sap-query.dto';
import { UpsertSapStockDto } from './dto/upsert-sap-stock.dto';
import { SapStockSnapshot } from './entities/sap-stock.entity';
import { roundQuantity } from '../../common/quantity';
import { CacheService } from '../cache/cache.service';
import type { WarehouseScope } from '../warehouses/warehouse-access.service';
import {
  businessDaysUntil,
  businessToday,
  endOfBusinessDay,
  parseBusinessDate,
  rawDateColumnToString,
  shiftBusinessDate,
} from '../../common/date';

/** Forma del reporte de stock — explicita para que el tipo no se pierda al cachear. */
export type StockReport = {
  totalMaterials: number;
  stockRows: number;
  totalQuantity: number;
  byWarehouse: { warehouseId: string | null; warehouseName: string | null; quantity: number }[];
  byMaterial: {
    productId: string; code: string; description: string;
    unitOfMeasure: string | null; quantity: number;
  }[];
  items: unknown[];
};

/** Forma de los KPIs — idem: el tipo tiene que sobrevivir al ida y vuelta por cache. */
export type KpisReport = {
  range: string;
  totalMaterials: number;
  totalQuantity: number;
  movementsCount: number;
  movementsInRange: number;
  movementsPrev: number;
  movementsDelta: number | null;
  pendingRegularizations: number;
  expiringLots: number;
  expiringCritical: number;
  stockByWarehouse: { warehouseId: string | null; warehouseName: string | null; quantity: number }[];
};

/**
 * Techo de filas del historial de trazabilidad de un material (RL-M-16).
 *
 * La consulta no tenía ninguno: devolvía el historial completo, que con diez
 * años de operación son decenas de miles de filas en una sola respuesta. 2.000
 * cubre de sobra cualquier consulta real —el historial de un material en un año
 * son cientos— y el flag `truncated` avisa cuando se llegó al tope, en vez de
 * dejar creer que eso es todo lo que hay.
 */
const TRACE_MAX_FILAS = 2000;

@Injectable()
export class ReportsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SapStockSnapshot)
    private readonly sapStockRepo: Repository<SapStockSnapshot>,
    private readonly cache: CacheService,
  ) {}

  private parseNumber(value: unknown) {
    return Number(value) || 0;
  }

  /**
   * Fragmento estable del alcance para las claves de caché.
   *
   * El alcance (`WarehouseScope`) lo resuelve siempre `WarehouseAccessService`
   * en el controller; acá solo se aplica. Así ningún reporte decide por su
   * cuenta qué depósitos puede ver, y una respuesta cacheada para un depósito
   * nunca se puede servir a otro.
   */
  private scopeKey(scope: WarehouseScope): string {
    return scope ? [...scope].sort().join('_') : 'all';
  }

  /**
   * Salud del inventario: verifica el invariante de la triple contabilidad
   *   Σ Pallet.quantity (no despachados)  ==  Σ Lot.stockActual  ==  Σ Stock.currentQuantity
   * por producto. Devuelve sólo los productos que divergen, con sus deltas.
   * Pensado para un endpoint de salud y para un job de alerta periódica.
   */
  /**
   * Salud del inventario. El invariante Stock = Lotes = Pallets se verifica
   * **por depósito** cuando hay alcance: con multi-depósito, un producto puede
   * cerrar globalmente y estar descuadrado dentro de un depósito concreto.
   *
   * `lots.stockActual` es un total global por lote y no se puede repartir por
   * depósito sin ambigüedad, así que dentro de un alcance acotado el contraste
   * se hace Stock vs Pallets (las dos magnitudes que sí son por ubicación).
   */
  async inventoryHealth(scope: WarehouseScope = null) {
    const scoped = !!scope;
    const params: unknown[] = scoped ? [scope] : [];
    const stockFilter = scoped ? `WHERE "warehouseId" = ANY($1::uuid[])` : '';
    const palletFilter = scoped
      ? `JOIN locations ploc ON ploc.id = pa."currentLocationId" AND ploc."warehouseId" = ANY($1::uuid[])`
      : '';
    // Sin alcance se compara además contra lots.stockActual (comportamiento
    // histórico global); con alcance ese término se neutraliza para no marcar
    // como divergencia lo que simplemente vive en otro depósito.
    const lotTotalExpr = scoped ? `COALESCE(p.total, 0)` : `COALESCE(l.total, 0)`;
    const lotJoin = scoped
      ? ''
      : `LEFT JOIN (
        SELECT "productId", SUM("stockActual") AS total FROM lots GROUP BY "productId"
      ) l ON l."productId" = pr.id`;

    const rows = await this.dataSource.query<Array<{
      productId: string; productCode: string; productDescription: string;
      stockSum: number; lotSum: number; palletSum: number;
    }>>(`
      SELECT
        pr.id                         AS "productId",
        pr.code                       AS "productCode",
        pr.description                AS "productDescription",
        COALESCE(s.total, 0)::float8  AS "stockSum",
        ${lotTotalExpr}::float8       AS "lotSum",
        COALESCE(p.total, 0)::float8  AS "palletSum"
      FROM products pr
      LEFT JOIN (
        SELECT "productId", SUM("currentQuantity") AS total FROM stocks ${stockFilter} GROUP BY "productId"
      ) s ON s."productId" = pr.id
      ${lotJoin}
      LEFT JOIN (
        SELECT lot."productId", SUM(pa.quantity) AS total
        FROM pallets pa
        JOIN lots lot ON lot.id = pa."lotId"
        ${palletFilter}
        WHERE pa.status <> 'EXITED'
        GROUP BY lot."productId"
      ) p ON p."productId" = pr.id
      WHERE COALESCE(s.total, 0) <> ${lotTotalExpr}
         OR ${lotTotalExpr} <> COALESCE(p.total, 0)
      ORDER BY pr.code
    `, params);

    const divergent = rows.map((r) => ({
      ...r,
      stockVsLot: r.stockSum - r.lotSum,
      lotVsPallet: r.lotSum - r.palletSum,
    }));

    // Un descuadre puede cerrar a nivel producto y estar mal repartido entre celdas
    // (stock en una ubicación sin pallets que lo respalden). El total no lo delata,
    // pero el operario va a buscar mercadería que no está ahí.
    const cells = await this.dataSource.query<Array<{
      productId: string; productCode: string; productDescription: string;
      locationId: string | null; locationCode: string | null;
      stockQuantity: number; palletQuantity: number;
    }>>(`
      SELECT
        pr.id            AS "productId",
        pr.code          AS "productCode",
        pr.description   AS "productDescription",
        s."locationId"   AS "locationId",
        loc.code         AS "locationCode",
        s."currentQuantity"::float8 AS "stockQuantity",
        COALESCE(pa.total, 0)::float8 AS "palletQuantity"
      FROM stocks s
      JOIN products pr ON pr.id = s."productId"
      LEFT JOIN locations loc ON loc.id = s."locationId"
      LEFT JOIN (
        SELECT lot."productId", p."currentLocationId" AS "locationId", SUM(p.quantity) AS total
        FROM pallets p
        JOIN lots lot ON lot.id = p."lotId"
        WHERE p.status <> 'EXITED'
        GROUP BY lot."productId", p."currentLocationId"
      ) pa ON pa."productId" = s."productId"
          AND pa."locationId" IS NOT DISTINCT FROM s."locationId"
      WHERE s."currentQuantity" <> COALESCE(pa.total, 0)
        ${scoped ? `AND s."warehouseId" = ANY($1::uuid[])` : ''}
      ORDER BY pr.code, loc.code
    `, params);

    const divergentCells = cells.map((c) => ({
      ...c,
      stockVsPallet: c.stockQuantity - c.palletQuantity,
      orphanLocation: c.locationId !== null && c.locationCode === null,
    }));

    return {
      ok: divergent.length === 0 && divergentCells.length === 0,
      divergentCount: divergent.length,
      divergentCellCount: divergentCells.length,
      checkedAt: new Date().toISOString(),
      divergent,
      divergentCells,
    };
  }

  /**
   * Ocupación del/los depósito(s): ubicaciones ocupadas vs totales y, si las
   * ubicaciones tienen capacidad definida, pallets almacenados vs capacidad.
   */
  async occupancy(scope: WarehouseScope = null) {
    const rows = await this.dataSource.query<Array<{
      warehouseId: string; warehouseName: string;
      totalLocations: number; capacityPallets: number;
      occupiedLocations: number; palletsStored: number;
    }>>(`
      SELECT
        w.id   AS "warehouseId",
        w.name AS "warehouseName",
        COALESCE(loc.total, 0)::int    AS "totalLocations",
        COALESCE(loc.capacity, 0)::int AS "capacityPallets",
        COALESCE(pal.occupied, 0)::int AS "occupiedLocations",
        COALESCE(pal.pallets, 0)::int  AS "palletsStored"
      FROM warehouses w
      LEFT JOIN (
        SELECT "warehouseId",
               COUNT(*) FILTER (WHERE active) AS total,
               SUM("capacityPallets")         AS capacity
        FROM locations GROUP BY "warehouseId"
      ) loc ON loc."warehouseId" = w.id
      LEFT JOIN (
        SELECT l."warehouseId",
               COUNT(DISTINCT p."currentLocationId") AS occupied,
               COUNT(p.id)                           AS pallets
        FROM pallets p
        JOIN locations l ON l.id = p."currentLocationId"
        WHERE p.status NOT IN ('EXITED', 'EMPTY')
        GROUP BY l."warehouseId"
      ) pal ON pal."warehouseId" = w.id
      WHERE w.active ${scope ? `AND w.id = ANY($1::uuid[])` : ''}
      ORDER BY w.name
    `, scope ? [scope] : []);

    const warehouses = rows.map((r) => ({
      ...r,
      freeLocations: Math.max(0, r.totalLocations - r.occupiedLocations),
      locationOccupancyPct: r.totalLocations > 0 ? Math.round((r.occupiedLocations / r.totalLocations) * 100) : 0,
      capacityOccupancyPct: r.capacityPallets > 0 ? Math.round((r.palletsStored / r.capacityPallets) * 100) : null,
    }));

    const sum = (k: 'totalLocations' | 'occupiedLocations' | 'palletsStored' | 'capacityPallets') =>
      warehouses.reduce((s, w) => s + w[k], 0);
    const totalLocations = sum('totalLocations');
    const capacityPallets = sum('capacityPallets');

    return {
      warehouses,
      totals: {
        totalLocations,
        occupiedLocations: sum('occupiedLocations'),
        freeLocations: Math.max(0, totalLocations - sum('occupiedLocations')),
        palletsStored: sum('palletsStored'),
        capacityPallets,
        locationOccupancyPct: totalLocations > 0 ? Math.round((sum('occupiedLocations') / totalLocations) * 100) : 0,
        capacityOccupancyPct: capacityPallets > 0 ? Math.round((sum('palletsStored') / capacityPallets) * 100) : null,
      },
    };
  }

  /**
   * Rotación por producto en un período: unidades despachadas (EXIT) vs stock
   * actual. turnover = exitUnits / stockActual (veces que rotó respecto a lo que
   * tiene hoy). Marca dead stock (con existencia y cero salidas). Default: 30 días.
   */
  async rotation(from?: string, to?: string, scope: WarehouseScope = null) {
    const end = to ? this.toEndDate(to) : new Date();
    const start = from ? this.toStartDate(from) : new Date(Date.now() - 30 * 86_400_000);
    const scopeFilter = scope ? `AND "warehouseId" = ANY($3::uuid[])` : '';
    const stockScopeFilter = scope ? `WHERE "warehouseId" = ANY($3::uuid[])` : '';

    const rows = await this.dataSource.query<Array<{
      productId: string; productCode: string; productDescription: string;
      exitUnits: number; currentStock: number;
    }>>(`
      SELECT
        pr.id          AS "productId",
        pr.code        AS "productCode",
        pr.description AS "productDescription",
        COALESCE(ex.units, 0)::float8 AS "exitUnits",
        COALESCE(st.stock, 0)::float8 AS "currentStock"
      FROM products pr
      LEFT JOIN (
        SELECT "productId", SUM(quantity) AS units
        FROM movements
        WHERE type = 'EXIT' AND date BETWEEN $1 AND $2 AND "voidStatus" <> 'VOIDED' ${scopeFilter}
        GROUP BY "productId"
      ) ex ON ex."productId" = pr.id
      LEFT JOIN (
        SELECT "productId", SUM("currentQuantity") AS stock FROM stocks ${stockScopeFilter} GROUP BY "productId"
      ) st ON st."productId" = pr.id
      WHERE pr.active AND (COALESCE(ex.units, 0) > 0 OR COALESCE(st.stock, 0) > 0)
    `, scope ? [start, end, scope] : [start, end]);

    const products = rows.map((r) => ({
      ...r,
      turnover: r.currentStock > 0 ? Number((r.exitUnits / r.currentStock).toFixed(2)) : (r.exitUnits > 0 ? null : 0),
      deadStock: r.exitUnits === 0 && r.currentStock > 0,
    }));

    return {
      from: start.toISOString(),
      to: end.toISOString(),
      topMovers: products.filter((p) => p.exitUnits > 0).sort((a, b) => b.exitUnits - a.exitUnits).slice(0, 20),
      deadStock: products.filter((p) => p.deadStock).sort((a, b) => b.currentStock - a.currentStock).slice(0, 20),
      totals: {
        products: products.length,
        exitUnits: products.reduce((s, p) => s + p.exitUnits, 0),
        currentStock: products.reduce((s, p) => s + p.currentStock, 0),
      },
    };
  }

  /**
   * Dwell-time / antigüedad de palet: cuánto llevan los pallets en stock.
   * Métrica base de facturación de almacenaje (pallet-días acumulados) y de
   * detección de mercadería estancada. Buckets 0-7 / 8-30 / 31-90 / 90+ días.
   */
  async dwellTime(scope: WarehouseScope = null) {
    const rows = await this.dataSource.query<Array<{
      id: string; code: string; quantity: number; createdAt: string; ageDays: string;
      productCode: string; productDescription: string;
      lotCode: string; locationCode: string | null; warehouseName: string | null;
    }>>(`
      SELECT
        p.id, p.code, p.quantity, p."createdAt",
        EXTRACT(EPOCH FROM (now() - p."createdAt")) / 86400 AS "ageDays",
        pr.code        AS "productCode",
        pr.description AS "productDescription",
        l."lotCode",
        loc.code AS "locationCode",
        w.name   AS "warehouseName"
      FROM pallets p
      JOIN lots l       ON l.id  = p."lotId"
      JOIN products pr  ON pr.id = l."productId"
      LEFT JOIN locations  loc ON loc.id = p."currentLocationId"
      LEFT JOIN warehouses w   ON w.id   = loc."warehouseId"
      WHERE p.status NOT IN ('EXITED', 'EMPTY')
        ${scope ? `AND loc."warehouseId" = ANY($1::uuid[])` : ''}
      ORDER BY p."createdAt" ASC
    `, scope ? [scope] : []);

    const pallets = rows.map((r) => ({
      id: r.id, code: r.code, quantity: r.quantity, createdAt: r.createdAt,
      ageDays: Math.floor(Number(r.ageDays) || 0),
      productCode: r.productCode, productDescription: r.productDescription,
      lotCode: r.lotCode, locationCode: r.locationCode, warehouseName: r.warehouseName,
    }));

    const buckets = { d0_7: 0, d8_30: 0, d31_90: 0, d90plus: 0 };
    let totalPalletDays = 0;
    for (const p of pallets) {
      totalPalletDays += p.ageDays;
      if (p.ageDays <= 7) buckets.d0_7++;
      else if (p.ageDays <= 30) buckets.d8_30++;
      else if (p.ageDays <= 90) buckets.d31_90++;
      else buckets.d90plus++;
    }

    return {
      summary: {
        totalPallets: pallets.length,
        avgAgeDays: pallets.length > 0 ? Math.round(totalPalletDays / pallets.length) : 0,
        totalPalletDays, // pallet-días acumulados → base de facturación de almacenaje
        buckets,
      },
      oldest: pallets.slice(0, 50), // ordenados ASC por createdAt → más antiguos primero
    };
  }

  /**
   * `value` es un día calendario ("YYYY-MM-DD") elegido por el usuario en un
   * filtro — se ancla a medianoche **en el depósito** (Asunción), no en UTC.
   * Anclar en UTC (como antes) desalinea el rango hasta ~4hs contra los
   * timestamps reales, que se guardan vía `parseBusinessDate` con ese mismo
   * anclaje: un movimiento de las 22:00 (Asunción) quedaba fuera de un filtro
   * "hasta hoy".
   */
  private toStartDate(value: string) {
    return parseBusinessDate(value);
  }

  private toEndDate(value: string) {
    return endOfBusinessDay(value);
  }

  private getRangeDates(range: 'today' | 'week' | 'month') {
    const now = new Date();
    if (range === 'today') {
      return { start: parseBusinessDate(businessToday()), end: now };
    }

    const days = range === 'week' ? 7 : 30;
    return { start: new Date(now.getTime() - days * 86_400_000), end: now };
  }

  /** Returns the equivalent previous period window (same duration, immediately before current). */
  private getPreviousRangeDates(range: 'today' | 'week' | 'month') {
    const now = new Date();
    if (range === 'today') {
      // Previous period = yesterday (día calendario completo en Asunción)
      const end = parseBusinessDate(businessToday());
      const start = parseBusinessDate(shiftBusinessDate(businessToday(), -1));
      return { start, end };
    }
    const days = range === 'week' ? 7 : 30;
    const end = new Date(now.getTime() - days * 86_400_000);
    const start = new Date(end.getTime() - days * 86_400_000);
    return { start, end };
  }

  async stock(query: StockQueryDto, scope: WarehouseScope = null) {
    // La clave lleva el alcance completo: una respuesta calculada para un
    // depósito nunca puede servirse a otro (ni a un usuario con otro alcance).
    const cacheKey = `stock:warehouse:${this.scopeKey(scope)}:${query.locationId ?? 'all'}`;
    const cached = await this.cache.get<StockReport>(cacheKey);
    if (cached) return cached;

    const qb = this.dataSource
      .createQueryBuilder()
      .from('stocks', 's')
      .leftJoin('products', 'p', 'p.id = s."productId"')
      .leftJoin('warehouses', 'w', 'w.id = s."warehouseId"')
      .leftJoin('locations', 'l', 'l.id = s."locationId"')
      .select('s.id', 'id')
      .addSelect('s."currentQuantity"', 'currentQuantity')
      .addSelect('s."updatedAt"', 'updatedAt')
      .addSelect('p.id', 'productId')
      .addSelect('p.code', 'productCode')
      .addSelect('p.description', 'productDescription')
      .addSelect('p."unitOfMeasure"', 'unitOfMeasure')
      .addSelect('w.id', 'warehouseId')
      .addSelect('w.name', 'warehouseName')
      .addSelect('l.id', 'locationId')
      .addSelect('l.code', 'locationCode');

    if (scope) qb.andWhere('s."warehouseId" IN (:...scopeIds)', { scopeIds: scope });
    if (query.locationId) qb.andWhere('s."locationId" = :locationId', { locationId: query.locationId });

    const [items, totalsRaw, byWarehouse, byMaterial] = await Promise.all([
      qb.clone().orderBy('p.code', 'ASC').getRawMany(),
      qb.clone()
        .select('COUNT(DISTINCT s.id)', 'stockRows')
        .addSelect('COUNT(DISTINCT s."productId")', 'materials')
        .addSelect('COALESCE(SUM(s."currentQuantity"), 0)', 'totalQuantity')
        .getRawOne(),
      qb.clone()
        .select('w.id', 'warehouseId')
        .addSelect('w.name', 'warehouseName')
        .addSelect('COALESCE(SUM(s."currentQuantity"), 0)', 'quantity')
        .groupBy('w.id')
        .addGroupBy('w.name')
        .orderBy('w.name', 'ASC')
        .getRawMany(),
      qb.clone()
        .select('p.id', 'productId')
        .addSelect('p.code', 'productCode')
        .addSelect('p.description', 'productDescription')
        .addSelect('p."unitOfMeasure"', 'unitOfMeasure')
        .addSelect('COALESCE(SUM(s."currentQuantity"), 0)', 'quantity')
        .groupBy('p.id')
        .addGroupBy('p.code')
        .addGroupBy('p.description')
        .addGroupBy('p."unitOfMeasure"')
        .orderBy('p.code', 'ASC')
        .getRawMany(),
    ]);

    const stockResult: StockReport = {
      totalMaterials: this.parseNumber(totalsRaw?.materials),
      stockRows: this.parseNumber(totalsRaw?.stockRows),
      totalQuantity: this.parseNumber(totalsRaw?.totalQuantity),
      byWarehouse: byWarehouse.map((row) => ({
        warehouseId: row.warehouseId,
        warehouseName: row.warehouseName,
        quantity: this.parseNumber(row.quantity),
      })),
      byMaterial: byMaterial.map((row) => ({
        productId: row.productId,
        code: row.productCode,
        description: row.productDescription,
        unitOfMeasure: row.unitOfMeasure,
        quantity: this.parseNumber(row.quantity),
      })),
      items: items.map((row) => ({
        id: row.id,
        currentQuantity: this.parseNumber(row.currentQuantity),
        updatedAt: row.updatedAt,
        material: {
          id: row.productId,
          code: row.productCode,
          description: row.productDescription,
          unitOfMeasure: row.unitOfMeasure,
        },
        warehouse: row.warehouseId ? { id: row.warehouseId, name: row.warehouseName } : null,
        location: row.locationId ? { id: row.locationId, code: row.locationCode } : null,
      })),
    };

    // Cache for 30 s — invalidated by MovementsService on any stock change
    void this.cache.set(cacheKey, stockResult, 30);
    return stockResult;
  }

  /** Depósitos del alcance, para rotularlos en encabezados de reportes/exportaciones. */
  async scopeLabel(scope: WarehouseScope): Promise<string | null> {
    if (!scope || scope.length === 0) return null;
    const rows = await this.dataSource.query<Array<{ documentCode: string | null; name: string }>>(
      `SELECT "documentCode", name FROM warehouses WHERE id = ANY($1::uuid[]) ORDER BY "documentCode" NULLS LAST, name`,
      [scope],
    );
    return rows.map((r) => (r.documentCode ? `${r.documentCode} · ${r.name}` : r.name)).join(' / ') || null;
  }

  async movements(query: ReportsMovementsQueryDto, scope: WarehouseScope = null) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.dataSource
      .createQueryBuilder()
      .from('movements', 'm')
      .leftJoin('products', 'p', 'p.id = m."productId"')
      .leftJoin('warehouses', 'w', 'w.id = m."warehouseId"')
      .leftJoin('locations', 'l', 'l.id = m."locationId"')
      .leftJoin('warehouses', 'fw', 'fw.id = m."fromWarehouseId"')
      .leftJoin('locations', 'fl', 'fl.id = m."fromLocationId"')
      .leftJoin('warehouses', 'tw', 'tw.id = m."toWarehouseId"')
      .leftJoin('locations', 'tl', 'tl.id = m."toLocationId"')
      .leftJoin('lots', 'lot', 'lot.id = m."lotId"')
      .leftJoin(
        (sq) =>
          sq
            .from('movement_details', 'md')
            .innerJoin('lots', 'dl', 'dl.id = md."lotId"')
            .select('md."movementId"', 'movementId')
            .addSelect('STRING_AGG(DISTINCT dl."lotCode", \', \' ORDER BY dl."lotCode")', 'lotCodes')
            .addSelect('STRING_AGG(DISTINCT dl."sapLot", \', \' ORDER BY dl."sapLot")', 'sapLots')
            .addSelect('COUNT(DISTINCT dl.id)', 'lotCount')
            .addSelect(`(
              SELECT JSON_AGG(lot_row ORDER BY lot_row."lotCode")
              FROM (
                SELECT
                  dl2."lotCode"                                                                 AS "lotCode",
                  dl2."sapLot"                                                                  AS "sapLot",
                  COUNT(DISTINCT md2."palletId") FILTER (WHERE md2."palletId" IS NOT NULL)::int AS "pallets",
                  SUM(md2.quantity)::float8                                                     AS "quantity"
                FROM movement_details md2
                INNER JOIN lots dl2 ON dl2.id = md2."lotId"
                WHERE md2."movementId" = md."movementId"
                GROUP BY dl2.id, dl2."lotCode", dl2."sapLot"
              ) lot_row
            )`, 'lotsDetail')
            .groupBy('md."movementId"'),
        'dl_agg',
        'dl_agg."movementId" = m.id',
      )
      .select('m.id', 'id')
      .addSelect('m.type', 'type')
      .addSelect('m.date', 'date')
      .addSelect('m."createdAt"', 'createdAt')
      .addSelect('m.quantity', 'quantity')
      .addSelect('m.pallets', 'pallets')
      .addSelect('m."documentNumber"', 'documentNumber')
      .addSelect('m.supplier', 'supplier')
      .addSelect('m.carrier', 'carrier')
      .addSelect('m.driver', 'driver')
      .addSelect('m.destination', 'destination')
      .addSelect('m."documentoMaterial"', 'documentoMaterial')
      .addSelect('m.notes', 'notes')
      .addSelect('m.status', 'status')
      .addSelect('m."voidStatus"', 'voidStatus')
      .addSelect('m."adjustmentReason"', 'adjustmentReason')
      .addSelect('p.id', 'productId')
      .addSelect('p.code', 'productCode')
      .addSelect('p.description', 'productDescription')
      .addSelect('p."unitOfMeasure"', 'unitOfMeasure')
      .addSelect('p."usesSapLot"', 'productUsesSapLot')
      .addSelect('w.id', 'warehouseId')
      .addSelect('w.name', 'warehouseName')
      .addSelect('w."usesSapLot"', 'warehouseUsesSapLot')
      .addSelect('l.id', 'locationId')
      .addSelect('l.code', 'locationCode')
      .addSelect('fw.name', 'fromWarehouseName')
      .addSelect('fl.code', 'fromLocationCode')
      .addSelect('tw.name', 'toWarehouseName')
      .addSelect('tl.code', 'toLocationCode')
      .addSelect('COALESCE(lot."lotCode", dl_agg."lotCodes")', 'lotCode')
      .addSelect('COALESCE(lot."sapLot", dl_agg."sapLots")', 'sapLot')
      .addSelect('COALESCE(dl_agg."lotCount", CASE WHEN lot.id IS NOT NULL THEN 1 ELSE 0 END)', 'lotCount');

    if (scope) {
      // Un movimiento pertenece al alcance si cualquiera de sus tres depósitos
      // (propio, origen o destino) está permitido: así una transferencia se ve
      // desde ambas puntas sin filtrar de más.
      qb.andWhere(
        '(m."warehouseId" IN (:...scopeIds) OR m."fromWarehouseId" IN (:...scopeIds) OR m."toWarehouseId" IN (:...scopeIds))',
        { scopeIds: scope },
      );
    }
    if (query.locationId) {
      qb.andWhere('(m."locationId" = :locationId OR m."fromLocationId" = :locationId OR m."toLocationId" = :locationId)', { locationId: query.locationId });
    }
    if (query.productId) qb.andWhere('m."productId" = :productId', { productId: query.productId });
    if (query.type) qb.andWhere('m.type = :type', { type: query.type });
    if (query.status) qb.andWhere('m.status = :status', { status: query.status });
    if (query.dateFrom) qb.andWhere('m.date >= :dateFrom', { dateFrom: this.toStartDate(query.dateFrom) });
    if (query.dateTo) qb.andWhere('m.date <= :dateTo', { dateTo: this.toEndDate(query.dateTo) });
    if (query.search?.trim()) {
      qb.andWhere(
        `(LOWER(COALESCE(m."documentNumber", '')) LIKE :search
          OR LOWER(COALESCE(m.supplier, '')) LIKE :search
          OR LOWER(COALESCE(m.destination, '')) LIKE :search
          OR LOWER(COALESCE(m."documentoMaterial", '')) LIKE :search
          OR LOWER(COALESCE(m.notes, '')) LIKE :search
          OR LOWER(COALESCE(p.code, '')) LIKE :search
          OR LOWER(COALESCE(p.description, '')) LIKE :search)`,
        { search: `%${query.search.trim().toLowerCase()}%` },
      );
    }

    const [data, total] = await Promise.all([
      qb.clone()
        .orderBy('m.date', 'DESC')
        .addOrderBy('m."createdAt"', 'DESC')
        .offset((page - 1) * limit)
        .limit(limit)
        .getRawMany(),
      qb.clone().select('COUNT(m.id)', 'total').getRawOne(),
    ]);

    return {
      data: data.map((row) => ({
        id: row.id,
        type: row.type,
        date: row.date,
        createdAt: row.createdAt ?? row.date,
        quantity: this.parseNumber(row.quantity),
        pallets: row.pallets === null || row.pallets === undefined ? null : this.parseNumber(row.pallets),
        documentNumber: row.documentNumber,
        supplier: row.supplier,
        carrier: row.carrier,
        driver: row.driver,
        destination: row.destination,
        documentoMaterial: row.documentoMaterial,
        notes: row.notes,
        material: {
          id: row.productId,
          code: row.productCode,
          description: row.productDescription,
          unitOfMeasure: row.unitOfMeasure,
          // El reporte también decide si corresponde mostrar `sapLot`: sin esto,
          // el frontend no puede distinguir un lote SAP vigente de uno que
          // quedó de antes de que el material o el depósito se reconfiguraran.
          usesSapLot: row.productUsesSapLot ?? true,
        },
        warehouse: row.warehouseId
          ? { id: row.warehouseId, name: row.warehouseName, usesSapLot: row.warehouseUsesSapLot ?? true }
          : null,
        location: row.locationId ? { id: row.locationId, code: row.locationCode } : null,
        lotCode: row.lotCode ?? null,
        sapLot: row.sapLot ?? null,
        lotCount: this.parseNumber(row.lotCount),
        lotsDetail: row.lotsDetail
          ? (Array.isArray(row.lotsDetail) ? row.lotsDetail : JSON.parse(row.lotsDetail as string))
          : null,
        status: row.status ?? 'NORMAL',
        voidStatus: row.voidStatus ?? 'NONE',
        adjustmentReason: row.adjustmentReason ?? null,
        from: row.fromWarehouseName || row.fromLocationCode ? { warehouseName: row.fromWarehouseName, locationCode: row.fromLocationCode } : null,
        to: row.toWarehouseName || row.toLocationCode ? { warehouseName: row.toWarehouseName, locationCode: row.toLocationCode } : null,
      })),
      meta: {
        page,
        limit,
        total: this.parseNumber(total?.total),
        totalPages: Math.max(1, Math.ceil(this.parseNumber(total?.total) / limit)),
      },
    };
  }

  async trace(materialId: string, scope: WarehouseScope = null) {
    const material = await this.dataSource
      .createQueryBuilder()
      .from('products', 'p')
      .select('p.id', 'id')
      .addSelect('p.code', 'code')
      .addSelect('p.description', 'description')
      .where('p.id = :materialId', { materialId })
      .getRawOne();

    if (!material) {
      throw new NotFoundException('Material no encontrado');
    }

    const historyQb = this.dataSource
      .createQueryBuilder()
      .from('movements', 'm')
      .leftJoin('warehouses', 'w', 'w.id = m."warehouseId"')
      .leftJoin('locations', 'l', 'l.id = m."locationId"')
      .leftJoin('warehouses', 'fw', 'fw.id = m."fromWarehouseId"')
      .leftJoin('locations', 'fl', 'fl.id = m."fromLocationId"')
      .leftJoin('warehouses', 'tw', 'tw.id = m."toWarehouseId"')
      .leftJoin('locations', 'tl', 'tl.id = m."toLocationId"')
      .select('m.id', 'movementId')
      // `date` es el día operativo elegido en el formulario. Para auditoría y
      // trazabilidad se muestra el instante real de creación, que sí conserva
      // la hora; los filtros diarios continúan usando `date`.
      .addSelect('m."createdAt"', 'at')
      .addSelect('m.type', 'type')
      .addSelect('m.quantity', 'quantity')
      .addSelect('m."documentNumber"', 'documentNumber')
      .addSelect('m.supplier', 'supplier')
      .addSelect('m.destination', 'destination')
      .addSelect('m."documentoMaterial"', 'documentoMaterial')
      .addSelect('m.notes', 'notes')
      .addSelect('m."voidStatus"', 'voidStatus')
      .addSelect('w.name', 'warehouseName')
      .addSelect('l.code', 'locationCode')
      .addSelect('fw.name', 'fromWarehouseName')
      .addSelect('fl.code', 'fromLocationCode')
      .addSelect('tw.name', 'toWarehouseName')
      .addSelect('tl.code', 'toLocationCode')
      .where('m."productId" = :materialId', { materialId })
      .orderBy('m.date', 'ASC')
      .addOrderBy('m."createdAt"', 'ASC');

    if (scope) {
      historyQb.andWhere(
        '(m."warehouseId" IN (:...scopeIds) OR m."fromWarehouseId" IN (:...scopeIds) OR m."toWarehouseId" IN (:...scopeIds))',
        { scopeIds: scope },
      );
    }

    // Tope explícito (RL-M-16): esta consulta devolvía el historial COMPLETO de
    // un material, sin límite. Con diez años de operación son decenas de miles
    // de filas en una sola respuesta. Se corta y se avisa que se cortó, en vez
    // de devolver una trazabilidad recortada que parece completa.
    const historyRows = await historyQb.take(TRACE_MAX_FILAS + 1).getRawMany();
    const truncated = historyRows.length > TRACE_MAX_FILAS;
    const history = truncated ? historyRows.slice(0, TRACE_MAX_FILAS) : historyRows;

    return {
      material,
      history: history.map((row) => ({
        movementId: row.movementId,
        at: row.at,
        type: row.type,
        quantity: this.parseNumber(row.quantity),
        documentNumber: row.documentNumber,
        supplier: row.supplier,
        destination: row.destination,
        documentoMaterial: row.documentoMaterial,
        notes: row.notes,
        voidStatus: row.voidStatus ?? 'NONE',
        warehouseName: row.warehouseName,
        locationCode: row.locationCode,
        fromWarehouseName: row.fromWarehouseName,
        fromLocationCode: row.fromLocationCode,
        toWarehouseName: row.toWarehouseName,
        toLocationCode: row.toLocationCode,
      })),
      // `true` significa que hay más historial del que se devolvió. Va explícito
      // para que la pantalla pueda decirlo: una trazabilidad recortada que se
      // presenta como completa es peor que no tenerla.
      truncated,
      limit: TRACE_MAX_FILAS,
    };
  }

  async dailyStock(query: DailyStockQueryDto, scope: WarehouseScope = null) {
    const today = businessToday();
    const from = (query.dateFrom ?? query.date ?? today).slice(0, 10);
    const to   = (query.dateTo   ?? query.date ?? today).slice(0, 10);
    const date = from; // kept for SAP snapshot lookup and response label
    // La ventana del día es de medianoche a medianoche **en Asunción** — mismo
    // criterio que `toStartDate`/`toEndDate` de acá abajo, reusados en vez de
    // reimplementados: un `.toISOString()` acá volvía a romperlo. `date`
    // (`timestamp` sin zona) comparado contra un parámetro STRING con 'Z' se
    // castea recortando el sufijo de zona, no convirtiéndolo — Postgres lee
    // "2026-08-22T03:00:00.000Z" como el instante naive 03:00, tres horas
    // después de la medianoche real que representaba. Pasar el `Date` tal
    // cual (sin `.toISOString()`) deja que el driver lo serialice en hora
    // local del proceso, que es la que coincide con lo guardado.
    const dayStart = this.toStartDate(from);
    const dayEnd   = this.toEndDate(to);

    const movementFilter = this.buildMovementScopeFilter(query, 2, scope);
    const sapFilter = this.buildSapScopeFilter(query, 1, scope);

    const rows = await this.dataSource.query(
      `
      SELECT
        p.id AS "productId",
        p.code AS "productCode",
        p.description AS "productDescription",
        p."unitOfMeasure" AS "unitOfMeasure",
        COALESCE(SUM(CASE
          WHEN m.date < $1 AND m.type IN ('ENTRY', 'ADJUSTMENT_IN', 'REPROCESS') THEN m.quantity
          WHEN m.date < $1 AND m.type IN ('EXIT', 'ADJUSTMENT_OUT') THEN -m.quantity
          ELSE 0
        END), 0) AS "stockInicial",
        COALESCE(SUM(CASE
          WHEN m.date >= $1 AND m.date <= $2 AND m.type IN ('ENTRY', 'ADJUSTMENT_IN', 'REPROCESS') THEN m.quantity
          ELSE 0
        END), 0) AS entradas,
        COALESCE(SUM(CASE
          WHEN m.date >= $1 AND m.date <= $2 AND m.type IN ('EXIT', 'ADJUSTMENT_OUT') THEN m.quantity
          ELSE 0
        END), 0) AS salidas
      FROM products p
      LEFT JOIN movements m ON m."productId" = p.id AND m."voidStatus" <> 'VOIDED'

      WHERE p.active = true ${movementFilter.whereSuffix}
      GROUP BY p.id, p.code, p.description, p."unitOfMeasure"
      ORDER BY p.code ASC
      `,
      [dayStart, dayEnd, ...movementFilter.params],
    );

    const sapRows = await this.dataSource.query(
      `
      SELECT s."productId", COALESCE(SUM(s."sapQuantity"), 0) AS "sapQuantity"
      FROM sap_stock_snapshots s
      WHERE s.date = $1 ${sapFilter.whereSuffix}
      GROUP BY s."productId"
      `,
      [date, ...sapFilter.params],
    );

    const sapByProduct = new Map<string, number>(
      sapRows.map((row: { productId: string; sapQuantity: string }) => [row.productId, this.parseNumber(row.sapQuantity)]),
    );

    return rows.map((row: Record<string, string>) => {
      const stockInicial = this.parseNumber(row.stockInicial);
      const entradas = this.parseNumber(row.entradas);
      const salidas = this.parseNumber(row.salidas);
      const stockFinal = roundQuantity(stockInicial + entradas - salidas);
      const stockSAP = sapByProduct.get(row.productId) ?? 0;

      return {
        date,
        material: {
          id: row.productId,
          code: row.productCode,
          description: row.productDescription,
          unitOfMeasure: row.unitOfMeasure,
        },
        stockInicial,
        entradas,
        salidas,
        stockFinal,
        stockSAP,
        diferencia: roundQuantity(stockFinal - stockSAP),
      };
    });
  }

  async upsertSapStock(dto: UpsertSapStockDto) {
    const existing = await this.sapStockRepo
      .createQueryBuilder('snapshot')
      .where('snapshot.date = :date', { date: dto.date.slice(0, 10) })
      .andWhere('snapshot."productId" = :productId', { productId: dto.productId })
      .andWhere(dto.warehouseId ? 'snapshot."warehouseId" = :warehouseId' : 'snapshot."warehouseId" IS NULL', {
        warehouseId: dto.warehouseId,
      })
      .andWhere(dto.locationId ? 'snapshot."locationId" = :locationId' : 'snapshot."locationId" IS NULL', {
        locationId: dto.locationId,
      })
      .getOne();

    const snapshot = this.sapStockRepo.create({
      ...existing,
      date: dto.date.slice(0, 10),
      productId: dto.productId,
      warehouseId: dto.warehouseId ?? null,
      locationId: dto.locationId ?? null,
      sapQuantity: dto.sapQuantity,
    });

    return this.sapStockRepo.save(snapshot);
  }

  async differencesSap(query: DifferencesSapQueryDto, scope: WarehouseScope = null) {
    const daily = await this.dailyStock({
      date: query.date,
      productId: query.productId,
      locationId: query.locationId,
    }, scope);

    return daily.filter((row: { stockSAP: number; diferencia: number }) => row.stockSAP !== 0 || row.diferencia !== 0);
  }

  async kpis(query: KpisQueryDto, scope: WarehouseScope = null) {
    const range = query.range ?? 'today';

    // La clave incluye el alcance: los KPIs del depósito 01 no pueden servirse
    // como si fueran los del 02 (ni los de un usuario con otro alcance).
    const cacheKey = `kpis:warehouse:${this.scopeKey(scope)}:${range}`;
    const cached = await this.cache.get<KpisReport>(cacheKey);
    if (cached) return cached;

    const { start, end } = this.getRangeDates(range);
    const { start: prevStart, end: prevEnd } = this.getPreviousRangeDates(range);

    // Expiry thresholds: lots expiring in ≤60 días. fechaVencimiento es una
    // fecha calendario (columna 'date'), así que el umbral se calcula y se
    // compara también como calendario ("YYYY-MM-DD") — nunca como instante:
    // comparar contra un Date real desalinea el resultado según la zona del
    // proceso y del servidor de Postgres.
    const today = businessToday();
    const in15 = shiftBusinessDate(today, 15);
    const in60 = shiftBusinessDate(today, 60);

    /** Aplica el alcance a un builder sobre `stocks`/`movements` con alias dado. */
    const scoped = <T extends { andWhere: (w: string, p?: object) => T }>(
      qb: T,
      expression: string,
    ): T => (scope ? qb.andWhere(expression, { scopeIds: scope }) : qb);

    const [
      stockRaw,
      movementsRaw,
      prevMovementsRaw,
      stockByWarehouseRaw,
      pendingRaw,
      expiringRaw,
    ] = await Promise.all([
      // Current stock totals
      scoped(
        this.dataSource
          .createQueryBuilder()
          .from('stocks', 's')
          .select('COUNT(DISTINCT s."productId")', 'materials')
          .addSelect('COALESCE(SUM(s."currentQuantity"), 0)', 'totalQuantity'),
        's."warehouseId" IN (:...scopeIds)',
      ).getRawOne(),

      // Movements in current period
      scoped(
        this.dataSource
          .createQueryBuilder()
          .from('movements', 'm')
          .select('COUNT(m.id)', 'movementsInRange')
          .where('m.date >= :start AND m.date <= :end', { start, end }),
        '(m."warehouseId" IN (:...scopeIds) OR m."fromWarehouseId" IN (:...scopeIds) OR m."toWarehouseId" IN (:...scopeIds))',
      ).getRawOne(),

      // Movements in previous period (for trend delta)
      scoped(
        this.dataSource
          .createQueryBuilder()
          .from('movements', 'm')
          .select('COUNT(m.id)', 'prevMovements')
          .where('m.date >= :prevStart AND m.date < :prevEnd', { prevStart, prevEnd }),
        '(m."warehouseId" IN (:...scopeIds) OR m."fromWarehouseId" IN (:...scopeIds) OR m."toWarehouseId" IN (:...scopeIds))',
      ).getRawOne(),

      // Stock by warehouse
      scoped(
        this.dataSource
          .createQueryBuilder()
          .from('stocks', 's')
          .leftJoin('warehouses', 'w', 'w.id = s."warehouseId"')
          .select('w.id', 'warehouseId')
          .addSelect('w.name', 'warehouseName')
          .addSelect('COALESCE(SUM(s."currentQuantity"), 0)', 'quantity')
          .groupBy('w.id')
          .addGroupBy('w.name')
          .orderBy('w.name', 'ASC'),
        's."warehouseId" IN (:...scopeIds)',
      ).getRawMany(),

      // Pending regularizations count — un movimiento anulado ya no necesita regularizarse.
      scoped(
        this.dataSource
          .createQueryBuilder()
          .from('movements', 'm')
          .select('COUNT(m.id)', 'pending')
          .where('m.status = :status', { status: 'PENDING_REGULARIZATION' })
          .andWhere('m."voidStatus" = :voidStatus', { voidStatus: 'NONE' }),
        '(m."warehouseId" IN (:...scopeIds) OR m."fromWarehouseId" IN (:...scopeIds) OR m."toWarehouseId" IN (:...scopeIds))',
      ).getRawOne(),

      // Lots expiring within 60 days (with available pallets).
      // El lote es global por producto: lo que lo ancla a un depósito es dónde
      // están hoy sus pallets vivos, así que el alcance se aplica por ubicación
      // actual y el stock informado es el de ESE depósito, no el global.
      scoped(
        this.dataSource
          .createQueryBuilder()
          .from('lots', 'l')
          .innerJoin('pallets', 'pa', `pa."lotId" = l.id AND pa.status NOT IN ('EXITED', 'EMPTY')`)
          .innerJoin('locations', 'ploc', 'ploc.id = pa."currentLocationId"')
          .select('l.id', 'id')
          .addSelect('l."fechaVencimiento"', 'fechaVencimiento')
          .addSelect('SUM(pa.quantity)', 'stockActual')
          .where('l."fechaVencimiento" IS NOT NULL')
          .andWhere('l."fechaVencimiento" <= :in60', { in60 })
          .andWhere('l."fechaVencimiento" >= :today', { today })
          .groupBy('l.id')
          .addGroupBy('l."fechaVencimiento"')
          .having('SUM(pa.quantity) > 0')
          .orderBy('l."fechaVencimiento"', 'ASC')
          .limit(50),
        'ploc."warehouseId" IN (:...scopeIds)',
      ).getRawMany(),
    ]);

    const currentMov = this.parseNumber(movementsRaw?.movementsInRange);
    const prevMov = this.parseNumber(prevMovementsRaw?.prevMovements);

    // Trend delta %: null when previous is 0 (no comparison baseline)
    let movementsDelta: number | null = null;
    if (prevMov > 0) {
      movementsDelta = Math.round(((currentMov - prevMov) / prevMov) * 100);
    } else if (currentMov > 0) {
      movementsDelta = 100; // went from 0 to something → +100%
    }

    const expiringCritical = expiringRaw.filter(
      (r) => r.fechaVencimiento <= in15,
    ).length;

    const kpisResult: KpisReport = {
      range,
      totalMaterials: this.parseNumber(stockRaw?.materials),
      totalQuantity: this.parseNumber(stockRaw?.totalQuantity),
      movementsCount: currentMov,
      movementsInRange: currentMov,
      movementsPrev: prevMov,
      movementsDelta,
      pendingRegularizations: this.parseNumber(pendingRaw?.pending),
      expiringLots: expiringRaw.length,
      expiringCritical,
      stockByWarehouse: stockByWarehouseRaw.map((row) => ({
        warehouseId: row.warehouseId,
        warehouseName: row.warehouseName,
        quantity: this.parseNumber(row.quantity),
      })),
    };

    // Cache for 60 s — movements create/regularize invalidate automatically
    void this.cache.set(cacheKey, kpisResult, 60);
    return kpisResult;
  }

  async freshness(productId?: string, scope: WarehouseScope = null) {
    // Control Frescura es una vista operativa: el stock informado por lote debe
    // ser el del depósito activo. Un lote solo "existe" en un depósito si tiene
    // pallets vivos ahí, así que se agrega por pallets y no por `l.stockActual`
    // (que es el total global del lote en todos los depósitos).
    const qb = this.dataSource
      .createQueryBuilder()
      .from('lots', 'l')
      .innerJoin('products', 'p', 'p.id = l."productId"')
      .innerJoin('pallets', 'pa', `pa."lotId" = l.id AND pa.status NOT IN ('EXITED', 'EMPTY')`)
      .innerJoin('locations', 'ploc', 'ploc.id = pa."currentLocationId"')
      .select('l.id', 'lotId')
      .addSelect('l."lotCode"', 'lotCode')
      .addSelect('l."sapLot"', 'sapLot')
      .addSelect('l."fechaVencimiento"', 'fechaVencimiento')
      .addSelect('l."fechaFabricacion"', 'fechaFabricacion')
      .addSelect('SUM(pa.quantity)', 'stockActual')
      .addSelect('l."proveedor"', 'proveedor')
      .addSelect('p.id', 'productId')
      .addSelect('p.code', 'productCode')
      .addSelect('p.description', 'productDescription')
      .addSelect('p."unitOfMeasure"', 'unitOfMeasure')
      .addSelect('p."usesSapLot"', 'productUsesSapLot')
      .where('l."fechaVencimiento" IS NOT NULL')
      .groupBy('l.id')
      .addGroupBy('l."lotCode"')
      .addGroupBy('l."sapLot"')
      .addGroupBy('l."fechaVencimiento"')
      .addGroupBy('l."fechaFabricacion"')
      .addGroupBy('l."proveedor"')
      .addGroupBy('p.id')
      .addGroupBy('p.code')
      .addGroupBy('p.description')
      .addGroupBy('p."unitOfMeasure"')
      .addGroupBy('p."usesSapLot"')
      .having('SUM(pa.quantity) > 0');

    if (productId) {
      qb.andWhere('l."productId" = :productId', { productId });
    }
    if (scope) {
      qb.andWhere('ploc."warehouseId" IN (:...scopeIds)', { scopeIds: scope });
    }

    const rows = await qb.orderBy('l."fechaVencimiento"', 'ASC').getRawMany();

    return rows.map((r) => {
      // fechaVencimiento es fecha calendario: comparar contra un lote que
      // vence "hoy" debía dar 0, no -1 (ya vencido) — new Date(fechaVencimiento)
      // se interpreta como medianoche UTC, y comparado contra un instante real
      // corría el resultado un día. businessDaysUntil compara calendario contra calendario.
      // `getRawMany()` no pasa por los transformers de TypeORM: `r.fechaVencimiento`
      // llega como `Date` (anclado a medianoche LOCAL, no UTC), no como string —
      // rawDateColumnToString la normaliza antes de tocarla.
      const fechaVencimiento = rawDateColumnToString(r.fechaVencimiento);
      const diasRestantes = businessDaysUntil(fechaVencimiento)!; // fechaVencimiento no es null: la query lo filtra arriba
      return {
        lotId: r.lotId,
        lotCode: r.lotCode,
        sapLot: r.sapLot ?? null,
        fechaVencimiento,
        fechaFabricacion: rawDateColumnToString(r.fechaFabricacion),
        stockActual: this.parseNumber(r.stockActual),
        proveedor: r.proveedor ?? null,
        diasRestantes,
        product: {
          id: r.productId,
          code: r.productCode,
          description: r.productDescription,
          unitOfMeasure: r.unitOfMeasure ?? null,
          // Solo el nivel material: esta consulta agrupa por lote y puede sumar
          // stock de varios depósitos del alcance del usuario en una sola fila,
          // así que acá no hay un único depósito contra el cual decidir si el
          // Lote SAP corresponde. El frontend igual puede ocultarlo cuando el
          // material no lo usa, que es el caso sin ambigüedad.
          usesSapLot: r.productUsesSapLot ?? true,
        },
      };
    });
  }

  private buildMovementScopeFilter(
    query: { productId?: string; locationId?: string },
    placeholderOffset: number,
    scope: WarehouseScope = null,
  ) {
    const params: unknown[] = [];
    const clauses: string[] = [];

    if (query.productId) {
      params.push(query.productId);
      clauses.push(`m."productId" = $${placeholderOffset + params.length}`);
    }
    if (scope) {
      params.push(scope);
      const p = `$${placeholderOffset + params.length}::uuid[]`;
      clauses.push(`(m."warehouseId" = ANY(${p}) OR m."fromWarehouseId" = ANY(${p}) OR m."toWarehouseId" = ANY(${p}))`);
    }
    if (query.locationId) {
      params.push(query.locationId);
      clauses.push(`(m."locationId" = $${placeholderOffset + params.length} OR m."fromLocationId" = $${placeholderOffset + params.length} OR m."toLocationId" = $${placeholderOffset + params.length})`);
    }

    return { params, whereSuffix: clauses.length ? ` AND ${clauses.join(' AND ')}` : '' };
  }

  private buildSapScopeFilter(
    query: { productId?: string; locationId?: string },
    placeholderOffset: number,
    scope: WarehouseScope = null,
  ) {
    const params: unknown[] = [];
    const clauses: string[] = [];

    if (query.productId) {
      params.push(query.productId);
      clauses.push(`s."productId" = $${placeholderOffset + params.length}`);
    }
    if (scope) {
      params.push(scope);
      clauses.push(`s."warehouseId" = ANY($${placeholderOffset + params.length}::uuid[])`);
    }
    if (query.locationId) {
      params.push(query.locationId);
      clauses.push(`s."locationId" = $${placeholderOffset + params.length}`);
    }

    return { params, whereSuffix: clauses.length ? ` AND ${clauses.join(' AND ')}` : '' };
  }
}
