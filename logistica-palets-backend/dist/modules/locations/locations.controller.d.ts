import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
export declare class LocationsController {
    private readonly service;
    constructor(service: LocationsService);
    findAll(): Promise<import("./entities/location.entity").Location[]>;
    findOne(id: string): Promise<import("./entities/location.entity").Location>;
    create(dto: CreateLocationDto): Promise<import("./entities/location.entity").Location>;
    update(id: string, dto: UpdateLocationDto): Promise<import("./entities/location.entity").Location>;
    remove(id: string): Promise<import("./entities/location.entity").Location>;
}
