import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('stock')
  stock() {
    return this.service.stock();
  }

  @Get('movements')
  movements() {
    return this.service.movements();
  }

  @Get('trace')
  trace(@Query('palletId') palletId: string) {
    return this.service.trace(palletId);
  }
    @Get('kpis')
  kpis() {
    return this.service.kpis();
  }

}
