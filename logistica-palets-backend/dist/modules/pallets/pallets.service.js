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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PalletsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const pallet_entity_1 = require("./entities/pallet.entity");
const lot_entity_1 = require("../lots/entities/lot.entity");
const location_entity_1 = require("../locations/entities/location.entity");
const stock_entity_1 = require("../stocks/entities/stock.entity");
const movement_entity_1 = require("../movements/entities/movement.entity");
const movement_detail_entity_1 = require("../movements/entities/movement-detail.entity");
let PalletsService = class PalletsService {
    constructor(dataSource, palletRepo, lotRepo, locationRepo) {
        this.dataSource = dataSource;
        this.palletRepo = palletRepo;
        this.lotRepo = lotRepo;
        this.locationRepo = locationRepo;
    }
    async create(dto) {
        var _a, _b;
        const exists = await this.palletRepo.findOne({ where: { code: dto.code } });
        if (exists)
            throw new common_1.BadRequestException('Ya existe un pallet con ese código');
        const lot = await this.lotRepo.findOne({ where: { id: dto.lotId } });
        if (!lot)
            throw new common_1.NotFoundException('Lote no encontrado');
        if (dto.currentLocationId) {
            const loc = await this.locationRepo.findOne({ where: { id: dto.currentLocationId } });
            if (!loc)
                throw new common_1.NotFoundException('Ubicación no encontrada');
        }
        const pallet = this.palletRepo.create({
            code: dto.code,
            lotId: dto.lotId,
            quantity: dto.quantity,
            currentLocationId: (_a = dto.currentLocationId) !== null && _a !== void 0 ? _a : null,
            status: (_b = dto.status) !== null && _b !== void 0 ? _b : 'AVAILABLE',
        });
        return this.palletRepo.save(pallet);
    }
    async findAll(filters = {}) {
        const { lotId, status, productId, locationId, search } = filters;
        const conditions = [];
        const params = [];
        if (lotId) {
            params.push(lotId);
            conditions.push(`p."lotId"::text = $${params.length}`);
        }
        if (status) {
            params.push(status);
            conditions.push(`p.status = $${params.length}`);
        }
        if (productId) {
            params.push(productId);
            conditions.push(`l."productId"::text = $${params.length}`);
        }
        if (locationId) {
            params.push(locationId);
            conditions.push(`p."currentLocationId"::text = $${params.length}`);
        }
        if (search === null || search === void 0 ? void 0 : search.trim()) {
            params.push(`%${search.trim()}%`);
            const i = params.length;
            conditions.push(`(p.code ILIKE $${i} OR pr.code ILIKE $${i} OR pr.description ILIKE $${i} OR l."lotCode" ILIKE $${i})`);
        }
        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return this.dataSource.query(`
      SELECT
        p.id,
        p.code,
        p."lotId",
        p.quantity,
        p."currentLocationId",
        p.status,
        p."createdAt",
        p."exitedAt",
        l."lotCode",
        l."fechaVencimiento",
        l."productId",
        pr.code              AS "productCode",
        pr.description       AS "productDescription",
        loc.code             AS "locationCode",
        w.id                 AS "warehouseId",
        w.name               AS "warehouseName"
      FROM pallets p
      JOIN lots     l   ON l.id  = p."lotId"
      JOIN products pr  ON pr.id = l."productId"
      LEFT JOIN locations  loc ON loc.id = p."currentLocationId"
      LEFT JOIN warehouses w   ON w.id   = loc."warehouseId"
      ${whereClause}
      ORDER BY p.code ASC
      `, params);
    }
    async kpis() {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const rows = await this.dataSource.query(`SELECT status, COUNT(*)::int AS cnt FROM pallets GROUP BY status`);
        const [noLoc] = await this.dataSource.query(`SELECT COUNT(*)::int AS cnt FROM pallets WHERE "currentLocationId" IS NULL AND status <> 'EXITED'`);
        const by = {};
        let total = 0;
        for (const r of rows) {
            by[r.status] = Number(r.cnt);
            total += Number(r.cnt);
        }
        return {
            total,
            available: (_a = by['AVAILABLE']) !== null && _a !== void 0 ? _a : 0,
            partial: (_b = by['PARTIAL']) !== null && _b !== void 0 ? _b : 0,
            blocked: (_c = by['BLOCKED']) !== null && _c !== void 0 ? _c : 0,
            damaged: (_d = by['DAMAGED']) !== null && _d !== void 0 ? _d : 0,
            inTransit: (_e = by['IN_TRANSIT']) !== null && _e !== void 0 ? _e : 0,
            exited: (_f = by['EXITED']) !== null && _f !== void 0 ? _f : 0,
            empty: (_g = by['EMPTY']) !== null && _g !== void 0 ? _g : 0,
            noLocation: Number((_h = noLoc === null || noLoc === void 0 ? void 0 : noLoc.cnt) !== null && _h !== void 0 ? _h : 0),
        };
    }
    async reconcileStatuses() {
        return this.dataSource.transaction(async (em) => {
            const exitedRows = await em.query(`
        UPDATE pallets
        SET status = 'EXITED',
            "exitedAt" = COALESCE("exitedAt", CURRENT_TIMESTAMP)
        WHERE status = 'AVAILABLE' AND quantity <= 0
        RETURNING id
        `);
            const partialRows = await em.query(`
        UPDATE pallets p
        SET status = 'PARTIAL'
        WHERE p.status = 'AVAILABLE'
          AND p.quantity > 0
          AND EXISTS (
            SELECT 1
            FROM movement_details md
            JOIN movements m ON m.id = md."movementId"
            WHERE md."palletId" = p.id
              AND m.type IN ('EXIT', 'ADJUSTMENT_OUT')
          )
        RETURNING p.id
        `);
            return {
                exited: Array.isArray(exitedRows) ? exitedRows.length : 0,
                partial: Array.isArray(partialRows) ? partialRows.length : 0,
            };
        });
    }
    async findOne(id) {
        const pallet = await this.palletRepo.findOne({ where: { id } });
        if (!pallet)
            throw new common_1.NotFoundException('Pallet no encontrado');
        return pallet;
    }
    async update(id, dto) {
        const pallet = await this.findOne(id);
        if (dto.currentLocationId) {
            const loc = await this.locationRepo.findOne({ where: { id: dto.currentLocationId } });
            if (!loc)
                throw new common_1.NotFoundException('Ubicación no encontrada');
        }
        const previousQuantity = pallet.quantity;
        Object.assign(pallet, dto);
        const saved = await this.palletRepo.save(pallet);
        if (dto.quantity !== undefined && dto.quantity !== previousQuantity) {
            const delta = dto.quantity - previousQuantity;
            const lot = await this.lotRepo.findOne({ where: { id: saved.lotId } });
            if (lot) {
                lot.stockActual = Math.max(0, lot.stockActual + delta);
                await this.lotRepo.save(lot);
            }
        }
        return saved;
    }
    async quickTransfer(palletId, toLocationId, userId) {
        var _a, _b, _c, _d;
        const pallet = await this.palletRepo.findOne({ where: { id: palletId } });
        if (!pallet)
            throw new common_1.NotFoundException('Pallet no encontrado');
        if (pallet.status === 'EXITED')
            throw new common_1.BadRequestException('No se puede transferir un pallet despachado');
        if (pallet.status === 'EMPTY')
            throw new common_1.BadRequestException('No se puede transferir un pallet vacío');
        if (pallet.currentLocationId === toLocationId)
            throw new common_1.BadRequestException('El pallet ya se encuentra en esa ubicación');
        const toLoc = await this.locationRepo.findOne({
            where: { id: toLocationId },
            relations: ['warehouse'],
        });
        if (!toLoc)
            throw new common_1.NotFoundException('Ubicación destino no encontrada');
        if (!toLoc.active)
            throw new common_1.BadRequestException('La ubicación destino no está activa');
        const lot = await this.lotRepo.findOne({ where: { id: pallet.lotId } });
        if (!lot)
            throw new common_1.NotFoundException('Lote del pallet no encontrado');
        const fromLocationId = pallet.currentLocationId;
        const toWarehouseId = (_b = (_a = toLoc.warehouse) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null;
        let fromWarehouseId = null;
        if (fromLocationId) {
            const fromLoc = await this.locationRepo.findOne({
                where: { id: fromLocationId },
                relations: ['warehouse'],
            });
            fromWarehouseId = (_d = (_c = fromLoc === null || fromLoc === void 0 ? void 0 : fromLoc.warehouse) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : null;
        }
        await this.dataSource.transaction(async (em) => {
            const fromStock = await this.findOrCreateStock(em, lot.productId, fromWarehouseId, fromLocationId !== null && fromLocationId !== void 0 ? fromLocationId : null);
            fromStock.currentQuantity = Math.max(0, fromStock.currentQuantity - pallet.quantity);
            fromStock.updatedAt = new Date();
            await em.save(fromStock);
            const toStock = await this.findOrCreateStock(em, lot.productId, toWarehouseId, toLocationId);
            toStock.currentQuantity += pallet.quantity;
            toStock.updatedAt = new Date();
            await em.save(toStock);
            await em.update(pallet_entity_1.Pallet, { id: palletId }, { currentLocationId: toLocationId });
            const movement = em.create(movement_entity_1.Movement);
            movement.type = 'TRANSFER';
            movement.productId = lot.productId;
            movement.quantity = pallet.quantity;
            movement.pallets = 1;
            movement.lotId = lot.id;
            movement.fromLocationId = fromLocationId !== null && fromLocationId !== void 0 ? fromLocationId : undefined;
            movement.fromWarehouseId = fromWarehouseId !== null && fromWarehouseId !== void 0 ? fromWarehouseId : undefined;
            movement.toLocationId = toLocationId;
            movement.toWarehouseId = toWarehouseId !== null && toWarehouseId !== void 0 ? toWarehouseId : undefined;
            movement.createdById = userId;
            movement.notes = 'Transferencia rápida desde módulo Pallets';
            movement.status = 'NORMAL';
            const savedMovement = await em.save(movement);
            const detail = em.create(movement_detail_entity_1.MovementDetail);
            detail.movementId = savedMovement.id;
            detail.palletId = palletId;
            detail.lotId = lot.id;
            detail.locationId = fromLocationId !== null && fromLocationId !== void 0 ? fromLocationId : undefined;
            detail.quantity = pallet.quantity;
            await em.save(detail);
        });
        return this.palletRepo.findOne({ where: { id: palletId } });
    }
    async findOrCreateStock(manager, productId, warehouseId, locationId) {
        const repo = manager.getRepository(stock_entity_1.Stock);
        const existing = await repo.findOne({
            where: {
                productId,
                warehouseId: warehouseId !== null && warehouseId !== void 0 ? warehouseId : (0, typeorm_2.IsNull)(),
                locationId: locationId !== null && locationId !== void 0 ? locationId : (0, typeorm_2.IsNull)(),
            },
        });
        if (existing)
            return existing;
        return repo.create({ productId, warehouseId, locationId, currentQuantity: 0, updatedAt: new Date() });
    }
    async remove(id) {
        const pallet = await this.findOne(id);
        await this.palletRepo.remove(pallet);
        return { deleted: true };
    }
    async history(id) {
        const pallet = await this.findOne(id);
        const detailEvents = await this.dataSource.query(`
      SELECT
        m.id          AS "movementId",
        m.type,
        m.date,
        md.quantity,
        m."documentNumber",
        m.supplier,
        m.carrier,
        m.driver,
        m.destination,
        m.notes,
        m.status,
        p.code        AS "productCode",
        p.description AS "productDescription",
        l_from.id     AS "fromLocationId",
        l_from.code   AS "fromLocationCode",
        w_from.name   AS "fromWarehouseName",
        l_to.id       AS "toLocationId",
        l_to.code     AS "toLocationCode",
        w_to.name     AS "toWarehouseName"
      FROM movement_details md
      JOIN movements m   ON m.id = md."movementId"
      JOIN products  p   ON p.id = m."productId"
      LEFT JOIN locations l_from ON l_from.id = md."locationId"
      LEFT JOIN warehouses w_from ON w_from.id = m."fromWarehouseId"
      LEFT JOIN locations l_to   ON l_to.id   = m."toLocationId"
      LEFT JOIN warehouses w_to  ON w_to.id   = m."toWarehouseId"
      WHERE md."palletId" = $1
      ORDER BY m.date ASC
      `, [id]);
        const directEvents = await this.dataSource.query(`
      SELECT
        m.id          AS "movementId",
        m.type,
        m.date,
        m.quantity,
        m."documentNumber",
        m.supplier,
        m.carrier,
        m.driver,
        m.destination,
        m.notes,
        m.status,
        p.code        AS "productCode",
        p.description AS "productDescription",
        l_from.id     AS "fromLocationId",
        l_from.code   AS "fromLocationCode",
        w_from.name   AS "fromWarehouseName",
        l_to.id       AS "toLocationId",
        l_to.code     AS "toLocationCode",
        w_to.name     AS "toWarehouseName"
      FROM movements m
      JOIN products p ON p.id = m."productId"
      LEFT JOIN locations  l_from ON l_from.id = m."fromLocationId"
      LEFT JOIN warehouses w_from ON w_from.id = m."fromWarehouseId"
      LEFT JOIN locations  l_to   ON l_to.id   = m."toLocationId"
      LEFT JOIN warehouses w_to   ON w_to.id   = m."toWarehouseId"
      WHERE m."palletId" = $1
        AND NOT EXISTS (
          SELECT 1 FROM movement_details md2
          WHERE md2."movementId" = m.id AND md2."palletId" = $1
        )
      ORDER BY m.date ASC
      `, [id]);
        const seen = new Set();
        const events = [...detailEvents, ...directEvents]
            .filter((e) => {
            if (seen.has(e.movementId))
                return false;
            seen.add(e.movementId);
            return true;
        })
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const INCREASE_TYPES = ['ENTRY', 'ADJUSTMENT_IN'];
        const NEUTRAL_TYPES = ['TRANSFER'];
        let running = 0;
        const history = events.map((e) => {
            var _a, _b, _c, _d, _e, _f;
            const qty = Number(e.quantity);
            if (!NEUTRAL_TYPES.includes(e.type)) {
                running += INCREASE_TYPES.includes(e.type) ? qty : -qty;
            }
            return {
                movementId: e.movementId,
                type: e.type,
                date: e.date,
                quantity: qty,
                remainingAfter: Math.max(0, running),
                documentNumber: (_a = e.documentNumber) !== null && _a !== void 0 ? _a : null,
                supplier: (_b = e.supplier) !== null && _b !== void 0 ? _b : null,
                carrier: (_c = e.carrier) !== null && _c !== void 0 ? _c : null,
                driver: (_d = e.driver) !== null && _d !== void 0 ? _d : null,
                destination: (_e = e.destination) !== null && _e !== void 0 ? _e : null,
                notes: (_f = e.notes) !== null && _f !== void 0 ? _f : null,
                status: e.status,
                from: e.fromLocationId
                    ? { locationId: e.fromLocationId, locationCode: e.fromLocationCode, warehouseName: e.fromWarehouseName }
                    : null,
                to: e.toLocationId
                    ? { locationId: e.toLocationId, locationCode: e.toLocationCode, warehouseName: e.toWarehouseName }
                    : null,
            };
        });
        return {
            pallet,
            product: events[0]
                ? { code: events[0].productCode, description: events[0].productDescription }
                : null,
            history,
        };
    }
};
exports.PalletsService = PalletsService;
exports.PalletsService = PalletsService = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, typeorm_1.InjectRepository)(pallet_entity_1.Pallet)),
    __param(2, (0, typeorm_1.InjectRepository)(lot_entity_1.Lot)),
    __param(3, (0, typeorm_1.InjectRepository)(location_entity_1.Location)),
    __metadata("design:paramtypes", [typeorm_2.DataSource,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository])
], PalletsService);
//# sourceMappingURL=pallets.service.js.map