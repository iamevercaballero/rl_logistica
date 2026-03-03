import { DataSource } from 'typeorm';
import { Movement } from './entities/movement.entity';
import { MovementDetail } from './entities/movement-detail.entity';
import { CreateEntryDto } from './dto/create-entry.dto';
import { CreateExitDto } from './dto/create-exit.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
export declare class MovementsService {
    private readonly dataSource;
    constructor(dataSource: DataSource);
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
    findAll(): Promise<Movement[]>;
    findOne(id: string): Promise<{
        details: MovementDetail[];
        id: string;
        type: string;
        date: Date;
        reference?: string;
        notes?: string;
    }>;
}
