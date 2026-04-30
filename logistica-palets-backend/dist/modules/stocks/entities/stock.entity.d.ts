export declare class Stock {
    id: string;
    productId: string;
    warehouseId?: string | null;
    locationId?: string | null;
    currentQuantity: number;
    updatedAt: Date;
}
