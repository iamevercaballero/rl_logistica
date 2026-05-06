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
var SeedController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeedController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const roles_guard_1 = require("../auth/roles/roles.guard");
const roles_decorator_1 = require("../auth/roles/roles.decorator");
const seed_service_1 = require("./seed.service");
let SeedController = SeedController_1 = class SeedController {
    constructor(seedService) {
        this.seedService = seedService;
        this.logger = new common_1.Logger(SeedController_1.name);
    }
    async seedFromExcel(body) {
        var _a, _b;
        if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_SEED) {
            throw new common_1.BadRequestException('Seed deshabilitado en producción. Setear ALLOW_SEED=true para habilitar.');
        }
        this.logger.log('Iniciando seed desde Excel...');
        return this.seedService.seedFromExcel((_a = body.maxMovimientos) !== null && _a !== void 0 ? _a : 300, (_b = body.soloProductos) !== null && _b !== void 0 ? _b : false);
    }
    async reset() {
        if (process.env.NODE_ENV === 'production') {
            throw new common_1.BadRequestException('Reset deshabilitado en producción.');
        }
        return this.seedService.resetData();
    }
};
exports.SeedController = SeedController;
__decorate([
    (0, common_1.Post)('from-excel'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SeedController.prototype, "seedFromExcel", null);
__decorate([
    (0, common_1.Post)('reset'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SeedController.prototype, "reset", null);
exports.SeedController = SeedController = SeedController_1 = __decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('seed'),
    __metadata("design:paramtypes", [seed_service_1.SeedService])
], SeedController);
//# sourceMappingURL=seed.controller.js.map