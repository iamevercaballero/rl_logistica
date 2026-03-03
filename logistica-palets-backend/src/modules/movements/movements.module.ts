import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MovementsService } from './movements.service';
import { MovementsController } from './movements.controller';
import { Movement } from './entities/movement.entity';
import { MovementDetail } from './entities/movement-detail.entity';
import { Pallet } from '../pallets/entities/pallet.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Movement, MovementDetail, Pallet])],
  controllers: [MovementsController],
  providers: [MovementsService],
})
export class MovementsModule {}
