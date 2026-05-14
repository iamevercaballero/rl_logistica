import { DataSource } from 'typeorm';
import { CreateMovementDto } from './dto/create-movement.dto';
import { RegularizeMovementDto } from './dto/regularize-movement.dto';
import { MovementsQueryDto } from './dto/movements-query.dto';
export declare class MovementsService {
    private readonly dataSource;
    constructor(dataSource: DataSource);
    create(dto: CreateMovementDto, userId: string): Promise<{
        movementId: string;
        stockImpact: string;
    }>;
    regularize(id: string, dto: RegularizeMovementDto, userId: string): Promise<{
        regularized: boolean;
        changes: number;
    }>;
    findAll(query: MovementsQueryDto): Promise<{
        data: {
            id: unknown;
            type: unknown;
            date: unknown;
            status: {};
            adjustmentReason: {} | null;
            adjustmentCategory: {} | null;
            quantity: number;
            pallets: number | null;
            documentNumber: unknown;
            supplier: unknown;
            carrier: unknown;
            driver: unknown;
            destination: unknown;
            notes: unknown;
            createdById: unknown;
            createdAt: unknown;
            palletId: unknown;
            lotId: unknown;
            encargado: {
                id: {};
                username: unknown;
                fullName: unknown;
            } | null;
            material: {
                id: unknown;
                code: unknown;
                description: unknown;
                unitOfMeasure: unknown;
            };
            warehouse: {
                id: {};
                name: unknown;
            } | null;
            location: {
                id: {};
                code: unknown;
            } | null;
            from: {
                warehouseId: unknown;
                warehouseName: unknown;
                locationId: unknown;
                locationCode: unknown;
            } | null;
            to: {
                warehouseId: unknown;
                warehouseName: unknown;
                locationId: unknown;
                locationCode: unknown;
            } | null;
        }[];
        meta: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
        };
    }>;
    findOne(id: string): Promise<{
        id: unknown;
        type: unknown;
        date: unknown;
        status: {};
        adjustmentReason: {} | null;
        adjustmentCategory: {} | null;
        quantity: number;
        pallets: number | null;
        documentNumber: unknown;
        supplier: unknown;
        carrier: unknown;
        driver: unknown;
        destination: unknown;
        notes: unknown;
        createdById: unknown;
        createdAt: unknown;
        palletId: unknown;
        lotId: unknown;
        encargado: {
            id: {};
            username: unknown;
            fullName: unknown;
        } | null;
        material: {
            id: unknown;
            code: unknown;
            description: unknown;
            unitOfMeasure: unknown;
        };
        warehouse: {
            id: {};
            name: unknown;
        } | null;
        location: {
            id: {};
            code: unknown;
        } | null;
        from: {
            warehouseId: unknown;
            warehouseName: unknown;
            locationId: unknown;
            locationCode: unknown;
        } | null;
        to: {
            warehouseId: unknown;
            warehouseName: unknown;
            locationId: unknown;
            locationCode: unknown;
        } | null;
    }>;
    private validateBusinessRules;
    private resolveLocationsAndWarehouses;
    private ensureExplicitWarehouseConsistency;
    private findLocation;
    private applyIncrease;
    private applyDecrease;
    private findOrCreateStock;
    private findOrCreateLot;
    private updateLotStock;
    private parseNumber;
    private toStartDate;
    private toEndDate;
    private mapMovementRow;
    private describeImpact;
}
