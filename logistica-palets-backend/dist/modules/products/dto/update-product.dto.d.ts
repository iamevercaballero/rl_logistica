export declare class UpdateProductDto {
    code?: string;
    description?: string;
    unitOfMeasure?: string;
    active?: boolean;
    stockMinimo?: number | null;
    stackable?: boolean;
    maxStackLevel?: number | null;
    canReceiveWeightOnTop?: boolean;
    stackingNotes?: string | null;
}
