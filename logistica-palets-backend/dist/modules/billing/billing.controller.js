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
exports.BillingController = void 0;
const common_1 = require("@nestjs/common");
const billing_service_1 = require("./billing.service");
const create_cliente_dto_1 = require("./dto/create-cliente.dto");
const create_factura_dto_1 = require("./dto/create-factura.dto");
const query_factura_dto_1 = require("./dto/query-factura.dto");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const roles_guard_1 = require("../auth/roles/roles.guard");
const roles_decorator_1 = require("../auth/roles/roles.decorator");
let BillingController = class BillingController {
    constructor(service) {
        this.service = service;
    }
    listarClientes() {
        return this.service.listarClientes();
    }
    crearCliente(dto) {
        return this.service.crearCliente(dto);
    }
    obtenerCliente(id) {
        return this.service.obtenerCliente(id);
    }
    actualizarCliente(id, dto) {
        return this.service.actualizarCliente(id, dto);
    }
    desactivarCliente(id) {
        return this.service.desactivarCliente(id);
    }
    listarFacturas(query) {
        return this.service.listarFacturas(query);
    }
    crearFactura(dto, req) {
        return this.service.crearFactura(dto, req.user.userId);
    }
    obtenerFactura(id) {
        return this.service.obtenerFactura(id);
    }
    enviarSIFEN(id) {
        return this.service.generarYEnviarSIFEN(id);
    }
    cancelar(id) {
        return this.service.cancelarFactura(id);
    }
    consultarSifen(id) {
        return this.service.consultarEstadoSifen(id);
    }
    async descargarXML(id, res) {
        var _a;
        const xml = await this.service.obtenerXML(id);
        const factura = await this.service.obtenerFactura(id);
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('Content-Disposition', `attachment; filename="DE-${(_a = factura.cdc) !== null && _a !== void 0 ? _a : id}.xml"`);
        res.send(xml);
    }
};
exports.BillingController = BillingController;
__decorate([
    (0, common_1.Get)('clientes'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'AUDITOR'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "listarClientes", null);
__decorate([
    (0, common_1.Post)('clientes'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_cliente_dto_1.CreateClienteDto]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "crearCliente", null);
__decorate([
    (0, common_1.Get)('clientes/:id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'AUDITOR'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "obtenerCliente", null);
__decorate([
    (0, common_1.Patch)('clientes/:id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "actualizarCliente", null);
__decorate([
    (0, common_1.Delete)('clientes/:id'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "desactivarCliente", null);
__decorate([
    (0, common_1.Get)('facturas'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'AUDITOR'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [query_factura_dto_1.QueryFacturaDto]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "listarFacturas", null);
__decorate([
    (0, common_1.Post)('facturas'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_factura_dto_1.CreateFacturaDto, Object]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "crearFactura", null);
__decorate([
    (0, common_1.Get)('facturas/:id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'AUDITOR'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "obtenerFactura", null);
__decorate([
    (0, common_1.Post)('facturas/:id/enviar-sifen'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "enviarSIFEN", null);
__decorate([
    (0, common_1.Post)('facturas/:id/cancelar'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "cancelar", null);
__decorate([
    (0, common_1.Post)('facturas/:id/consultar-sifen'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'AUDITOR'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "consultarSifen", null);
__decorate([
    (0, common_1.Get)('facturas/:id/xml'),
    (0, roles_decorator_1.Roles)('ADMIN', 'MANAGER', 'AUDITOR'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "descargarXML", null);
exports.BillingController = BillingController = __decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('billing'),
    __metadata("design:paramtypes", [billing_service_1.BillingService])
], BillingController);
//# sourceMappingURL=billing.controller.js.map