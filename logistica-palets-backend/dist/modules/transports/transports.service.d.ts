import { Repository } from 'typeorm';
import { Transport } from './entities/transport.entity';
import { CreateTransportDto } from './dto/create-transport.dto';
import { UpdateTransportDto } from './dto/update-transport.dto';
export declare class TransportsService {
    private readonly repo;
    constructor(repo: Repository<Transport>);
    create(dto: CreateTransportDto): Promise<Transport>;
    findAll(): Promise<Transport[]>;
    findOne(id: string): Promise<Transport>;
    update(id: string, dto: UpdateTransportDto): Promise<Transport>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
