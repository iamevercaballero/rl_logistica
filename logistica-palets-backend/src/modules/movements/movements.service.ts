import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { CreateMovementDto } from './dto/create-movement.dto';
import { MovementsQueryDto } from './dto/movements-query.dto';
import { Movement, MovementType } from './entities/movement.entity';
import { Product } from '../products/entities/product.entity';
import { Location } from '../locations/entities/location.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { Stock } from '../stocks/entities/stock.entity';

@Injectable()
export class MovementsService {
  constructor(private readonly dataSource: DataSource) {}

  async create(dto: CreateMovementDto, userId: string) {
    return this.dataSource.transaction(async (manager) => {
      const product = await manager.findOne(Product, { where: { id: dto.productId } });
      if (!product || !product.active) {
        throw new NotFoundException('Material inexistente o inactivo');
      }

      this.validateBusinessRules(dto);

      const resolved = await this.resolveLocationsAndWarehouses(manager, dto);
      await this.ensureExplicitWarehouseConsistency(manager, dto, resolved);

      switch (dto.type) {
        case 'ENTRY':
        case 'ADJUSTMENT_IN':
        case 'REPROCESS':
          await this.applyIncrease(manager, dto.productId, resolved.warehouseId, resolved.locationId, dto.quantity);
          break;
        case 'EXIT':
        case 'ADJUSTMENT_OUT':
          await this.applyDecrease(manager, dto.productId, resolved.warehouseId, resolved.locationId, dto.quantity);
          break;
        case 'TRANSFER':
          await this.applyDecrease(manager, dto.productId, resolved.fromWarehouseId, dto.fromLocationId ?? null, dto.quantity);
          await this.applyIncrease(manager, dto.productId, resolved.toWarehouseId, dto.toLocationId ?? null, dto.quantity);
          break;
      }

      const movement = manager.create(Movement, {
        type: dto.type,
        date: dto.date ? new Date(dto.date) : new Date(),
        productId: dto.productId,
        quantity: dto.quantity,
        pallets: dto.pallets,
        warehouseId: resolved.warehouseId,
        locationId: resolved.locationId,
        fromWarehouseId: resolved.fromWarehouseId,
        fromLocationId: dto.fromLocationId,
        toWarehouseId: resolved.toWarehouseId,
        toLocationId: dto.toLocationId,
        documentNumber: dto.documentNumber?.trim(),
        supplier: dto.supplier?.trim(),
        carrier: dto.carrier?.trim(),
        driver: dto.driver?.trim(),
        destination: dto.destination?.trim(),
        notes: dto.notes?.trim(),
        palletId: dto.palletId,
        lotId: dto.lotId,
        createdById: userId,
      });

      await manager.save(movement);

      return {
        movementId: movement.id,
        stockImpact: this.describeImpact(dto.type),
      };
    });
  }

  async findAll(query: MovementsQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);

    const qb = this.dataSource
      .getRepository(Movement)
      .createQueryBuilder('movement')
      .leftJoin('products', 'product', 'product.id = movement."productId"')
      .leftJoin('warehouses', 'warehouse', 'warehouse.id = movement."warehouseId"')
      .leftJoin('locations', 'location', 'location.id = movement."locationId"')
      .leftJoin('warehouses', 'fromWarehouse', 'fromWarehouse.id = movement."fromWarehouseId"')
      .leftJoin('locations', 'fromLocation', 'fromLocation.id = movement."fromLocationId"')
      .leftJoin('warehouses', 'toWarehouse', 'toWarehouse.id = movement."toWarehouseId"')
      .leftJoin('locations', 'toLocation', 'toLocation.id = movement."toLocationId"')
      .select([
        'movement.id AS id',
        'movement.type AS type',
        'movement.date AS date',
        'movement.quantity AS quantity',
        'movement.pallets AS pallets',
        'movement.documentNumber AS "documentNumber"',
        'movement.supplier AS supplier',
        'movement.carrier AS carrier',
        'movement.driver AS driver',
        'movement.destination AS destination',
        'movement.notes AS notes',
        'movement.createdById AS "createdById"',
        'product.id AS "productId"',
        'product.code AS "productCode"',
        'product.description AS "productDescription"',
        'product."unitOfMeasure" AS "unitOfMeasure"',
        'warehouse.id AS "warehouseId"',
        'warehouse.name AS "warehouseName"',
        'location.id AS "locationId"',
        'location.code AS "locationCode"',
        'fromWarehouse.id AS "fromWarehouseId"',
        'fromWarehouse.name AS "fromWarehouseName"',
        'fromLocation.id AS "fromLocationId"',
        'fromLocation.code AS "fromLocationCode"',
        'toWarehouse.id AS "toWarehouseId"',
        'toWarehouse.name AS "toWarehouseName"',
        'toLocation.id AS "toLocationId"',
        'toLocation.code AS "toLocationCode"',
      ])
      .orderBy('movement.date', 'DESC');

