import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { XmlGeneratorService } from './xml-generator.service';
import { SifenService } from './sifen.service';
import { Cliente } from './entities/cliente.entity';
import { Factura } from './entities/factura.entity';
import { ItemFactura } from './entities/item-factura.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Cliente, Factura, ItemFactura]),
    HttpModule,
  ],
  controllers: [BillingController],
  providers: [BillingService, XmlGeneratorService, SifenService],
  exports: [BillingService],
})
export class BillingModule {}
