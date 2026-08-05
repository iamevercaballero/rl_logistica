import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LocationsService } from './locations.service';
import { LocationsController } from './locations.controller';
import { Location } from './entities/location.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { Pallet } from '../pallets/entities/pallet.entity';
import { Product } from '../products/entities/product.entity';
import { Pila } from '../pilas/entities/pila.entity';
import { PilasModule } from '../pilas/pilas.module';

@Module({
  imports: [TypeOrmModule.forFeature([Location, Warehouse, Pallet, Product, Pila]), PilasModule],
  controllers: [LocationsController],
  providers: [LocationsService],
})
export class LocationsModule {}
