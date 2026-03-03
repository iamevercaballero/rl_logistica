import { Repository } from 'typeorm';
import { Pallet } from './entities/pallet.entity';
import { CreatePalletDto } from './dto/create-pallet.dto';
import { UpdatePalletDto } from './dto/update-pallet.dto';
import { Lot } from '../lots/entities/lot.entity';
import { Location } from '../locations/entities/location.entity';
export declare class PalletsService {
    private readonly palletRepo;
    private readonly lotRepo;
    private readonly locationRepo;
    constructor(palletRepo: Repository<Pallet>, lotRepo: Repository<Lot>, locationRepo: Repository<Location>);
    create(dto: CreatePalletDto): Promise<Pallet>;
    findAll(): Promise<Pallet[]>;
    findOne(id: string): Promise<Pallet>;
    update(id: string, dto: UpdatePalletDto): Promise<Pallet>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
