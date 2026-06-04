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
exports.PalletsController = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const pallets_service_1 = require("./pallets.service");
const create_pallet_dto_1 = require("./dto/create-pallet.dto");
const update_pallet_dto_1 = require("./dto/update-pallet.dto");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const roles_guard_1 = require("../auth/roles/roles.guard");
const roles_decorator_1 = require("../auth/roles/roles.decorator");
class QuickTransferDto {
}
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], QuickTransferDto.prototype, "toLocationId", void 0);
let PalletsController = class PalletsController {
    constructor(service) {
        this.service = service;
    }
    findAll(lotId, status, productId, locationId, search) {
        return this.service.findAll({ lotId, status, productId, locationId, search });
    }
    kpis() {
        return this.service.kpis();
    }
    reconcileStatuses() {
        return this.service.reconcileStatuses();
    }
    findOne(id) {
        return this.service.findOne(id);
    }
    history(id) {
        return this.service.history(id);
    }
    create(dto) {
        return this.service.create(dto);
    }
    quickTransfer(id, dto, req) {
        return this.service.quickTransfer(id, dto.toLocationId, req.user.userId);
    }
    update(id, dto) {
        return this.service.update(id, dto);
    }
    remove(_id) {
        throw new common_1.MethodNotAllowedException('La eliminación de pallets está deshabilitada para preservar la trazabilidad');
    }
};
exports.PalletsController = PalletsController;
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR'),
    __param(0, (0, common_1.Query)('lotId')),
    __param(1, (0, common_1.Query)('status')),
    __param(2, (0, common_1.Query)('productId')),
    __param(3, (0, common_1.Query)('locationId')),
    __param(4, (0, common_1.Query)('search')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], PalletsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('kpis'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], PalletsController.prototype, "kpis", null);
__decorate([
    (0, common_1.Post)('reconcile-status'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], PalletsController.prototype, "reconcileStatuses", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PalletsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Get)(':id/history'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'AUDITOR'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PalletsController.prototype, "history", null);
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'OPERATOR'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_pallet_dto_1.CreatePalletDto]),
    __metadata("design:returntype", void 0)
], PalletsController.prototype, "create", null);
__decorate([
    (0, common_1.Post)(':id/transfer'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'OPERATOR'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, QuickTransferDto, Object]),
    __metadata("design:returntype", void 0)
], PalletsController.prototype, "quickTransfer", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'OPERATOR'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_pallet_dto_1.UpdatePalletDto]),
    __metadata("design:returntype", void 0)
], PalletsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER'),
    (0, common_1.HttpCode)(common_1.HttpStatus.METHOD_NOT_ALLOWED),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PalletsController.prototype, "remove", null);
exports.PalletsController = PalletsController = __decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('pallets'),
    __metadata("design:paramtypes", [pallets_service_1.PalletsService])
], PalletsController);
//# sourceMappingURL=pallets.controller.js.map