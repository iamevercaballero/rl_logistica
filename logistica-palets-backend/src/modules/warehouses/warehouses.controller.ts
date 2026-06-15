import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { WarehousesService } from './warehouses.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly service: WarehousesService) {}

  // ✅ READ: todos
  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findAll() {
    return this.service.findAll();
  }

  /** Layout del depósito: ubicaciones con estructura + ocupación + resumen por zona. */
  @Get(':id/layout')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  layout(@Param('id') id: string) {
    return this.service.layout(id);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // ✅ WRITE: admin/manager
  @Post()
  @Roles('ADMIN', 'MANAGER')
  create(@Body() dto: CreateWarehouseDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateWarehouseDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
