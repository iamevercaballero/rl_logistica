import { LotsService } from './lots.service';
import { CreateLotDto } from './dto/create-lot.dto';
import { UpdateLotDto } from './dto/update-lot.dto';
export declare class LotsController {
    private readonly service;
    constructor(service: LotsService);
    findAll(): Promise<import("./entities/lot.entity").Lot[]>;
    findOne(id: string): Promise<import("./entities/lot.entity").Lot>;
    create(dto: CreateLotDto): Promise<import("./entities/lot.entity").Lot>;
    update(id: string, dto: UpdateLotDto): Promise<import("./entities/lot.entity").Lot>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
