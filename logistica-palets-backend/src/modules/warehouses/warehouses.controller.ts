import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { WarehousesService } from './warehouses.service';
import { WarehouseAccessService, type AccessUser } from './warehouse-access.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';

type AuthedRequest = Request & { user: AccessUser };

@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@Controller('warehouses')
export class WarehousesController {
  constructor(
    private readonly service: WarehousesService,
    private readonly access: WarehouseAccessService,
  ) {}

  /**
   * Depósitos que el usuario autenticado puede seleccionar. Es la fuente que
   * alimenta el selector global del frontend: el cliente nunca decide su
   * propio alcance, lo resuelve el backend a partir del rol y sus asignaciones.
   *
   * Sin `@RequirePermission`: incluso un usuario a quien se le apague
   * `warehouses:read` (poco probable, pero posible) sigue necesitando saber en
   * qué depósito trabaja para que el resto de la app funcione.
   */
  @Get('allowed')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  allowed(@Req() req: AuthedRequest) {
    return this.access.getAllowedWarehouses(req.user);
  }

  // ✅ READ: catálogo maestro completo (incluye inactivos) — administración.
  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('warehouses', 'read')
  findAll() {
    return this.service.findAll();
  }

  /** Layout del depósito: ubicaciones con estructura + ocupación + resumen por zona. */
  @Get(':id/layout')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('warehouses', 'read')
  async layout(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    await this.access.assertWarehouseAccess(req.user, id);
    return this.service.layout(id);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('warehouses', 'read')
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    await this.access.assertWarehouseAccess(req.user, id);
    return this.service.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('warehouses', 'create')
  create(@Body() dto: CreateWarehouseDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('warehouses', 'update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWarehouseDto) {
    return this.service.update(id, dto);
  }

  /** Baja de depósito: operación de catálogo maestro, no de piso. */
  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('warehouses', 'remove')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
