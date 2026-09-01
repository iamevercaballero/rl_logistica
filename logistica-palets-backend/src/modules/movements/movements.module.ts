import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MovementsService } from './movements.service';
import { MovementsController } from './movements.controller';
import { Movement } from './entities/movement.entity';
import { MovementDetail } from './entities/movement-detail.entity';
import { RegularizationLog } from './entities/regularization-log.entity';
import { LogisticsDocument } from './entities/logistics-document.entity';
import { DocumentSequence } from './entities/document-sequence.entity';
import { DocumentSequenceService } from './document-sequence.service';
import { Product } from '../products/entities/product.entity';
import { Location } from '../locations/entities/location.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { Stock } from '../stocks/entities/stock.entity';
import { Lot } from '../lots/entities/lot.entity';
import { Pallet } from '../pallets/entities/pallet.entity';
import { AdjustmentRequest } from '../adjustments/entities/adjustment-request.entity';
import { AdjustmentRequestLine } from '../adjustments/entities/adjustment-request-line.entity';
import { UploadsModule } from '../uploads/uploads.module';
import { PilasModule } from '../pilas/pilas.module';

@Module({
  imports: [IdempotencyModule, 
    UploadsModule,
    PilasModule,
    TypeOrmModule.forFeature([
      Movement,
      MovementDetail,
      RegularizationLog,
      LogisticsDocument,
      DocumentSequence,
      Product,
      Location,
      Warehouse,
      Stock,
      Lot,
      Pallet,
      AdjustmentRequest,
      AdjustmentRequestLine,
    ]),
  ],
  controllers: [MovementsController],
  providers: [MovementsService, DocumentSequenceService],
  exports: [MovementsService, DocumentSequenceService],
})
export class MovementsModule {}
