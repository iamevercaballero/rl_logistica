import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { StockQueryDto } from './dto/stock-query.dto';
import { ReportsMovementsQueryDto } from './dto/movements-query.dto';
import { TraceQueryDto } from './dto/trace-query.dto';
import { KpisQueryDto } from './dto/kpis-query.dto';
import { DailyStockQueryDto } from './dto/daily-stock-query.dto';
import { DifferencesSapQueryDto } from './dto/differences-sap-query.dto';
import { UpsertSapStockDto } from './dto/upsert-sap-stock.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('stock')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  stock(@Query() query: StockQueryDto) {
    return this.service.stock(query);
  }

  @Get('movements')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  movements(@Query() query: ReportsMovementsQueryDto) {
    return this.service.movements(query);
  }

  @Get('trace')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  trace(@Query() query: TraceQueryDto) {
    return this.service.trace(query.materialId);
  }

  @Get('daily-stock')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  dailyStock(@Query() query: DailyStockQueryDto) {
    return this.service.dailyStock(query);
  }

  @Post('sap-stock')
  @Roles('ADMIN', 'MANAGER')
  upsertSapStock(@Body() dto: UpsertSapStockDto) {
    return this.service.upsertSapStock(dto);
  }

  @Get('differences-sap')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  differencesSap(@Query() query: DifferencesSapQueryDto) {
    return this.service.differencesSap(query);
  }

  @Get('kpis')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  kpis(@Query() query: KpisQueryDto) {
    return this.service.kpis(query);
  }
}
