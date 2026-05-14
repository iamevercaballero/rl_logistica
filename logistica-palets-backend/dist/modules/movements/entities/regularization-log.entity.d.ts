export declare class RegularizationLog {
    id: string;
    movementId: string;
    field: string;
    oldValue?: string | null;
    newValue?: string | null;
    changedById: string;
    reason: string;
    createdAt: Date;
}
