import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Location } from './entities/location.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@Injectable()
export class LocationsService {
  constructor(
    @InjectRepository(Location)
    private readonly locationRepo: Repository<Location>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
  ) {}

  async create(dto: CreateLocationDto) {
    const warehouse = await this.warehouseRepo.findOne({
      where: { id: dto.warehouseId },
    });

    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    const location = this.locationRepo.create({
      code: dto.code,
      warehouse,
    });

    return this.locationRepo.save(location);
  }

  findAll() {
    return this.locationRepo.find({ relations: ['warehouse'] });
  }

  async findOne(id: string) {
    const location = await this.locationRepo.findOne({
      where: { id },
      relations: ['warehouse'],
    });

    if (!location) throw new NotFoundException('Location not found');
    return location;
  }

  async update(id: string, dto: UpdateLocationDto) {
    const location = await this.findOne(id);
    Object.assign(location, dto);
    return this.locationRepo.save(location);
  }

  async remove(id: string) {
    const location = await this.findOne(id);
    return this.locationRepo.remove(location);
  }
}
