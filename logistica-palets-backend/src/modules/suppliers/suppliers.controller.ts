import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';

@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly service: SuppliersService) {}

  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('suppliers', 'read')
  findAll(@Query('search') search?: string, @Query('includeInactive') includeInactive?: string) {
    return this.service.findAll(search, includeInactive === 'true');
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('suppliers', 'read')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  /** Alta rápida desde el formulario de entrada ("Agregar proveedor"). */
  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('suppliers', 'create')
  create(@Body() dto: CreateSupplierDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('suppliers', 'update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto) {
    return this.service.update(id, dto);
  }

  /** Baja lógica — el histórico de remitos conserva el nombre copiado. */
  @Patch(':id/deactivate')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('suppliers', 'remove')
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.deactivate(id);
  }
}
