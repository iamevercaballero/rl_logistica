import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  MethodNotAllowedException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { Request } from 'express';
import { PalletsService } from './pallets.service';
import { CreatePalletDto } from './dto/create-pallet.dto';
import { UpdatePalletDto } from './dto/update-pallet.dto';
import {
  WarehouseAccessService,
  type AccessUser,
  type WarehouseScope,
} from '../warehouses/warehouse-access.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';

class QuickTransferDto {
  @IsUUID()
  toLocationId: string;
}

type AuthedRequest = Request & { user: AccessUser };
const OptionalUuid = new ParseUUIDPipe({ optional: true });

@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@Controller('pallets')
export class PalletsController {
  constructor(
    private readonly service: PalletsService,
    private readonly access: WarehouseAccessService,
  ) {}

  private async scopeOf(req: AuthedRequest, warehouseId?: string): Promise<WarehouseScope> {
    const { warehouseIds } = await this.access.resolveQueryScope(req.user, warehouseId);
    return warehouseIds;
  }

  // ── READ ──────────────────────────────────────────────────────────────────

  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('pallets', 'read')
  async findAll(
    @Req() req: AuthedRequest,
    @Query('lotId') lotId?: string,
    @Query('status') status?: string,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
    @Query('search') search?: string,
    @Query('warehouseId', OptionalUuid) warehouseId?: string,
  ) {
    return this.service.findAll(
      { lotId, status, productId, locationId, search },
      await this.scopeOf(req, warehouseId),
    );
  }

  /** KPI counts — must be before :id to avoid param collision */
  @Get('kpis')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('pallets', 'read')
  async kpis(@Req() req: AuthedRequest, @Query('warehouseId', OptionalUuid) warehouseId?: string) {
    return this.service.kpis(await this.scopeOf(req, warehouseId));
  }

  /** Reconcilia estados inconsistentes de pallets existentes según su historial */
  @Post('reconcile-status')
  @Roles('ADMIN', 'MANAGER')
  reconcileStatuses() {
    return this.service.reconcileStatuses();
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('pallets', 'read')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.service.findOne(id, req.user);
  }

  @Get(':id/history')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  @RequirePermission('pallets', 'read')
  history(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.service.history(id, req.user);
  }

  // ── WRITE ─────────────────────────────────────────────────────────────────

  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('pallets', 'create')
  create(@Body() dto: CreatePalletDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, req.user);
  }

  /** Quick transfer: move a single pallet to a new location, records a TRANSFER movement */
  @Post(':id/transfer')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('pallets', 'update')
  quickTransfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QuickTransferDto,
    @Req() req: AuthedRequest,
  ) {
    return this.service.quickTransfer(id, dto.toLocationId, req.user.userId, req.user.role);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('pallets', 'update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePalletDto, @Req() req: AuthedRequest) {
    return this.service.update(id, dto, req.user);
  }

  // DELETE deshabilitado — los pallets no se eliminan para preservar trazabilidad
  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.METHOD_NOT_ALLOWED)
  remove(@Param('id', ParseUUIDPipe) _id: string) {
    throw new MethodNotAllowedException(
      'La eliminación de pallets está deshabilitada para preservar la trazabilidad',
    );
  }
}
