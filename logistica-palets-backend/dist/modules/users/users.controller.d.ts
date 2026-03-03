import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
export declare class UsersController {
    private readonly service;
    constructor(service: UsersService);
    findAll(): Promise<import("./entities/user.entity").User[]>;
    create(dto: CreateUserDto): Promise<{
        id: string;
        username: string;
        role: import("./entities/user.entity").UserRole;
        active: boolean;
    }>;
}
