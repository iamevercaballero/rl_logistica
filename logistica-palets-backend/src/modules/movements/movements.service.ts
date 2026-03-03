import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Movement } from './entities/movement.entity';
import { MovementDetail } from './entities/movement-detail.entity';
import { Pallet } from '../pallets/entities/pallet.entity';
import { CreateEntryDto } from './dto/create-entry.dto';
import { CreateExitDto } from './dto/create-exit.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';

@Injectable()
export class MovementsService {
  constructor(private readonly dataSource: DataSource) {}

  async createEntry(dto: CreateEntryDto) {
    return this.dataSource.transaction(async (manager: import('typeorm').EntityManager) => {
      const movement = manager.create(Movement, {
        type: 'ENTRADA',
        reference: dto.reference,
        notes: dto.notes,
      });
      await manager.save(movement);

      for (const item of dto.items) {
        // crear pallet
        const pallet = manager.create(Pallet, {
          code: item.palletCode,
          lotId: item.lotId,
          quantity: item.quantity,
          currentLocationId: item.locationId,
          status: 'AVAILABLE',
        });
        await manager.save(pallet);

        // detalle
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
        type: 'SALIDA',
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

        // detalle salida
        const detail = manager.create(MovementDetail, {
          movementId: movement.id,
          palletId: pallet.id,
          lotId: pallet.lotId,
          locationId: pallet.currentLocationId,
          quantity: item.quantity,
        });
        await manager.save(detail);

        // actualizar pallet
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
        type: 'TRANSFERENCIA',
        reference: dto.reference,
        notes: dto.notes,
      });
      await manager.save(movement);

      // detalle origen
      await manager.save(
        manager.create(MovementDetail, {
          movementId: movement.id,
          palletId: pallet.id,
          lotId: pallet.lotId,
          locationId: pallet.currentLocationId,
          quantity: dto.quantity,
        }),
      );

      // total
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

      // parcial: reduce original + crea nuevo
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
    async findAll() {
    return this.dataSource.getRepository(Movement).find({
      order: { date: 'DESC' }, // si tu entidad usa "date"
    });
  }

  async findOne(id: string) {
    const movement = await this.dataSource.getRepository(Movement).findOne({
      where: { id },
    });

    if (!movement) throw new NotFoundException('Movimiento no encontrado');

    const details = await this.dataSource.getRepository(MovementDetail).find({
      where: { movementId: id },
    });

    return { ...movement, details };
  }

}
