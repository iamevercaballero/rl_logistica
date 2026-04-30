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
exports.ProductsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const product_entity_1 = require("./entities/product.entity");
let ProductsService = class ProductsService {
    constructor(productRepo) {
        this.productRepo = productRepo;
    }
    async create(dto) {
        var _a;
        await this.ensureCodeAvailable(dto.code);
        const product = this.productRepo.create({
            ...dto,
            code: dto.code.trim().toUpperCase(),
            description: dto.description.trim(),
            unitOfMeasure: (_a = dto.unitOfMeasure) === null || _a === void 0 ? void 0 : _a.trim().toUpperCase(),
        });
        return this.productRepo.save(product);
    }
    findAll() {
        return this.productRepo.find({ order: { code: 'ASC' } });
    }
    async findOne(id) {
        const product = await this.productRepo.findOne({ where: { id } });
        if (!product)
            throw new common_1.NotFoundException('Material no encontrado');
        return product;
    }
    async update(id, dto) {
        const product = await this.findOne(id);
        if (dto.code && dto.code.trim().toUpperCase() !== product.code) {
            await this.ensureCodeAvailable(dto.code, id);
        }
        Object.assign(product, {
            ...dto,
            code: dto.code ? dto.code.trim().toUpperCase() : product.code,
            description: dto.description ? dto.description.trim() : product.description,
            unitOfMeasure: dto.unitOfMeasure ? dto.unitOfMeasure.trim().toUpperCase() : product.unitOfMeasure,
        });
        return this.productRepo.save(product);
    }
    async remove(id) {
        const product = await this.findOne(id);
        return this.productRepo.remove(product);
    }
    async ensureCodeAvailable(code, excludeId) {
        const existing = await this.productRepo.findOne({ where: { code: code.trim().toUpperCase() } });
        if (existing && existing.id !== excludeId) {
            throw new common_1.BadRequestException('Ya existe un material con ese código');
        }
    }
};
exports.ProductsService = ProductsService;
exports.ProductsService = ProductsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(product_entity_1.Product)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], ProductsService);
//# sourceMappingURL=products.service.js.map