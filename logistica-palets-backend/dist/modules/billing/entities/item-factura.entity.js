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
exports.ItemFactura = exports.afectacionCode = exports.afectacionesIVA = void 0;
const typeorm_1 = require("typeorm");
const factura_entity_1 = require("./factura.entity");
exports.afectacionesIVA = ['IVA10', 'IVA5', 'EXENTA', 'EXONERADA'];
const afectacionCode = {
    IVA10: '1',
    IVA5: '2',
    EXENTA: '3',
    EXONERADA: '4',
};
exports.afectacionCode = afectacionCode;
let ItemFactura = class ItemFactura {
};
exports.ItemFactura = ItemFactura;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], ItemFactura.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], ItemFactura.prototype, "facturaId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => factura_entity_1.Factura, (f) => f.items, { onDelete: 'CASCADE' }),
    (0, typeorm_1.JoinColumn)({ name: 'facturaId' }),
    __metadata("design:type", factura_entity_1.Factura)
], ItemFactura.prototype, "factura", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", Number)
], ItemFactura.prototype, "orden", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 50, nullable: true }),
    __metadata("design:type", String)
], ItemFactura.prototype, "codigo", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 500 }),
    __metadata("design:type", String)
], ItemFactura.prototype, "descripcion", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 10, default: 'UNI' }),
    __metadata("design:type", String)
], ItemFactura.prototype, "unidadMedida", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 14, scale: 4 }),
    __metadata("design:type", Number)
], ItemFactura.prototype, "cantidad", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 18, scale: 2 }),
    __metadata("design:type", Number)
], ItemFactura.prototype, "precioUnitario", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], ItemFactura.prototype, "descuentoPorcentaje", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 18, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], ItemFactura.prototype, "descuentoMonto", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 18, scale: 2 }),
    __metadata("design:type", Number)
], ItemFactura.prototype, "totalBruto", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 18, scale: 2 }),
    __metadata("design:type", Number)
], ItemFactura.prototype, "totalNeto", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: exports.afectacionesIVA, default: 'IVA10' }),
    __metadata("design:type", String)
], ItemFactura.prototype, "afectacionIVA", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 2, default: 10 }),
    __metadata("design:type", Number)
], ItemFactura.prototype, "tasaIVA", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 18, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], ItemFactura.prototype, "baseGravada", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 18, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], ItemFactura.prototype, "ivaLiquidado", void 0);
exports.ItemFactura = ItemFactura = __decorate([
    (0, typeorm_1.Entity)('items_factura')
], ItemFactura);
//# sourceMappingURL=item-factura.entity.js.map