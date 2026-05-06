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
exports.CreateFacturaDto = exports.CreateItemFacturaDto = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const factura_entity_1 = require("../entities/factura.entity");
const item_factura_entity_1 = require("../entities/item-factura.entity");
class CreateItemFacturaDto {
}
exports.CreateItemFacturaDto = CreateItemFacturaDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], CreateItemFacturaDto.prototype, "codigo", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CreateItemFacturaDto.prototype, "descripcion", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(10),
    __metadata("design:type", String)
], CreateItemFacturaDto.prototype, "unidadMedida", void 0);
__decorate([
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateItemFacturaDto.prototype, "cantidad", void 0);
__decorate([
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateItemFacturaDto.prototype, "precioUnitario", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateItemFacturaDto.prototype, "descuentoPorcentaje", void 0);
__decorate([
    (0, class_validator_1.IsEnum)(item_factura_entity_1.afectacionesIVA),
    __metadata("design:type", String)
], CreateItemFacturaDto.prototype, "afectacionIVA", void 0);
class CreateFacturaDto {
}
exports.CreateFacturaDto = CreateFacturaDto;
__decorate([
    (0, class_validator_1.IsEnum)(factura_entity_1.tiposDE),
    __metadata("design:type", String)
], CreateFacturaDto.prototype, "tipoDE", void 0);
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateFacturaDto.prototype, "clienteId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateFacturaDto.prototype, "fecha", void 0);
__decorate([
    (0, class_validator_1.IsEnum)(factura_entity_1.condicionesPago),
    __metadata("design:type", String)
], CreateFacturaDto.prototype, "condicionPago", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(3),
    __metadata("design:type", String)
], CreateFacturaDto.prototype, "moneda", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateFacturaDto.prototype, "movimientoId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CreateFacturaDto.prototype, "observaciones", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => CreateItemFacturaDto),
    __metadata("design:type", Array)
], CreateFacturaDto.prototype, "items", void 0);
//# sourceMappingURL=create-factura.dto.js.map