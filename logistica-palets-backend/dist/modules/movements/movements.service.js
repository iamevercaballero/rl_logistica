"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MovementsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
const movement_entity_1 = require("./entities/movement.entity");
const product_entity_1 = require("../products/entities/product.entity");
const location_entity_1 = require("../locations/entities/location.entity");
const warehouse_entity_1 = require("../warehouses/entities/warehouse.entity");
const stock_entity_1 = require("../stocks/entities/stock.entity");
let MovementsService = class MovementsService {
    constructor(dataSource) {
        this.dataSource = dataSource;
    }
    async create(dto, userId) {
        return this.dataSource.transaction(async (manager) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
            const product = await manager.findOne(product_entity_1.Product, { where: { id: dto.productId } });
            if (!product || !product.active) {
                throw new common_1.NotFoundException('Material inexistente o inactivo');
            }
            this.validateBusinessRules(dto);
            const resolved = await this.resolveLocationsAndWarehouses(manager, dto);
            await this.ensureExplicitWarehouseConsistency(manager, dto, resolved);
            switch (dto.type) {
                case 'ENTRY':
                case 'ADJUSTMENT_IN':
                case 'REPROCESS':
                    await this.applyIncrease(manager, dto.productId, resolved.warehouseId, resolved.locationId, dto.quantity);
                    break;
                case 'EXIT':
                case 'ADJUSTMENT_OUT':
                    await this.applyDecrease(manager, dto.productId, resolved.warehouseId, resolved.locationId, dto.quantity);
                    break;
                case 'TRANSFER':
                    await this.applyDecrease(manager, dto.productId, resolved.fromWarehouseId, (_a = dto.fromLocationId) !== null && _a !== void 0 ? _a : null, dto.quantity);
                    await this.applyIncrease(manager, dto.productId, resolved.toWarehouseId, (_b = dto.toLocationId) !== null && _b !== void 0 ? _b : null, dto.quantity);
                    break;
            }
            const movementData = {
                type: dto.type,
                date: dto.date ? new Date(dto.date) : new Date(),
                productId: dto.productId,
                quantity: dto.quantity,
                pallets: (_c = dto.pallets) !== null && _c !== void 0 ? _c : undefined,
                warehouseId: (_d = resolved.warehouseId) !== null && _d !== void 0 ? _d : undefined,
                locationId: (_e = resolved.locationId) !== null && _e !== void 0 ? _e : undefined,
                fromWarehouseId: (_f = resolved.fromWarehouseId) !== null && _f !== void 0 ? _f : undefined,
                fromLocationId: (_g = dto.fromLocationId) !== null && _g !== void 0 ? _g : undefined,
                toWarehouseId: (_h = resolved.toWarehouseId) !== null && _h !== void 0 ? _h : undefined,
                toLocationId: (_j = dto.toLocationId) !== null && _j !== void 0 ? _j : undefined,
                documentNumber: ((_k = dto.documentNumber) === null || _k === void 0 ? void 0 : _k.trim()) || undefined,
                supplier: ((_l = dto.supplier) === null || _l === void 0 ? void 0 : _l.trim()) || undefined,
                carrier: ((_m = dto.carrier) === null || _m === void 0 ? void 0 : _m.trim()) || undefined,
                driver: ((_o = dto.driver) === null || _o === void 0 ? void 0 : _o.trim()) || undefined,
                destination: ((_p = dto.destination) === null || _p === void 0 ? void 0 : _p.trim()) || undefined,
                notes: ((_q = dto.notes) === null || _q === void 0 ? void 0 : _q.trim()) || undefined,
                palletId: (_r = dto.palletId) !== null && _r !== void 0 ? _r : undefined,
                lotId: (_s = dto.lotId) !== null && _s !== void 0 ? _s : undefined,
                createdById: userId,
            };
            const movement = manager.create(movement_entity_1.Movement, movementData);
            await manager.save(movement);
            return {
                movementId: movement.id,
                stockImpact: this.describeImpact(dto.type),
            };
        });
    }
    async findAll(query) {
        var _a, _b, _c;
        const page = (_a = query.page) !== null && _a !== void 0 ? _a : 1;
        const limit = Math.min((_b = query.limit) !== null && _b !== void 0 ? _b : 20, 100);
        const qb = this.dataSource
            .getRepository(movement_entity_1.Movement)
            .createQueryBuilder('movement')
            .leftJoin('products', 'product', 'product.id = movement."productId"')
            .leftJoin('warehouses', 'warehouse', 'warehouse.id = movement."warehouseId"')
            .leftJoin('locations', 'location', 'location.id = movement."locationId"')
            .leftJoin('warehouses', 'fromWarehouse', 'fromWarehouse.id = movement."fromWarehouseId"')
            .leftJoin('locations', 'fromLocation', 'fromLocation.id = movement."fromLocationId"')
            .leftJoin('warehouses', 'toWarehouse', 'toWarehouse.id = movement."toWarehouseId"')
            .leftJoin('locations', 'toLocation', 'toLocation.id = movement."toLocationId"')
            .select([
            'movement.id AS id',
            'movement.type AS type',
            'movement.date AS date',
            'movement.quantity AS quantity',
            'movement.pallets AS pallets',
            'movement.documentNumber AS "documentNumber"',
            'movement.supplier AS supplier',
            'movement.carrier AS carrier',
            'movement.driver AS driver',
            'movement.destination AS destination',
            'movement.notes AS notes',
            'movement.createdById AS "createdById"',
            'product.id AS "productId"',
            'product.code AS "productCode"',
            'product.description AS "productDescription"',
            'product."unitOfMeasure" AS "unitOfMeasure"',
            'warehouse.id AS "warehouseId"',
            'warehouse.name AS "warehouseName"',
            'location.id AS "locationId"',
            'location.code AS "locationCode"',
            'fromWarehouse.id AS "fromWarehouseId"',
            'fromWarehouse.name AS "fromWarehouseName"',
            'fromLocation.id AS "fromLocationId"',
            'fromLocation.code AS "fromLocationCode"',
            'toWarehouse.id AS "toWarehouseId"',
            'toWarehouse.name AS "toWarehouseName"',
            'toLocation.id AS "toLocationId"',
            'toLocation.code AS "toLocationCode"',
        ])
            .orderBy('movement.date', 'DESC');
        if (query.warehouseId) {
            qb.andWhere('(movement."warehouseId" = :warehouseId OR movement."fromWarehouseId" = :warehouseId OR movement."toWarehouseId" = :warehouseId)', { warehouseId: query.warehouseId });
        }
        if (query.locationId) {
            qb.andWhere('(movement."locationId" = :locationId OR movement."fromLocationId" = :locationId OR movement."toLocationId" = :locationId)', { locationId: query.locationId });
        }
        if (query.productId)
            qb.andWhere('movement."productId" = :productId', { productId: query.productId });
        if (query.type)
            qb.andWhere('movement.type = :type', { type: query.type });
        if (query.dateFrom)
            qb.andWhere('movement.date >= :dateFrom', { dateFrom: this.toStartDate(query.dateFrom) });
        if (query.dateTo)
            qb.andWhere('movement.date <= :dateTo', { dateTo: this.toEndDate(query.dateTo) });
        if ((_c = query.search) === null || _c === void 0 ? void 0 : _c.trim()) {
            const search = `%${query.search.trim().toLowerCase()}%`;
            qb.andWhere(`(
          LOWER(COALESCE(movement."documentNumber", '')) LIKE :search
          OR LOWER(COALESCE(movement.supplier, '')) LIKE :search
          OR LOWER(COALESCE(movement.destination, '')) LIKE :search
          OR LOWER(COALESCE(movement.notes, '')) LIKE :search
          OR LOWER(COALESCE(product.code, '')) LIKE :search
          OR LOWER(COALESCE(product.description, '')) LIKE :search
        )`, { search });
        }
        const [data, totalRow] = await Promise.all([
            qb.clone().offset((page - 1) * limit).limit(limit).getRawMany(),
            qb.clone().select('COUNT(movement.id)', 'total').getRawOne(),
        ]);
        return {
            data: data.map((row) => this.mapMovementRow(row)),
            meta: {
                page,
                limit,
                total: this.parseNumber(totalRow === null || totalRow === void 0 ? void 0 : totalRow.total),
                totalPages: Math.max(1, Math.ceil(this.parseNumber(totalRow === null || totalRow === void 0 ? void 0 : totalRow.total) / limit)),
            },
        };
    }
    async findOne(id) {
        const qb = this.dataSource
            .getRepository(movement_entity_1.Movement)
            .createQueryBuilder('movement')
            .leftJoin('products', 'product', 'product.id = movement."productId"')
            .leftJoin('warehouses', 'warehouse', 'warehouse.id = movement."warehouseId"')
            .leftJoin('locations', 'location', 'location.id = movement."locationId"')
            .leftJoin('warehouses', 'fromWarehouse', 'fromWarehouse.id = movement."fromWarehouseId"')
            .leftJoin('locations', 'fromLocation', 'fromLocation.id = movement."fromLocationId"')
            .leftJoin('warehouses', 'toWarehouse', 'toWarehouse.id = movement."toWarehouseId"')
            .leftJoin('locations', 'toLocation', 'toLocation.id = movement."toLocationId"')
            .select([
            'movement.id AS id',
            'movement.type AS type',
            'movement.date AS date',
            'movement.quantity AS quantity',
            'movement.pallets AS pallets',
            'movement.documentNumber AS "documentNumber"',
            'movement.supplier AS supplier',
            'movement.carrier AS carrier',
            'movement.driver AS driver',
            'movement.destination AS destination',
            'movement.notes AS notes',
            'movement.createdById AS "createdById"',
            'movement.createdAt AS "createdAt"',
            'movement.palletId AS "palletId"',
            'movement.lotId AS "lotId"',
            'product.id AS "productId"',
            'product.code AS "productCode"',
            'product.description AS "productDescription"',
            'product."unitOfMeasure" AS "unitOfMeasure"',
            'warehouse.id AS "warehouseId"',
            'warehouse.name AS "warehouseName"',
            'location.id AS "locationId"',
            'location.code AS "locationCode"',
            'fromWarehouse.id AS "fromWarehouseId"',
            'fromWarehouse.name AS "fromWarehouseName"',
            'fromLocation.id AS "fromLocationId"',
            'fromLocation.code AS "fromLocationCode"',
            'toWarehouse.id AS "toWarehouseId"',
            'toWarehouse.name AS "toWarehouseName"',
            'toLocation.id AS "toLocationId"',
            'toLocation.code AS "toLocationCode"',
        ])
            .where('movement.id = :id', { id });
        const movement = await qb.getRawOne();
        if (!movement)
            throw new common_1.NotFoundException('Movimiento no encontrado');
        return this.mapMovementRow(movement);
    }
    validateBusinessRules(dto) {
        var _a;
        if (dto.quantity <= 0) {
            throw new common_1.BadRequestException('La cantidad debe ser mayor a cero');
        }
        if (dto.type === 'TRANSFER' && (!dto.fromLocationId || !dto.toLocationId)) {
            throw new common_1.BadRequestException('TRANSFER requiere ubicación origen y destino');
        }
        if ((dto.type === 'ADJUSTMENT_IN' || dto.type === 'ADJUSTMENT_OUT') && !((_a = dto.notes) === null || _a === void 0 ? void 0 : _a.trim())) {
            throw new common_1.BadRequestException('Los ajustes requieren observación en notes');
        }
        if (dto.type === 'TRANSFER' && dto.fromLocationId === dto.toLocationId) {
            throw new common_1.BadRequestException('Origen y destino no pueden ser la misma ubicación');
        }
    }
    async resolveLocationsAndWarehouses(manager, dto) {
        var _a, _b, _c, _d, _e;
        const location = dto.locationId ? await this.findLocation(manager, dto.locationId) : null;
        const fromLocation = dto.fromLocationId ? await this.findLocation(manager, dto.fromLocationId) : null;
        const toLocation = dto.toLocationId ? await this.findLocation(manager, dto.toLocationId) : null;
        return {
            warehouseId: (_b = (_a = location === null || location === void 0 ? void 0 : location.warehouse.id) !== null && _a !== void 0 ? _a : dto.warehouseId) !== null && _b !== void 0 ? _b : null,
            locationId: (_c = location === null || location === void 0 ? void 0 : location.id) !== null && _c !== void 0 ? _c : null,
            fromWarehouseId: (_d = fromLocation === null || fromLocation === void 0 ? void 0 : fromLocation.warehouse.id) !== null && _d !== void 0 ? _d : null,
            toWarehouseId: (_e = toLocation === null || toLocation === void 0 ? void 0 : toLocation.warehouse.id) !== null && _e !== void 0 ? _e : null,
        };
    }
    async ensureExplicitWarehouseConsistency(manager, dto, resolved) {
        if (!dto.warehouseId) {
            return;
        }
        const warehouse = await manager.findOne(warehouse_entity_1.Warehouse, { where: { id: dto.warehouseId } });
        if (!warehouse) {
            throw new common_1.NotFoundException('Depósito inexistente');
        }
        if (resolved.locationId && resolved.warehouseId && dto.warehouseId !== resolved.warehouseId) {
            throw new common_1.BadRequestException('La ubicación no pertenece al depósito indicado');
        }
    }
    async findLocation(manager, id) {
        const location = await manager.findOne(location_entity_1.Location, { where: { id } });
        if (!location || !location.active) {
            throw new common_1.NotFoundException(`Ubicación inexistente o inactiva: ${id}`);
        }
        return location;
    }
    async applyIncrease(manager, productId, warehouseId, locationId, quantity) {
        const stock = await this.findOrCreateStock(manager, productId, warehouseId, locationId);
        stock.currentQuantity += quantity;
        stock.updatedAt = new Date();
        await manager.save(stock);
    }
    async applyDecrease(manager, productId, warehouseId, locationId, quantity) {
        const stock = await this.findOrCreateStock(manager, productId, warehouseId, locationId);
        if (stock.currentQuantity < quantity) {
            throw new common_1.BadRequestException('Stock insuficiente para completar la operación');
        }
        stock.currentQuantity -= quantity;
        stock.updatedAt = new Date();
        await manager.save(stock);
    }
    async findOrCreateStock(manager, productId, warehouseId, locationId) {
        const repository = manager.getRepository(stock_entity_1.Stock);
        const stock = await repository.findOne({
            where: {
                productId,
                warehouseId: warehouseId !== null && warehouseId !== void 0 ? warehouseId : (0, typeorm_1.IsNull)(),
                locationId: locationId !== null && locationId !== void 0 ? locationId : (0, typeorm_1.IsNull)(),
            },
        });
        if (stock) {
            return stock;
        }
        return repository.create({ productId, warehouseId, locationId, currentQuantity: 0, updatedAt: new Date() });
    }
    parseNumber(value) {
        return Number(value) || 0;
    }
    toStartDate(value) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(value))
            return new Date(`${value}T00:00:00.000Z`);
        return new Date(value);
    }
    toEndDate(value) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(value))
            return new Date(`${value}T23:59:59.999Z`);
        return new Date(value);
    }
    mapMovementRow(row) {
        var _a;
        return {
            id: row.id,
            type: row.type,
            date: row.date,
            quantity: this.parseNumber(row.quantity),
            pallets: row.pallets === null || row.pallets === undefined ? null : this.parseNumber(row.pallets),
            documentNumber: row.documentNumber,
            supplier: row.supplier,
            carrier: row.carrier,
            driver: row.driver,
            destination: row.destination,
            notes: row.notes,
            createdById: row.createdById,
            createdAt: (_a = row.createdAt) !== null && _a !== void 0 ? _a : row.date,
            palletId: row.palletId,
            lotId: row.lotId,
            material: {
                id: row.productId,
                code: row.productCode,
                description: row.productDescription,
                unitOfMeasure: row.unitOfMeasure,
            },
            warehouse: row.warehouseId ? { id: row.warehouseId, name: row.warehouseName } : null,
            location: row.locationId ? { id: row.locationId, code: row.locationCode } : null,
            from: row.fromLocationId || row.fromWarehouseId
                ? {
                    warehouseId: row.fromWarehouseId,
                    warehouseName: row.fromWarehouseName,
                    locationId: row.fromLocationId,
                    locationCode: row.fromLocationCode,
                }
                : null,
            to: row.toLocationId || row.toWarehouseId
                ? {
                    warehouseId: row.toWarehouseId,
                    warehouseName: row.toWarehouseName,
                    locationId: row.toLocationId,
                    locationCode: row.toLocationCode,
                }
                : null,
        };
    }
    describeImpact(type) {
        if (type === 'TRANSFER') {
            return 'Actualiza ubicación sin cambiar el stock total';
        }
        if (type === 'EXIT' || type === 'ADJUSTMENT_OUT') {
            return 'Resta stock';
        }
        return 'Suma stock';
    }
};
exports.MovementsService = MovementsService;
exports.MovementsService = MovementsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeorm_1.DataSource])
], MovementsService);
//# sourceMappingURL=movements.service.js.map