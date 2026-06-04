import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ProductionPlansService } from './production-plans.service';
import { CreateProductionPlanDto } from './dto/create-production-plan.dto';
import { UpdateProductionPlanDto } from './dto/update-production-plan.dto';
import { QueryProductionPlanDto } from './dto/query-production-plan.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('production-plans')
export class ProductionPlansController {
  constructor(private readonly service: ProductionPlansService) {}

  @Post()
  @Roles('ADMIN', 'MANAGER')
  create(@Body() dto: CreateProductionPlanDto, @Request() req: { user: { id: string } }) {
    return this.service.create(dto, req.user.id);
  }

  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findAll(@Query() query: QueryProductionPlanDto) {
    return this.service.findAll(query);
  }

  @Get('upcoming')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  upcoming(@Query('days') days?: string) {
    return this.service.upcoming(days ? Number(days) : 7);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductionPlanDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.service.update(id, dto, req.user.id);
  }

  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
