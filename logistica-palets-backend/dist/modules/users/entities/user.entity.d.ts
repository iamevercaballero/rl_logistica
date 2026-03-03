export type UserRole = 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'AUDITOR';
export declare class User {
    id: string;
    username: string;
    passwordHash: string;
    role: UserRole;
    active: boolean;
}
