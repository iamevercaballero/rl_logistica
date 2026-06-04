import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ProductionPlan } from './entities/production-plan.entity';
import { CreateProductionPlanDto } from './dto/create-production-plan.dto';
import { UpdateProductionPlanDto } from './dto/update-production-plan.dto';
import { QueryProductionPlanDto } from './dto/query-production-plan.dto';

@Injectable()
export class ProductionPlansService {
  constructor(
    @InjectRepository(ProductionPlan)
    private readonly repo: Repository<ProductionPlan>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateProductionPlanDto, userId: string) {
    const plan = this.repo.create({
      ...dto,
      plannedDate: dto.plannedDate.slice(0, 10),
      status: 'PLANNED',
      createdById: userId,
      updatedAt: new Date(),
    });
    return this.repo.save(plan);
  }

  async findAll(query: QueryProductionPlanDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const qb = this.dataSource
      .createQueryBuilder()
      .from('production_plans', 'pp')
      .leftJoin('products', 'p', 'p.id = pp."productId"')
      .leftJoin('warehouses', 'w', 'w.id = pp."warehouseId"')
      .leftJoin('locations', 'l', 'l.id = pp."locationId"')
      .select('pp.id', 'id')
      .addSelect('pp."plannedDate"', 'plannedDate')
      .addSelect('pp.type', 'type')
      .addSelect('pp.status', 'status')
      .addSelect('pp."plannedQuantity"', 'plannedQuantity')
      .addSelect('pp."plannedPallets"', 'plannedPallets')
      .addSelect('pp.supplier', 'supplier')
      .addSelect('pp.destination', 'destination')
      .addSelect('pp.carrier', 'carrier')
      .addSelect('pp.notes', 'notes')
      .addSelect('pp."confirmedAt"', 'confirmedAt')
      .addSelect('pp."createdAt"', 'createdAt')
      .addSelect('pp."updatedAt"', 'updatedAt')
      .addSelect('p.id', 'productId')
      .addSelect('p.code', 'productCode')
      .addSelect('p.description', 'productDescription')
      .addSelect('p."unitOfMeasure"', 'unitOfMeasure')
      .addSelect('w.name', 'warehouseName')
      .addSelect('l.code', 'locationCode');

    if (query.status) qb.andWhere('pp.status = :status', { status: query.status });
    if (query.type) qb.andWhere('pp.type = :type', { type: query.type });
    if (query.productId) qb.andWhere('pp."productId" = :productId', { productId: query.productId });
    if (query.warehouseId) qb.andWhere('pp."warehouseId" = :warehouseId', { warehouseId: query.warehouseId });
    if (query.dateFrom) qb.andWhere('pp."plannedDate" >= :dateFrom', { dateFrom: query.dateFrom.slice(0, 10) });
    if (query.dateTo) qb.andWhere('pp."plannedDate" <= :dateTo', { dateTo: query.dateTo.slice(0, 10) });

    const [rows, countRaw] = await Promise.all([
      qb.clone()
        .orderBy('pp."plannedDate"', 'ASC')
        .addOrderBy('pp."createdAt"', 'DESC')
        .offset((page - 1) * limit)
        .limit(limit)
        .getRawMany(),
      qb.clone().select('COUNT(pp.id)', 'total').getRawOne(),
    ]);

    const total = Number(countRaw?.total ?? 0);

    return {
      data: rows.map((r) => this.mapRow(r)),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async findOne(id: string) {
    const plan = await this.repo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    return plan;
  }

  async update(id: string, dto: UpdateProductionPlanDto, userId: string) {
    const plan = await this.findOne(id);

    const now = new Date();
    const updates: Partial<ProductionPlan> = { ...dto, updatedAt: now };

    if (dto.status === 'CONFIRMED' && plan.status === 'PLANNED') {
      updates.confirmedById = userId;
      updates.confirmedAt = now;
    }

    if (dto.plannedDate) {
      updates.plannedDate = dto.plannedDate.slice(0, 10);
    }

    Object.assign(plan, updates);
    return this.repo.save(plan);
  }

  async remove(id: string) {
    const plan = await this.findOne(id);
    plan.status = 'CANCELLED';
    plan.updatedAt = new Date();
    return this.repo.save(plan);
  }

  /** Returns plans for the next N days (for dashboard widget). */
  async upcoming(days = 7) {
    const today = new Date().toISOString().slice(0, 10);
    const until = new Date();
    until.setDate(until.getDate() + days);
    const untilStr = until.toISOString().slice(0, 10);

    const rows = await this.dataSource
      .createQueryBuilder()
      .from('production_plans', 'pp')
      .leftJoin('products', 'p', 'p.id = pp."productId"')
      .leftJoin('warehouses', 'w', 'w.id = pp."warehouseId"')
      .leftJoin('locations', 'l', 'l.id = pp."locationId"')
      .select('pp.id', 'id')
      .addSelect('pp."plannedDate"', 'plannedDate')
      .addSelect('pp.type', 'type')
      .addSelect('pp.status', 'status')
      .addSelect('pp."plannedQuantity"', 'plannedQuantity')
      .addSelect('pp."plannedPallets"', 'plannedPallets')
      .addSelect('pp.supplier', 'supplier')
      .addSelect('pp.destination', 'destination')
      .addSelect('pp.notes', 'notes')
      .addSelect('p.id', 'productId')
      .addSelect('p.code', 'productCode')
      .addSelect('p.description', 'productDescription')
      .addSelect('w.name', 'warehouseName')
      .addSelect('l.code', 'locationCode')
      .where(`pp."plannedDate" >= :today AND pp."plannedDate" <= :until`, { today, until: untilStr })
      .andWhere(`pp.status IN ('PLANNED', 'CONFIRMED')`)
      .orderBy('pp."plannedDate"', 'ASC')
      .limit(20)
      .getRawMany();

    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(r: Record<string, unknown>) {
    return {
      id: r.id,
      plannedDate: r.plannedDate,
      type: r.type,
      status: r.status,
      plannedQuantity: Number(r.plannedQuantity),
      plannedPallets: r.plannedPallets != null ? Number(r.plannedPallets) : null,
      supplier: r.supplier ?? null,
      destination: r.destination ?? null,
      carrier: r.carrier ?? null,
      notes: r.notes ?? null,
      confirmedAt: r.confirmedAt ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      product: {
        id: r.productId,
        code: r.productCode,
        description: r.productDescription,
        unitOfMeasure: r.unitOfMeasure ?? null,
      },
      warehouseName: r.warehouseName ?? null,
      locationCode: r.locationCode ?? null,
    };
  }
}
