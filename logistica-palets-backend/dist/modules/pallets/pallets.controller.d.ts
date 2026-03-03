import { PalletsService } from './pallets.service';
import { CreatePalletDto } from './dto/create-pallet.dto';
import { UpdatePalletDto } from './dto/update-pallet.dto';
export declare class PalletsController {
    private readonly service;
    constructor(service: PalletsService);
    findAll(): Promise<import("./entities/pallet.entity").Pallet[]>;
    findOne(id: string): Promise<import("./entities/pallet.entity").Pallet>;
    create(dto: CreatePalletDto): Promise<import("./entities/pallet.entity").Pallet>;
    update(id: string, dto: UpdatePalletDto): Promise<import("./entities/pallet.entity").Pallet>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
