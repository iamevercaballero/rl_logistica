import { DataSource, Repository } from 'typeorm';
import { StockQueryDto } from './dto/stock-query.dto';
import { ReportsMovementsQueryDto } from './dto/movements-query.dto';
import { KpisQueryDto } from './dto/kpis-query.dto';
import { DailyStockQueryDto } from './dto/daily-stock-query.dto';
import { DifferencesSapQueryDto } from './dto/differences-sap-query.dto';
import { UpsertSapStockDto } from './dto/upsert-sap-stock.dto';
import { SapStockSnapshot } from './entities/sap-stock.entity';
import { CacheService } from '../cache/cache.service';
export declare class ReportsService {
    private readonly dataSource;
    private readonly sapStockRepo;
    private readonly cache;
    constructor(dataSource: DataSource, sapStockRepo: Repository<SapStockSnapshot>, cache: CacheService);
    private parseNumber;
    private toStartDate;
    private toEndDate;
    private getRangeDates;
    private getPreviousRangeDates;
    stock(query: StockQueryDto): Promise<{}>;
    movements(query: ReportsMovementsQueryDto): Promise<{
        data: {
            id: any;
            type: any;
            date: any;
            quantity: number;
            pallets: number | null;
            documentNumber: any;
            supplier: any;
            carrier: any;
            driver: any;
            destination: any;
            notes: any;
            material: {
                id: any;
                code: any;
                description: any;
                unitOfMeasure: any;
            };
            warehouse: {
                id: any;
                name: any;
            } | null;
            location: {
                id: any;
                code: any;
            } | null;
            lotCode: any;
            sapLot: any;
            lotCount: number;
            status: any;
            adjustmentReason: any;
            from: {
                warehouseName: any;
                locationCode: any;
            } | null;
            to: {
                warehouseName: any;
                locationCode: any;
            } | null;
        }[];
        meta: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
        };
    }>;
    trace(materialId: string): Promise<{
        material: any;
        history: {
            movementId: any;
            at: any;
            type: any;
            quantity: number;
            documentNumber: any;
            supplier: any;
            destination: any;
            notes: any;
            warehouseName: any;
            locationCode: any;
            fromWarehouseName: any;
            fromLocationCode: any;
            toWarehouseName: any;
            toLocationCode: any;
        }[];
    }>;
    dailyStock(query: DailyStockQueryDto): Promise<any>;
    upsertSapStock(dto: UpsertSapStockDto): Promise<SapStockSnapshot>;
    differencesSap(query: DifferencesSapQueryDto): Promise<any>;
    kpis(query: KpisQueryDto): Promise<{}>;
    freshness(productId?: string): Promise<{
        lotId: any;
        lotCode: any;
        sapLot: any;
        fechaVencimiento: any;
        fechaFabricacion: any;
        stockActual: number;
        proveedor: any;
        diasRestantes: number;
        product: {
            id: any;
            code: any;
            description: any;
            unitOfMeasure: any;
        };
    }[]>;
    private buildMovementScopeFilter;
    private buildSapScopeFilter;
}
