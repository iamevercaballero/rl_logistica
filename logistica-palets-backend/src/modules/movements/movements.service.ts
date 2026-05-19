import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { CreateMovementDto } from './dto/create-movement.dto';
import { RegularizeMovementDto } from './dto/regularize-movement.dto';
import { MovementsQueryDto } from './dto/movements-query.dto';
import { Movement, MovementType } from './entities/movement.entity';
import { MovementDetail } from './entities/movement-detail.entity';
import { RegularizationLog } from './entities/regularization-log.entity';
import { Product } from '../products/entities/product.entity';
import { Location } from '../locations/entities/location.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { Stock } from '../stocks/entities/stock.entity';
import { Lot } from '../lots/entities/lot.entity';
import { Pallet } from '../pallets/entities/pallet.entity';
import { DeepPartial } from 'typeorm/common/DeepPartial';

@Injectable()
export class MovementsService {
  constructor(private readonly dataSource: DataSource) {}

  async create(dto: CreateMovementDto, userId: string) {
    return this.dataSource.transaction(async (manager) => {
      const product = await manager.findOne(Product, { where: { id: dto.productId } });
      if (!product || !product.active) {
        throw new NotFoundException('Material inexistente o inactivo');
      }

      // Validaciones previas al procesamiento
      const isEntry = ['ENTRY', 'ADJUSTMENT_IN'].includes(dto.type);
      const isAdjustment = ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'].includes(dto.type);

      if (dto.isProvisional && !isEntry) {
        throw new BadRequestException('Solo las entradas pueden marcarse como provisorias');
      }
      if (dto.isProvisional && !dto.notes?.trim()) {
        throw new BadRequestException('Las entradas provisorias requieren una observación obligatoria');
      }
      if (isAdjustment && !dto.adjustmentReason) {
        throw new BadRequestException('Los ajustes requieren un motivo obligatorio');
      }

      const totalQty = dto.palletItems?.length
        ? dto.palletItems.reduce((s, i) => s + i.quantity, 0)
        : (dto.quantity ?? 0);

      if (totalQty <= 0) throw new BadRequestException('La cantidad debe ser mayor a cero');

      this.validateBusinessRules({ ...dto, quantity: totalQty });

      const resolved = await this.resolveLocationsAndWarehouses(manager, dto);
      await this.ensureExplicitWarehouseConsistency(manager, dto, resolved);

      const isIncrease = ['ENTRY', 'ADJUSTMENT_IN'].includes(dto.type);

      if (dto.palletItems?.length) {
        // ENTRY/ADJUSTMENT_IN: aumentar stock total ahora con ubicación del formulario.
        // EXIT/ADJUSTMENT_OUT: reducir palet a palet en el loop (por ubicación real del palet).
        // TRANSFER: reducir/aumentar palet a palet en el loop.
        if (isEntry) {
          await this.applyIncrease(manager, dto.productId, resolved.warehouseId, resolved.locationId, totalQty);
        }
      } else {
        switch (dto.type) {
          case 'ENTRY':
          case 'ADJUSTMENT_IN':
            await this.applyIncrease(manager, dto.productId, resolved.warehouseId, resolved.locationId, totalQty);
            break;
          case 'EXIT':
          case 'ADJUSTMENT_OUT':
            await this.applyDecrease(manager, dto.productId, resolved.warehouseId, resolved.locationId, totalQty);
            break;
          case 'TRANSFER':
            await this.applyDecrease(manager, dto.productId, resolved.fromWarehouseId, dto.fromLocationId ?? null, totalQty);
            await this.applyIncrease(manager, dto.productId, resolved.toWarehouseId, dto.toLocationId ?? null, totalQty);
            break;
        }
      }

      const movementData: DeepPartial<Movement> = {
        type: dto.type,
        date: dto.date ? new Date(dto.date) : new Date(),
        productId: dto.productId,
        quantity: totalQty,
        pallets: dto.pallets ?? undefined,
        warehouseId: resolved.warehouseId ?? undefined,
        locationId: resolved.locationId ?? undefined,
        fromWarehouseId: resolved.fromWarehouseId ?? undefined,
        fromLocationId: dto.fromLocationId ?? undefined,
        toWarehouseId: resolved.toWarehouseId ?? undefined,
        toLocationId: dto.toLocationId ?? undefined,
        documentNumber: dto.documentNumber?.trim() || undefined,
        supplier: dto.supplier?.trim() || undefined,
        carrier: dto.carrier?.trim() || undefined,
        driver: dto.driver?.trim() || undefined,
        destination: dto.destination?.trim() || undefined,
        notes: dto.notes?.trim() || undefined,
        palletId: dto.palletId ?? undefined,
        lotId: dto.lotId ?? undefined,
        createdById: userId,
        encargadoRecepcionId: dto.encargadoRecepcionId ?? undefined,
        status: dto.isProvisional ? 'PENDING_REGULARIZATION' : 'NORMAL',
        adjustmentReason: dto.adjustmentReason ?? undefined,
        adjustmentCategory: dto.adjustmentCategory ?? undefined,
      };

      const movement = manager.create(Movement, movementData);
      await manager.save(movement);

      // Loop palet a palet
      if (dto.palletItems?.length) {
        for (const item of dto.palletItems) {
          let resolvedLotId: string | undefined;
          let resolvedPalletId: string | undefined = item.palletId;

          if (item.palletId) {
            const pallet = await manager.getRepository(Pallet).findOne({ where: { id: item.palletId } });
            if (!pallet) throw new NotFoundException(`Palet no encontrado: ${item.palletId}`);
            if (pallet.status === 'EXITED') throw new BadRequestException(`El palet ${pallet.code} ya fue despachado`);
            resolvedLotId = pallet.lotId;

            if (dto.type === 'EXIT' || dto.type === 'ADJUSTMENT_OUT') {
              // Verificar que el lote no esté pendiente de regularización
              const palletLot = await manager.getRepository(Lot).findOne({ where: { id: pallet.lotId } });
              if (palletLot?.status === 'PENDING_REGULARIZATION') {
                throw new BadRequestException(
                  `El lote "${palletLot.lotCode}" está pendiente de regularización. Regularizá el lote antes de despachar.`,
                );
              }

              // Reducir stock desde la ubicación real del palet
              const stockLocationId: string | null = pallet.currentLocationId ?? null;
              let stockWarehouseId: string | null = null;
              if (stockLocationId) {
                const loc = await manager.findOne(Location, { where: { id: stockLocationId } });
                stockWarehouseId = loc?.warehouse?.id ?? null;
              }
              await this.applyDecrease(manager, dto.productId, stockWarehouseId, stockLocationId, item.quantity);
              pallet.status = 'EXITED';
              pallet.exitedAt = new Date();

            } else if (dto.type === 'TRANSFER') {
              // Transferencia: reducir desde ubicación actual del palet, aumentar en destino
              const fromLocationId: string | null = pallet.currentLocationId ?? null;
              let fromWarehouseId: string | null = null;
              if (fromLocationId) {
                const loc = await manager.findOne(Location, { where: { id: fromLocationId } });
                fromWarehouseId = loc?.warehouse?.id ?? null;
              }
              await this.applyDecrease(manager, dto.productId, fromWarehouseId, fromLocationId, item.quantity);
              await this.applyIncrease(manager, dto.productId, resolved.toWarehouseId, dto.toLocationId ?? null, item.quantity);
              pallet.currentLocationId = dto.toLocationId ?? null;
            }

            await manager.save(pallet);

          } else if (item.lotCode) {
            // ENTRADA: crear/encontrar lote y registrar nuevo palet
            const lot = await this.findOrCreateLot(
              manager, dto.productId, item.lotCode,
              item.fechaVencimiento, undefined,
              item.fechaFabricacion, item.sapLot,
              dto.isProvisional ? 'PENDING_REGULARIZATION' : 'NORMAL',
            );
            resolvedLotId = lot.id;
            const existingCount = await manager.getRepository(Pallet).count({ where: { lotId: lot.id } });
            const pallet = manager.getRepository(Pallet).create({
              code: `${lot.lotCode}-P${existingCount + 1}`,
              lotId: lot.id,
              quantity: item.quantity,
              currentLocationId: resolved.locationId ?? null,
              status: 'AVAILABLE',
            });
            const savedPallet = await manager.save(pallet);
            resolvedPalletId = savedPallet.id;
          }

          if (resolvedLotId) {
            const detail = manager.create(MovementDetail, {
              movementId: movement.id,
              lotId: resolvedLotId,
              palletId: resolvedPalletId ?? undefined,
              quantity: item.quantity,
            });
            await manager.save(detail);
            await this.updateLotStock(manager, resolvedLotId, isIncrease ? item.quantity : -item.quantity);
          }
        }
      } else if (dto.lotId) {
        await this.updateLotStock(manager, dto.lotId, isIncrease ? totalQty : -totalQty);
      }

      return { movementId: movement.id, stockImpact: this.describeImpact(dto.type) };
    });
  }

