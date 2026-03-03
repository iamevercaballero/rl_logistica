import { ReportsService } from './reports.service';
export declare class ReportsController {
    private readonly service;
    constructor(service: ReportsService);
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
