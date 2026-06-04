export declare class CreateProductDto {
    code: string;
    description: string;
    unitOfMeasure?: string;
    active?: boolean;
    stockMinimo?: number;
    stackable?: boolean;
    maxStackLevel?: number | null;
    canReceiveWeightOnTop?: boolean;
    stackingNotes?: string | null;
}
