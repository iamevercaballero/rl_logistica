import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdjustmentsController } from './adjustments.controller';
import { AdjustmentsService } from './adjustments.service';
import { AdjustmentRequest } from './entities/adjustment-request.entity';
import { AdjustmentRequestLine } from './entities/adjustment-request-line.entity';
import { MovementsModule } from '../movements/movements.module';
import { UploadsModule } from '../uploads/uploads.module';
import { CacheModule } from '../cache/cache.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdjustmentRequest, AdjustmentRequestLine]),
    MovementsModule,
    UploadsModule,
    CacheModule,
    EventsModule,
  ],
  controllers: [AdjustmentsController],
  providers: [AdjustmentsService],
  exports: [AdjustmentsService],
})
export class AdjustmentsModule {}
