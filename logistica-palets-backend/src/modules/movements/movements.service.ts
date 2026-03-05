import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Movement } from './entities/movement.entity';
import { MovementDetail } from './entities/movement-detail.entity';
import { Pallet } from '../pallets/entities/pallet.entity';
import { CreateEntryDto } from './dto/create-entry.dto';
import { CreateExitDto } from './dto/create-exit.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { MovementsQueryDto } from './dto/movements-query.dto';

@Injectable()
export class MovementsService {
  constructor(private readonly dataSource: DataSource) {}

  async createEntry(dto: CreateEntryDto) {
    return this.dataSource.transaction(async (manager: import('typeorm').EntityManager) => {
      const movement = manager.create(Movement, {
        type: 'ENTRY',
        reference: dto.reference,
        notes: dto.notes,
      });
      await manager.save(movement);

      for (const item of dto.items) {
        const pallet = manager.create(Pallet, {
          code: item.palletCode,
          lotId: item.lotId,
          quantity: item.quantity,
          currentLocationId: item.locationId,
          status: 'AVAILABLE',
        });
        await manager.save(pallet);

        const detail = manager.create(MovementDetail, {
          movementId: movement.id,
          palletId: pallet.id,
          lotId: item.lotId,
          locationId: item.locationId,
          quantity: item.quantity,
        });
        await manager.save(detail);
      }

      return { movementId: movement.id };
    });
  }

  async createExit(dto: CreateExitDto) {
    return this.dataSource.transaction(async (manager: import('typeorm').EntityManager) => {
      const movement = manager.create(Movement, {
        type: 'EXIT',
        reference: dto.reference,
        notes: dto.notes,
      });
      await manager.save(movement);

      for (const item of dto.items) {
        const pallet = await manager.findOne(Pallet, { where: { id: item.palletId } });
        if (!pallet) throw new NotFoundException(`Pallet no encontrado: ${item.palletId}`);

        if (pallet.quantity < item.quantity) {
          throw new BadRequestException(`Cantidad insuficiente en pallet ${pallet.code}`);
        }

        const detail = manager.create(MovementDetail, {
          movementId: movement.id,
          palletId: pallet.id,
          lotId: pallet.lotId,
          locationId: pallet.currentLocationId,
          quantity: item.quantity,
        });
        await manager.save(detail);

        if (pallet.quantity === item.quantity) {
          await manager.remove(pallet);
        } else {
          pallet.quantity -= item.quantity;
          await manager.save(pallet);
        }
      }

      return { movementId: movement.id };
    });
  }

  async createTransfer(dto: CreateTransferDto) {
    return this.dataSource.transaction(async (manager: import('typeorm').EntityManager) => {
      const pallet = await manager.findOne(Pallet, { where: { id: dto.palletId } });
      if (!pallet) throw new NotFoundException('Pallet no encontrado');

      if (pallet.quantity < dto.quantity) {
        throw new BadRequestException('Cantidad insuficiente para transferencia');
      }

      const movement = manager.create(Movement, {
        type: 'TRANSFER',
        reference: dto.reference,
        notes: dto.notes,
      });
      await manager.save(movement);

      await manager.save(
        manager.create(MovementDetail, {
          movementId: movement.id,
          palletId: pallet.id,
          lotId: pallet.lotId,
          locationId: pallet.currentLocationId,
          quantity: dto.quantity,
        }),
      );

      if (pallet.quantity === dto.quantity) {
        pallet.currentLocationId = dto.destinationLocationId;
        await manager.save(pallet);

        await manager.save(
          manager.create(MovementDetail, {
            movementId: movement.id,
            palletId: pallet.id,
            lotId: pallet.lotId,
            locationId: dto.destinationLocationId,
            quantity: dto.quantity,
          }),
        );

        return { movementId: movement.id };
      }

      pallet.quantity -= dto.quantity;
      await manager.save(pallet);

      const newPallet = manager.create(Pallet, {
        code: `${pallet.code}-T`,
        lotId: pallet.lotId,
        quantity: dto.quantity,
        currentLocationId: dto.destinationLocationId,
        status: pallet.status,
      });
      await manager.save(newPallet);

      await manager.save(
        manager.create(MovementDetail, {
          movementId: movement.id,
          palletId: newPallet.id,
          lotId: pallet.lotId,
          locationId: dto.destinationLocationId,
          quantity: dto.quantity,
        }),
      );

      return { movementId: movement.id, newPalletId: newPallet.id };
    });
  }


  private toStartDate(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00.000Z`);
    return new Date(value);
  }

  private toEndDate(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T23:59:59.999Z`);
    return new Date(value);
  }

  async findAll(query: MovementsQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);

    const qb = this.dataSource
      .getRepository(Movement)
      .createQueryBuilder('movement')
      .leftJoin('movement_details', 'detail', 'detail.movementId = movement.id')
      .leftJoin('locations', 'location', 'location.id = detail.locationId')
      .leftJoin('warehouses', 'warehouse', 'warehouse.id = location.warehouseId')
      .leftJoin('pallets', 'pallet', 'pallet.id = detail.palletId')
      .leftJoin('lots', 'lot', 'lot.id = detail.lotId')
      .leftJoin('products', 'product', 'product.id = lot.productId')
      .orderBy('movement.date', 'DESC')
      .distinct(true);

    if (query.warehouseId) qb.andWhere('warehouse.id = :warehouseId', { warehouseId: query.warehouseId });
    if (query.type) qb.andWhere('movement.type = :type', { type: query.type });
    if (query.dateFrom) qb.andWhere('movement.date >= :dateFrom', { dateFrom: this.toStartDate(query.dateFrom) });
    if (query.dateTo) qb.andWhere('movement.date <= :dateTo', { dateTo: this.toEndDate(query.dateTo) });
    if (query.search?.trim()) {
      const search = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(movement.reference) LIKE :search OR LOWER(movement.notes) LIKE :search OR LOWER(pallet.code) LIKE :search OR CAST(detail.palletId as text) LIKE :search OR LOWER(lot.lotCode) LIKE :search OR LOWER(product.code) LIKE :search OR LOWER(product.description) LIKE :search)',
        { search },
      );
    }

    qb.skip((page - 1) * limit).take(limit);
    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async findOne(id: string) {
    const movement = await this.dataSource.getRepository(Movement).findOne({ where: { id } });
    if (!movement) throw new NotFoundException('Movimiento no encontrado');

    const details = await this.dataSource.getRepository(MovementDetail).find({ where: { movementId: id } });
    return { ...movement, details };
  }
}
