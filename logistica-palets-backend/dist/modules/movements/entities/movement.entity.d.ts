export declare const movementTypes: readonly ["ENTRY", "EXIT", "TRANSFER", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "REPROCESS"];
export type MovementType = (typeof movementTypes)[number];
export declare class Movement {
    id: string;
    type: MovementType;
    date: Date;
    productId: string;
    quantity: number;
    pallets?: number;
    warehouseId?: string;
    locationId?: string;
    fromWarehouseId?: string;
    fromLocationId?: string;
    toWarehouseId?: string;
    toLocationId?: string;
    documentNumber?: string;
    supplier?: string;
    carrier?: string;
    driver?: string;
    destination?: string;
    notes?: string;
    palletId?: string;
    lotId?: string;
    createdById: string;
    createdAt: Date;
}
