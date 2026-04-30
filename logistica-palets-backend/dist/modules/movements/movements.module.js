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
const product_entity_1 = require("../products/entities/product.entity");
const location_entity_1 = require("../locations/entities/location.entity");
const warehouse_entity_1 = require("../warehouses/entities/warehouse.entity");
const stock_entity_1 = require("../stocks/entities/stock.entity");
let MovementsModule = class MovementsModule {
};
exports.MovementsModule = MovementsModule;
exports.MovementsModule = MovementsModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([movement_entity_1.Movement, movement_detail_entity_1.MovementDetail, product_entity_1.Product, location_entity_1.Location, warehouse_entity_1.Warehouse, stock_entity_1.Stock])],
        controllers: [movements_controller_1.MovementsController],
        providers: [movements_service_1.MovementsService],
        exports: [movements_service_1.MovementsService],
    })
], MovementsModule);
//# sourceMappingURL=movements.module.js.map