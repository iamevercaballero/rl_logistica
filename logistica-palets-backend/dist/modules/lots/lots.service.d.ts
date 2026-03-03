import { Repository } from 'typeorm';
import { Lot } from './entities/lot.entity';
import { Product } from '../products/entities/product.entity';
import { CreateLotDto } from './dto/create-lot.dto';
import { UpdateLotDto } from './dto/update-lot.dto';
export declare class LotsService {
    private readonly lotRepo;
    private readonly productRepo;
    constructor(lotRepo: Repository<Lot>, productRepo: Repository<Product>);
    create(dto: CreateLotDto): Promise<Lot>;
    findAll(): Promise<Lot[]>;
    findOne(id: string): Promise<Lot>;
    update(id: string, dto: UpdateLotDto): Promise<Lot>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
