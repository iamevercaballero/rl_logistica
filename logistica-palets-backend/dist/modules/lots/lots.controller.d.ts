import { LotsService } from './lots.service';
import { CreateLotDto } from './dto/create-lot.dto';
import { UpdateLotDto } from './dto/update-lot.dto';
export declare class LotsController {
    private readonly service;
    constructor(service: LotsService);
    findAll(productId?: string, sapLot?: string, includePallets?: string): Promise<{
        pallets?: import("../pallets/entities/pallet.entity").Pallet[] | undefined;
        availablePalletsCount: number;
        exitedPalletsCount: number;
        totalPalletsCount: number;
        id: string;
        lotCode: string;
        productId: string;
        product: import("../products/entities/product.entity").Product;
        fechaVencimiento?: string | null;
        fechaFabricacion?: string | null;
        proveedor?: string | null;
        sapLot?: string | null;
        stockActual: number;
        status: string;
    }[]>;
    fefo(productId?: string, sapLot?: string, locationId?: string): Promise<{
        pallets: import("../pallets/entities/pallet.entity").Pallet[];
        id: string;
        lotCode: string;
        productId: string;
        product: import("../products/entities/product.entity").Product;
        fechaVencimiento?: string | null;
        fechaFabricacion?: string | null;
        proveedor?: string | null;
        sapLot?: string | null;
        stockActual: number;
        status: string;
    }[]>;
    findOne(id: string): Promise<import("./entities/lot.entity").Lot>;
    create(dto: CreateLotDto): Promise<import("./entities/lot.entity").Lot>;
    update(id: string, dto: UpdateLotDto): Promise<import("./entities/lot.entity").Lot>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
    reconcile(id: string): Promise<{
        lotId: string;
        lotCode: string;
        previous: number;
        reconciled: number;
        delta: number;
    }>;
    reconcileAll(productId?: string): Promise<{
        corrected: number;
        corrections: {
            lotId: string;
            lotCode: string;
            previous: number;
            reconciled: number;
            delta: number;
        }[];
    }>;
}
