import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransportsController } from './transports.controller';
import { TransportsService } from './transports.service';
import { Transport } from './entities/transport.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Transport])],
  controllers: [TransportsController],
  providers: [TransportsService],
})
export class TransportsModule {}