  async regularize(id: string, dto: RegularizeMovementDto, userId: string) {
    return this.dataSource.transaction(async (manager) => {
      const movement = await manager.findOne(Movement, { where: { id } });
      if (!movement) throw new NotFoundException('Movimiento no encontrado');
      if (movement.status !== 'PENDING_REGULARIZATION') {
        throw new BadRequestException('El movimiento no está pendiente de regularización');
      }

      const logs: DeepPartial<RegularizationLog>[] = [];

      const movementStringFields = [
        'documentNumber', 'supplier', 'carrier', 'driver', 'destination', 'notes',
      ] as const;

      for (const field of movementStringFields) {
        const newVal = dto[field]?.trim() ?? null;
        if (newVal === null) continue;
        const oldVal = (movement[field] as string | undefined) ?? null;
        if (newVal !== oldVal) {
          logs.push({ movementId: id, field, oldValue: oldVal, newValue: newVal, changedById: userId, reason: dto.reason });
          (movement as unknown as Record<string, unknown>)[field] = newVal || null;
        }
      }

      // Actualizar lotes asociados vía MovementDetail
      const details = await manager.getRepository(MovementDetail).find({ where: { movementId: id } });
      const lotIds = [...new Set(details.map((d) => d.lotId).filter(Boolean))] as string[];

      if (lotIds.length > 0) {
        const lots = await manager.getRepository(Lot).find({ where: lotIds.map((lotId) => ({ id: lotId })) });
        const lotDateFields = ['fechaVencimiento', 'fechaFabricacion'] as const;
        const lotStringFields = ['sapLot', 'proveedor'] as const;

        for (const lot of lots) {
          let lotChanged = false;

          for (const field of lotStringFields) {
            const newVal = dto[field]?.trim() ?? null;
            if (newVal === null) continue;
            const oldVal = lot[field] ?? null;
            if (newVal !== oldVal) {
              logs.push({ movementId: id, field: `lot.${lot.lotCode}.${field}`, oldValue: oldVal, newValue: newVal, changedById: userId, reason: dto.reason });
              lot[field] = newVal;
              lotChanged = true;
            }
          }

          for (const field of lotDateFields) {
            const newVal = dto[field] ?? null;
            if (newVal === null) continue;
            const oldVal = lot[field] ?? null;
            if (newVal !== oldVal) {
              logs.push({ movementId: id, field: `lot.${lot.lotCode}.${field}`, oldValue: oldVal, newValue: newVal, changedById: userId, reason: dto.reason });
              lot[field] = newVal;
              lotChanged = true;
            }
          }

          if (lotChanged) {
            lot.status = 'NORMAL';
            await manager.save(Lot, lot);
          }
        }
      }

      movement.status = 'NORMAL';
      await manager.save(movement);

      for (const log of logs) {
        await manager.save(manager.create(RegularizationLog, log));
      }

      return { regularized: true, changes: logs.length };
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
      .leftJoin('users', 'encargado', 'encargado.id = movement."encargadoRecepcionId"')
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
        'movement.status AS status',
        'movement."adjustmentReason" AS "adjustmentReason"',
        'movement."adjustmentCategory" AS "adjustmentCategory"',
        'movement.createdById AS "createdById"',
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
        'encargado.id AS "encargadoId"',
        'encargado.username AS "encargadoUsername"',
        'encargado."fullName" AS "encargadoFullName"',
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
    if (query.status) qb.andWhere('movement.status = :status', { status: query.status });
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
      qb.clone().select('COUNT(movement.id)', 'total').orderBy().getRawOne(),
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
      .leftJoin('users', 'encargado', 'encargado.id = movement."encargadoRecepcionId"')
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
        'movement.status AS status',
        'movement."adjustmentReason" AS "adjustmentReason"',
        'movement."adjustmentCategory" AS "adjustmentCategory"',
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
        'encargado.id AS "encargadoId"',
        'encargado.username AS "encargadoUsername"',
        'encargado."fullName" AS "encargadoFullName"',
      ])
      .where('movement.id = :id', { id });

    const movement = await qb.getRawOne();
    if (!movement) throw new NotFoundException('Movimiento no encontrado');
    return this.mapMovementRow(movement);
  }

