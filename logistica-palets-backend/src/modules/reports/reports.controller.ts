import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { StockQueryDto } from './dto/stock-query.dto';
import { ReportsMovementsQueryDto } from './dto/movements-query.dto';
import { TraceQueryDto } from './dto/trace-query.dto';
import { KpisQueryDto } from './dto/kpis-query.dto';

@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('stock')
  stock(@Query() query: StockQueryDto) {
    return this.service.stock(query);
  }

  @Get('movements')
  movements(@Query() query: ReportsMovementsQueryDto) {
    return this.service.movements(query);
  }

  @Get('trace')
  trace(@Query() query: TraceQueryDto) {
    return this.service.trace(query.palletId);
  }

  @Get('kpis')
  kpis(@Query() query: KpisQueryDto) {
    return this.service.kpis(query);
  }
}
