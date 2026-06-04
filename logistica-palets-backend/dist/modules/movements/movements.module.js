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
const regularization_log_entity_1 = require("./entities/regularization-log.entity");
const logistics_document_entity_1 = require("./entities/logistics-document.entity");
const document_sequence_entity_1 = require("./entities/document-sequence.entity");
const document_sequence_service_1 = require("./document-sequence.service");
const product_entity_1 = require("../products/entities/product.entity");
const location_entity_1 = require("../locations/entities/location.entity");
const warehouse_entity_1 = require("../warehouses/entities/warehouse.entity");
const stock_entity_1 = require("../stocks/entities/stock.entity");
const lot_entity_1 = require("../lots/entities/lot.entity");
const pallet_entity_1 = require("../pallets/entities/pallet.entity");
const adjustment_request_entity_1 = require("../adjustments/entities/adjustment-request.entity");
const adjustment_request_line_entity_1 = require("../adjustments/entities/adjustment-request-line.entity");
const uploads_module_1 = require("../uploads/uploads.module");
let MovementsModule = class MovementsModule {
};
exports.MovementsModule = MovementsModule;
exports.MovementsModule = MovementsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            uploads_module_1.UploadsModule,
            typeorm_1.TypeOrmModule.forFeature([
                movement_entity_1.Movement,
                movement_detail_entity_1.MovementDetail,
                regularization_log_entity_1.RegularizationLog,
                logistics_document_entity_1.LogisticsDocument,
                document_sequence_entity_1.DocumentSequence,
                product_entity_1.Product,
                location_entity_1.Location,
                warehouse_entity_1.Warehouse,
                stock_entity_1.Stock,
                lot_entity_1.Lot,
                pallet_entity_1.Pallet,
                adjustment_request_entity_1.AdjustmentRequest,
                adjustment_request_line_entity_1.AdjustmentRequestLine,
            ]),
        ],
        controllers: [movements_controller_1.MovementsController],
        providers: [movements_service_1.MovementsService, document_sequence_service_1.DocumentSequenceService],
        exports: [movements_service_1.MovementsService, document_sequence_service_1.DocumentSequenceService],
    })
], MovementsModule);
//# sourceMappingURL=movements.module.js.map