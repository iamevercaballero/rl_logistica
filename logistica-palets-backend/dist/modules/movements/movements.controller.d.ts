import { MovementsService } from './movements.service';
import { CreateEntryDto } from './dto/create-entry.dto';
import { CreateExitDto } from './dto/create-exit.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
export declare class MovementsController {
    private readonly service;
    constructor(service: MovementsService);
    createEntry(dto: CreateEntryDto): Promise<{
        movementId: string;
    }>;
    createExit(dto: CreateExitDto): Promise<{
        movementId: string;
    }>;
    createTransfer(dto: CreateTransferDto): Promise<{
        movementId: string;
        newPalletId?: undefined;
    } | {
        movementId: string;
        newPalletId: string;
    }>;
    findAll(): Promise<import("./entities/movement.entity").Movement[]>;
    findOne(id: string): Promise<{
        details: import("./entities/movement-detail.entity").MovementDetail[];
        id: string;
        type: string;
        date: Date;
        reference?: string;
        notes?: string;
    }>;
}
