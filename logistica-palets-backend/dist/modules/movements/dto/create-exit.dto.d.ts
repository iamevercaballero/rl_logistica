export declare class ExitItemDto {
    palletId: string;
    quantity: number;
}
export declare class CreateExitDto {
    reference?: string;
    notes?: string;
    items: ExitItemDto[];
}
