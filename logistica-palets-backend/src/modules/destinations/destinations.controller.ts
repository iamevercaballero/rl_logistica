import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { RolesGuard } from '../auth/roles/roles.guard';
import { CreateDestinationDto, UpdateDestinationDto } from './dto/destination.dto';
import { DestinationsService } from './destinations.service';

@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@Controller('destinations')
export class DestinationsController {
  constructor(private readonly service: DestinationsService) {}

  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('destinations', 'read')
  findAll(@Query('search') search?: string, @Query('includeInactive') includeInactive?: string) {
    return this.service.findAll(search, includeInactive === 'true');
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('destinations', 'read')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  /** Alta rápida desde el selector de Destino de una Salida. */
  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('destinations', 'create')
  create(@Body() dto: CreateDestinationDto) {
    return this.service.create(dto);
  }

  /*
   * Mismo criterio que proveedores: editar y dar de baja el catálogo es de
   * supervisión y la plantilla de OPERATOR no lo trae, pero el rol deja pasar
   * para que otorgarlo por persona sirva de algo.
   */
  @Patch(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('destinations', 'update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDestinationDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/deactivate')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('destinations', 'remove')
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.deactivate(id);
  }
}
