import { Location } from '../../locations/entities/location.entity';
export declare class Warehouse {
    id: string;
    name: string;
    address: string;
    active: boolean;
    locations: Location[];
}
