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
exports.LotsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const lot_entity_1 = require("./entities/lot.entity");
const product_entity_1 = require("../products/entities/product.entity");
const pallet_entity_1 = require("../pallets/entities/pallet.entity");
let LotsService = class LotsService {
    constructor(lotRepo, productRepo, palletRepo) {
        this.lotRepo = lotRepo;
        this.productRepo = productRepo;
        this.palletRepo = palletRepo;
    }
    async create(dto) {
        var _a, _b, _c, _d;
        const product = await this.productRepo.findOne({ where: { id: dto.productId } });
        if (!product)
            throw new common_1.NotFoundException('Producto no encontrado');
        const lot = this.lotRepo.create({
            lotCode: dto.lotCode,
            productId: dto.productId,
            product,
            fechaVencimiento: (_a = dto.fechaVencimiento) !== null && _a !== void 0 ? _a : null,
            fechaFabricacion: (_b = dto.fechaFabricacion) !== null && _b !== void 0 ? _b : null,
            proveedor: (_c = dto.proveedor) !== null && _c !== void 0 ? _c : null,
            sapLot: (_d = dto.sapLot) !== null && _d !== void 0 ? _d : null,
            stockActual: 0,
        });
        return this.lotRepo.save(lot);
    }
    async findAll(productId, sapLot, includePallets = false) {
        const qb = this.lotRepo
            .createQueryBuilder('lot')
            .leftJoinAndSelect('lot.product', 'product')
            .orderBy('lot.fechaVencimiento', 'ASC');
        if (productId)
            qb.andWhere('lot.productId = :productId', { productId });
        if (sapLot)
            qb.andWhere('lot.sapLot = :sapLot', { sapLot });
        const lots = await qb.getMany();
        if (lots.length === 0)
            return [];
        const lotIds = lots.map((l) => l.id);
        const counts = await this.palletRepo
            .createQueryBuilder('p')
            .select('p."lotId"', 'lotId')
            .addSelect("COUNT(*) FILTER (WHERE p.status = 'AVAILABLE')", 'availableCount')
            .addSelect("COUNT(*) FILTER (WHERE p.status = 'EXITED')", 'exitedCount')
            .addSelect('COUNT(*)', 'totalCount')
            .where('p."lotId" IN (:...lotIds)', { lotIds })
            .groupBy('p."lotId"')
            .getRawMany();
        const countsByLot = new Map(counts.map((c) => [c.lotId, c]));
        let palletsByLot = null;
        if (includePallets) {
            const pallets = await this.palletRepo
                .createQueryBuilder('p')
                .where('p."lotId" IN (:...lotIds)', { lotIds })
                .orderBy('p.code', 'ASC')
                .getMany();
            palletsByLot = new Map();
            for (const p of pallets) {
                if (!palletsByLot.has(p.lotId))
                    palletsByLot.set(p.lotId, []);
                palletsByLot.get(p.lotId).push(p);
            }
        }
        return lots.map((lot) => {
            var _a;
            const c = countsByLot.get(lot.id);
            return {
                ...lot,
                availablePalletsCount: c ? Number(c.availableCount) : 0,
                exitedPalletsCount: c ? Number(c.exitedCount) : 0,
                totalPalletsCount: c ? Number(c.totalCount) : 0,
                ...(includePallets ? { pallets: (_a = palletsByLot === null || palletsByLot === void 0 ? void 0 : palletsByLot.get(lot.id)) !== null && _a !== void 0 ? _a : [] } : {}),
            };
        });
    }
    async findFefo(productId, sapLot, locationId) {
        const qb = this.lotRepo
            .createQueryBuilder('lot')
            .leftJoinAndSelect('lot.product', 'product')
            .andWhere('lot.stockActual > 0')
            .orderBy({ 'lot.fechaVencimiento': { order: 'ASC', nulls: 'NULLS LAST' } });
        if (productId)
            qb.andWhere('lot.productId = :productId', { productId });
        if (sapLot)
            qb.andWhere('lot.sapLot = :sapLot', { sapLot });
        const lots = await qb.getMany();
        if (lots.length === 0)
            return [];
        const lotIds = lots.map((l) => l.id);
        const palletsQb = this.palletRepo
            .createQueryBuilder('p')
            .where('p.lotId IN (:...lotIds)', { lotIds })
            .andWhere("p.status = 'AVAILABLE'")
            .orderBy('p.code', 'ASC');
        if (locationId) {
            palletsQb.andWhere('p.currentLocationId = :locationId', { locationId });
        }
        const pallets = await palletsQb.getMany();
        const palletsByLot = new Map();
        for (const p of pallets) {
            if (!palletsByLot.has(p.lotId))
                palletsByLot.set(p.lotId, []);
            palletsByLot.get(p.lotId).push(p);
        }
        const result = lots.map((lot) => { var _a; return ({ ...lot, pallets: (_a = palletsByLot.get(lot.id)) !== null && _a !== void 0 ? _a : [] }); });
        return locationId ? result.filter((l) => l.pallets.length > 0) : result;
    }
    async findOne(id) {
        const lot = await this.lotRepo.findOne({ where: { id }, relations: ['product'] });
        if (!lot)
            throw new common_1.NotFoundException('Lote no encontrado');
        return lot;
    }
    async findOrCreate(productId, lotCode, fechaVencimiento, proveedor, fechaFabricacion, sapLot) {
        let lot = await this.lotRepo.findOne({ where: { productId, lotCode } });
        if (!lot) {
            lot = await this.lotRepo.save(this.lotRepo.create({
                lotCode, productId,
                fechaVencimiento: fechaVencimiento !== null && fechaVencimiento !== void 0 ? fechaVencimiento : null,
                fechaFabricacion: fechaFabricacion !== null && fechaFabricacion !== void 0 ? fechaFabricacion : null,
                proveedor: proveedor !== null && proveedor !== void 0 ? proveedor : null,
                sapLot: sapLot !== null && sapLot !== void 0 ? sapLot : null,
                stockActual: 0,
            }));
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
                lot = await this.lotRepo.save(lot);
        }
        return lot;
    }
    async update(id, dto) {
        const lot = await this.findOne(id);
        Object.assign(lot, dto);
        return this.lotRepo.save(lot);
    }
    async remove(id) {
        const lot = await this.findOne(id);
        await this.lotRepo.remove(lot);
        return { deleted: true };
    }
    async reconcileStock(id) {
        var _a;
        const lot = await this.findOne(id);
        const result = await this.palletRepo
            .createQueryBuilder('p')
            .select("COALESCE(SUM(p.quantity), 0)", 'total')
            .where('p."lotId" = :id', { id })
            .andWhere("p.status != 'EXITED'")
            .getRawOne();
        const real = Number((_a = result === null || result === void 0 ? void 0 : result.total) !== null && _a !== void 0 ? _a : 0);
        const previous = lot.stockActual;
        lot.stockActual = real;
        await this.lotRepo.save(lot);
        return { lotId: id, lotCode: lot.lotCode, previous, reconciled: real, delta: real - previous };
    }
    async reconcileAllStocks(productId) {
        var _a;
        const qb = this.lotRepo.createQueryBuilder('lot');
        if (productId)
            qb.andWhere('lot."productId" = :productId', { productId });
        const lots = await qb.getMany();
        const corrections = [];
        for (const lot of lots) {
            const result = await this.palletRepo
                .createQueryBuilder('p')
                .select("COALESCE(SUM(p.quantity), 0)", 'total')
                .where('p."lotId" = :id', { id: lot.id })
                .andWhere("p.status != 'EXITED'")
                .getRawOne();
            const real = Number((_a = result === null || result === void 0 ? void 0 : result.total) !== null && _a !== void 0 ? _a : 0);
            if (real !== lot.stockActual) {
                corrections.push({ lotId: lot.id, lotCode: lot.lotCode, previous: lot.stockActual, reconciled: real, delta: real - lot.stockActual });
                lot.stockActual = real;
                await this.lotRepo.save(lot);
            }
        }
        return { corrected: corrections.length, corrections };
    }
};
exports.LotsService = LotsService;
exports.LotsService = LotsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(lot_entity_1.Lot)),
    __param(1, (0, typeorm_1.InjectRepository)(product_entity_1.Product)),
    __param(2, (0, typeorm_1.InjectRepository)(pallet_entity_1.Pallet)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository])
], LotsService);
//# sourceMappingURL=lots.service.js.map