import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lot } from './entities/lot.entity';
import { Product } from '../products/entities/product.entity';
import { Pallet } from '../pallets/entities/pallet.entity';
import { CreateLotDto } from './dto/create-lot.dto';
import { UpdateLotDto } from './dto/update-lot.dto';

@Injectable()
export class LotsService {
  constructor(
    @InjectRepository(Lot)
    private readonly lotRepo: Repository<Lot>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Pallet)
    private readonly palletRepo: Repository<Pallet>,
  ) {}

  async create(dto: CreateLotDto) {
    const product = await this.productRepo.findOne({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');

    const lot = this.lotRepo.create({
      lotCode: dto.lotCode,
      productId: dto.productId,
      product,
      fechaVencimiento: dto.fechaVencimiento ?? null,
      fechaFabricacion: dto.fechaFabricacion ?? null,
      proveedor: dto.proveedor ?? null,
      sapLot: dto.sapLot ?? null,
      stockActual: 0,
    });

    return this.lotRepo.save(lot);
  }

  findAll(productId?: string, sapLot?: string) {
    const qb = this.lotRepo
      .createQueryBuilder('lot')
      .leftJoinAndSelect('lot.product', 'product')
      .orderBy('lot.fechaVencimiento', 'ASC');
    if (productId) qb.andWhere('lot.productId = :productId', { productId });
    if (sapLot) qb.andWhere('lot.sapLot = :sapLot', { sapLot });
    return qb.getMany();
  }

  /** FEFO con pallets disponibles embebidos por lote.
   *  locationId: si se especifica, solo incluye pallets de esa ubicación (para transferencias). */
  async findFefo(productId?: string, sapLot?: string, locationId?: string) {
    const qb = this.lotRepo
      .createQueryBuilder('lot')
      .leftJoinAndSelect('lot.product', 'product')
      .andWhere('lot.stockActual > 0')
      .orderBy({ 'lot.fechaVencimiento': { order: 'ASC', nulls: 'NULLS LAST' } });
    if (productId) qb.andWhere('lot.productId = :productId', { productId });
    if (sapLot) qb.andWhere('lot.sapLot = :sapLot', { sapLot });
    const lots = await qb.getMany();

    if (lots.length === 0) return [];
    const lotIds = lots.map((l) => l.id);

    const palletsQb = this.palletRepo
      .createQueryBuilder('p')
      .where('p.lotId IN (:...lotIds)', { lotIds })
      .andWhere("p.status = 'AVAILABLE'")
      .orderBy('p.code', 'ASC');

    if (locationId) {
      palletsQb.andWhere('p.currentLocationId = :locationId', { locationId });
    }

    const pallets = await palletsQb.getMany();

    const palletsByLot = new Map<string, Pallet[]>();
    for (const p of pallets) {
      if (!palletsByLot.has(p.lotId)) palletsByLot.set(p.lotId, []);
      palletsByLot.get(p.lotId)!.push(p);
    }

    // Si se filtra por locationId, excluir lotes sin pallets en esa ubicación
    const result = lots.map((lot) => ({ ...lot, pallets: palletsByLot.get(lot.id) ?? [] }));
    return locationId ? result.filter((l) => l.pallets.length > 0) : result;
  }

  async findOne(id: string) {
    const lot = await this.lotRepo.findOne({ where: { id }, relations: ['product'] });
    if (!lot) throw new NotFoundException('Lote no encontrado');
    return lot;
  }

  async findOrCreate(
    productId: string,
    lotCode: string,
    fechaVencimiento?: string,
    proveedor?: string,
    fechaFabricacion?: string,
    sapLot?: string,
  ): Promise<Lot> {
    let lot = await this.lotRepo.findOne({ where: { productId, lotCode } });
    if (!lot) {
      lot = await this.lotRepo.save(this.lotRepo.create({
        lotCode, productId,
        fechaVencimiento: fechaVencimiento ?? null,
        fechaFabricacion: fechaFabricacion ?? null,
        proveedor: proveedor ?? null,
        sapLot: sapLot ?? null,
        stockActual: 0,
      }));
    } else {
      let changed = false;
      if (fechaVencimiento && !lot.fechaVencimiento) { lot.fechaVencimiento = fechaVencimiento; changed = true; }
      if (proveedor && !lot.proveedor) { lot.proveedor = proveedor; changed = true; }
      if (fechaFabricacion && !lot.fechaFabricacion) { lot.fechaFabricacion = fechaFabricacion; changed = true; }
      if (sapLot && !lot.sapLot) { lot.sapLot = sapLot; changed = true; }
      if (changed) lot = await this.lotRepo.save(lot);
    }
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
