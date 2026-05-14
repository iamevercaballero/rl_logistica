import { Repository } from 'typeorm';
import { Lot } from './entities/lot.entity';
import { Product } from '../products/entities/product.entity';
import { Pallet } from '../pallets/entities/pallet.entity';
import { CreateLotDto } from './dto/create-lot.dto';
import { UpdateLotDto } from './dto/update-lot.dto';
export declare class LotsService {
    private readonly lotRepo;
    private readonly productRepo;
    private readonly palletRepo;
    constructor(lotRepo: Repository<Lot>, productRepo: Repository<Product>, palletRepo: Repository<Pallet>);
    create(dto: CreateLotDto): Promise<Lot>;
    findAll(productId?: string, sapLot?: string): Promise<Lot[]>;
    findFefo(productId?: string, sapLot?: string, locationId?: string): Promise<{
        pallets: Pallet[];
        id: string;
        lotCode: string;
        productId: string;
        product: Product;
        fechaVencimiento?: string | null;
        fechaFabricacion?: string | null;
        proveedor?: string | null;
        sapLot?: string | null;
        stockActual: number;
        status: string;
    }[]>;
    findOne(id: string): Promise<Lot>;
    findOrCreate(productId: string, lotCode: string, fechaVencimiento?: string, proveedor?: string, fechaFabricacion?: string, sapLot?: string): Promise<Lot>;
    update(id: string, dto: UpdateLotDto): Promise<Lot>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
