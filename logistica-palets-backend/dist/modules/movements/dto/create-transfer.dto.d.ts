export declare class CreateTransferDto {
    date?: string;
    productId: string;
    quantity: number;
    pallets?: number;
    fromLocationId: string;
    toLocationId: string;
    documentNumber?: string;
    carrier?: string;
    driver?: string;
    notes?: string;
    palletId?: string;
    lotId?: string;
}