  // ─── Privados ────────────────────────────────────────────────────────────────

  private validateBusinessRules(dto: CreateMovementDto & { quantity: number }) {
    if (dto.quantity <= 0) {
      throw new BadRequestException('La cantidad debe ser mayor a cero');
    }

    if (dto.type === 'TRANSFER' && (!dto.fromLocationId || !dto.toLocationId)) {
      throw new BadRequestException('TRANSFER requiere ubicación origen y destino');
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
    if (!dto.warehouseId) return;

    const warehouse = await manager.findOne(Warehouse, { where: { id: dto.warehouseId } });
    if (!warehouse) throw new NotFoundException('Depósito inexistente');

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
    manager: EntityManager, productId: string, warehouseId: string | null, locationId: string | null, quantity: number,
  ) {
    const stock = await this.findOrCreateStock(manager, productId, warehouseId, locationId);
    stock.currentQuantity += quantity;
    stock.updatedAt = new Date();
    await manager.save(stock);
  }

  private async applyDecrease(
    manager: EntityManager, productId: string, warehouseId: string | null, locationId: string | null, quantity: number,
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
    manager: EntityManager, productId: string, warehouseId: string | null, locationId: string | null,
  ) {
    const repository = manager.getRepository(Stock);
    const stock = await repository.findOne({
      where: { productId, warehouseId: warehouseId ?? IsNull(), locationId: locationId ?? IsNull() },
    });
    if (stock) return stock;
    return repository.create({ productId, warehouseId, locationId, currentQuantity: 0, updatedAt: new Date() });
  }

  private async findOrCreateLot(
    manager: EntityManager,
    productId: string,
    lotCode: string,
    fechaVencimiento?: string,
    proveedor?: string,
    fechaFabricacion?: string,
    sapLot?: string,
    status = 'NORMAL',
  ): Promise<Lot> {
    const repo = manager.getRepository(Lot);
    let lot = await repo.findOne({ where: { productId, lotCode } });
    if (!lot) {
      lot = repo.create({
        productId, lotCode,
        fechaVencimiento: fechaVencimiento ?? null,
        fechaFabricacion: fechaFabricacion ?? null,
        proveedor: proveedor ?? null,
        sapLot: sapLot ?? null,
        stockActual: 0,
        status,
      });
      lot = await repo.save(lot);
    } else {
      let changed = false;
      if (fechaVencimiento && !lot.fechaVencimiento) { lot.fechaVencimiento = fechaVencimiento; changed = true; }
      if (proveedor && !lot.proveedor) { lot.proveedor = proveedor; changed = true; }
      if (fechaFabricacion && !lot.fechaFabricacion) { lot.fechaFabricacion = fechaFabricacion; changed = true; }
      if (sapLot && !lot.sapLot) { lot.sapLot = sapLot; changed = true; }
      if (changed) lot = await repo.save(lot);
    }
    return lot;
  }

  private async updateLotStock(manager: EntityManager, lotId: string, delta: number) {
    const repo = manager.getRepository(Lot);
    const lot = await repo.findOne({ where: { id: lotId } });
    if (lot) {
      lot.stockActual = Math.max(0, lot.stockActual + delta);
      await repo.save(lot);
    }
  }

  private parseNumber(value: unknown) { return Number(value) || 0; }

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
      id: row.id, type: row.type, date: row.date,
      status: row.status ?? 'NORMAL',
      adjustmentReason: row.adjustmentReason ?? null,
      adjustmentCategory: row.adjustmentCategory ?? null,
      quantity: this.parseNumber(row.quantity),
      pallets: row.pallets === null || row.pallets === undefined ? null : this.parseNumber(row.pallets),
      documentNumber: row.documentNumber, supplier: row.supplier, carrier: row.carrier,
      driver: row.driver, destination: row.destination, notes: row.notes,
      createdById: row.createdById, createdAt: row.createdAt ?? row.date,
      palletId: row.palletId, lotId: row.lotId,
      encargado: row.encargadoId ? { id: row.encargadoId, username: row.encargadoUsername, fullName: row.encargadoFullName } : null,
      material: {
        id: row.productId, code: row.productCode,
        description: row.productDescription, unitOfMeasure: row.unitOfMeasure,
      },
      warehouse: row.warehouseId ? { id: row.warehouseId, name: row.warehouseName } : null,
      location: row.locationId ? { id: row.locationId, code: row.locationCode } : null,
      from: row.fromLocationId || row.fromWarehouseId
        ? { warehouseId: row.fromWarehouseId, warehouseName: row.fromWarehouseName, locationId: row.fromLocationId, locationCode: row.fromLocationCode }
        : null,
      to: row.toLocationId || row.toWarehouseId
        ? { warehouseId: row.toWarehouseId, warehouseName: row.toWarehouseName, locationId: row.toLocationId, locationCode: row.toLocationCode }
        : null,
    };
  }

  private describeImpact(type: MovementType) {
    if (type === 'TRANSFER') return 'Actualiza ubicación del palet';
    if (type === 'EXIT' || type === 'ADJUSTMENT_OUT') return 'Resta stock';
    return 'Suma stock';
  }
}
