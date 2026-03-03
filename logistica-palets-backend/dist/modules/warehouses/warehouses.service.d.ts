import { Repository } from 'typeorm';
import { Warehouse } from './entities/warehouse.entity';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
export declare class WarehousesService {
    private readonly warehouseRepo;
    constructor(warehouseRepo: Repository<Warehouse>);
    create(dto: CreateWarehouseDto): Promise<Warehouse>;
    findAll(): Promise<Warehouse[]>;
    findOne(id: string): Promise<Warehouse>;
    update(id: string, dto: UpdateWarehouseDto): Promise<Warehouse>;
    remove(id: string): Promise<Warehouse>;
}
