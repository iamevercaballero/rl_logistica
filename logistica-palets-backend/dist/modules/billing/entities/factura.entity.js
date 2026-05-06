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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Factura = exports.tiposDECode = exports.tiposDE = exports.condicionesPago = exports.estadosFactura = void 0;
const typeorm_1 = require("typeorm");
const cliente_entity_1 = require("./cliente.entity");
const item_factura_entity_1 = require("./item-factura.entity");
exports.estadosFactura = ['BORRADOR', 'PENDIENTE', 'APROBADO', 'RECHAZADO', 'CANCELADO'];
exports.condicionesPago = ['CONTADO', 'CREDITO'];
exports.tiposDE = ['FACTURA', 'NOTA_CREDITO', 'NOTA_DEBITO', 'AUTOFACTURA', 'NOTA_REMISION'];
const tiposDECode = {
    FACTURA: '01',
    NOTA_CREDITO: '05',
    NOTA_DEBITO: '06',
    AUTOFACTURA: '07',
    NOTA_REMISION: '08',
};
exports.tiposDECode = tiposDECode;
let Factura = class Factura {
    get numeroFormateado() {
        return `${this.establecimiento}-${this.puntoExpedicion}-${String(this.numeroDocumento).padStart(7, '0')}`;
    }
};
exports.Factura = Factura;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], Factura.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: exports.tiposDE, default: 'FACTURA' }),
    __metadata("design:type", String)
], Factura.prototype, "tipoDE", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 3 }),
    __metadata("design:type", String)
], Factura.prototype, "establecimiento", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 3 }),
    __metadata("design:type", String)
], Factura.prototype, "puntoExpedicion", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", Number)
], Factura.prototype, "numeroDocumento", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 20 }),
    __metadata("design:type", String)
], Factura.prototype, "timbrado", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date' }),
    __metadata("design:type", Date)
], Factura.prototype, "fechaVigenciaTimbrado", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 44, nullable: true }),
    (0, typeorm_1.Index)({ unique: true, where: 'cdc IS NOT NULL' }),
    __metadata("design:type", String)
], Factura.prototype, "cdc", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], Factura.prototype, "clienteId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => cliente_entity_1.Cliente, (c) => c.facturas, { eager: true }),
    (0, typeorm_1.JoinColumn)({ name: 'clienteId' }),
    __metadata("design:type", cliente_entity_1.Cliente)
], Factura.prototype, "cliente", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], Factura.prototype, "fecha", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: exports.condicionesPago, default: 'CONTADO' }),
    __metadata("design:type", String)
], Factura.prototype, "condicionPago", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 3, default: 'PYG' }),
    __metadata("design:type", String)
], Factura.prototype, "moneda", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 18, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], Factura.prototype, "subtotalExenta", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 18, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], Factura.prototype, "subtotal5", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 18, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], Factura.prototype, "subtotal10", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 18, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], Factura.prototype, "iva5", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 18, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], Factura.prototype, "iva10", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 18, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], Factura.prototype, "totalGeneral", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: exports.estadosFactura, default: 'BORRADOR' }),
    __metadata("design:type", String)
], Factura.prototype, "estado", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], Factura.prototype, "xmlGenerado", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 500, nullable: true }),
    __metadata("design:type", String)
], Factura.prototype, "codigoQR", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 20, nullable: true }),
    __metadata("design:type", String)
], Factura.prototype, "protocoloSifen", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 1000, nullable: true }),
    __metadata("design:type", String)
], Factura.prototype, "mensajeSifen", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamp', nullable: true }),
    __metadata("design:type", Date)
], Factura.prototype, "fechaAprobacion", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true }),
    __metadata("design:type", String)
], Factura.prototype, "movimientoId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], Factura.prototype, "createdById", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 500, nullable: true }),
    __metadata("design:type", String)
], Factura.prototype, "observaciones", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], Factura.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], Factura.prototype, "updatedAt", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => item_factura_entity_1.ItemFactura, (i) => i.factura, { cascade: true, eager: true }),
    __metadata("design:type", Array)
], Factura.prototype, "items", void 0);
exports.Factura = Factura = __decorate([
    (0, typeorm_1.Entity)('facturas')
], Factura);
//# sourceMappingURL=factura.entity.js.map