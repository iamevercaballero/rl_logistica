import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
export declare class AuthController {
    private readonly auth;
    constructor(auth: AuthService);
    login(dto: LoginDto): Promise<{
        access_token: string;
        user: {
            userId: string;
            username: string;
            role: import("../users/entities/user.entity").UserRole;
        };
    }>;
    me(req: any): any;
}