    if (query.warehouseId) {
      qb.andWhere(
        '(movement."warehouseId" = :warehouseId OR movement."fromWarehouseId" = :warehouseId OR movement."toWarehouseId" = :warehouseId)',
        { warehouseId: query.warehouseId },
      );
    }
    if (query.locationId) {
      qb.andWhere(
        '(movement."locationId" = :locationId OR movement."fromLocationId" = :locationId OR movement."toLocationId" = :locationId)',
        { locationId: query.locationId },
      );
    }
    if (query.productId) qb.andWhere('movement."productId" = :productId', { productId: query.productId });
    if (query.type) qb.andWhere('movement.type = :type', { type: query.type });
    if (query.dateFrom) qb.andWhere('movement.date >= :dateFrom', { dateFrom: this.toStartDate(query.dateFrom) });
    if (query.dateTo) qb.andWhere('movement.date <= :dateTo', { dateTo: this.toEndDate(query.dateTo) });
    if (query.search?.trim()) {
      const search = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        `(
          LOWER(COALESCE(movement."documentNumber", '')) LIKE :search
          OR LOWER(COALESCE(movement.supplier, '')) LIKE :search
          OR LOWER(COALESCE(movement.destination, '')) LIKE :search
          OR LOWER(COALESCE(movement.notes, '')) LIKE :search
          OR LOWER(COALESCE(product.code, '')) LIKE :search
          OR LOWER(COALESCE(product.description, '')) LIKE :search
        )`,
        { search },
      );
    }

    const [data, totalRow] = await Promise.all([
      qb.clone().offset((page - 1) * limit).limit(limit).getRawMany(),
      qb.clone().select('COUNT(movement.id)', 'total').getRawOne(),
    ]);

    return {
      data: data.map((row) => this.mapMovementRow(row)),
      meta: {
        page,
        limit,
        total: this.parseNumber(totalRow?.total),
        totalPages: Math.max(1, Math.ceil(this.parseNumber(totalRow?.total) / limit)),
      },
    };
  }

  async findOne(id: string) {
    const qb = this.dataSource
      .getRepository(Movement)
      .createQueryBuilder('movement')
      .leftJoin('products', 'product', 'product.id = movement."productId"')
      .leftJoin('warehouses', 'warehouse', 'warehouse.id = movement."warehouseId"')
      .leftJoin('locations', 'location', 'location.id = movement."locationId"')
      .leftJoin('warehouses', 'fromWarehouse', 'fromWarehouse.id = movement."fromWarehouseId"')
      .leftJoin('locations', 'fromLocation', 'fromLocation.id = movement."fromLocationId"')
      .leftJoin('warehouses', 'toWarehouse', 'toWarehouse.id = movement."toWarehouseId"')
      .leftJoin('locations', 'toLocation', 'toLocation.id = movement."toLocationId"')
      .select([
        'movement.id AS id',
        'movement.type AS type',
        'movement.date AS date',
        'movement.quantity AS quantity',
        'movement.pallets AS pallets',
        'movement.documentNumber AS "documentNumber"',
        'movement.supplier AS supplier',
        'movement.carrier AS carrier',
        'movement.driver AS driver',
        'movement.destination AS destination',
        'movement.notes AS notes',
        'movement.createdById AS "createdById"',
        'movement.createdAt AS "createdAt"',
        'movement.palletId AS "palletId"',
        'movement.lotId AS "lotId"',
        'product.id AS "productId"',
        'product.code AS "productCode"',
        'product.description AS "productDescription"',
        'product."unitOfMeasure" AS "unitOfMeasure"',
        'warehouse.id AS "warehouseId"',
        'warehouse.name AS "warehouseName"',
        'location.id AS "locationId"',
        'location.code AS "locationCode"',
        'fromWarehouse.id AS "fromWarehouseId"',
        'fromWarehouse.name AS "fromWarehouseName"',
        'fromLocation.id AS "fromLocationId"',
        'fromLocation.code AS "fromLocationCode"',
        'toWarehouse.id AS "toWarehouseId"',
        'toWarehouse.name AS "toWarehouseName"',
        'toLocation.id AS "toLocationId"',
        'toLocation.code AS "toLocationCode"',
      ])
      .where('movement.id = :id', { id });

    const movement = await qb.getRawOne();
    if (!movement) throw new NotFoundException('Movimiento no encontrado');
    return this.mapMovementRow(movement);
  }

  private validateBusinessRules(dto: CreateMovementDto) {
    if (dto.quantity <= 0) {
      throw new BadRequestException('La cantidad debe ser mayor a cero');
    }

    if (dto.type === 'TRANSFER' && (!dto.fromLocationId || !dto.toLocationId)) {
      throw new BadRequestException('TRANSFER requiere ubicación origen y destino');
    }

    if ((dto.type === 'ADJUSTMENT_IN' || dto.type === 'ADJUSTMENT_OUT') && !dto.notes?.trim()) {
      throw new BadRequestException('Los ajustes requieren observación en notes');
    }

    if (dto.type === 'TRANSFER' && dto.fromLocationId === dto.toLocationId) {
      throw new BadRequestException('Origen y destino no pueden ser la misma ubicación');
    }
  }

  private async resolveLocationsAndWarehouses(manager: EntityManager, dto: CreateMovementDto) {
    const location = dto.locationId ? await this.findLocation(manager, dto.locationId) : null;
    const fromLocation = dto.fromLocationId ? await this.findLocation(manager, dto.fromLocationId) : null;
    const toLocation = dto.toLocationId ? await this.findLocation(manager, dto.toLocationId) : null;

    return {
      warehouseId: location?.warehouse.id ?? dto.warehouseId ?? null,
      locationId: location?.id ?? null,
      fromWarehouseId: fromLocation?.warehouse.id ?? null,
      toWarehouseId: toLocation?.warehouse.id ?? null,
    };
  }

  private async ensureExplicitWarehouseConsistency(
    manager: EntityManager,
    dto: CreateMovementDto,
    resolved: { warehouseId: string | null; locationId: string | null },
  ) {
    if (!dto.warehouseId) {
      return;
    }

    const warehouse = await manager.findOne(Warehouse, { where: { id: dto.warehouseId } });
    if (!warehouse) {
      throw new NotFoundException('Depósito inexistente');
    }

    if (resolved.locationId && resolved.warehouseId && dto.warehouseId !== resolved.warehouseId) {
      throw new BadRequestException('La ubicación no pertenece al depósito indicado');
    }
  }

  private async findLocation(manager: EntityManager, id: string) {
    const location = await manager.findOne(Location, { where: { id } });
    if (!location || !location.active) {
      throw new NotFoundException(`Ubicación inexistente o inactiva: ${id}`);
    }
    return location;
  }

  private async applyIncrease(
    manager: EntityManager,
    productId: string,
    warehouseId: string | null,
    locationId: string | null,
    quantity: number,
  ) {
    const stock = await this.findOrCreateStock(manager, productId, warehouseId, locationId);
    stock.currentQuantity += quantity;
    stock.updatedAt = new Date();
    await manager.save(stock);
  }

  private async applyDecrease(
    manager: EntityManager,
    productId: string,
    warehouseId: string | null,
    locationId: string | null,
    quantity: number,
  ) {
    const stock = await this.findOrCreateStock(manager, productId, warehouseId, locationId);
    if (stock.currentQuantity < quantity) {
      throw new BadRequestException('Stock insuficiente para completar la operación');
    }
    stock.currentQuantity -= quantity;
    stock.updatedAt = new Date();
    await manager.save(stock);
  }

  private async findOrCreateStock(
    manager: EntityManager,
    productId: string,
    warehouseId: string | null,
    locationId: string | null,
  ) {
    const repository = manager.getRepository(Stock);
    const stock = await repository.findOne({
      where: {
        productId,
        warehouseId: warehouseId ?? IsNull(),
        locationId: locationId ?? IsNull(),
      },
    });

    if (stock) {
      return stock;
    }

    return repository.create({ productId, warehouseId, locationId, currentQuantity: 0, updatedAt: new Date() });
  }

  private parseNumber(value: unknown) {
    return Number(value) || 0;
  }

  private toStartDate(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00.000Z`);
    return new Date(value);
  }

  private toEndDate(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T23:59:59.999Z`);
    return new Date(value);
  }

  private mapMovementRow(row: Record<string, unknown>) {
    return {
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
      createdById: row.createdById,
      createdAt: row.createdAt ?? row.date,
      palletId: row.palletId,
      lotId: row.lotId,
      material: {
        id: row.productId,
        code: row.productCode,
        description: row.productDescription,
        unitOfMeasure: row.unitOfMeasure,
      },
      warehouse: row.warehouseId ? { id: row.warehouseId, name: row.warehouseName } : null,
      location: row.locationId ? { id: row.locationId, code: row.locationCode } : null,
      from: row.fromLocationId || row.fromWarehouseId
        ? {
            warehouseId: row.fromWarehouseId,
            warehouseName: row.fromWarehouseName,
            locationId: row.fromLocationId,
            locationCode: row.fromLocationCode,
          }
        : null,
      to: row.toLocationId || row.toWarehouseId
        ? {
            warehouseId: row.toWarehouseId,
            warehouseName: row.toWarehouseName,
            locationId: row.toLocationId,
            locationCode: row.toLocationCode,
          }
        : null,
    };
  }

  private describeImpact(type: MovementType) {
    if (type === 'TRANSFER') {
      return 'Actualiza ubicación sin cambiar el stock total';
    }
    if (type === 'EXIT' || type === 'ADJUSTMENT_OUT') {
      return 'Resta stock';
    }
    return 'Suma stock';
  }
}
