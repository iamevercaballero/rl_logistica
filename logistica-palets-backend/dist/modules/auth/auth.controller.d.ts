import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
export declare class AuthController {
    private readonly auth;
    constructor(auth: AuthService);
    login(dto: LoginDto, res: Response): Promise<{
        access_token: string;
        user: {
            userId: string;
            username: string;
            role: import("../users/entities/user.entity").UserRole;
        };
    }>;
    refresh(req: Request): Promise<{
        access_token: string;
    }>;
    logout(res: Response): {
        loggedOut: boolean;
    };
    me(req: Request): any;
}
