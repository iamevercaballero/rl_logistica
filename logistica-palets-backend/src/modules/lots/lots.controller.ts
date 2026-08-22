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
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { LotsService } from './lots.service';
import { CreateLotDto } from './dto/create-lot.dto';
import { UpdateLotDto } from './dto/update-lot.dto';
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

type AuthedRequest = Request & { user: AccessUser };
const OptionalUuid = new ParseUUIDPipe({ optional: true });

@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@Controller('lots')
export class LotsController {
  constructor(
    private readonly service: LotsService,
    private readonly access: WarehouseAccessService,
  ) {}

  private async scopeOf(req: AuthedRequest, warehouseId?: string): Promise<WarehouseScope> {
    const { warehouseIds } = await this.access.resolveQueryScope(req.user, warehouseId);
    return warehouseIds;
  }

  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('lots', 'read')
  async findAll(
    @Req() req: AuthedRequest,
    @Query('productId') productId?: string,
    @Query('sapLot') sapLot?: string,
    @Query('includePallets') includePallets?: string,
    @Query('warehouseId', OptionalUuid) warehouseId?: string,
  ) {
    return this.service.findAll(
      productId,
      sapLot,
      includePallets === 'true',
      await this.scopeOf(req, warehouseId),
    );
  }

  /** FEFO: lotes con stock disponible ordenados por vencimiento próximo.
   *  Filtra por productId, sapLot, o locationId (para selección de pallets en transferencias). */
  @Get('fefo')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('lots', 'read')
  async fefo(
    @Req() req: AuthedRequest,
    @Query('productId') productId?: string,
    @Query('sapLot') sapLot?: string,
    @Query('locationId') locationId?: string,
    @Query('warehouseId', OptionalUuid) warehouseId?: string,
  ) {
    return this.service.findFefo(productId, sapLot, locationId, await this.scopeOf(req, warehouseId));
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('lots', 'read')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('lots', 'create')
  create(@Body() dto: CreateLotDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('lots', 'update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLotDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('lots', 'remove')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  /** Reconcilia stockActual de un lote específico desde sus pallets reales. */
  @Post(':id/reconcile')
  @HttpCode(200)
  @Roles('ADMIN', 'MANAGER')
  reconcile(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.reconcileStock(id);
  }

  /** Reconcilia stockActual de todos los lotes (o de un producto). Solo reporta correcciones. */
  @Post('reconcile-all')
  @HttpCode(200)
  @Roles('ADMIN', 'MANAGER')
  reconcileAll(@Query('productId') productId?: string) {
    return this.service.reconcileAllStocks(productId);
  }
}
