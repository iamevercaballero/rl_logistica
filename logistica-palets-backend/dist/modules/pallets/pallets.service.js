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
let PalletsService = class PalletsService {
    constructor(palletRepo, lotRepo, locationRepo) {
        this.palletRepo = palletRepo;
        this.lotRepo = lotRepo;
        this.locationRepo = locationRepo;
    }
    async create(dto) {
        var _a;
        const exists = await this.palletRepo.findOne({ where: { code: dto.code } });
        if (exists)
            throw new common_1.BadRequestException('Ya existe un pallet con ese código');
        const lot = await this.lotRepo.findOne({ where: { id: dto.lotId } });
        if (!lot)
            throw new common_1.NotFoundException('Lote no encontrado');
        const loc = await this.locationRepo.findOne({ where: { id: dto.currentLocationId } });
        if (!loc)
            throw new common_1.NotFoundException('Ubicación no encontrada');
        const pallet = this.palletRepo.create({
            code: dto.code,
            lotId: dto.lotId,
            quantity: dto.quantity,
            currentLocationId: dto.currentLocationId,
            status: (_a = dto.status) !== null && _a !== void 0 ? _a : 'AVAILABLE',
        });
        return this.palletRepo.save(pallet);
    }
    findAll() {
        return this.palletRepo.find();
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
        Object.assign(pallet, dto);
        return this.palletRepo.save(pallet);
    }
    async remove(id) {
        const pallet = await this.findOne(id);
        await this.palletRepo.remove(pallet);
        return { deleted: true };
    }
};
exports.PalletsService = PalletsService;
exports.PalletsService = PalletsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(pallet_entity_1.Pallet)),
    __param(1, (0, typeorm_1.InjectRepository)(lot_entity_1.Lot)),
    __param(2, (0, typeorm_1.InjectRepository)(location_entity_1.Location)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository])
], PalletsService);
//# sourceMappingURL=pallets.service.js.map