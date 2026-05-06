"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const axios_1 = require("@nestjs/axios");
const billing_service_1 = require("./billing.service");
const billing_controller_1 = require("./billing.controller");
const xml_generator_service_1 = require("./xml-generator.service");
const sifen_service_1 = require("./sifen.service");
const cliente_entity_1 = require("./entities/cliente.entity");
const factura_entity_1 = require("./entities/factura.entity");
const item_factura_entity_1 = require("./entities/item-factura.entity");
let BillingModule = class BillingModule {
};
exports.BillingModule = BillingModule;
exports.BillingModule = BillingModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([cliente_entity_1.Cliente, factura_entity_1.Factura, item_factura_entity_1.ItemFactura]),
            axios_1.HttpModule,
        ],
        controllers: [billing_controller_1.BillingController],
        providers: [billing_service_1.BillingService, xml_generator_service_1.XmlGeneratorService, sifen_service_1.SifenService],
        exports: [billing_service_1.BillingService],
    })
], BillingModule);
//# sourceMappingURL=billing.module.js.map