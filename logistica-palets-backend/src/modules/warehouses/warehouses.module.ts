import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WarehousesService } from './warehouses.service';
import { WarehouseAccessService } from './warehouse-access.service';
import { WarehousesController } from './warehouses.controller';
import { Warehouse } from './entities/warehouse.entity';
import { UserWarehouse } from './entities/user-warehouse.entity';

/**
 * Global: `WarehouseAccessService` es la única autoridad de permisos por
 * depósito y lo necesitan casi todos los módulos operativos (movimientos,
 * reportes, pallets, lotes, ubicaciones, ajustes, alertas). Exponerlo como
 * global evita importar este módulo en cadena y los ciclos que eso genera —
 * mismo criterio que `CacheModule`.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Warehouse, UserWarehouse])],
  controllers: [WarehousesController],
  providers: [WarehousesService, WarehouseAccessService],
  exports: [WarehouseAccessService],
})
export class WarehousesModule {}
