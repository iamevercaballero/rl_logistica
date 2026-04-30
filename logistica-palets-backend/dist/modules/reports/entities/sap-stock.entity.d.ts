export declare class SapStockSnapshot {
    id: string;
    date: string;
    productId: string;
    warehouseId?: string | null;
    locationId?: string | null;
    sapQuantity: number;
    createdAt: Date;
}
