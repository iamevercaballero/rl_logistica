import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { RolesGuard } from '../auth/roles/roles.guard';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { CreateTransportDto } from './dto/create-transport.dto';
import { RegisterInspectionDto, UpdateTransportDto } from './dto/update-transport.dto';
import { TransportsService } from './transports.service';

@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@Controller('transports')
export class TransportsController {
  constructor(private readonly service: TransportsService) {}

  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('transports', 'read')
  findAll() {
    return this.service.findAll();
  }

  /** Historial de remitos (entradas/salidas) vinculados a la patente del vehículo. */
  @Get(':id/history')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('transports', 'read')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.history(id);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('transports', 'read')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('transports', 'create')
  create(
    @Body() dto: CreateTransportDto,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.create(dto, req.user.userId);
  }

  /** Registra una inspección en la bitácora del vehículo. */
  @Post(':id/inspection')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('transports', 'update')
  inspect(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegisterInspectionDto,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.inspect(id, dto, req.user.userId);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('transports', 'update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTransportDto,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.update(id, dto, req.user.userId);
  }

  @Delete(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('transports', 'remove')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.remove(id, req.user.userId);
  }
}
