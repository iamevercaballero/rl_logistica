import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PalletsController } from './pallets.controller';
import { PalletsService } from './pallets.service';
import { Pallet } from './entities/pallet.entity';
import { Lot } from '../lots/entities/lot.entity';
import { Location } from '../locations/entities/location.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Pallet, Lot, Location])],
  controllers: [PalletsController],
  providers: [PalletsService],
})
export class PalletsModule {}
