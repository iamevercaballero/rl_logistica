import { Repository } from 'typeorm';
import { User, UserRole } from './entities/user.entity';
export declare class UsersService {
    private readonly userRepo;
    constructor(userRepo: Repository<User>);
    findAll(): Promise<User[]>;
    findByUsername(username: string): Promise<User | null>;
    createWithPassword(username: string, password: string, role?: UserRole): Promise<{
        id: string;
        username: string;
        role: UserRole;
        active: boolean;
    }>;
}
