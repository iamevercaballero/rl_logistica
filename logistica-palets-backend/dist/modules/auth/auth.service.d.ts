import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
export declare class AuthService {
    private readonly usersService;
    private readonly jwt;
    constructor(usersService: UsersService, jwt: JwtService);
    login(username: string, password: string): Promise<{
        access_token: string;
        user: {
            userId: string;
            username: string;
            role: import("../users/entities/user.entity").UserRole;
        };
    }>;
}
