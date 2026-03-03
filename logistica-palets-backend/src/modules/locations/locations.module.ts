import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LocationsService } from './locations.service';
import { LocationsController } from './locations.controller';
import { Location } from './entities/location.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Location, Warehouse])],
  controllers: [LocationsController],
  providers: [LocationsService],
})
export class LocationsModule {}
