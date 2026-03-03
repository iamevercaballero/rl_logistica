"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MovementsModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const movements_service_1 = require("./movements.service");
const movements_controller_1 = require("./movements.controller");
const movement_entity_1 = require("./entities/movement.entity");
const movement_detail_entity_1 = require("./entities/movement-detail.entity");
const pallet_entity_1 = require("../pallets/entities/pallet.entity");
let MovementsModule = class MovementsModule {
};
exports.MovementsModule = MovementsModule;
exports.MovementsModule = MovementsModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([movement_entity_1.Movement, movement_detail_entity_1.MovementDetail, pallet_entity_1.Pallet])],
        controllers: [movements_controller_1.MovementsController],
        providers: [movements_service_1.MovementsService],
    })
], MovementsModule);
//# sourceMappingURL=movements.module.js.map