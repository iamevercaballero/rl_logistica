import { Request } from 'express';
import { MovementsService } from './movements.service';
import { CreateEntryDto } from './dto/create-entry.dto';
import { CreateExitDto } from './dto/create-exit.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { CreateMovementDto } from './dto/create-movement.dto';
import { MovementsQueryDto } from './dto/movements-query.dto';
export declare class MovementsController {
    private readonly service;
    constructor(service: MovementsService);
    create(dto: CreateMovementDto, req: Request & {
        user: {
            userId: string;
        };
    }): Promise<{
        movementId: string;
        stockImpact: string;
    }>;
    createEntry(dto: CreateEntryDto, req: Request & {
        user: {
            userId: string;
        };
    }): Promise<{
        movementId: string;
        stockImpact: string;
    }>;
    createExit(dto: CreateExitDto, req: Request & {
        user: {
            userId: string;
        };
    }): Promise<{
        movementId: string;
        stockImpact: string;
    }>;
    createTransfer(dto: CreateTransferDto, req: Request & {
        user: {
            userId: string;
        };
    }): Promise<{
        movementId: string;
        stockImpact: string;
    }>;
    createAdjustmentIn(dto: CreateEntryDto, req: Request & {
        user: {
            userId: string;
        };
    }): Promise<{
        movementId: string;
        stockImpact: string;
    }>;
    createAdjustmentOut(dto: CreateExitDto, req: Request & {
        user: {
            userId: string;
        };
    }): Promise<{
        movementId: string;
        stockImpact: string;
    }>;
    createReprocess(dto: CreateEntryDto, req: Request & {
        user: {
            userId: string;
        };
    }): Promise<{
        movementId: string;
        stockImpact: string;
    }>;
    findAll(query: MovementsQueryDto): Promise<{
        data: {
            id: unknown;
            type: unknown;
            date: unknown;
            quantity: number;
            pallets: number | null;
            documentNumber: unknown;
            supplier: unknown;
            carrier: unknown;
            driver: unknown;
            destination: unknown;
            notes: unknown;
            createdById: unknown;
            createdAt: unknown;
            palletId: unknown;
            lotId: unknown;
            material: {
                id: unknown;
                code: unknown;
                description: unknown;
                unitOfMeasure: unknown;
            };
            warehouse: {
                id: {};
                name: unknown;
            } | null;
            location: {
                id: {};
                code: unknown;
            } | null;
            from: {
                warehouseId: unknown;
                warehouseName: unknown;
                locationId: unknown;
                locationCode: unknown;
            } | null;
            to: {
                warehouseId: unknown;
                warehouseName: unknown;
                locationId: unknown;
                locationCode: unknown;
            } | null;
        }[];
        meta: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
        };
    }>;
    findOne(id: string): Promise<{
        id: unknown;
        type: unknown;
        date: unknown;
        quantity: number;
        pallets: number | null;
        documentNumber: unknown;
        supplier: unknown;
        carrier: unknown;
        driver: unknown;
        destination: unknown;
        notes: unknown;
        createdById: unknown;
        createdAt: unknown;
        palletId: unknown;
        lotId: unknown;
        material: {
            id: unknown;
            code: unknown;
            description: unknown;
            unitOfMeasure: unknown;
        };
        warehouse: {
            id: {};
            name: unknown;
        } | null;
        location: {
            id: {};
            code: unknown;
        } | null;
        from: {
            warehouseId: unknown;
            warehouseName: unknown;
            locationId: unknown;
            locationCode: unknown;
        } | null;
        to: {
            warehouseId: unknown;
            warehouseName: unknown;
            locationId: unknown;
            locationCode: unknown;
        } | null;
    }>;
}
