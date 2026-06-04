export declare class Product {
    id: string;
    code: string;
    description: string;
    unitOfMeasure: string;
    active: boolean;
    stockMinimo?: number | null;
    stackable: boolean;
    maxStackLevel?: number | null;
    canReceiveWeightOnTop: boolean;
    stackingNotes?: string | null;
}
