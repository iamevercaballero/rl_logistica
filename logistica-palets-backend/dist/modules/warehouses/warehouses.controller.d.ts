import { WarehousesService } from './warehouses.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
export declare class WarehousesController {
    private readonly service;
    constructor(service: WarehousesService);
    findAll(): Promise<import("./entities/warehouse.entity").Warehouse[]>;
    findOne(id: string): Promise<import("./entities/warehouse.entity").Warehouse>;
    create(dto: CreateWarehouseDto): Promise<import("./entities/warehouse.entity").Warehouse>;
    update(id: string, dto: UpdateWarehouseDto): Promise<import("./entities/warehouse.entity").Warehouse>;
    remove(id: string): Promise<import("./entities/warehouse.entity").Warehouse>;
}
