import { Warehouse } from '../../warehouses/entities/warehouse.entity';
export declare class Location {
    id: string;
    code: string;
    type: string;
    warehouse: Warehouse;
    active: boolean;
}
