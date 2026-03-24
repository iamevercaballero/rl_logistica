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

@Injectable()
export class ReportsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SapStockSnapshot)
    private readonly sapStockRepo: Repository<SapStockSnapshot>,
  ) {}

  private parseNumber(value: unknown) {
    return Number(value) || 0;
  }

  private toStartDate(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T00:00:00.000Z`);
    }
    return new Date(value);
  }

  private toEndDate(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T23:59:59.999Z`);
    }
    return new Date(value);
  }

  private getRangeDates(range: 'today' | 'week' | 'month') {
    const now = new Date();
    if (range === 'today') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { start, end: now };
    }

    const days = range === 'week' ? 7 : 30;
    const start = new Date(now);
    start.setDate(start.getDate() - days);
    return { start, end: now };
  }

  async stock(query: StockQueryDto) {
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
      .addSelect('l.code', 'locationCode')
      .orderBy('p.code', 'ASC');

    if (query.warehouseId) qb.andWhere('s."warehouseId" = :warehouseId', { warehouseId: query.warehouseId });
    if (query.locationId) qb.andWhere('s."locationId" = :locationId', { locationId: query.locationId });

    const [items, totalsRaw, byWarehouse, byMaterial] = await Promise.all([
      qb.clone().getRawMany(),
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

    return {
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
  }

  async movements(query: ReportsMovementsQueryDto) {
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
      .select('m.id', 'id')
      .addSelect('m.type', 'type')
      .addSelect('m.date', 'date')
      .addSelect('m.quantity', 'quantity')
      .addSelect('m.pallets', 'pallets')
      .addSelect('m."documentNumber"', 'documentNumber')
      .addSelect('m.supplier', 'supplier')
      .addSelect('m.carrier', 'carrier')
      .addSelect('m.driver', 'driver')
      .addSelect('m.destination', 'destination')
      .addSelect('m.notes', 'notes')
      .addSelect('p.id', 'productId')
      .addSelect('p.code', 'productCode')
      .addSelect('p.description', 'productDescription')
      .addSelect('p."unitOfMeasure"', 'unitOfMeasure')
      .addSelect('w.id', 'warehouseId')
      .addSelect('w.name', 'warehouseName')
      .addSelect('l.id', 'locationId')
      .addSelect('l.code', 'locationCode')
      .addSelect('fw.name', 'fromWarehouseName')
      .addSelect('fl.code', 'fromLocationCode')
      .addSelect('tw.name', 'toWarehouseName')
      .addSelect('tl.code', 'toLocationCode')
      .orderBy('m.date', 'DESC');

    if (query.warehouseId) {
      qb.andWhere('(m."warehouseId" = :warehouseId OR m."fromWarehouseId" = :warehouseId OR m."toWarehouseId" = :warehouseId)', { warehouseId: query.warehouseId });
    }
    if (query.locationId) {
      qb.andWhere('(m."locationId" = :locationId OR m."fromLocationId" = :locationId OR m."toLocationId" = :locationId)', { locationId: query.locationId });
    }
    if (query.productId) qb.andWhere('m."productId" = :productId', { productId: query.productId });
    if (query.type) qb.andWhere('m.type = :type', { type: query.type });
    if (query.dateFrom) qb.andWhere('m.date >= :dateFrom', { dateFrom: this.toStartDate(query.dateFrom) });
    if (query.dateTo) qb.andWhere('m.date <= :dateTo', { dateTo: this.toEndDate(query.dateTo) });
    if (query.search?.trim()) {
      qb.andWhere(
        `(LOWER(COALESCE(m."documentNumber", '')) LIKE :search
          OR LOWER(COALESCE(m.supplier, '')) LIKE :search
          OR LOWER(COALESCE(m.destination, '')) LIKE :search
          OR LOWER(COALESCE(m.notes, '')) LIKE :search
          OR LOWER(COALESCE(p.code, '')) LIKE :search
          OR LOWER(COALESCE(p.description, '')) LIKE :search)`,
        { search: `%${query.search.trim().toLowerCase()}%` },
      );
    }

    const [data, total] = await Promise.all([
      qb.clone().offset((page - 1) * limit).limit(limit).getRawMany(),
      qb.clone().select('COUNT(m.id)', 'total').getRawOne(),
    ]);

    return {
      data: data.map((row) => ({
        id: row.id,
        type: row.type,
        date: row.date,
        quantity: this.parseNumber(row.quantity),
        pallets: row.pallets === null || row.pallets === undefined ? null : this.parseNumber(row.pallets),
        documentNumber: row.documentNumber,
        supplier: row.supplier,
        carrier: row.carrier,
        driver: row.driver,
        destination: row.destination,
        notes: row.notes,
        material: {
          id: row.productId,
          code: row.productCode,
          description: row.productDescription,
          unitOfMeasure: row.unitOfMeasure,
        },
        warehouse: row.warehouseId ? { id: row.warehouseId, name: row.warehouseName } : null,
        location: row.locationId ? { id: row.locationId, code: row.locationCode } : null,
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

  async trace(materialId: string) {
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

    const history = await this.dataSource
      .createQueryBuilder()
      .from('movements', 'm')
      .leftJoin('warehouses', 'w', 'w.id = m."warehouseId"')
      .leftJoin('locations', 'l', 'l.id = m."locationId"')
      .leftJoin('warehouses', 'fw', 'fw.id = m."fromWarehouseId"')
      .leftJoin('locations', 'fl', 'fl.id = m."fromLocationId"')
      .leftJoin('warehouses', 'tw', 'tw.id = m."toWarehouseId"')
      .leftJoin('locations', 'tl', 'tl.id = m."toLocationId"')
      .select('m.id', 'movementId')
      .addSelect('m.date', 'at')
      .addSelect('m.type', 'type')
      .addSelect('m.quantity', 'quantity')
      .addSelect('m."documentNumber"', 'documentNumber')
      .addSelect('m.supplier', 'supplier')
      .addSelect('m.destination', 'destination')
      .addSelect('m.notes', 'notes')
      .addSelect('w.name', 'warehouseName')
      .addSelect('l.code', 'locationCode')
      .addSelect('fw.name', 'fromWarehouseName')
      .addSelect('fl.code', 'fromLocationCode')
      .addSelect('tw.name', 'toWarehouseName')
      .addSelect('tl.code', 'toLocationCode')
      .where('m."productId" = :materialId', { materialId })
      .orderBy('m.date', 'ASC')
      .getRawMany();

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
        notes: row.notes,
        warehouseName: row.warehouseName,
        locationCode: row.locationCode,
        fromWarehouseName: row.fromWarehouseName,
        fromLocationCode: row.fromLocationCode,
        toWarehouseName: row.toWarehouseName,
        toLocationCode: row.toLocationCode,
      })),
    };
  }

  async dailyStock(query: DailyStockQueryDto) {
    const date = query.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    const dayStart = `${date}T00:00:00.000Z`;
    const dayEnd = `${date}T23:59:59.999Z`;

    const movementFilter = this.buildMovementScopeFilter(query, 2);
    const sapFilter = this.buildSapScopeFilter(query, 1);

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
      LEFT JOIN movements m ON m."productId" = p.id
      
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
      const stockFinal = stockInicial + entradas - salidas;
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
        diferencia: stockFinal - stockSAP,
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

  async differencesSap(query: DifferencesSapQueryDto) {
    const daily = await this.dailyStock({
      date: query.date,
      productId: query.productId,
      warehouseId: query.warehouseId,
      locationId: query.locationId,
    });

    return daily.filter((row: { stockSAP: number; diferencia: number }) => row.stockSAP !== 0 || row.diferencia !== 0);
  }

  async kpis(query: KpisQueryDto) {
    const range = query.range ?? 'today';
    const { start, end } = this.getRangeDates(range);

    const [stockRaw, movementsRaw, stockByWarehouseRaw] = await Promise.all([
      this.dataSource
        .createQueryBuilder()
        .from('stocks', 's')
        .select('COUNT(DISTINCT s."productId")', 'materials')
        .addSelect('COALESCE(SUM(s."currentQuantity"), 0)', 'totalQuantity')
        .getRawOne(),
      this.dataSource
        .createQueryBuilder()
        .from('movements', 'm')
        .select('COUNT(m.id)', 'movementsInRange')
        .where('m.date >= :start AND m.date <= :end', { start, end })
        .getRawOne(),
      this.dataSource
        .createQueryBuilder()
        .from('stocks', 's')
        .leftJoin('warehouses', 'w', 'w.id = s."warehouseId"')
        .select('w.id', 'warehouseId')
        .addSelect('w.name', 'warehouseName')
        .addSelect('COALESCE(SUM(s."currentQuantity"), 0)', 'quantity')
        .groupBy('w.id')
        .addGroupBy('w.name')
        .orderBy('w.name', 'ASC')
        .getRawMany(),
    ]);

    return {
      range,
      totalMaterials: this.parseNumber(stockRaw?.materials),
      totalQuantity: this.parseNumber(stockRaw?.totalQuantity),
      movementsCount: this.parseNumber(movementsRaw?.movementsInRange),
      movementsInRange: this.parseNumber(movementsRaw?.movementsInRange),
      stockByWarehouse: stockByWarehouseRaw.map((row) => ({
        warehouseId: row.warehouseId,
        warehouseName: row.warehouseName,
        quantity: this.parseNumber(row.quantity),
      })),
    };
  }

  private buildMovementScopeFilter(
    query: { productId?: string; warehouseId?: string; locationId?: string },
    placeholderOffset: number,
  ) {
    const params: string[] = [];
    const clauses: string[] = [];

    if (query.productId) {
      params.push(query.productId);
      clauses.push(`m."productId" = $${placeholderOffset + params.length}`);
    }
    if (query.warehouseId) {
      params.push(query.warehouseId);
      clauses.push(`(m."warehouseId" = $${placeholderOffset + params.length} OR m."fromWarehouseId" = $${placeholderOffset + params.length} OR m."toWarehouseId" = $${placeholderOffset + params.length})`);
    }
    if (query.locationId) {
      params.push(query.locationId);
      clauses.push(`(m."locationId" = $${placeholderOffset + params.length} OR m."fromLocationId" = $${placeholderOffset + params.length} OR m."toLocationId" = $${placeholderOffset + params.length})`);
    }

    return { params, whereSuffix: clauses.length ? ` AND ${clauses.join(' AND ')}` : '' };
  }

  private buildSapScopeFilter(query: { productId?: string; warehouseId?: string; locationId?: string }, placeholderOffset: number) {
    const params: string[] = [];
    const clauses: string[] = [];

    if (query.productId) {
      params.push(query.productId);
      clauses.push(`s."productId" = $${placeholderOffset + params.length}`);
    }
    if (query.warehouseId) {
      params.push(query.warehouseId);
      clauses.push(`s."warehouseId" = $${placeholderOffset + params.length}`);
    }
    if (query.locationId) {
      params.push(query.locationId);
      clauses.push(`s."locationId" = $${placeholderOffset + params.length}`);
    }

    return { params, whereSuffix: clauses.length ? ` AND ${clauses.join(' AND ')}` : '' };
  }
}
