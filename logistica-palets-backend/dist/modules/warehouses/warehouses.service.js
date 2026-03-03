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
exports.WarehousesService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const warehouse_entity_1 = require("./entities/warehouse.entity");
let WarehousesService = class WarehousesService {
    constructor(warehouseRepo) {
        this.warehouseRepo = warehouseRepo;
    }
    create(dto) {
        const warehouse = this.warehouseRepo.create(dto);
        return this.warehouseRepo.save(warehouse);
    }
    findAll() {
        return this.warehouseRepo.find();
    }
    async findOne(id) {
        const warehouse = await this.warehouseRepo.findOne({ where: { id } });
        if (!warehouse)
            throw new common_1.NotFoundException('Warehouse not found');
        return warehouse;
    }
    async update(id, dto) {
        const warehouse = await this.findOne(id);
        Object.assign(warehouse, dto);
        return this.warehouseRepo.save(warehouse);
    }
    async remove(id) {
        const warehouse = await this.findOne(id);
        return this.warehouseRepo.remove(warehouse);
    }
};
exports.WarehousesService = WarehousesService;
exports.WarehousesService = WarehousesService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(warehouse_entity_1.Warehouse)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], WarehousesService);
//# sourceMappingURL=warehouses.service.js.map