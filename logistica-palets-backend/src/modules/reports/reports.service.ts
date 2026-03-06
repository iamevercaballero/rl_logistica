import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StockQueryDto } from './dto/stock-query.dto';
import { ReportsMovementsQueryDto } from './dto/movements-query.dto';
import { KpisQueryDto } from './dto/kpis-query.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly dataSource: DataSource) {}

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
    const baseStockQb = this.dataSource
      .createQueryBuilder()
      .from('pallets', 'p')
      .leftJoin('locations', 'l', 'l.id = p."currentLocationId"')
      .leftJoin('warehouses', 'w', 'w.id = l."warehouseId"');

    if (query.warehouseId) {
      baseStockQb.where('w.id = :warehouseId', { warehouseId: query.warehouseId });
    }

    const [totalsRaw] = await baseStockQb
      .clone()
      .select('COUNT(p.id)', 'totalPallets')
      .addSelect('COALESCE(SUM(p.quantity), 0)', 'totalUnits')
      .getRawMany();

    const byWarehouse = await baseStockQb
      .clone()
      .select('w.id', 'warehouseId')
      .addSelect('w.name', 'warehouseName')
      .addSelect('COUNT(p.id)', 'pallets')
      .addSelect('COALESCE(SUM(p.quantity), 0)', 'units')
      .groupBy('w.id')
      .addGroupBy('w.name')
      .orderBy('w.name', 'ASC')
      .getRawMany();

    const items = await baseStockQb
      .clone()
      .select('p.id', 'palletId')
      .addSelect('p.code', 'palletCode')
      .addSelect('p.quantity', 'quantity')
      .addSelect('p.status', 'status')
      .addSelect('l.id', 'locationId')
      .addSelect('l.code', 'locationCode')
      .addSelect('w.id', 'warehouseId')
      .addSelect('w.name', 'warehouseName')
      .orderBy('w.name', 'ASC')
      .addOrderBy('l.code', 'ASC')
      .addOrderBy('p.code', 'ASC')
      .getRawMany();

    return {
      totalPallets: this.parseNumber(totalsRaw?.totalPallets),
      totalUnits: this.parseNumber(totalsRaw?.totalUnits),
      byWarehouse: byWarehouse.map((row) => ({
        warehouseId: row.warehouseId,
        warehouseName: row.warehouseName,
        pallets: this.parseNumber(row.pallets),
        units: this.parseNumber(row.units),
      })),
      items: items.map((item) => ({
        palletId: item.palletId,
        palletCode: item.palletCode,
        quantity: this.parseNumber(item.quantity),
        status: item.status,
        locationId: item.locationId,
        locationCode: item.locationCode,
        warehouseId: item.warehouseId,
        warehouseName: item.warehouseName,
      })),
    };
  }

  async movements(query: ReportsMovementsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.dataSource
      .createQueryBuilder()
      .from('movements', 'm')
      .leftJoin('movement_details', 'd', 'd."movementId" = m.id')
      .leftJoin('pallets', 'p', 'p.id = d."palletId"')
      .leftJoin('locations', 'l', 'l.id = d."locationId"')
      .leftJoin('warehouses', 'w', 'w.id = l."warehouseId"')
      .select('m.id', 'id')
      .addSelect('m.type', 'type')
      .addSelect('m.date', 'createdAt')
      .addSelect('m.reference', 'reference')
      .addSelect('m.notes', 'notes')
      .addSelect('w.id', 'warehouseId')
      .addSelect('w.name', 'warehouseName')
      .addSelect('p.id', 'palletId')
      .addSelect('p.code', 'palletCode')
      .addSelect('d.quantity', 'quantity')
      .orderBy('m.date', 'DESC');

    if (query.warehouseId) {
      qb.andWhere('w.id = :warehouseId', { warehouseId: query.warehouseId });
    }

    if (query.type) {
      qb.andWhere('m.type = :type', { type: query.type });
    }

    if (query.dateFrom) {
      qb.andWhere('m.date >= :dateFrom', { dateFrom: this.toStartDate(query.dateFrom) });
    }

    if (query.dateTo) {
      qb.andWhere('m.date <= :dateTo', { dateTo: this.toEndDate(query.dateTo) });
    }

    if (query.search?.trim()) {
      qb.andWhere(
        '(LOWER(COALESCE(m.reference, \'\')) LIKE :search OR LOWER(COALESCE(m.notes, \'\')) LIKE :search OR LOWER(COALESCE(p.code, \'\')) LIKE :search)',
        { search: `%${query.search.trim().toLowerCase()}%` },
      );
    }

    const [data, total] = await Promise.all([
      qb.clone().offset((page - 1) * limit).limit(limit).getRawMany(),
      qb.clone().select('COUNT(DISTINCT m.id)', 'total').getRawOne(),
    ]);

    return {
      data: data.map((row) => ({
        id: row.id,
        type: row.type,
        createdAt: row.createdAt,
        reference: row.reference,
        notes: row.notes,
        warehouseId: row.warehouseId,
        warehouseName: row.warehouseName,
        palletId: row.palletId,
        palletCode: row.palletCode,
        quantity: this.parseNumber(row.quantity),
      })),
      meta: {
        page,
        limit,
        total: this.parseNumber(total?.total),
        totalPages: Math.max(1, Math.ceil(this.parseNumber(total?.total) / limit)),
      },
    };
  }

  async trace(palletId: string) {
    const rows = await this.dataSource
      .createQueryBuilder()
      .from('movement_details', 'd')
      .leftJoin('movements', 'm', 'm.id = d."movementId"')
      .leftJoin('locations', 'l', 'l.id = d."locationId"')
      .leftJoin('warehouses', 'w', 'w.id = l."warehouseId"')
      .select('d."movementId"', 'movementId')
      .addSelect('d."palletId"', 'palletId')
      .addSelect('m.date', 'at')
      .addSelect('m.type', 'type')
      .addSelect('m.reference', 'ref')
      .addSelect('w.id', 'warehouseId')
      .addSelect('w.name', 'warehouseName')
      .addSelect('d.quantity', 'quantity')
      .where('d."palletId" = :palletId', { palletId })
      .orderBy('m.date', 'ASC')
      .getRawMany();

    const history = rows.map((row) => ({
      at: row.at,
      type: row.type,
      fromWarehouse: row.type === 'EXIT' ? row.warehouseName : undefined,
      toWarehouse: row.type === 'ENTRY' || row.type === 'TRANSFER' ? row.warehouseName : undefined,
      ref: row.ref,
      userId: null,
      username: null,
      quantity: this.parseNumber(row.quantity),
      movementId: row.movementId,
      warehouseId: row.warehouseId,
    }));

    return { palletId, history };
  }

  async kpis(query: KpisQueryDto) {
    const range = query.range ?? 'today';
    const { start, end } = this.getRangeDates(range);

    const [totalsRaw, movementsRaw, stockByWarehouseRaw] = await Promise.all([
      this.dataSource
        .createQueryBuilder()
        .from('pallets', 'p')
        .select('COUNT(p.id)', 'totalPallets')
        .addSelect('COALESCE(SUM(p.quantity), 0)', 'totalUnits')
        .getRawOne(),
      this.dataSource
        .createQueryBuilder()
        .from('movements', 'm')
        .select('COUNT(m.id)', 'movementsInRange')
        .where('m.date >= :start AND m.date <= :end', { start, end })
        .getRawOne(),
      this.dataSource
        .createQueryBuilder()
        .from('warehouses', 'w')
        .leftJoin('locations', 'l', 'l."warehouseId" = w.id')
        .leftJoin('pallets', 'p', 'p."currentLocationId" = l.id')
        .select('w.id', 'warehouseId')
        .addSelect('w.name', 'warehouseName')
        .addSelect('COUNT(p.id)', 'pallets')
        .addSelect('COALESCE(SUM(p.quantity), 0)', 'units')
        .groupBy('w.id')
        .addGroupBy('w.name')
        .orderBy('w.name', 'ASC')
        .getRawMany(),
    ]);

    return {
      range,
      totalPallets: this.parseNumber(totalsRaw?.totalPallets),
      totalUnits: this.parseNumber(totalsRaw?.totalUnits),
      movementsCount: this.parseNumber(movementsRaw?.movementsInRange),
      movementsInRange: this.parseNumber(movementsRaw?.movementsInRange),
      stockByWarehouse: stockByWarehouseRaw.map((row) => ({
        warehouseId: row.warehouseId,
        warehouseName: row.warehouseName,
        pallets: this.parseNumber(row.pallets),
        units: this.parseNumber(row.units),
      })),
    };
  }
}
