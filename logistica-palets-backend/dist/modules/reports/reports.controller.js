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
exports.ReportsController = void 0;
const common_1 = require("@nestjs/common");
const reports_service_1 = require("./reports.service");
const stock_query_dto_1 = require("./dto/stock-query.dto");
const movements_query_dto_1 = require("./dto/movements-query.dto");
const trace_query_dto_1 = require("./dto/trace-query.dto");
const kpis_query_dto_1 = require("./dto/kpis-query.dto");
const daily_stock_query_dto_1 = require("./dto/daily-stock-query.dto");
const differences_sap_query_dto_1 = require("./dto/differences-sap-query.dto");
const upsert_sap_stock_dto_1 = require("./dto/upsert-sap-stock.dto");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const roles_guard_1 = require("../auth/roles/roles.guard");
const roles_decorator_1 = require("../auth/roles/roles.decorator");
let ReportsController = class ReportsController {
    constructor(service) {
        this.service = service;
    }
    stock(query) {
        return this.service.stock(query);
    }
    movements(query) {
        return this.service.movements(query);
    }
    trace(query) {
        return this.service.trace(query.materialId);
    }
    dailyStock(query) {
        return this.service.dailyStock(query);
    }
    upsertSapStock(dto) {
        return this.service.upsertSapStock(dto);
    }
    differencesSap(query) {
        return this.service.differencesSap(query);
    }
    kpis(query) {
        return this.service.kpis(query);
    }
};
exports.ReportsController = ReportsController;
__decorate([
    (0, common_1.Get)('stock'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [stock_query_dto_1.StockQueryDto]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "stock", null);
__decorate([
    (0, common_1.Get)('movements'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [movements_query_dto_1.ReportsMovementsQueryDto]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "movements", null);
__decorate([
    (0, common_1.Get)('trace'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [trace_query_dto_1.TraceQueryDto]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "trace", null);
__decorate([
    (0, common_1.Get)('daily-stock'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [daily_stock_query_dto_1.DailyStockQueryDto]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "dailyStock", null);
__decorate([
    (0, common_1.Post)('sap-stock'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [upsert_sap_stock_dto_1.UpsertSapStockDto]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "upsertSapStock", null);
__decorate([
    (0, common_1.Get)('differences-sap'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'AUDITOR'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [differences_sap_query_dto_1.DifferencesSapQueryDto]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "differencesSap", null);
__decorate([
    (0, common_1.Get)('kpis'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'AUDITOR'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [kpis_query_dto_1.KpisQueryDto]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "kpis", null);
exports.ReportsController = ReportsController = __decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('reports'),
    __metadata("design:paramtypes", [reports_service_1.ReportsService])
], ReportsController);
//# sourceMappingURL=reports.controller.js.map