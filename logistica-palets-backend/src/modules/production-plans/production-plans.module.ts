import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductionPlan } from './entities/production-plan.entity';
import { ProductionPlansService } from './production-plans.service';
import { ProductionPlansController } from './production-plans.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ProductionPlan])],
  controllers: [ProductionPlansController],
  providers: [ProductionPlansService],
  exports: [ProductionPlansService],
})
export class ProductionPlansModule {}
