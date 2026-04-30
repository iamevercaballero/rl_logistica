import { ReportsService } from './reports.service';
import { StockQueryDto } from './dto/stock-query.dto';
import { ReportsMovementsQueryDto } from './dto/movements-query.dto';
import { TraceQueryDto } from './dto/trace-query.dto';
import { KpisQueryDto } from './dto/kpis-query.dto';
import { DailyStockQueryDto } from './dto/daily-stock-query.dto';
import { DifferencesSapQueryDto } from './dto/differences-sap-query.dto';
import { UpsertSapStockDto } from './dto/upsert-sap-stock.dto';
export declare class ReportsController {
    private readonly service;
    constructor(service: ReportsService);
    stock(query: StockQueryDto): Promise<{
        totalMaterials: number;
        stockRows: number;
        totalQuantity: number;
        byWarehouse: {
            warehouseId: any;
            warehouseName: any;
            quantity: number;
        }[];
        byMaterial: {
            productId: any;
            code: any;
            description: any;
            unitOfMeasure: any;
            quantity: number;
        }[];
        items: {
            id: any;
            currentQuantity: number;
            updatedAt: any;
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
        }[];
    }>;
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
    trace(query: TraceQueryDto): Promise<{
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
    upsertSapStock(dto: UpsertSapStockDto): Promise<import("./entities/sap-stock.entity").SapStockSnapshot>;
    differencesSap(query: DifferencesSapQueryDto): Promise<any>;
    kpis(query: KpisQueryDto): Promise<{
        range: "week" | "today" | "month";
        totalMaterials: number;
        totalQuantity: number;
        movementsCount: number;
        movementsInRange: number;
        stockByWarehouse: {
            warehouseId: any;
            warehouseName: any;
            quantity: number;
        }[];
    }>;
}
