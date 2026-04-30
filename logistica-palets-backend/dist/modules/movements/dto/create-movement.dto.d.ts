import { MovementType } from '../entities/movement.entity';
export declare class CreateMovementDto {
    type: MovementType;
    date?: string;
    productId: string;
    quantity: number;
    pallets?: number;
    warehouseId?: string;
    locationId?: string;
    fromLocationId?: string;
    toLocationId?: string;
    documentNumber?: string;
    supplier?: string;
    carrier?: string;
    driver?: string;
    destination?: string;
    notes?: string;
    palletId?: string;
    lotId?: string;
}
