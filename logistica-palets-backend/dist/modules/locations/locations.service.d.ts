import { Repository } from 'typeorm';
import { Location } from './entities/location.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
export declare class LocationsService {
    private readonly locationRepo;
    private readonly warehouseRepo;
    constructor(locationRepo: Repository<Location>, warehouseRepo: Repository<Warehouse>);
    create(dto: CreateLocationDto): Promise<Location>;
    findAll(): Promise<Location[]>;
    findOne(id: string): Promise<Location>;
    update(id: string, dto: UpdateLocationDto): Promise<Location>;
    remove(id: string): Promise<Location>;
}
