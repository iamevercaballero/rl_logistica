import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pallet } from './entities/pallet.entity';
import { CreatePalletDto } from './dto/create-pallet.dto';
import { UpdatePalletDto } from './dto/update-pallet.dto';
import { Lot } from '../lots/entities/lot.entity';
import { Location } from '../locations/entities/location.entity';

@Injectable()
export class PalletsService {
  constructor(
    @InjectRepository(Pallet) private readonly palletRepo: Repository<Pallet>,
    @InjectRepository(Lot) private readonly lotRepo: Repository<Lot>,
    @InjectRepository(Location) private readonly locationRepo: Repository<Location>,
  ) {}

  async create(dto: CreatePalletDto) {
    // code único
    const exists = await this.palletRepo.findOne({ where: { code: dto.code } });
    if (exists) throw new BadRequestException('Ya existe un pallet con ese código');

    // validar FK
    const lot = await this.lotRepo.findOne({ where: { id: dto.lotId } });
    if (!lot) throw new NotFoundException('Lote no encontrado');

    const loc = await this.locationRepo.findOne({ where: { id: dto.currentLocationId } });
    if (!loc) throw new NotFoundException('Ubicación no encontrada');

    const pallet = this.palletRepo.create({
      code: dto.code,
      lotId: dto.lotId,
      quantity: dto.quantity,
      currentLocationId: dto.currentLocationId,
      status: dto.status ?? 'AVAILABLE',
    });

    return this.palletRepo.save(pallet);
  }

  findAll() {
    return this.palletRepo.find();
  }

  async findOne(id: string) {
    const pallet = await this.palletRepo.findOne({ where: { id } });
    if (!pallet) throw new NotFoundException('Pallet no encontrado');
    return pallet;
  }

  async update(id: string, dto: UpdatePalletDto) {
    const pallet = await this.findOne(id);

    if (dto.currentLocationId) {
      const loc = await this.locationRepo.findOne({ where: { id: dto.currentLocationId } });
      if (!loc) throw new NotFoundException('Ubicación no encontrada');
    }

    Object.assign(pallet, dto);
    return this.palletRepo.save(pallet);
  }

  async remove(id: string) {
    const pallet = await this.findOne(id);
    await this.palletRepo.remove(pallet);
    return { deleted: true };
  }
}
