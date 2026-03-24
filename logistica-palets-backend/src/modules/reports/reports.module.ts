import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { SapStockSnapshot } from './entities/sap-stock.entity';
import { Stock } from '../stocks/entities/stock.entity';
import { Movement } from '../movements/entities/movement.entity';
import { Product } from '../products/entities/product.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { Location } from '../locations/entities/location.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SapStockSnapshot, Stock, Movement, Product, Warehouse, Location])],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
