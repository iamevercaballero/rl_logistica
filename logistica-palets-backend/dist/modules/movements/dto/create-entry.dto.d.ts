export declare class EntryItemDto {
    palletCode: string;
    lotId: string;
    locationId: string;
    quantity: number;
}
export declare class CreateEntryDto {
    reference?: string;
    notes?: string;
    items: EntryItemDto[];
}
