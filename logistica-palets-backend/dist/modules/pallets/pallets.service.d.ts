import { DataSource, Repository } from 'typeorm';
import { Pallet } from './entities/pallet.entity';
import { CreatePalletDto } from './dto/create-pallet.dto';
import { UpdatePalletDto } from './dto/update-pallet.dto';
import { Lot } from '../lots/entities/lot.entity';
import { Location } from '../locations/entities/location.entity';
export interface EnrichedPallet {
    id: string;
    code: string;
    lotId: string;
    quantity: number;
    currentLocationId: string | null;
    status: string;
    createdAt: Date;
    exitedAt: Date | null;
    lotCode: string;
    fechaVencimiento: string | null;
    productId: string;
    productCode: string;
    productDescription: string;
    locationCode: string | null;
    warehouseId: string | null;
    warehouseName: string | null;
}
export declare class PalletsService {
    private readonly dataSource;
    private readonly palletRepo;
    private readonly lotRepo;
    private readonly locationRepo;
    constructor(dataSource: DataSource, palletRepo: Repository<Pallet>, lotRepo: Repository<Lot>, locationRepo: Repository<Location>);
    create(dto: CreatePalletDto): Promise<Pallet>;
    findAll(filters?: {
        lotId?: string;
        status?: string;
        productId?: string;
        locationId?: string;
        search?: string;
    }): Promise<EnrichedPallet[]>;
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
    findOne(id: string): Promise<Pallet>;
    update(id: string, dto: UpdatePalletDto): Promise<Pallet>;
    quickTransfer(palletId: string, toLocationId: string, userId: string): Promise<Pallet | null>;
    private findOrCreateStock;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
    history(id: string): Promise<{
        pallet: Pallet;
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
}
