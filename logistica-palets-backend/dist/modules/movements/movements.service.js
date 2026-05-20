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
const movement_detail_entity_1 = require("./entities/movement-detail.entity");
const regularization_log_entity_1 = require("./entities/regularization-log.entity");
const product_entity_1 = require("../products/entities/product.entity");
const location_entity_1 = require("../locations/entities/location.entity");
const warehouse_entity_1 = require("../warehouses/entities/warehouse.entity");
const stock_entity_1 = require("../stocks/entities/stock.entity");
const lot_entity_1 = require("../lots/entities/lot.entity");
const pallet_entity_1 = require("../pallets/entities/pallet.entity");
let MovementsService = class MovementsService {
    constructor(dataSource) {
        this.dataSource = dataSource;
    }
    async create(dto, userId) {
        return this.dataSource.transaction(async (manager) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9;
            const product = await manager.findOne(product_entity_1.Product, { where: { id: dto.productId } });
            if (!product || !product.active) {
                throw new common_1.NotFoundException('Material inexistente o inactivo');
            }
            const isEntry = ['ENTRY', 'ADJUSTMENT_IN'].includes(dto.type);
            const isAdjustment = ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'].includes(dto.type);
            if (dto.isProvisional && !isEntry) {
                throw new common_1.BadRequestException('Solo las entradas pueden marcarse como provisorias');
            }
            if (dto.isProvisional && !((_a = dto.notes) === null || _a === void 0 ? void 0 : _a.trim())) {
                throw new common_1.BadRequestException('Las entradas provisorias requieren una observación obligatoria');
            }
            if (isAdjustment && !dto.adjustmentReason) {
                throw new common_1.BadRequestException('Los ajustes requieren un motivo obligatorio');
            }
            const totalQty = ((_b = dto.palletItems) === null || _b === void 0 ? void 0 : _b.length)
                ? dto.palletItems.reduce((s, i) => s + i.quantity, 0)
                : ((_c = dto.quantity) !== null && _c !== void 0 ? _c : 0);
            if (totalQty <= 0)
                throw new common_1.BadRequestException('La cantidad debe ser mayor a cero');
            this.validateBusinessRules({ ...dto, quantity: totalQty });
            const resolved = await this.resolveLocationsAndWarehouses(manager, dto);
            await this.ensureExplicitWarehouseConsistency(manager, dto, resolved);
            const isIncrease = ['ENTRY', 'ADJUSTMENT_IN'].includes(dto.type);
            if ((_d = dto.palletItems) === null || _d === void 0 ? void 0 : _d.length) {
                if (isEntry) {
                    await this.applyIncrease(manager, dto.productId, resolved.warehouseId, resolved.locationId, totalQty);
                }
            }
            else {
                switch (dto.type) {
                    case 'ENTRY':
                    case 'ADJUSTMENT_IN':
                        await this.applyIncrease(manager, dto.productId, resolved.warehouseId, resolved.locationId, totalQty);
                        break;
                    case 'EXIT':
                    case 'ADJUSTMENT_OUT':
                        await this.applyDecrease(manager, dto.productId, resolved.warehouseId, resolved.locationId, totalQty);
                        break;
                    case 'TRANSFER':
                        await this.applyDecrease(manager, dto.productId, resolved.fromWarehouseId, (_e = dto.fromLocationId) !== null && _e !== void 0 ? _e : null, totalQty);
                        await this.applyIncrease(manager, dto.productId, resolved.toWarehouseId, (_f = dto.toLocationId) !== null && _f !== void 0 ? _f : null, totalQty);
                        break;
                }
            }
            const movementData = {
                type: dto.type,
                date: dto.date ? new Date(dto.date) : new Date(),
                productId: dto.productId,
                quantity: totalQty,
                pallets: (_g = dto.pallets) !== null && _g !== void 0 ? _g : undefined,
                warehouseId: (_h = resolved.warehouseId) !== null && _h !== void 0 ? _h : undefined,
                locationId: (_j = resolved.locationId) !== null && _j !== void 0 ? _j : undefined,
                fromWarehouseId: (_k = resolved.fromWarehouseId) !== null && _k !== void 0 ? _k : undefined,
                fromLocationId: (_l = dto.fromLocationId) !== null && _l !== void 0 ? _l : undefined,
                toWarehouseId: (_m = resolved.toWarehouseId) !== null && _m !== void 0 ? _m : undefined,
                toLocationId: (_o = dto.toLocationId) !== null && _o !== void 0 ? _o : undefined,
                documentNumber: ((_p = dto.documentNumber) === null || _p === void 0 ? void 0 : _p.trim()) || undefined,
                supplier: ((_q = dto.supplier) === null || _q === void 0 ? void 0 : _q.trim()) || undefined,
                carrier: ((_r = dto.carrier) === null || _r === void 0 ? void 0 : _r.trim()) || undefined,
                driver: ((_s = dto.driver) === null || _s === void 0 ? void 0 : _s.trim()) || undefined,
                destination: ((_t = dto.destination) === null || _t === void 0 ? void 0 : _t.trim()) || undefined,
                notes: ((_u = dto.notes) === null || _u === void 0 ? void 0 : _u.trim()) || undefined,
                palletId: (_v = dto.palletId) !== null && _v !== void 0 ? _v : undefined,
                lotId: (_w = dto.lotId) !== null && _w !== void 0 ? _w : undefined,
                createdById: userId,
                encargadoRecepcionId: (_x = dto.encargadoRecepcionId) !== null && _x !== void 0 ? _x : undefined,
                status: dto.isProvisional ? 'PENDING_REGULARIZATION' : 'NORMAL',
                adjustmentReason: (_y = dto.adjustmentReason) !== null && _y !== void 0 ? _y : undefined,
                adjustmentCategory: (_z = dto.adjustmentCategory) !== null && _z !== void 0 ? _z : undefined,
            };
            const movement = manager.create(movement_entity_1.Movement, movementData);
            await manager.save(movement);
            if ((_0 = dto.palletItems) === null || _0 === void 0 ? void 0 : _0.length) {
                for (const item of dto.palletItems) {
                    let resolvedLotId;
                    let resolvedPalletId = item.palletId;
                    if (item.palletId) {
                        const pallet = await manager.getRepository(pallet_entity_1.Pallet).findOne({ where: { id: item.palletId } });
                        if (!pallet)
                            throw new common_1.NotFoundException(`Palet no encontrado: ${item.palletId}`);
                        if (pallet.status === 'EXITED')
                            throw new common_1.BadRequestException(`El palet ${pallet.code} ya fue despachado`);
                        resolvedLotId = pallet.lotId;
                        if (dto.type === 'EXIT' || dto.type === 'ADJUSTMENT_OUT') {
                            const palletLot = await manager.getRepository(lot_entity_1.Lot).findOne({ where: { id: pallet.lotId } });
                            if ((palletLot === null || palletLot === void 0 ? void 0 : palletLot.status) === 'PENDING_REGULARIZATION') {
                                throw new common_1.BadRequestException(`El lote "${palletLot.lotCode}" está pendiente de regularización. Regularizá el lote antes de despachar.`);
                            }
                            const stockLocationId = (_1 = pallet.currentLocationId) !== null && _1 !== void 0 ? _1 : null;
                            let stockWarehouseId = null;
                            if (stockLocationId) {
                                const loc = await manager.findOne(location_entity_1.Location, { where: { id: stockLocationId } });
                                stockWarehouseId = (_3 = (_2 = loc === null || loc === void 0 ? void 0 : loc.warehouse) === null || _2 === void 0 ? void 0 : _2.id) !== null && _3 !== void 0 ? _3 : null;
                            }
                            await this.applyDecrease(manager, dto.productId, stockWarehouseId, stockLocationId, item.quantity);
                            pallet.status = 'EXITED';
                            pallet.exitedAt = new Date();
                        }
                        else if (dto.type === 'TRANSFER') {
                            const fromLocationId = (_4 = pallet.currentLocationId) !== null && _4 !== void 0 ? _4 : null;
                            let fromWarehouseId = null;
                            if (fromLocationId) {
                                const loc = await manager.findOne(location_entity_1.Location, { where: { id: fromLocationId } });
                                fromWarehouseId = (_6 = (_5 = loc === null || loc === void 0 ? void 0 : loc.warehouse) === null || _5 === void 0 ? void 0 : _5.id) !== null && _6 !== void 0 ? _6 : null;
                            }
                            await this.applyDecrease(manager, dto.productId, fromWarehouseId, fromLocationId, item.quantity);
                            await this.applyIncrease(manager, dto.productId, resolved.toWarehouseId, (_7 = dto.toLocationId) !== null && _7 !== void 0 ? _7 : null, item.quantity);
                            pallet.currentLocationId = (_8 = dto.toLocationId) !== null && _8 !== void 0 ? _8 : null;
                        }
                        await manager.save(pallet);
                    }
                    else if (item.lotCode) {
                        const lot = await this.findOrCreateLot(manager, dto.productId, item.lotCode, item.fechaVencimiento, undefined, item.fechaFabricacion, item.sapLot, dto.isProvisional ? 'PENDING_REGULARIZATION' : 'NORMAL');
                        resolvedLotId = lot.id;
                        const existingCount = await manager.getRepository(pallet_entity_1.Pallet).count({ where: { lotId: lot.id } });
                        const pallet = manager.getRepository(pallet_entity_1.Pallet).create({
                            code: `${lot.lotCode}-P${existingCount + 1}`,
                            lotId: lot.id,
                            quantity: item.quantity,
                            currentLocationId: (_9 = resolved.locationId) !== null && _9 !== void 0 ? _9 : null,
                            status: 'AVAILABLE',
                        });
                        const savedPallet = await manager.save(pallet);
                        resolvedPalletId = savedPallet.id;
                    }
                    if (resolvedLotId) {
                        const detail = manager.create(movement_detail_entity_1.MovementDetail, {
                            movementId: movement.id,
                            lotId: resolvedLotId,
                            palletId: resolvedPalletId !== null && resolvedPalletId !== void 0 ? resolvedPalletId : undefined,
                            quantity: item.quantity,
                        });
                        await manager.save(detail);
                        await this.updateLotStock(manager, resolvedLotId, isIncrease ? item.quantity : -item.quantity);
                    }
                }
            }
            else if (dto.lotId) {
                await this.updateLotStock(manager, dto.lotId, isIncrease ? totalQty : -totalQty);
            }
            return { movementId: movement.id, stockImpact: this.describeImpact(dto.type) };
        });
    }
    async regularize(id, dto, userId) {
        return this.dataSource.transaction(async (manager) => {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const movement = await manager.findOne(movement_entity_1.Movement, { where: { id } });
            if (!movement)
                throw new common_1.NotFoundException('Movimiento no encontrado');
            if (movement.status !== 'PENDING_REGULARIZATION') {
                throw new common_1.BadRequestException('El movimiento no está pendiente de regularización');
            }
            const logs = [];
            const movementStringFields = [
                'documentNumber', 'supplier', 'carrier', 'driver', 'destination', 'notes',
            ];
            for (const field of movementStringFields) {
                const newVal = (_b = (_a = dto[field]) === null || _a === void 0 ? void 0 : _a.trim()) !== null && _b !== void 0 ? _b : null;
                if (newVal === null)
                    continue;
                const oldVal = (_c = movement[field]) !== null && _c !== void 0 ? _c : null;
                if (newVal !== oldVal) {
                    logs.push({ movementId: id, field, oldValue: oldVal, newValue: newVal, changedById: userId, reason: dto.reason });
                    movement[field] = newVal || null;
                }
            }
            const details = await manager.getRepository(movement_detail_entity_1.MovementDetail).find({ where: { movementId: id } });
            const lotIds = [...new Set(details.map((d) => d.lotId).filter(Boolean))];
            if (lotIds.length > 0) {
                const lots = await manager.getRepository(lot_entity_1.Lot).find({ where: lotIds.map((lotId) => ({ id: lotId })) });
                const lotDateFields = ['fechaVencimiento', 'fechaFabricacion'];
                const lotStringFields = ['sapLot', 'proveedor'];
                for (const lot of lots) {
                    let lotChanged = false;
                    for (const field of lotStringFields) {
                        const newVal = (_e = (_d = dto[field]) === null || _d === void 0 ? void 0 : _d.trim()) !== null && _e !== void 0 ? _e : null;
                        if (newVal === null)
                            continue;
                        const oldVal = (_f = lot[field]) !== null && _f !== void 0 ? _f : null;
                        if (newVal !== oldVal) {
                            logs.push({ movementId: id, field: `lot.${lot.lotCode}.${field}`, oldValue: oldVal, newValue: newVal, changedById: userId, reason: dto.reason });
                            lot[field] = newVal;
                            lotChanged = true;
                        }
                    }
                    for (const field of lotDateFields) {
                        const newVal = (_g = dto[field]) !== null && _g !== void 0 ? _g : null;
                        if (newVal === null)
                            continue;
                        const oldVal = (_h = lot[field]) !== null && _h !== void 0 ? _h : null;
                        if (newVal !== oldVal) {
                            logs.push({ movementId: id, field: `lot.${lot.lotCode}.${field}`, oldValue: oldVal, newValue: newVal, changedById: userId, reason: dto.reason });
                            lot[field] = newVal;
                            lotChanged = true;
                        }
                    }
                    if (lotChanged) {
                        lot.status = 'NORMAL';
                        await manager.save(lot_entity_1.Lot, lot);
                    }
                }
            }
            movement.status = 'NORMAL';
            await manager.save(movement);
            for (const log of logs) {
                await manager.save(manager.create(regularization_log_entity_1.RegularizationLog, log));
            }
            return { regularized: true, changes: logs.length };
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
            .leftJoin('users', 'encargado', 'encargado.id = movement."encargadoRecepcionId"')
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
            'movement.status AS status',
            'movement."adjustmentReason" AS "adjustmentReason"',
            'movement."adjustmentCategory" AS "adjustmentCategory"',
            'movement.createdById AS "createdById"',
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
            'encargado.id AS "encargadoId"',
            'encargado.username AS "encargadoUsername"',
            'encargado."fullName" AS "encargadoFullName"',
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
        if (query.status)
            qb.andWhere('movement.status = :status', { status: query.status });
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
            qb.clone().select('COUNT(movement.id)', 'total').orderBy().getRawOne(),
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
            .leftJoin('users', 'encargado', 'encargado.id = movement."encargadoRecepcionId"')
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
            'movement.status AS status',
            'movement."adjustmentReason" AS "adjustmentReason"',
            'movement."adjustmentCategory" AS "adjustmentCategory"',
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
            'encargado.id AS "encargadoId"',
            'encargado.username AS "encargadoUsername"',
            'encargado."fullName" AS "encargadoFullName"',
        ])
            .where('movement.id = :id', { id });
        const movement = await qb.getRawOne();
        if (!movement)
            throw new common_1.NotFoundException('Movimiento no encontrado');
        return this.mapMovementRow(movement);
    }
    validateBusinessRules(dto) {
        if (dto.quantity <= 0) {
            throw new common_1.BadRequestException('La cantidad debe ser mayor a cero');
        }
        if (dto.type === 'TRANSFER' && (!dto.fromLocationId || !dto.toLocationId)) {
            throw new common_1.BadRequestException('TRANSFER requiere ubicación origen y destino');
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
        if (!dto.warehouseId)
            return;
        const warehouse = await manager.findOne(warehouse_entity_1.Warehouse, { where: { id: dto.warehouseId } });
        if (!warehouse)
            throw new common_1.NotFoundException('Depósito inexistente');
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
            where: { productId, warehouseId: warehouseId !== null && warehouseId !== void 0 ? warehouseId : (0, typeorm_1.IsNull)(), locationId: locationId !== null && locationId !== void 0 ? locationId : (0, typeorm_1.IsNull)() },
        });
        if (stock)
            return stock;
        return repository.create({ productId, warehouseId, locationId, currentQuantity: 0, updatedAt: new Date() });
    }
    async findOrCreateLot(manager, productId, lotCode, fechaVencimiento, proveedor, fechaFabricacion, sapLot, status = 'NORMAL') {
        const repo = manager.getRepository(lot_entity_1.Lot);
        let lot = await repo.findOne({ where: { productId, lotCode } });
        if (!lot) {
            lot = repo.create({
                productId, lotCode,
                fechaVencimiento: fechaVencimiento !== null && fechaVencimiento !== void 0 ? fechaVencimiento : null,
                fechaFabricacion: fechaFabricacion !== null && fechaFabricacion !== void 0 ? fechaFabricacion : null,
                proveedor: proveedor !== null && proveedor !== void 0 ? proveedor : null,
                sapLot: sapLot !== null && sapLot !== void 0 ? sapLot : null,
                stockActual: 0,
                status,
            });
            lot = await repo.save(lot);
        }
        else {
            let changed = false;
            if (fechaVencimiento && !lot.fechaVencimiento) {
                lot.fechaVencimiento = fechaVencimiento;
                changed = true;
            }
            if (proveedor && !lot.proveedor) {
                lot.proveedor = proveedor;
                changed = true;
            }
            if (fechaFabricacion && !lot.fechaFabricacion) {
                lot.fechaFabricacion = fechaFabricacion;
                changed = true;
            }
            if (sapLot && !lot.sapLot) {
                lot.sapLot = sapLot;
                changed = true;
            }
            if (changed)
                lot = await repo.save(lot);
        }
        return lot;
    }
    async updateLotStock(manager, lotId, delta) {
        const repo = manager.getRepository(lot_entity_1.Lot);
        const lot = await repo.findOne({ where: { id: lotId } });
        if (lot) {
            lot.stockActual = Math.max(0, lot.stockActual + delta);
            await repo.save(lot);
        }
    }
    parseNumber(value) { return Number(value) || 0; }
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
        var _a, _b, _c, _d;
        return {
            id: row.id, type: row.type, date: row.date,
            status: (_a = row.status) !== null && _a !== void 0 ? _a : 'NORMAL',
            adjustmentReason: (_b = row.adjustmentReason) !== null && _b !== void 0 ? _b : null,
            adjustmentCategory: (_c = row.adjustmentCategory) !== null && _c !== void 0 ? _c : null,
            quantity: this.parseNumber(row.quantity),
            pallets: row.pallets === null || row.pallets === undefined ? null : this.parseNumber(row.pallets),
            documentNumber: row.documentNumber, supplier: row.supplier, carrier: row.carrier,
            driver: row.driver, destination: row.destination, notes: row.notes,
            createdById: row.createdById, createdAt: (_d = row.createdAt) !== null && _d !== void 0 ? _d : row.date,
            palletId: row.palletId, lotId: row.lotId,
            encargado: row.encargadoId ? { id: row.encargadoId, username: row.encargadoUsername, fullName: row.encargadoFullName } : null,
            material: {
                id: row.productId, code: row.productCode,
                description: row.productDescription, unitOfMeasure: row.unitOfMeasure,
            },
            warehouse: row.warehouseId ? { id: row.warehouseId, name: row.warehouseName } : null,
            location: row.locationId ? { id: row.locationId, code: row.locationCode } : null,
            from: row.fromLocationId || row.fromWarehouseId
                ? { warehouseId: row.fromWarehouseId, warehouseName: row.fromWarehouseName, locationId: row.fromLocationId, locationCode: row.fromLocationCode }
                : null,
            to: row.toLocationId || row.toWarehouseId
                ? { warehouseId: row.toWarehouseId, warehouseName: row.toWarehouseName, locationId: row.toLocationId, locationCode: row.toLocationCode }
                : null,
        };
    }
    describeImpact(type) {
        if (type === 'TRANSFER')
            return 'Actualiza ubicación del palet';
        if (type === 'EXIT' || type === 'ADJUSTMENT_OUT')
            return 'Resta stock';
        return 'Suma stock';
    }
};
exports.MovementsService = MovementsService;
exports.MovementsService = MovementsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeorm_1.DataSource])
], MovementsService);
//# sourceMappingURL=movements.service.js.map