import { Repository } from 'typeorm';
import { User, UserRole } from './entities/user.entity';
export declare class UsersService {
    private readonly userRepo;
    constructor(userRepo: Repository<User>);
    findAll(): Promise<User[]>;
    findActive(): Promise<User[]>;
    findByUsername(username: string): Promise<User | null>;
    createWithPassword(username: string, password: string, role?: UserRole, fullName?: string): Promise<{
        id: string;
        username: string;
        fullName: string | null | undefined;
        role: UserRole;
        active: boolean;
    }>;
    update(id: string, dto: {
        username?: string;
        password?: string;
        role?: string;
        fullName?: string;
        active?: boolean;
    }): Promise<{
        id: string;
        username: string;
        fullName: string | null | undefined;
        role: UserRole;
        active: boolean;
    }>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
