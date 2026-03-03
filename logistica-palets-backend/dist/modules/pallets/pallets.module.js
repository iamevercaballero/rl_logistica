"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PalletsModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const pallets_controller_1 = require("./pallets.controller");
const pallets_service_1 = require("./pallets.service");
const pallet_entity_1 = require("./entities/pallet.entity");
const lot_entity_1 = require("../lots/entities/lot.entity");
const location_entity_1 = require("../locations/entities/location.entity");
let PalletsModule = class PalletsModule {
};
exports.PalletsModule = PalletsModule;
exports.PalletsModule = PalletsModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([pallet_entity_1.Pallet, lot_entity_1.Lot, location_entity_1.Location])],
        controllers: [pallets_controller_1.PalletsController],
        providers: [pallets_service_1.PalletsService],
    })
], PalletsModule);
//# sourceMappingURL=pallets.module.js.map