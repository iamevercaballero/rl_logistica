import { CreateTransportDto } from './dto/create-transport.dto';
import { UpdateTransportDto } from './dto/update-transport.dto';
import { TransportsService } from './transports.service';
export declare class TransportsController {
    private readonly service;
    constructor(service: TransportsService);
    findAll(): Promise<import("./entities/transport.entity").Transport[]>;
    findOne(id: string): Promise<import("./entities/transport.entity").Transport>;
    create(dto: CreateTransportDto): Promise<import("./entities/transport.entity").Transport>;
    update(id: string, dto: UpdateTransportDto): Promise<import("./entities/transport.entity").Transport>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
