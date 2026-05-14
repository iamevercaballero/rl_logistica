import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LotsService } from './lots.service';
import { LotsController } from './lots.controller';
import { Lot } from './entities/lot.entity';
import { Product } from '../products/entities/product.entity';
import { Pallet } from '../pallets/entities/pallet.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Lot, Product, Pallet])],
  controllers: [LotsController],
  providers: [LotsService],
})
export class LotsModule {}
