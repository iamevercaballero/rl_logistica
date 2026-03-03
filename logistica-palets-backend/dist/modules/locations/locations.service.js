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
exports.LocationsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const location_entity_1 = require("./entities/location.entity");
const warehouse_entity_1 = require("../warehouses/entities/warehouse.entity");
let LocationsService = class LocationsService {
    constructor(locationRepo, warehouseRepo) {
        this.locationRepo = locationRepo;
        this.warehouseRepo = warehouseRepo;
    }
    async create(dto) {
        const warehouse = await this.warehouseRepo.findOne({
            where: { id: dto.warehouseId },
        });
        if (!warehouse) {
            throw new common_1.NotFoundException('Warehouse not found');
        }
        const location = this.locationRepo.create({
            code: dto.code,
            warehouse,
        });
        return this.locationRepo.save(location);
    }
    findAll() {
        return this.locationRepo.find({ relations: ['warehouse'] });
    }
    async findOne(id) {
        const location = await this.locationRepo.findOne({
            where: { id },
            relations: ['warehouse'],
        });
        if (!location)
            throw new common_1.NotFoundException('Location not found');
        return location;
    }
    async update(id, dto) {
        const location = await this.findOne(id);
        Object.assign(location, dto);
        return this.locationRepo.save(location);
    }
    async remove(id) {
        const location = await this.findOne(id);
        return this.locationRepo.remove(location);
    }
};
exports.LocationsService = LocationsService;
exports.LocationsService = LocationsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(location_entity_1.Location)),
    __param(1, (0, typeorm_1.InjectRepository)(warehouse_entity_1.Warehouse)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository])
], LocationsService);
//# sourceMappingURL=locations.service.js.map