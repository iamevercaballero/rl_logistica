import { Body, Controller, Get, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ReportsService } from './reports.service';
import { StockQueryDto } from './dto/stock-query.dto';
import { ReportsMovementsQueryDto } from './dto/movements-query.dto';
import { TraceQueryDto } from './dto/trace-query.dto';
import { KpisQueryDto } from './dto/kpis-query.dto';
import { DailyStockQueryDto } from './dto/daily-stock-query.dto';
import { DifferencesSapQueryDto } from './dto/differences-sap-query.dto';
import { UpsertSapStockDto } from './dto/upsert-sap-stock.dto';
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

/** `?warehouseId=` opcional pero, si viene, tiene que ser un UUID válido. */
const OptionalUuid = new ParseUUIDPipe({ optional: true });

/**
 * Todos los reportes se resuelven contra el alcance de depósitos del usuario.
 *
 * El `warehouseId` del query es una *preferencia* (el depósito activo del
 * frontend), nunca una autorización: `resolveQueryScope` valida el acceso y,
 * si no se manda ninguno, acota igual a los depósitos permitidos. Manipular
 * el parámetro no puede ampliar lo que se ve.
 *
 * `reports` es un único permiso de lectura (así lo trata la spec y el
 * frontend hoy) aunque el `@Roles()` de cada endpoint sea más fino — ese
 * `@Roles()` sigue siendo el piso real; `@RequirePermission` solo afina por
 * encima, nunca lo afloja.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly service: ReportsService,
    private readonly access: WarehouseAccessService,
  ) {}

  private async scopeOf(req: AuthedRequest, warehouseId?: string): Promise<WarehouseScope> {
    const { warehouseIds } = await this.access.resolveQueryScope(req.user, warehouseId);
    return warehouseIds;
  }

  @Get('stock')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('reports', 'read')
  async stock(@Query() query: StockQueryDto, @Req() req: AuthedRequest) {
    return this.service.stock(query, await this.scopeOf(req, query.warehouseId));
  }

  @Get('movements')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('reports', 'read')
  async movements(@Query() query: ReportsMovementsQueryDto, @Req() req: AuthedRequest) {
    return this.service.movements(query, await this.scopeOf(req, query.warehouseId));
  }

  @Get('trace')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('reports', 'read')
  async trace(@Query() query: TraceQueryDto, @Req() req: AuthedRequest) {
    return this.service.trace(query.materialId, await this.scopeOf(req, query.warehouseId));
  }

  @Get('daily-stock')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('reports', 'read')
  async dailyStock(@Query() query: DailyStockQueryDto, @Req() req: AuthedRequest) {
    return this.service.dailyStock(query, await this.scopeOf(req, query.warehouseId));
  }

  @Post('sap-stock')
  @Roles('ADMIN', 'MANAGER')
  async upsertSapStock(@Body() dto: UpsertSapStockDto, @Req() req: AuthedRequest) {
    // Escritura: el depósito del snapshot debe ser uno al que el usuario accede.
    if (dto.warehouseId) await this.access.assertWarehouseAccess(req.user, dto.warehouseId);
    return this.service.upsertSapStock(dto);
  }

  @Get('differences-sap')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  @RequirePermission('reports', 'read')
  async differencesSap(@Query() query: DifferencesSapQueryDto, @Req() req: AuthedRequest) {
    return this.service.differencesSap(query, await this.scopeOf(req, query.warehouseId));
  }

  @Get('kpis')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR', 'OPERATOR')
  @RequirePermission('reports', 'read')
  async kpis(@Query() query: KpisQueryDto, @Req() req: AuthedRequest) {
    return this.service.kpis(query, await this.scopeOf(req, query.warehouseId));
  }

  @Get('freshness')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('reports', 'read')
  async freshness(
    @Req() req: AuthedRequest,
    @Query('productId') productId?: string,
    @Query('warehouseId', OptionalUuid) warehouseId?: string,
  ) {
    return this.service.freshness(productId, await this.scopeOf(req, warehouseId));
  }

  /** Salud del inventario: detecta divergencias del invariante Stock=Lote=Pallet por producto. */
  @Get('inventory-health')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  @RequirePermission('reports', 'read')
  async inventoryHealth(@Req() req: AuthedRequest, @Query('warehouseId') warehouseId?: string) {
    return this.service.inventoryHealth(await this.scopeOf(req, warehouseId));
  }

  /** Ocupación: ubicaciones ocupadas vs totales y pallets vs capacidad, por depósito. */
  @Get('occupancy')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  @RequirePermission('reports', 'read')
  async occupancy(@Req() req: AuthedRequest, @Query('warehouseId') warehouseId?: string) {
    return this.service.occupancy(await this.scopeOf(req, warehouseId));
  }

  /** Rotación por producto en un período: salidas vs stock, top movers y dead stock. */
  @Get('rotation')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  @RequirePermission('reports', 'read')
  async rotation(
    @Req() req: AuthedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('warehouseId', OptionalUuid) warehouseId?: string,
  ) {
    return this.service.rotation(from, to, await this.scopeOf(req, warehouseId));
  }

  /** Dwell-time: antigüedad de los pallets en stock (base de facturación de almacenaje). */
  @Get('dwell-time')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  @RequirePermission('reports', 'read')
  async dwellTime(@Req() req: AuthedRequest, @Query('warehouseId') warehouseId?: string) {
    return this.service.dwellTime(await this.scopeOf(req, warehouseId));
  }
}
