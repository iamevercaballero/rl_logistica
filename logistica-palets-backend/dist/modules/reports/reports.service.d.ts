import { DataSource } from 'typeorm';
export declare class ReportsService {
    private readonly dataSource;
    constructor(dataSource: DataSource);
    stock(): Promise<any>;
    movements(): Promise<any>;
    trace(palletId: string): Promise<any>;
    kpis(): Promise<{
        totalPallets: any;
        totalUnits: any;
        movementsToday: any;
        stockByWarehouse: any;
    }>;
}
