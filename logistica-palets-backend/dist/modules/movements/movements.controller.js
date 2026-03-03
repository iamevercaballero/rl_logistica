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
exports.MovementsController = void 0;
const common_1 = require("@nestjs/common");
const movements_service_1 = require("./movements.service");
const create_entry_dto_1 = require("./dto/create-entry.dto");
const create_exit_dto_1 = require("./dto/create-exit.dto");
const create_transfer_dto_1 = require("./dto/create-transfer.dto");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const roles_guard_1 = require("../auth/roles/roles.guard");
const roles_decorator_1 = require("../auth/roles/roles.decorator");
let MovementsController = class MovementsController {
    constructor(service) {
        this.service = service;
    }
    createEntry(dto) {
        return this.service.createEntry(dto);
    }
    createExit(dto) {
        return this.service.createExit(dto);
    }
    createTransfer(dto) {
        return this.service.createTransfer(dto);
    }
    findAll() {
        return this.service.findAll();
    }
    findOne(id) {
        return this.service.findOne(id);
    }
};
exports.MovementsController = MovementsController;
__decorate([
    (0, common_1.Post)('entry'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'OPERATOR'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_entry_dto_1.CreateEntryDto]),
    __metadata("design:returntype", void 0)
], MovementsController.prototype, "createEntry", null);
__decorate([
    (0, common_1.Post)('exit'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'OPERATOR'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_exit_dto_1.CreateExitDto]),
    __metadata("design:returntype", void 0)
], MovementsController.prototype, "createExit", null);
__decorate([
    (0, common_1.Post)('transfer'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_transfer_dto_1.CreateTransferDto]),
    __metadata("design:returntype", void 0)
], MovementsController.prototype, "createTransfer", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'AUDITOR'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], MovementsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'AUDITOR'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], MovementsController.prototype, "findOne", null);
exports.MovementsController = MovementsController = __decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('movements'),
    __metadata("design:paramtypes", [movements_service_1.MovementsService])
], MovementsController);
//# sourceMappingURL=movements.controller.js.map