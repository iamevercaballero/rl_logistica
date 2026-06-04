import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
export declare class AuthService {
    private readonly usersService;
    private readonly jwt;
    constructor(usersService: UsersService, jwt: JwtService);
    private get refreshSecret();
    private get refreshExpiresIn();
    login(username: string, password: string): Promise<{
        access_token: string;
        refresh_token: string;
        user: {
            userId: string;
            username: string;
            role: import("../users/entities/user.entity").UserRole;
        };
    }>;
    refresh(refreshToken: string | undefined): Promise<{
        access_token: string;
    }>;
}
