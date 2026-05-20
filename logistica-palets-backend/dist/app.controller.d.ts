import { DataSource } from 'typeorm';
export declare class AppController {
    private readonly dataSource;
    private readonly startedAt;
    constructor(dataSource: DataSource);
    root(): {
        ok: boolean;
        name: string;
        time: string;
    };
    health(): Promise<{
        status: "ok" | "error";
        timestamp: string;
        uptime: number;
        checks: Record<string, {
            status: string;
            latencyMs?: number;
            note?: string;
        }>;
    }>;
}
