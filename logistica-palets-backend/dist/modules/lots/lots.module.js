"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LotsModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const lots_service_1 = require("./lots.service");
const lots_controller_1 = require("./lots.controller");
const lot_entity_1 = require("./entities/lot.entity");
const product_entity_1 = require("../products/entities/product.entity");
let LotsModule = class LotsModule {
};
exports.LotsModule = LotsModule;
exports.LotsModule = LotsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([lot_entity_1.Lot, product_entity_1.Product])
        ],
        controllers: [lots_controller_1.LotsController],
        providers: [lots_service_1.LotsService],
    })
], LotsModule);
//# sourceMappingURL=lots.module.js.map