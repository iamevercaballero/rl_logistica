import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lot } from './entities/lot.entity';
import { Product } from '../products/entities/product.entity';
import { CreateLotDto } from './dto/create-lot.dto';
import { UpdateLotDto } from './dto/update-lot.dto';

@Injectable()
export class LotsService {
  constructor(
    @InjectRepository(Lot)
    private readonly lotRepo: Repository<Lot>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
  ) {}

  async create(dto: CreateLotDto) {
    const product = await this.productRepo.findOne({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');

    const lot = this.lotRepo.create({
      lotCode: dto.lotCode,
      product,
    });

    return this.lotRepo.save(lot);
  }

  findAll() {
    return this.lotRepo.find({ relations: ['product'] });
  }

  async findOne(id: string) {
    const lot = await this.lotRepo.findOne({ where: { id }, relations: ['product'] });
    if (!lot) throw new NotFoundException('Lote no encontrado');
    return lot;
  }

  async update(id: string, dto: UpdateLotDto) {
    const lot = await this.findOne(id);
    Object.assign(lot, dto);
    return this.lotRepo.save(lot);
  }

  async remove(id: string) {
    const lot = await this.findOne(id);
    await this.lotRepo.remove(lot);
    return { deleted: true };
  }
}
