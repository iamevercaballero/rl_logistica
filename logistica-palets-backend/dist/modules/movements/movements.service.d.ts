import { DataSource, EntityManager } from 'typeorm';
import { CreateMovementDto } from './dto/create-movement.dto';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UploadsService } from '../uploads/uploads.service';
import { RegularizeMovementDto } from './dto/regularize-movement.dto';
import { MovementsQueryDto } from './dto/movements-query.dto';
import { Movement, MovementType } from './entities/movement.entity';
import { MovementDetail } from './entities/movement-detail.entity';
import { LogisticsDocument } from './entities/logistics-document.entity';
import { DocumentSequenceService } from './document-sequence.service';
import { EventsGateway } from '../events/events.gateway';
import { CacheService } from '../cache/cache.service';
export declare class MovementsService {
    private readonly dataSource;
    private readonly events;
    private readonly cache;
    private readonly sequences;
    private readonly uploads;
    constructor(dataSource: DataSource, events: EventsGateway, cache: CacheService, sequences: DocumentSequenceService, uploads: UploadsService);
    requestVoid(id: string, userId: string): Promise<{
        warnings: string[];
        requestId: string;
        code: string;
    }>;
    create(dto: CreateMovementDto, userId: string): Promise<{
        movementId: string;
        stockImpact: string;
    }>;
    createInTransactionPublic(manager: EntityManager, dto: CreateMovementDto, userId: string, documentId?: string): Promise<{
        movementId: string;
        stockImpact: string;
        type: MovementType;
        warehouseId: string | null;
    }>;
    private createInTransaction;
    createDocument(dto: CreateDocumentDto, userId: string): Promise<{
        documentId: string;
        code: string;
        movementIds: string[];
        stockImpact: string;
    }>;
    findDocuments(query: {
        type?: string;
        from?: string;
        to?: string;
        search?: string;
    }): Promise<LogisticsDocument[]>;
    findDocument(id: string): Promise<{
        document: LogisticsDocument;
        movements: Movement[];
        details: MovementDetail[];
    }>;
    editMetadata(id: string, dto: RegularizeMovementDto, userId: string): Promise<{
        edited: boolean;
        changes: number;
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
            lotCode: {} | null;
            sapLot: {} | null;
            lotCount: number;
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
        lotCode: {} | null;
        sapLot: {} | null;
        lotCount: number;
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
    private autoFefoExit;
    private describeImpact;
}
