import { MovementType } from '../entities/movement.entity';
export declare class MovementsQueryDto {
    page?: number;
    limit?: number;
    warehouseId?: string;
    locationId?: string;
    productId?: string;
    type?: MovementType;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
}
