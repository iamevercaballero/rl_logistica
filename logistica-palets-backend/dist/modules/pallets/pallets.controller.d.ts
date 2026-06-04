import { Request } from 'express';
import { PalletsService } from './pallets.service';
import { CreatePalletDto } from './dto/create-pallet.dto';
import { UpdatePalletDto } from './dto/update-pallet.dto';
declare class QuickTransferDto {
    toLocationId: string;
}
export declare class PalletsController {
    private readonly service;
    constructor(service: PalletsService);
    findAll(lotId?: string, status?: string, productId?: string, locationId?: string, search?: string): Promise<import("./pallets.service").EnrichedPallet[]>;
    kpis(): Promise<{
        total: number;
        available: number;
        partial: number;
        blocked: number;
        damaged: number;
        inTransit: number;
        exited: number;
        empty: number;
        noLocation: number;
    }>;
    reconcileStatuses(): Promise<{
        exited: number;
        partial: number;
    }>;
    findOne(id: string): Promise<import("./entities/pallet.entity").Pallet>;
    history(id: string): Promise<{
        pallet: import("./entities/pallet.entity").Pallet;
        product: {
            code: any;
            description: any;
        } | null;
        history: {
            movementId: any;
            type: any;
            date: any;
            quantity: number;
            remainingAfter: number;
            documentNumber: any;
            supplier: any;
            carrier: any;
            driver: any;
            destination: any;
            notes: any;
            status: any;
            from: {
                locationId: any;
                locationCode: any;
                warehouseName: any;
            } | null;
            to: {
                locationId: any;
                locationCode: any;
                warehouseName: any;
            } | null;
        }[];
    }>;
    create(dto: CreatePalletDto): Promise<import("./entities/pallet.entity").Pallet>;
    quickTransfer(id: string, dto: QuickTransferDto, req: Request & {
        user: {
            userId: string;
        };
    }): Promise<import("./entities/pallet.entity").Pallet | null>;
    update(id: string, dto: UpdatePalletDto): Promise<import("./entities/pallet.entity").Pallet>;
    remove(_id: string): void;
}
export {};
