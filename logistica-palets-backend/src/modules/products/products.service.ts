import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
  ) {}

  async create(dto: CreateProductDto) {
    await this.ensureCodeAvailable(dto.code);
    const product = this.productRepo.create({
      ...dto,
      code: dto.code.trim().toUpperCase(),
      description: dto.description.trim(),
      unitOfMeasure: dto.unitOfMeasure?.trim().toUpperCase(),
    });
    return this.productRepo.save(product);
  }

  findAll() {
    return this.productRepo.find({ order: { code: 'ASC' } });
  }

  async findOne(id: string) {
    const product = await this.productRepo.findOne({ where: { id } });
    if (!product) throw new NotFoundException('Material no encontrado');
    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    const product = await this.findOne(id);

    if (dto.code && dto.code.trim().toUpperCase() !== product.code) {
      await this.ensureCodeAvailable(dto.code, id);
    }

    Object.assign(product, {
      ...dto,
      code: dto.code ? dto.code.trim().toUpperCase() : product.code,
      description: dto.description ? dto.description.trim() : product.description,
      unitOfMeasure: dto.unitOfMeasure ? dto.unitOfMeasure.trim().toUpperCase() : product.unitOfMeasure,
    });

    return this.productRepo.save(product);
  }

  async remove(id: string) {
    const product = await this.findOne(id);
    return this.productRepo.remove(product);
  }

  private async ensureCodeAvailable(code: string, excludeId?: string) {
    const existing = await this.productRepo.findOne({ where: { code: code.trim().toUpperCase() } });
    if (existing && existing.id !== excludeId) {
      throw new BadRequestException('Ya existe un material con ese código');
    }
  }
}
