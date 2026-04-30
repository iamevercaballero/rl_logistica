import { MovementType } from '../../movements/entities/movement.entity';
export declare class ReportsMovementsQueryDto {
    warehouseId?: string;
    locationId?: string;
    productId?: string;
    type?: MovementType;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    page?: number;
    limit?: number;
}
